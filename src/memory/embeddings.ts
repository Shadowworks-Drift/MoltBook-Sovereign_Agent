// ============================================================
//  Semantic Embedding Index
//  Stores vector embeddings alongside content so recall can
//  find relevant memories by meaning, not just keyword match.
//
//  Uses Ollama's embed endpoint — no extra dependencies.
//  Defaults to the same model as the chat model; set
//  OLLAMA_EMBED_MODEL to use a dedicated embedding model
//  (e.g. nomic-embed-text) if you have one pulled.
// ============================================================

import fs from 'fs';
import path from 'path';
import { Ollama } from 'ollama';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

const INDEX_FILE = path.join(config.storage.dataDir, 'embeddings.json');

export interface EmbeddingEntry {
  id: string;
  content: string;
  vector: number[];
  metadata: Record<string, string>;
  createdAt: string;
}

interface EmbeddingStore {
  entries: EmbeddingEntry[];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function loadIndex(): EmbeddingStore {
  try {
    if (fs.existsSync(INDEX_FILE)) {
      return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8')) as EmbeddingStore;
    }
  } catch {
    logger.warn('Failed to load embedding index — starting fresh');
  }
  return { entries: [] };
}

function saveIndex(store: EmbeddingStore): void {
  fs.mkdirSync(config.storage.dataDir, { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(store), 'utf-8');
}

export class EmbeddingIndex {
  private store: EmbeddingStore;
  private ollama: Ollama;
  private model: string;

  constructor() {
    this.store = loadIndex();
    this.ollama = new Ollama({ host: config.ollama.host });
    this.model = config.ollama.embedModel;
  }

  private async embed(text: string): Promise<number[] | null> {
    try {
      const res = await this.ollama.embed({ model: this.model, input: text });
      // ollama SDK returns embeddings as res.embeddings[0]
      return res.embeddings?.[0] ?? null;
    } catch (err) {
      logger.debug(`Embedding failed (${this.model}): ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  async add(id: string, content: string, metadata: Record<string, string> = {}): Promise<void> {
    const vector = await this.embed(content);
    if (!vector) return; // silently skip — recall falls back to keyword

    // Replace existing entry with same id
    this.store.entries = this.store.entries.filter(e => e.id !== id);
    this.store.entries.push({ id, content, vector, metadata, createdAt: new Date().toISOString() });

    // Cap at 2000 entries — drop oldest
    if (this.store.entries.length > 2000) {
      this.store.entries = this.store.entries.slice(-2000);
    }
    saveIndex(this.store);
  }

  async search(query: string, topK = 5, filterType?: string): Promise<EmbeddingEntry[]> {
    return (await this.searchScored(query, topK, filterType)).map(r => r.entry);
  }

  async searchScored(
    query: string,
    topK = 5,
    filterType?: string
  ): Promise<Array<{ entry: EmbeddingEntry; score: number }>> {
    if (this.store.entries.length === 0) return [];

    const queryVec = await this.embed(query);
    if (!queryVec) return [];

    let candidates = this.store.entries;
    if (filterType) {
      candidates = candidates.filter(e => e.metadata.type === filterType);
    }

    return candidates
      .map(e => ({ entry: e, score: cosine(queryVec, e.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .filter(r => r.score > 0.3);
  }

  remove(id: string): void {
    this.store.entries = this.store.entries.filter(e => e.id !== id);
    saveIndex(this.store);
  }

  size(): number {
    return this.store.entries.length;
  }
}
