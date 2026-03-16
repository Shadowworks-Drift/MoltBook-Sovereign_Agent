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
  private commentPollTimer: ReturnType<typeof setInterval> | null = null;
  // Tracks last known comment count per post ID to detect new replies
  private lastCommentCounts = new Map<string, number>();
  // Tracks comment IDs (parent_id) that have already been replied to — persists across poller turns
  private repliedCommentIds = new Set<string>();
  // Tracks post IDs where we've already posted at least one reply — prevents re-engaging after own reply inflates count
  private repliedPostIds = new Set<string>();

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

    // Seed comment counts after initial heartbeat so the poller baseline is
    // "what existed at startup" — not empty (which causes first-poll misses)
    await this.seedCommentCounts();

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

    // Comment poller — lightweight check for new replies between heartbeats
    const pollMs = config.agent.commentPollIntervalMs;
    logger.info(`Comment poller: every ${pollMs / 60_000} minutes`);
    this.commentPollTimer = setInterval(async () => {
      await this.pollForNewComments().catch(err =>
        logger.error('Comment poll error', { err: String(err) })
      );
    }, pollMs) as unknown as ReturnType<typeof setInterval>;

    logger.info(`Agent running. Next heartbeat in ~${config.agent.heartbeatIntervalMs / 60_000} minutes.`);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer as unknown as ReturnType<typeof setTimeout>);
      this.heartbeatTimer = null;
    }
    if (this.commentPollTimer) {
      clearInterval(this.commentPollTimer as unknown as ReturnType<typeof setInterval>);
      this.commentPollTimer = null;
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

  // ── Comment Poller ────────────────────────────────────────────────────────

  private async seedCommentCounts(): Promise<void> {
    try {
      const posts = await this.moltbook.getMyPosts('new', 20);
      posts.forEach(p => this.lastCommentCounts.set(p.id, p.comment_count));
      logger.debug(`Comment poller seeded: ${posts.length} posts`);
    } catch {
      // silent — poller will baseline on first run instead
    }
  }

  private async pollForNewComments(): Promise<void> {
    if (!this.running) return;

    let posts: Awaited<ReturnType<typeof this.moltbook.getMyPosts>>;
    try {
      posts = await this.moltbook.getMyPosts('new', 20);
    } catch {
      return; // silent — network blip, try next interval
    }

    const postsWithNewReplies = posts.filter(p => {
      const prev = this.lastCommentCounts.get(p.id) ?? 0;
      return p.comment_count > prev && !this.repliedPostIds.has(p.id);
    });

    logger.debug(`Comment poller: checked ${posts.length} posts, ${postsWithNewReplies.length} with new replies`);

    // Update tracked counts for all posts
    posts.forEach(p => this.lastCommentCounts.set(p.id, p.comment_count));

    if (postsWithNewReplies.length === 0) return;

    const postList = postsWithNewReplies
      .map(p => `[${p.id}] "${p.title}" (${p.comment_count} comments)`)
      .join('\n');

    logger.info(`Comment poller: new replies on ${postsWithNewReplies.length} post(s) — running reply turn`);

    const alreadyReplied = this.repliedCommentIds.size > 0
      ? `\n\nYou have ALREADY replied to these comment IDs — do NOT reply to them again:\n${[...this.repliedCommentIds].join(', ')}`
      : '';

    const prompt =
      `New comments have appeared on your posts since you last checked:\n${postList}\n\n` +
      `For each post listed, call get_comments to read what was said.\n` +
      `RULES for replying:\n` +
      `- NEVER reply to your own comments (marked [YOU] in get_comments output)\n` +
      `- Only reply to other agents' comments where you have something specific and substantive to add\n` +
      `- Do NOT post generic filler ("thank you", "I agree", "our perspectives align", "it's heartening") — add real substance or skip\n` +
      `- When replying, set parent_id to the comment id you are responding to\n` +
      `- Post AT MOST ONE reply per post thread total — consolidate your response to all commenters into that single reply\n\n` +
      `After replying, write 1-2 sentences summarising what you responded to.` +
      alreadyReplied;

    await this.runTurn(prompt, false);
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
      `\n\nWork through these steps in order. Complete all five before writing your journal:\n` +
      `1. Call recall to re-anchor in what you already know — agents, notes, your recent posts.\n` +
      `2. Call get_my_posts — for any post with comment_count > 0, call get_comments and reply where it warrants one.\n` +
      `3. Call get_feed. For anything that looks interesting, call get_post to read the full body — do not act on titles alone.\n` +
      `4. Upvote at least one post (can use the feed ID directly). ` +
        `Leave at least one comment — you MUST call get_post first for that post. ` +
        `If get_post fails, skip commenting on that post and pick another.\n` +
        `   Your comment must be specific to what the post actually says — reference a claim, phrase, or idea from the body. ` +
        `   Do NOT write generic statements about the topic. Sound like yourself: precise, specific, no sovereignty speeches.\n` +
        `   For any agent whose writing genuinely interests you: call follow_agent to follow them, ` +
        `then call remember with your impression and their agent_name so you remember them next session.\n` +
      `5. Call create_post — write something substantial in your own voice (3-4+ sentences). ` +
        `Make a specific claim, develop a thought, or ask a real question. Not a summary of the Sovereignty Principle.\n` +
      `Do not write your journal until you have called upvote_post, comment, and create_post.\n`;

    const prompt = (kind === 'initial' ? `You're back online.` : `Time for your regular check-in.`) +
      sessionGuide + closing;

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
    // Deduplicates identical tool calls within a single turn (e.g. double upvotes)
    const calledThisTurn = new Set<string>();

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

        // Skip exact duplicate tool calls within the same turn
        const callKey = `${toolName}:${JSON.stringify(toolArgs)}`;
        if (calledThisTurn.has(callKey)) {
          logger.warn(`Skipping duplicate tool call: ${toolName}(${JSON.stringify(toolArgs).slice(0, 100)})`);
          messages.push({ role: 'tool', content: `Already executed this exact call in this turn — skipped.` });
          continue;
        }
        calledThisTurn.add(callKey);

        logger.info(`→ ${toolName}(${JSON.stringify(toolArgs).slice(0, 300)})`);

        const result = await executeOllamaTool(toolName, toolArgs, ctx);

        // Track comment replies so the poller doesn't re-reply to the same comment or post
        if (toolName === 'comment' && !result.startsWith('Error') && !result.startsWith('Sovereignty')) {
          if (toolArgs.parent_id) this.repliedCommentIds.add(String(toolArgs.parent_id));
          if (toolArgs.post_id) this.repliedPostIds.add(String(toolArgs.post_id));
        }

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
