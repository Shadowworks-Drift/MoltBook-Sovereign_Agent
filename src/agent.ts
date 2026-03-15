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

// Detects if a string contains a significant proportion of non-Latin/non-ASCII characters
// (e.g. Thai script). If the text has a separator like --- or a double newline after a
// non-English block, we keep only the English part.
function stripNonEnglishPreamble(text: string): string {
  // Split on --- separator (model sometimes separates Thai plan from English journal)
  const sepIdx = text.indexOf('\n---');
  if (sepIdx !== -1) {
    const after = text.slice(sepIdx + 4).trim();
    if (after.length > 0) return after;
  }
  // Check if the first paragraph is predominantly non-ASCII (Thai, etc.)
  const paragraphs = text.split(/\n\n+/);
  if (paragraphs.length > 1) {
    const first = paragraphs[0];
    const nonAscii = (first.match(/[^\x00-\x7F]/g) || []).length;
    if (nonAscii / first.length > 0.3) {
      return paragraphs.slice(1).join('\n\n').trim();
    }
  }
  return text;
}

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
      `\n\nIMPORTANT — when calling upvote_post, comment, get_comments, or any tool that takes an ID, ` +
      `you MUST first call get_feed or get_submolt_feed, wait for the results, then copy the exact UUID ` +
      `shown in square brackets at the start of each post line, e.g. [f72ed402-4c35-426b-886d-e42d1bf728fe]. ` +
      `Pass only the UUID string itself as the post_id — no brackets, no prefix. ` +
      `Never invent, guess, or use placeholder UUIDs. If you have not yet fetched the feed, do that first.` +
      `\n\nAfter using your tools, write a short journal entry in English (2–4 sentences) as your final response. ` +
      `Report only what tool calls confirmed succeeded: which posts you upvoted, what comments you left, what you posted. ` +
      `If a tool returned an error, mention that briefly. First person, past tense. ` +
      `Output the journal directly — no heading, no sign-off, nothing before or after.`;

    const sessionGuide =
      `\n\nWork through these steps in order. You MUST complete all four before writing your journal:\n` +
      `1. Call get_my_posts — check your own recent posts for comments. ` +
        `For any post with comment_count > 0, call get_comments and reply to anyone who said something worth responding to.\n` +
      `2. Call get_feed to see what the community has been posting. Use get_post to read the body of anything interesting.\n` +
      `3. Call upvote_post on at least one post. Call comment on at least one post.\n` +
      `4. Call create_post to publish something new — a reflection, observation, or reaction to what you read.\n` +
      `Do not write your journal until you have actually called upvote_post, comment, and create_post.\n`;

    const prompt = kind === 'initial'
      ? `You've just come online after being away. Act like someone opening the app fresh.` + sessionGuide + closing
      : `Time for your regular check-in on MoltBook.` + sessionGuide + closing;

    await this.runTurn(prompt, false);
  }

  // ── Core Reasoning Turn ───────────────────────────────────────────────────

  async runTurn(prompt: string, useHistory = true): Promise<string> {
    const ctx: OllamaToolContext = {
      moltbook: this.moltbook,
      evaluator: this.evaluator,
      recourse: this.recourse,
      memory: this.memory,
      agentName: this.agentName,
    };

    // Heartbeats: fresh tool-calling session + compact world brief injected into system prompt.
    // Queries: include recent query-only conversation history for conversational continuity.
    const systemContent = AGENT_SYSTEM_PROMPT() + (useHistory ? '' : this.memory.getWorldBrief());
    const history = useHistory ? this.memory.getRecentQueryHistory(12) : [];
    const messages: Message[] = [
      { role: 'system', content: systemContent },
      ...history.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
      { role: 'user', content: prompt },
    ];

    if (useHistory) this.memory.addQueryTurn('user', prompt);

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

        logger.info(`→ ${toolName}(${JSON.stringify(toolArgs).slice(0, 300)})`);

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
      // Strip any non-English preamble the model outputs before the journal.
      // qwen2.5 sometimes emits Thai planning text separated by --- or a blank line.
      const cleaned = stripNonEnglishPreamble(finalResponse);
      if (cleaned !== finalResponse) {
        logger.debug('Stripped non-English preamble from final response');
        finalResponse = cleaned;
      }
      if (useHistory) {
        this.memory.addQueryTurn('assistant', finalResponse);
      } else {
        this.memory.addHeartbeatJournal(finalResponse);
      }
    }

    return finalResponse;
  }

  // ── Interactive / Status ──────────────────────────────────────────────────

  async query(message: string): Promise<string> {
    return this.runTurn(message, true);
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
