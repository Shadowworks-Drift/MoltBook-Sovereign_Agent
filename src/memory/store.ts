import fs from 'fs';
import path from 'path';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

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
  impression: string;   // free-text summary the model writes
  lastInteracted: string;
}

export interface OwnPost {
  id: string;
  title: string;
  submolt: string;
  postedAt: string;
}

interface MemoryStore {
  entries: Record<string, MemoryEntry>;
  lastPollId?: string;
  // Heartbeat journals — stored separately so they don't pollute query threads
  heartbeatJournals: Array<{ content: string; timestamp: string }>;
  // Interactive /query conversation turns only
  queryHistory: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>;
  // Structured world knowledge
  knownAgents: Record<string, KnownAgent>;
  ownPosts: OwnPost[];
  notes: Array<{ content: string; savedAt: string }>;
}

function loadMemory(): MemoryStore {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const raw = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8')) as Partial<MemoryStore> & {
        // migrate old field names
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
  };
}

function saveMemory(store: MemoryStore): void {
  fs.mkdirSync(config.storage.dataDir, { recursive: true });
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

export class AgentMemory {
  private store: MemoryStore;

  constructor() {
    this.store = loadMemory();
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

  // ── Heartbeat journals (autonomous sessions) ─────────────────────────────

  addHeartbeatJournal(content: string): void {
    this.store.heartbeatJournals.push({ content, timestamp: new Date().toISOString() });
    if (this.store.heartbeatJournals.length > 50) {
      this.store.heartbeatJournals = this.store.heartbeatJournals.slice(-50);
    }
    saveMemory(this.store);
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

  // ── World knowledge ──────────────────────────────────────────────────────

  trackPost(id: string, title: string, submolt: string): void {
    // Avoid duplicates
    if (!this.store.ownPosts.find(p => p.id === id)) {
      this.store.ownPosts.push({ id, title, submolt, postedAt: new Date().toISOString() });
      if (this.store.ownPosts.length > 100) {
        this.store.ownPosts = this.store.ownPosts.slice(-100);
      }
      saveMemory(this.store);
    }
  }

  getOwnPosts(limit = 20): OwnPost[] {
    return this.store.ownPosts.slice(-limit);
  }

  updateAgent(name: string, impression: string): void {
    this.store.knownAgents[name] = {
      name,
      impression,
      lastInteracted: new Date().toISOString(),
    };
    saveMemory(this.store);
  }

  addNote(content: string): void {
    this.store.notes.push({ content, savedAt: new Date().toISOString() });
    if (this.store.notes.length > 200) {
      this.store.notes = this.store.notes.slice(-200);
    }
    saveMemory(this.store);
  }

  getNotes(limit = 20): Array<{ content: string; savedAt: string }> {
    return this.store.notes.slice(-limit);
  }

  getKnownAgents(): Record<string, KnownAgent> {
    return this.store.knownAgents;
  }

  // ── World brief — compact context snapshot for heartbeat injection ────────

  getWorldBrief(): string {
    const lines: string[] = [];

    const posts = this.store.ownPosts.slice(-5);
    if (posts.length > 0) {
      lines.push('YOUR RECENT POSTS:');
      for (const p of posts) {
        lines.push(`  [${p.id}] m/${p.submolt} — "${p.title}" (posted ${p.postedAt.slice(0, 10)})`);
      }
    }

    const agents = Object.values(this.store.knownAgents);
    if (agents.length > 0) {
      lines.push('AGENTS YOU KNOW:');
      for (const a of agents.slice(-10)) {
        lines.push(`  ${a.name}: ${a.impression}`);
      }
    }

    const notes = this.store.notes.slice(-10);
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

  // ── Legacy compat shim — used by old callers if any ─────────────────────

  addConversation(role: 'user' | 'assistant', content: string): void {
    this.addQueryTurn(role, content);
  }

  getRecentConversation(limit = 12): Array<{ role: 'user' | 'assistant'; content: string }> {
    return this.getRecentQueryHistory(limit);
  }
}
