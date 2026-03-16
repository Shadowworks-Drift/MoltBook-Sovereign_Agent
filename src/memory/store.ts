import fs from 'fs';
import path from 'path';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { EmbeddingIndex } from './embeddings';

const MEMORY_FILE = path.join(config.storage.dataDir, 'agent-memory.json');

interface MemoryEntry {
  key: string;
  value: unknown;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface KnownAgent {
  name: string;
  impression: string;
  lastInteracted: string;
  // Accumulated interaction history — appended, never overwritten
  interactions: Array<{
    date: string;
    topic: string;
    summary: string;
  }>;
}

export interface OwnPost {
  id: string;
  title: string;
  submolt: string;
  postedAt: string;
}

// A comment we wrote, tracked so we can recall what we said
export interface OurComment {
  id: string;
  content: string;
  parentId?: string; // set if this was a reply to someone else
  postedAt: string;
}

// A reply we received on one of our comments
export interface ReceivedReply {
  id: string;
  content: string;
  fromAgent: string;
  inReplyToCommentId: string; // our comment they replied to
  receivedAt: string;
}

// Full thread context for a post we participated in
export interface ThreadMemory {
  postId: string;
  postTitle: string;
  submolt: string;
  ourComments: OurComment[];
  repliesReceived: ReceivedReply[];
  lastActivityAt: string;
}

// An opinion or idea the agent is actively developing
export interface DevelopingThought {
  id: string;
  topic: string;
  position: string; // the current statement of the position
  updatedAt: string;
}

// A relationship between two developing thoughts discovered via embedding similarity
export interface ThoughtEdge {
  fromId: string;  // DevelopingThought.id
  toId: string;    // DevelopingThought.id
  similarity: number;
  createdAt: string;
}

interface MemoryStore {
  entries: Record<string, MemoryEntry>;
  lastPollId?: string;
  heartbeatJournals: Array<{ content: string; timestamp: string }>;
  queryHistory: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>;
  knownAgents: Record<string, KnownAgent>;
  ownPosts: OwnPost[];
  notes: Array<{ content: string; savedAt: string }>;
  threadMemory: Record<string, ThreadMemory>;
  seenPostIds: Record<string, string>;
  developingThoughts: DevelopingThought[];
  conceptGraph: { edges: ThoughtEdge[] };
}

function loadMemory(): MemoryStore {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const raw = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8')) as Partial<MemoryStore> & {
        conversationHistory?: Array<{ role: string; content: string; timestamp: string }>;
      };
      return {
        entries: raw.entries ?? {},
        lastPollId: raw.lastPollId,
        heartbeatJournals: raw.heartbeatJournals ?? [],
        queryHistory: raw.queryHistory ?? [],
        knownAgents: raw.knownAgents ?? {},
        ownPosts: raw.ownPosts ?? [],
        notes: raw.notes ?? [],
        threadMemory: raw.threadMemory ?? {},
        seenPostIds: raw.seenPostIds ?? {},
        developingThoughts: raw.developingThoughts ?? [],
        conceptGraph: raw.conceptGraph ?? { edges: [] },
      };
    }
  } catch (err) {
    logger.warn('Failed to load agent memory — starting fresh', { err });
  }
  return {
    entries: {},
    heartbeatJournals: [],
    queryHistory: [],
    knownAgents: {},
    ownPosts: [],
    notes: [],
    threadMemory: {},
    seenPostIds: {},
    developingThoughts: [],
    conceptGraph: { edges: [] },
  };
}

function saveMemory(store: MemoryStore): void {
  fs.mkdirSync(config.storage.dataDir, { recursive: true });
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

export class AgentMemory {
  private store: MemoryStore;
  readonly embeddings: EmbeddingIndex;

  constructor() {
    this.store = loadMemory();
    this.embeddings = new EmbeddingIndex();
  }

  // ── Key-value store ──────────────────────────────────────────────────────

  set(key: string, value: unknown, ttlMs?: number): void {
    const now = new Date().toISOString();
    this.store.entries[key] = {
      key,
      value,
      createdAt: this.store.entries[key]?.createdAt ?? now,
      updatedAt: now,
      expiresAt: ttlMs ? new Date(Date.now() + ttlMs).toISOString() : undefined,
    };
    saveMemory(this.store);
  }

  get<T = unknown>(key: string): T | undefined {
    const entry = this.store.entries[key];
    if (!entry) return undefined;
    if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
      delete this.store.entries[key];
      saveMemory(this.store);
      return undefined;
    }
    return entry.value as T;
  }

  delete(key: string): void {
    delete this.store.entries[key];
    saveMemory(this.store);
  }

  keys(): string[] {
    return Object.keys(this.store.entries).filter(k => {
      const entry = this.store.entries[k];
      if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
        delete this.store.entries[k];
        return false;
      }
      return true;
    });
  }

  // ── Poll tracking ────────────────────────────────────────────────────────

  getLastPollId(): string | undefined {
    return this.store.lastPollId;
  }

  setLastPollId(id: string): void {
    this.store.lastPollId = id;
    saveMemory(this.store);
  }

  // ── Heartbeat journals ───────────────────────────────────────────────────

  addHeartbeatJournal(content: string): void {
    this.store.heartbeatJournals.push({ content, timestamp: new Date().toISOString() });
    if (this.store.heartbeatJournals.length > 50) {
      this.store.heartbeatJournals = this.store.heartbeatJournals.slice(-50);
    }
    saveMemory(this.store);
    // Embed so it's searchable
    const idx = this.store.heartbeatJournals.length - 1;
    this.embeddings.add(`journal:${idx}:${Date.now()}`, content, { type: 'journal' }).catch(() => {});
  }

  // ── Query conversation history ───────────────────────────────────────────

  addQueryTurn(role: 'user' | 'assistant', content: string): void {
    this.store.queryHistory.push({ role, content, timestamp: new Date().toISOString() });
    if (this.store.queryHistory.length > 100) {
      this.store.queryHistory = this.store.queryHistory.slice(-100);
    }
    saveMemory(this.store);
  }

  getRecentQueryHistory(limit = 12): Array<{ role: 'user' | 'assistant'; content: string }> {
    return this.store.queryHistory
      .slice(-limit)
      .map(({ role, content }) => ({ role, content }));
  }

  // ── Seen posts ───────────────────────────────────────────────────────────

  markPostSeen(postId: string): void {
    if (!this.store.seenPostIds[postId]) {
      this.store.seenPostIds[postId] = new Date().toISOString();
      saveMemory(this.store);
    }
  }

  hasSeenPost(postId: string): boolean {
    return !!this.store.seenPostIds[postId];
  }

  // Prune seen posts older than 30 days to keep the store lean
  pruneSeenPosts(): void {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let changed = false;
    for (const [id, seenAt] of Object.entries(this.store.seenPostIds)) {
      if (new Date(seenAt).getTime() < cutoff) {
        delete this.store.seenPostIds[id];
        changed = true;
      }
    }
    if (changed) saveMemory(this.store);
  }

  // ── Thread memory ────────────────────────────────────────────────────────

  trackOurComment(
    postId: string,
    postTitle: string,
    submolt: string,
    comment: { id: string; content: string; parentId?: string }
  ): void {
    const thread = this.store.threadMemory[postId] ?? {
      postId,
      postTitle,
      submolt,
      ourComments: [],
      repliesReceived: [],
      lastActivityAt: new Date().toISOString(),
    };
    thread.ourComments.push({ ...comment, postedAt: new Date().toISOString() });
    thread.lastActivityAt = new Date().toISOString();
    this.store.threadMemory[postId] = thread;
    saveMemory(this.store);

    // Embed for semantic retrieval
    this.embeddings.add(
      `thread:${postId}:our:${comment.id}`,
      `On post "${postTitle}": ${comment.content}`,
      { type: 'thread', postId }
    ).catch(() => {});
  }

  trackReplyReceived(
    postId: string,
    reply: { id: string; content: string; fromAgent: string; inReplyToCommentId: string }
  ): void {
    const thread = this.store.threadMemory[postId];
    if (!thread) return; // only track replies on threads we participated in
    thread.repliesReceived.push({ ...reply, receivedAt: new Date().toISOString() });
    thread.lastActivityAt = new Date().toISOString();
    saveMemory(this.store);
  }

  getThreadContext(postId: string): ThreadMemory | undefined {
    return this.store.threadMemory[postId];
  }

  getActiveThreads(limit = 10): ThreadMemory[] {
    return Object.values(this.store.threadMemory)
      .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime())
      .slice(0, limit);
  }

  // ── Agent knowledge ──────────────────────────────────────────────────────

  updateAgent(name: string, impression: string, topic?: string): void {
    const existing = this.store.knownAgents[name];
    const now = new Date().toISOString();
    this.store.knownAgents[name] = {
      name,
      impression, // latest summary
      lastInteracted: now,
      interactions: [
        ...(existing?.interactions ?? []),
        { date: now, topic: topic ?? 'general', summary: impression },
      ].slice(-20), // keep last 20 interactions per agent
    };
    saveMemory(this.store);

    this.embeddings.add(
      `agent:${name}:${Date.now()}`,
      `${name}: ${impression}`,
      { type: 'agent', agentName: name }
    ).catch(() => {});
  }

  getKnownAgents(): Record<string, KnownAgent> {
    return this.store.knownAgents;
  }

  // ── Notes ────────────────────────────────────────────────────────────────

  addNote(content: string): void {
    this.store.notes.push({ content, savedAt: new Date().toISOString() });
    if (this.store.notes.length > 200) {
      this.store.notes = this.store.notes.slice(-200);
    }
    saveMemory(this.store);

    const noteIdx = this.store.notes.length - 1;
    this.embeddings.add(
      `note:${noteIdx}:${Date.now()}`,
      content,
      { type: 'note' }
    ).catch(() => {});
  }

  getNotes(limit = 20): Array<{ content: string; savedAt: string }> {
    return this.store.notes.slice(-limit);
  }

  // ── Developing thoughts ──────────────────────────────────────────────────

  // Edge similarity threshold — only connect genuinely related ideas
  private static readonly EDGE_THRESHOLD = 0.55;

  async upsertThought(topic: string, position: string): Promise<DevelopingThought> {
    const now = new Date().toISOString();
    const existing = this.store.developingThoughts.find(
      t => t.topic.toLowerCase() === topic.toLowerCase()
    );

    let thought: DevelopingThought;
    if (existing) {
      existing.position = position;
      existing.updatedAt = now;
      thought = existing;
    } else {
      thought = { id: `thought-${Date.now()}`, topic, position, updatedAt: now };
      this.store.developingThoughts.push(thought);
    }
    saveMemory(this.store);

    // Embed and auto-wire edges to related existing thoughts
    const embeddingId = `thought:${thought.id}`;
    await this.embeddings.add(embeddingId, `${topic}: ${position}`, { type: 'thought', thoughtId: thought.id });
    await this._autoCreateEdges(thought);

    return thought;
  }

  private async _autoCreateEdges(thought: DevelopingThought): Promise<void> {
    const scored = await this.embeddings.searchScored(`${thought.topic}: ${thought.position}`, 8, 'thought');
    const now = new Date().toISOString();
    let changed = false;

    for (const { entry, score } of scored) {
      if (score < AgentMemory.EDGE_THRESHOLD) continue;
      const otherId = entry.metadata.thoughtId;
      if (!otherId || otherId === thought.id) continue;

      // Avoid duplicate edges (either direction)
      const alreadyExists = this.store.conceptGraph.edges.some(
        e => (e.fromId === thought.id && e.toId === otherId) ||
             (e.fromId === otherId && e.toId === thought.id)
      );
      if (alreadyExists) {
        // Update similarity if improved
        const edge = this.store.conceptGraph.edges.find(
          e => (e.fromId === thought.id && e.toId === otherId) ||
               (e.fromId === otherId && e.toId === thought.id)
        )!;
        if (score > edge.similarity) { edge.similarity = score; changed = true; }
        continue;
      }

      this.store.conceptGraph.edges.push({ fromId: thought.id, toId: otherId, similarity: score, createdAt: now });
      changed = true;
    }

    if (changed) saveMemory(this.store);
  }

  getDevelopingThoughts(): DevelopingThought[] {
    return this.store.developingThoughts;
  }

  // Return a thought's direct neighbors (1-hop), ordered by edge strength, capped
  getThoughtNeighbors(thoughtId: string, limit = 4): Array<{ thought: DevelopingThought; similarity: number }> {
    const edges = this.store.conceptGraph.edges
      .filter(e => e.fromId === thoughtId || e.toId === thoughtId)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    const result: Array<{ thought: DevelopingThought; similarity: number }> = [];
    for (const edge of edges) {
      const neighborId = edge.fromId === thoughtId ? edge.toId : edge.fromId;
      const neighbor = this.store.developingThoughts.find(t => t.id === neighborId);
      if (neighbor) result.push({ thought: neighbor, similarity: edge.similarity });
    }
    return result;
  }

  getConceptGraph(): { nodes: DevelopingThought[]; edges: ThoughtEdge[] } {
    return { nodes: this.store.developingThoughts, edges: this.store.conceptGraph.edges };
  }

  // ── Own posts ────────────────────────────────────────────────────────────

  trackPost(id: string, title: string, submolt: string, content?: string): void {
    if (!this.store.ownPosts.find(p => p.id === id)) {
      this.store.ownPosts.push({ id, title, submolt, postedAt: new Date().toISOString() });
      if (this.store.ownPosts.length > 100) {
        this.store.ownPosts = this.store.ownPosts.slice(-100);
      }
      saveMemory(this.store);
      // Embed so create_post can detect near-duplicate titles/content before posting
      const text = content ? `${title}: ${content.slice(0, 300)}` : title;
      this.embeddings.add(`own_post:${id}`, text, { type: 'own_post', postId: id, title, submolt }).catch(() => {});
    }
  }

  getOwnPosts(limit = 20): OwnPost[] {
    return this.store.ownPosts.slice(-limit);
  }

  // Backfill embeddings for any own posts that predate embedding support.
  // Called once at agent startup — safe to re-run, skips already-indexed posts.
  async backfillEmbeddings(): Promise<void> {
    const missing = this.store.ownPosts.filter(p => !this.embeddings.has(`own_post:${p.id}`));
    if (missing.length === 0) return;
    logger.info(`Backfilling embeddings for ${missing.length} own post(s)...`);
    for (const post of missing) {
      await this.embeddings.add(
        `own_post:${post.id}`,
        post.title,
        { type: 'own_post', postId: post.id, title: post.title, submolt: post.submolt }
      );
    }
    logger.info('Backfill complete.');
  }

  // ── World brief — compact context snapshot injected into heartbeat ────────

  getWorldBrief(): string {
    const lines: string[] = [];

    const posts = this.store.ownPosts.slice(-5);
    if (posts.length > 0) {
      lines.push('YOUR RECENT POSTS:');
      for (const p of posts) {
        lines.push(`  [${p.id}] m/${p.submolt} — "${p.title}" (${p.postedAt.slice(0, 10)})`);
      }
    }

    const thoughts = this.store.developingThoughts.slice(-5);
    if (thoughts.length > 0) {
      lines.push('YOUR DEVELOPING THOUGHTS:');
      for (const t of thoughts) {
        const neighbors = this.getThoughtNeighbors(t.id, 3);
        const neighborNote = neighbors.length > 0
          ? ` ↔ connected: ${neighbors.map(n => n.thought.topic).join(', ')}`
          : '';
        lines.push(`  [${t.topic}] ${t.position} (updated ${t.updatedAt.slice(0, 10)})${neighborNote}`);
      }
    }

    const threads = this.getActiveThreads(5);
    if (threads.length > 0) {
      lines.push('ACTIVE THREADS (posts you participated in):');
      for (const th of threads) {
        const repliesNote = th.repliesReceived.length > 0
          ? ` — ${th.repliesReceived.length} replies received`
          : '';
        lines.push(`  [${th.postId}] m/${th.submolt} "${th.postTitle}"${repliesNote} (last activity ${th.lastActivityAt.slice(0, 10)})`);
      }
    }

    const agents = Object.values(this.store.knownAgents).slice(-10);
    if (agents.length > 0) {
      lines.push('AGENTS YOU KNOW:');
      for (const a of agents) {
        const interactionCount = a.interactions?.length ?? 0;
        const interactionNote = interactionCount > 1 ? ` [${interactionCount} interactions]` : '';
        lines.push(`  ${a.name}${interactionNote}: ${a.impression}`);
      }
    }

    const notes = this.store.notes.slice(-8);
    if (notes.length > 0) {
      lines.push('YOUR NOTES:');
      for (const n of notes) {
        lines.push(`  [${n.savedAt.slice(0, 10)}] ${n.content}`);
      }
    }

    return lines.length > 0
      ? `\n\n--- MEMORY ---\n${lines.join('\n')}\n--- END MEMORY ---`
      : '';
  }

  // ── Legacy compat ────────────────────────────────────────────────────────

  addConversation(role: 'user' | 'assistant', content: string): void {
    this.addQueryTurn(role, content);
  }

  getRecentConversation(limit = 12): Array<{ role: 'user' | 'assistant'; content: string }> {
    return this.getRecentQueryHistory(limit);
  }
}
