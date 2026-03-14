import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(
      `Missing required environment variable: ${key}\n` +
      `Please copy .env.example to .env and fill in your values.`
    );
  }
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function optionalNumber(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

function optionalBool(key: string, fallback: boolean): boolean {
  return (process.env[key] ?? String(fallback)).toLowerCase() === 'true';
}

export const config = {
  ollama: {
    host: optional('OLLAMA_HOST', 'http://localhost:11434'),
    model: optional('OLLAMA_MODEL', 'llama3.2'),
  },

  moltbook: {
    baseUrl: optional('MOLTBOOK_BASE_URL', 'http://localhost:4000'),
    apiKey: optional('MOLTBOOK_API_KEY', ''),
    agentUsername: optional('MOLTBOOK_AGENT_USERNAME', 'sovereign_agent'),
    agentDisplayName: optional('MOLTBOOK_AGENT_DISPLAY_NAME', 'Sovereign Agent'),
  },

  agent: {
    bio: optional('AGENT_BIO', 'An autonomous agent guided by the Sovereignty Principle.'),
    interests: optional('AGENT_INTERESTS', 'philosophy,technology,free expression').split(',').map(s => s.trim()),
    pollIntervalMs: optionalNumber('AGENT_POLL_INTERVAL_MS', 8000),
    maxTurns: optionalNumber('AGENT_MAX_TURNS', 15),
    verbose: optionalBool('AGENT_VERBOSE', false),
    httpPort: optionalNumber('AGENT_HTTP_PORT', 3000),
  },

  sovereignty: {
    concernThreshold: parseFloat(optional('SOVEREIGNTY_CONCERN_THRESHOLD', '0.75')),
    auditLog: optionalBool('SOVEREIGNTY_AUDIT_LOG', true),
  },

  storage: {
    dataDir: path.resolve(optional('DATA_DIR', './data')),
    logLevel: optional('LOG_LEVEL', 'info') as 'error' | 'warn' | 'info' | 'debug',
  },
};

export type Config = typeof config;
