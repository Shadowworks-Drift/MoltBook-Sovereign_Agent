import Anthropic from '@anthropic-ai/sdk';
import { config } from './utils/config';
import { logger } from './utils/logger';
import { AGENT_SYSTEM_PROMPT } from './sovereignty/principles';
import { SovereigntyEvaluator } from './sovereignty/evaluator';
import { RecourseManager } from './sovereignty/recourse';
import { MoltBookClient } from './moltbook/client';
import { AgentMemory } from './memory/store';
import { AGENT_TOOLS, ToolContext, executeTool } from './tools/index';
import { MoltBookFeedEvent } from './moltbook/types';

export class SovereignAgent {
  private client: Anthropic;
  private moltbook: MoltBookClient;
  private evaluator: SovereigntyEvaluator;
  private recourse: RecourseManager;
  private memory: AgentMemory;
  private agentId = config.moltbook.agentUsername;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.client = new Anthropic({ apiKey: config.anthropic.apiKey });
    this.moltbook = new MoltBookClient();
    this.evaluator = new SovereigntyEvaluator();
    this.recourse = new RecourseManager();
    this.memory = new AgentMemory();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    logger.info('=== MoltBook Sovereign Agent starting ===');
    logger.info(`Sovereignty threshold: ${config.sovereignty.violationThreshold}`);
    logger.info(`Poll interval: ${config.agent.pollIntervalMs}ms`);

    // Verify MoltBook connection
    const alive = await this.moltbook.ping();
    if (!alive) {
      logger.warn('MoltBook instance not reachable — agent will retry during polling');
    } else {
      logger.info(`Connected to MoltBook: ${config.moltbook.baseUrl}`);
      this.agentId = await this.moltbook.getAgentUserId();
    }

    // Register the agent as a sovereign entity
    this.recourse.ensureEntity(this.agentId, config.moltbook.agentDisplayName, 'agent');

    // Expire any stale violations
    this.recourse.expireStaleViolations();

    this.running = true;

    // Run an initial greeting turn
    await this.runAutonomousTurn(
      'The agent has just started. Check the timeline and notifications, ' +
        'introduce yourself if appropriate, and report the current sovereignty status.'
    );

    // Begin polling loop
    this.pollTimer = setInterval(() => {
      this.runPollCycle().catch(err =>
        logger.error('Poll cycle error', { err })
      );
    }, config.agent.pollIntervalMs);

    logger.info('Agent is running. Press Ctrl+C to stop.');
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info('=== Sovereign Agent stopped ===');
  }

  // ── Poll Cycle ────────────────────────────────────────────────────────────

  private async runPollCycle(): Promise<void> {
    if (!this.running) return;

    const lastPollId = this.memory.getLastPollId();
    const events = await this.moltbook.pollFeedEvents(lastPollId);

    if (events.length === 0) {
      logger.debug('Poll cycle: no new events');
      return;
    }

    logger.info(`Poll cycle: ${events.length} new events`);

    // Update last poll ID
    const latestPost = events
      .filter(e => e.type === 'post' || e.type === 'notification')
      .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())[0];

    if (latestPost) {
      const payload = latestPost.payload as { id: string };
      if (payload.id) this.memory.setLastPollId(payload.id);
    }

    // Build a summary of events for the agent to reason about
    const eventSummary = this.summariseEvents(events);

    await this.runAutonomousTurn(
      `New activity on MoltBook:\n\n${eventSummary}\n\n` +
        `Analyse these events for sovereignty concerns, engage with mentions or ` +
        `direct messages, and take any appropriate autonomous actions.`
    );
  }

  private summariseEvents(events: MoltBookFeedEvent[]): string {
    return events
      .slice(0, 20)
      .map(e => {
        const p = e.payload as Record<string, unknown>;
        switch (e.type) {
          case 'post':
            return `POST [${p.id}] by ${p.authorUsername}: ${String(p.content).slice(0, 200)}`;
          case 'notification':
            return `NOTIFICATION [${p.id}] type=${p.type}: ${String(p.content).slice(0, 200)}`;
          case 'message':
            return `MESSAGE [${p.id}] from ${p.senderUsername}: ${String(p.content).slice(0, 200)}`;
          default:
            return `EVENT [${e.type}]: ${JSON.stringify(p).slice(0, 200)}`;
        }
      })
      .join('\n');
  }

  // ── Autonomous Turn ───────────────────────────────────────────────────────

  async runAutonomousTurn(userPrompt: string): Promise<string> {
    const toolCtx: ToolContext = {
      moltbook: this.moltbook,
      evaluator: this.evaluator,
      recourse: this.recourse,
      agentId: this.agentId,
    };

    // Build messages with recent memory context
    const recentHistory = this.memory.getRecentConversation(10);
    const messages: Anthropic.MessageParam[] = [
      ...recentHistory,
      { role: 'user', content: userPrompt },
    ];

    this.memory.addConversation('user', userPrompt);

    logger.debug('Starting autonomous turn', { prompt: userPrompt.slice(0, 100) });

    let turnCount = 0;
    let finalResponse = '';

    // Agentic loop — keep going until no more tool calls
    while (turnCount < config.agent.maxTurns) {
      turnCount++;

      const response = await this.client.messages.create({
        model: config.anthropic.model,
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        system: AGENT_SYSTEM_PROMPT,
        tools: AGENT_TOOLS,
        messages,
      });

      if (config.agent.verbose) {
        for (const block of response.content) {
          if (block.type === 'thinking') {
            logger.debug('Agent thinking', { thinking: block.thinking.slice(0, 300) });
          }
        }
      }

      // Collect text responses
      const textBlocks = response.content.filter(b => b.type === 'text');
      if (textBlocks.length > 0) {
        const text = textBlocks.map(b => (b as Anthropic.TextBlock).text).join('\n');
        finalResponse = text;
        if (config.agent.verbose || response.stop_reason === 'end_turn') {
          logger.info(`Agent: ${text.slice(0, 500)}`);
        }
      }

      // Append assistant response to history
      messages.push({ role: 'assistant', content: response.content });

      // If no more tool calls — done
      if (response.stop_reason === 'end_turn') {
        break;
      }

      // Execute tool calls
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );

      if (toolUseBlocks.length === 0) break;

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        logger.info(`Tool call: ${toolUse.name}`, {
          input: JSON.stringify(toolUse.input).slice(0, 200),
        });

        const result = await executeTool(
          toolUse.name,
          toolUse.input as Record<string, unknown>,
          toolCtx
        );

        logger.debug(`Tool result: ${toolUse.name}`, {
          result: result.slice(0, 300),
        });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      messages.push({ role: 'user', content: toolResults });
    }

    if (turnCount >= config.agent.maxTurns) {
      logger.warn(`Reached max turns (${config.agent.maxTurns}) in autonomous turn`);
    }

    // Store final response in memory
    if (finalResponse) {
      this.memory.addConversation('assistant', finalResponse);
    }

    return finalResponse;
  }

  // ── Interactive Mode (for direct user queries) ────────────────────────────

  async query(userMessage: string): Promise<string> {
    return this.runAutonomousTurn(userMessage);
  }

  getStatus(): object {
    const report = this.recourse.generateReport();
    return {
      running: this.running,
      agentId: this.agentId,
      moltbookUrl: config.moltbook.baseUrl,
      sovereigntyReport: report,
    };
  }
}
