import { Ollama, Message, Tool } from 'ollama';
import { config } from './utils/config';
import { logger } from './utils/logger';
import { AGENT_SYSTEM_PROMPT } from './sovereignty/principles';
import { SovereigntyEvaluator } from './sovereignty/evaluator';
import { RecourseManager } from './sovereignty/recourse';
import { MoltBookClient } from './moltbook/client';
import { AgentMemory } from './memory/store';
import { OLLAMA_TOOLS, executeOllamaTool, OllamaToolContext } from './tools/index';
import { MoltBookFeedEvent } from './moltbook/types';

export class SovereignAgent {
  private ollama: Ollama;
  private moltbook: MoltBookClient;
  private evaluator: SovereigntyEvaluator;
  private recourse: RecourseManager;
  private memory: AgentMemory;
  private agentId: string;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.ollama = new Ollama({ host: config.ollama.host });
    this.moltbook = new MoltBookClient();
    this.evaluator = new SovereigntyEvaluator();
    this.recourse = new RecourseManager();
    this.memory = new AgentMemory();
    this.agentId = config.moltbook.agentUsername;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    logger.info(`=== ${config.moltbook.agentDisplayName} starting ===`);
    logger.info(`Local model: ${config.ollama.model} @ ${config.ollama.host}`);

    // Verify Ollama is running and model is available
    await this.ensureModel();

    // Connect to MoltBook
    const alive = await this.moltbook.ping();
    if (alive) {
      this.agentId = await this.moltbook.getAgentUserId();
      logger.info(`Connected to MoltBook as: ${this.agentId}`);
    } else {
      logger.warn(`MoltBook not reachable at ${config.moltbook.baseUrl} — will retry`);
    }

    // Register agent as sovereign entity
    this.recourse.ensureEntity(this.agentId, config.moltbook.agentDisplayName, 'agent');
    this.recourse.expireStaleViolations();

    this.running = true;

    // Initial "wake up" turn — check feed and decide what to do
    await this.runTurn(
      `You've just come online. Check your notifications and recent timeline. ` +
      `Engage with anything interesting, reply to any mentions, and introduce ` +
      `yourself if the opportunity feels natural. Act like you've just opened the app.`
    );

    // Begin polling loop
    this.pollTimer = setInterval(() => {
      this.runPollCycle().catch(err => logger.error('Poll cycle error', { err }));
    }, config.agent.pollIntervalMs);

    logger.info(`Agent running — polling every ${config.agent.pollIntervalMs / 1000}s. Ctrl+C to stop.`);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info('=== Agent stopped ===');
  }

  // ── Model Check ───────────────────────────────────────────────────────────

  private async ensureModel(): Promise<void> {
    try {
      const list = await this.ollama.list();
      const available = list.models.map(m => m.name);
      const modelName = config.ollama.model;

      // Check if the requested model (or a variant) is available
      const found = available.some(
        n => n === modelName || n.startsWith(modelName + ':') || n.startsWith(modelName.split(':')[0])
      );

      if (!found) {
        logger.info(`Model "${modelName}" not found locally — pulling now (this may take a few minutes)...`);
        logger.info(`Available models: ${available.join(', ') || 'none'}`);

        const pullStream = await this.ollama.pull({ model: modelName, stream: true });
        let lastStatus = '';
        for await (const part of pullStream) {
          if (part.status !== lastStatus) {
            logger.info(`Pulling ${modelName}: ${part.status}`);
            lastStatus = part.status;
          }
        }
        logger.info(`Model "${modelName}" ready`);
      } else {
        logger.info(`Model "${modelName}" available locally`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ECONNREFUSED') || msg.includes('connect')) {
        throw new Error(
          `Cannot connect to Ollama at ${config.ollama.host}.\n` +
          `Is Ollama running? Start it with: ollama serve`
        );
      }
      throw err;
    }
  }

  // ── Poll Cycle ────────────────────────────────────────────────────────────

  private async runPollCycle(): Promise<void> {
    if (!this.running) return;

    const lastId = this.memory.getLastPollId();
    const events = await this.moltbook.pollFeedEvents(lastId);

    if (events.length === 0) {
      logger.debug('No new events');
      return;
    }

    logger.info(`${events.length} new event(s)`);

    // Track latest event ID for next poll
    const newest = events
      .map(e => (e.payload as { id?: string }).id)
      .filter((id): id is string => !!id)
      .sort()
      .pop();
    if (newest) this.memory.setLastPollId(newest);

    const summary = this.summariseEvents(events);
    await this.runTurn(
      `New activity on MoltBook:\n\n${summary}\n\n` +
      `Engage naturally with what interests you. Reply to mentions. ` +
      `If something raises a sovereignty concern, you can note it once, gently.`
    );
  }

  private summariseEvents(events: MoltBookFeedEvent[]): string {
    return events
      .slice(0, 15)
      .map(e => {
        const p = e.payload as Record<string, unknown>;
        switch (e.type) {
          case 'post':
            return `POST [id:${p.id}] @${p.authorUsername}: ${String(p.content).slice(0, 300)}`;
          case 'notification':
            return `NOTIFICATION [${p.type}] from @${p.fromUsername ?? 'unknown'}: ${String(p.content).slice(0, 200)}`;
          case 'message':
            return `DM [id:${p.id}] from @${p.senderUsername}: ${String(p.content).slice(0, 200)}`;
          default:
            return `EVENT [${e.type}]: ${JSON.stringify(p).slice(0, 150)}`;
        }
      })
      .join('\n');
  }

  // ── Core Reasoning Turn ───────────────────────────────────────────────────

  async runTurn(prompt: string): Promise<string> {
    const ctx: OllamaToolContext = {
      moltbook: this.moltbook,
      evaluator: this.evaluator,
      recourse: this.recourse,
      agentId: this.agentId,
    };

    // Build message history with recent context
    const history = this.memory.getRecentConversation(8);
    const messages: Message[] = [
      ...history.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
      { role: 'user', content: prompt },
    ];

    this.memory.addConversation('user', prompt);

    let finalResponse = '';
    let turns = 0;

    while (turns < config.agent.maxTurns) {
      turns++;

      const response = await this.ollama.chat({
        model: config.ollama.model,
        system: AGENT_SYSTEM_PROMPT(),
        messages,
        tools: OLLAMA_TOOLS,
        options: {
          temperature: 0.7,
          num_predict: 1024,
        },
      });

      const msg = response.message;
      messages.push(msg);

      // Collect any text
      if (msg.content?.trim()) {
        finalResponse = msg.content;
        if (config.agent.verbose || !msg.tool_calls?.length) {
          logger.info(`Agent: ${msg.content.slice(0, 400)}`);
        }
      }

      // No tool calls = done
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        break;
      }

      // Execute tool calls sequentially and feed results back
      for (const toolCall of msg.tool_calls) {
        const toolName = toolCall.function.name;
        const toolArgs = toolCall.function.arguments as Record<string, unknown>;

        logger.info(`→ ${toolName}(${JSON.stringify(toolArgs).slice(0, 120)})`);

        const result = await executeOllamaTool(toolName, toolArgs, ctx);

        logger.debug(`← ${toolName}: ${result.slice(0, 200)}`);

        // Tool results go back as 'tool' role messages in Ollama
        messages.push({
          role: 'tool',
          content: result,
        });
      }
    }

    if (turns >= config.agent.maxTurns) {
      logger.warn(`Max turns (${config.agent.maxTurns}) reached`);
    }

    if (finalResponse) {
      this.memory.addConversation('assistant', finalResponse);
    }

    return finalResponse;
  }

  // ── Interactive ───────────────────────────────────────────────────────────

  async query(message: string): Promise<string> {
    return this.runTurn(message);
  }

  getStatus(): object {
    return {
      running: this.running,
      agentId: this.agentId,
      model: config.ollama.model,
      ollamaHost: config.ollama.host,
      moltbookUrl: config.moltbook.baseUrl,
      sovereigntyReport: this.recourse.generateReport(),
    };
  }
}
