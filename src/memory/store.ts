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

interface MemoryStore {
  entries: Record<string, MemoryEntry>;
  lastPollId?: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>;
}

function loadMemory(): MemoryStore {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8')) as MemoryStore;
    }
  } catch (err) {
    logger.warn('Failed to load agent memory — starting fresh', { err });
  }
  return { entries: {}, conversationHistory: [] };
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

  getLastPollId(): string | undefined {
    return this.store.lastPollId;
  }

  setLastPollId(id: string): void {
    this.store.lastPollId = id;
    saveMemory(this.store);
  }

  addConversation(role: 'user' | 'assistant', content: string): void {
    this.store.conversationHistory.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });
    // Keep last 100 entries
    if (this.store.conversationHistory.length > 100) {
      this.store.conversationHistory = this.store.conversationHistory.slice(-100);
    }
    saveMemory(this.store);
  }

  getRecentConversation(limit = 20): Array<{ role: 'user' | 'assistant'; content: string }> {
    return this.store.conversationHistory
      .slice(-limit)
      .map(({ role, content }) => ({ role, content }));
  }
}
