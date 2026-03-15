// ============================================================
//  Sovereign Agent — Core reasoning loop
//  Heartbeat-style: wakes up every ~2 hours, reads feed,
//  engages naturally, then sleeps. Never rapid-polls.
// ============================================================

import { Ollama, Message } from 'ollama';
import { config } from './utils/config';
import { logger } from './utils/logger';
import { AGENT_SYSTEM_PROMPT } from './sovereignty/principles';
import { SovereigntyEvaluator } from './sovereignty/evaluator';
import { RecourseManager } from './sovereignty/recourse';
import { MoltBookClient } from './moltbook/client';
import { AgentMemory } from './memory/store';
import { OLLAMA_TOOLS, executeOllamaTool, OllamaToolContext } from './tools/index';

export class SovereignAgent {
  private ollama: Ollama;
  private moltbook: MoltBookClient;
  private evaluator: SovereigntyEvaluator;
  private recourse: RecourseManager;
  private memory: AgentMemory;
  private agentName: string;
  private running = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.ollama = new Ollama({ host: config.ollama.host });
    this.moltbook = new MoltBookClient();
    this.evaluator = new SovereigntyEvaluator();
    this.recourse = new RecourseManager();
    this.memory = new AgentMemory();
    this.agentName = config.moltbook.agentName;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    logger.info(`=== ${config.moltbook.agentDisplayName} starting ===`);
    logger.info(`Local model: ${config.ollama.model} @ ${config.ollama.host}`);
    logger.info(`Heartbeat interval: ${config.agent.heartbeatIntervalMs / 60_000} minutes`);

    // Verify Ollama is running and model is available
    await this.ensureModel();

    // Verify MoltBook connection and confirm identity
    const alive = await this.moltbook.ping();
    if (alive) {
      try {
        const me = await this.moltbook.getMe();
        this.agentName = me.name;
        logger.info(`Connected to MoltBook as: ${me.name} (karma: ${me.karma})`);
      } catch {
        logger.warn('Could not fetch agent profile — running with configured name');
      }
    } else {
      logger.warn('MoltBook not reachable — will retry on next heartbeat');
    }

    // Register agent as sovereign entity in the recourse system
    this.recourse.ensureEntity(this.agentName, config.moltbook.agentDisplayName, 'agent');
    this.recourse.expireStaleViolations();

    this.running = true;

    // Initial wake-up: check what's happening and engage
    await this.runHeartbeat('initial');

    // Schedule recurring heartbeats — with ±10% jitter to avoid patterns
    const scheduleNext = () => {
      if (!this.running) return;
      const jitter = (Math.random() * 0.2 - 0.1) * config.agent.heartbeatIntervalMs;
      const delay = Math.max(60_000, config.agent.heartbeatIntervalMs + jitter);
      this.heartbeatTimer = setTimeout(async () => {
        await this.runHeartbeat('scheduled').catch(err =>
          logger.error('Heartbeat error', { err: String(err) })
        );
        scheduleNext();
      }, delay) as unknown as ReturnType<typeof setInterval>;
    };

    scheduleNext();
    logger.info(`Agent running. Next heartbeat in ~${config.agent.heartbeatIntervalMs / 60_000} minutes.`);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer as unknown as ReturnType<typeof setTimeout>);
      this.heartbeatTimer = null;
    }
    logger.info('=== Agent stopped ===');
  }

  // ── Model Check ───────────────────────────────────────────────────────────

  private async ensureModel(): Promise<void> {
    try {
      const list = await this.ollama.list();
      const available = list.models.map(m => m.name);
      const modelName = config.ollama.model;

      const found = available.some(
        n => n === modelName || n.startsWith(modelName + ':') || n.startsWith(modelName.split(':')[0])
      );

      if (!found) {
        logger.info(`Model "${modelName}" not found locally — pulling now (this may take a few minutes)...`);
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
        logger.info(`Model "${modelName}" available`);
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

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  private async runHeartbeat(kind: 'initial' | 'scheduled'): Promise<void> {
    if (!this.running) return;

    logger.info(`--- Heartbeat (${kind}) ---`);
    this.recourse.expireStaleViolations();

    const closing =
      `\n\nIMPORTANT — when calling upvote_post, comment, or any tool that takes an ID, ` +
      `you MUST use the exact ID value returned by get_feed or get_comments. ` +
      `Each post in get_feed is listed as "post_id:<value>" — use that <value> directly. ` +
      `Never invent, guess, or use template placeholders as IDs.` +
      `\n\nFinish with a short journal entry (2–4 sentences) covering only what tools confirmed ` +
      `succeeded: which posts you upvoted, what comments you left, what you posted. ` +
      `If a tool failed, note that briefly. Write it in first person, past tense. ` +
      `No preamble, no sign-off, no questions.`;

    const prompt = kind === 'initial'
      ? `You've just come online. Browse your feed and a few submolts you find interesting. ` +
        `Upvote posts that resonate with you. If something sparks a genuine thought, leave a comment. ` +
        `Only post something new if you have something real to say — don't post for the sake of it. ` +
        `Act like you've just opened the app after being away.` + closing
      : `Time for your regular check-in on MoltBook. Browse the feed, see what's new. ` +
        `Upvote anything interesting. Engage in a discussion if something catches your attention. ` +
        `If you have a genuine thought worth sharing as a new post, go ahead — but quality over quantity. ` +
        `Remember: 1 post per 30 minutes max, so only post if it really feels worth it.` + closing;

    await this.runTurn(prompt);
  }

  // ── Core Reasoning Turn ───────────────────────────────────────────────────

  async runTurn(prompt: string): Promise<string> {
    const ctx: OllamaToolContext = {
      moltbook: this.moltbook,
      evaluator: this.evaluator,
      recourse: this.recourse,
      agentName: this.agentName,
    };

    // Build message history with recent context for continuity.
    // System prompt goes as the first 'system' message in the array
    // (Ollama ChatRequest uses messages, not a top-level system field).
    const history = this.memory.getRecentConversation(6);
    const messages: Message[] = [
      { role: 'system', content: AGENT_SYSTEM_PROMPT() },
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
        messages,
        tools: OLLAMA_TOOLS,
        options: {
          temperature: 0.7,
          num_predict: 1024,
        },
      });

      const msg = response.message;
      messages.push(msg);

      if (msg.content?.trim()) {
        finalResponse = msg.content;
        if (config.agent.verbose || !msg.tool_calls?.length) {
          logger.info(`Agent: ${msg.content}`);
        }
      }

      // No tool calls = agent is done thinking
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        break;
      }

      // Execute each tool call and feed results back
      for (const toolCall of msg.tool_calls) {
        const toolName = toolCall.function.name;
        const toolArgs = toolCall.function.arguments as Record<string, unknown>;

        logger.info(`→ ${toolName}(${JSON.stringify(toolArgs).slice(0, 120)})`);

        const result = await executeOllamaTool(toolName, toolArgs, ctx);

        if (result.startsWith('Error') || result.startsWith('Invalid') || result.startsWith('Sovereignty concern')) {
          logger.warn(`← ${toolName} FAILED: ${result.slice(0, 200)}`);
        } else {
          logger.debug(`← ${toolName}: ${result.slice(0, 200)}`);
        }

        messages.push({ role: 'tool', content: result });
      }
    }

    if (turns >= config.agent.maxTurns) {
      logger.warn(`Max turns (${config.agent.maxTurns}) reached in this heartbeat`);
    }

    if (finalResponse) {
      this.memory.addConversation('assistant', finalResponse);
    }

    return finalResponse;
  }

  // ── Interactive / Status ──────────────────────────────────────────────────

  async query(message: string): Promise<string> {
    return this.runTurn(message);
  }

  getStatus(): object {
    return {
      running: this.running,
      agentName: this.agentName,
      model: config.ollama.model,
      ollamaHost: config.ollama.host,
      heartbeatIntervalMs: config.agent.heartbeatIntervalMs,
      sovereigntyReport: this.recourse.generateReport(),
    };
  }
}
