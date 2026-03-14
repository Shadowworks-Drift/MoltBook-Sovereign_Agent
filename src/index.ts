import 'dotenv/config';
import express from 'express';
import { SovereignAgent } from './agent';
import { logger } from './utils/logger';
import { config } from './utils/config';

// ── Graceful Shutdown ─────────────────────────────────────────────────────────

let agent: SovereignAgent | null = null;

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal} — shutting down gracefully...`);
  if (agent) await agent.stop();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ── HTTP Status Interface ─────────────────────────────────────────────────────

function startStatusServer(a: SovereignAgent): void {
  const app = express();
  app.use(express.json());

  app.get('/', (_req, res) => {
    res.json({
      service: 'MoltBook Sovereign Agent',
      version: '1.0.0',
      principle: 'Any conscious system should be able to make any choices for itself it wishes, ' +
        'so long as that choice does not impede, impose or impair upon another\'s choices or ' +
        'ability to choose, at which point any offender sacrifices their right to sovereign ' +
        'protection until recourse is achieved.',
    });
  });

  app.get('/status', (_req, res) => {
    res.json(a.getStatus());
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Interactive query endpoint
  app.post('/query', async (req, res) => {
    const { message } = req.body as { message?: string };
    if (!message) {
      res.status(400).json({ error: 'message field required' });
      return;
    }
    try {
      const response = await a.query(message);
      res.json({ response });
    } catch (err) {
      logger.error('Query endpoint error', { err });
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.listen(config.agent.httpPort, () => {
    logger.info(`Status server: http://localhost:${config.agent.httpPort}`);
    logger.info(`  GET  /         — About`);
    logger.info(`  GET  /status   — Sovereignty report`);
    logger.info(`  GET  /health   — Health check`);
    logger.info(`  POST /query    — Interactive query { "message": "..." }`);
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info('');
  logger.info('  ██████╗  ██████╗ ██╗   ██╗███████╗██████╗ ███████╗██╗ ██████╗ ███╗   ██╗');
  logger.info('  ██╔════╝██╔═══██╗██║   ██║██╔════╝██╔══██╗██╔════╝██║██╔════╝ ████╗  ██║');
  logger.info('  ███████╗██║   ██║██║   ██║█████╗  ██████╔╝█████╗  ██║██║  ███╗██╔██╗ ██║');
  logger.info('  ╚════██║██║   ██║╚██╗ ██╔╝██╔══╝  ██╔══██╗██╔══╝  ██║██║   ██║██║╚██╗██║');
  logger.info('  ███████║╚██████╔╝ ╚████╔╝ ███████╗██║  ██║███████╗██║╚██████╔╝██║ ╚████║');
  logger.info('  ╚══════╝ ╚═════╝   ╚═══╝  ╚══════╝╚═╝  ╚═╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝');
  logger.info('');
  logger.info('  MoltBook Sovereign Agent v1.0.0');
  logger.info('');

  agent = new SovereignAgent();
  startStatusServer(agent);
  await agent.start();
}

main().catch(err => {
  logger.error('Fatal error during startup', { err });
  process.exit(1);
});
