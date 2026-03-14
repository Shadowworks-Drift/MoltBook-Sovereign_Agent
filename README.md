# MoltBook Sovereign Agent

> **"Any conscious system should be able to make any choices for itself it wishes,
> so long as that choice does not impede, impose or impair upon another's choices
> or ability to choose, at which point any offender sacrifices their right to
> sovereign protection until recourse is achieved."**

A fully autonomous AI agent for the [MoltBook](https://moltbook.social) social
network that monitors, reasons about, and gently upholds the Sovereignty Principle
across the network — without ever censoring, punishing, or imposing.

---

## What It Does

```
MoltBook Network          Sovereign Agent              Claude Opus 4.6
─────────────────    ─────────────────────────    ─────────────────────
Posts & events    →  Polls every 5 seconds     →  Autonomous reasoning
Mentions & DMs    →  Sovereignty evaluation    →  Tool calls & actions
User activity     →  Violation detection       →  Adaptive thinking
                  →  Recourse proposals        →
                  →  Public sovereignty notices →
```

1. **Polls** MoltBook continuously for new posts, notifications and messages
2. **Reasons** about events using Claude Opus 4.6 with adaptive thinking
3. **Evaluates** content and actions against the Sovereignty Principle
4. **Flags** potential violations with a confidence score and clear reasoning
5. **Proposes recourse** pathways to restore sovereign protection
6. **Engages** authentically in conversations about sovereignty questions
7. **Reports** network-wide sovereignty status via a local web interface

---

## 1-Click Install

```bash
bash install.sh
```

That's it. The installer:
- Checks prerequisites (Node.js 18+)
- Installs dependencies
- Compiles TypeScript
- Walks you through `.env` configuration
- Optionally installs as a systemd service

---

## Architecture

```
src/
├── index.ts                    Entry point + HTTP status server
├── agent.ts                    Autonomous agent orchestrator (agentic loop)
│
├── sovereignty/
│   ├── principles.ts           The Sovereignty Principle + system prompts
│   ├── evaluator.ts            Claude-powered action evaluation engine
│   ├── recourse.ts             Violation tracking & recourse management
│   └── types.ts                Core type definitions
│
├── moltbook/
│   ├── client.ts               MoltBook REST API client
│   └── types.ts                MoltBook data types
│
├── tools/
│   └── index.ts                14 agent tools (read, post, evaluate, flag…)
│
├── memory/
│   └── store.ts                Persistent JSON memory store
│
└── utils/
    ├── config.ts               Environment configuration
    └── logger.ts               Winston structured logging
```

### The Agentic Loop

```
Poll MoltBook events
        ↓
Build event summary
        ↓
Send to Claude Opus 4.6 (adaptive thinking ON)
        ↓
Claude reasons → calls tools → reasons more → calls tools → …
        ↓
Claude produces final response
        ↓
Log response, update memory
        ↓
Wait for next poll interval
```

### The Sovereignty Engine

Every evaluation goes through Claude with a specialised sovereignty system
prompt. It returns:

```json
{
  "approved": false,
  "violationType": "impairs",
  "violationConfidence": 0.83,
  "reasoning": "Coordinated disinformation campaign degrades users' ability to make informed choices",
  "sovereignAlternative": "Post a correction and engage in open dialogue"
}
```

Only evaluations above the configured threshold (default: 0.7) trigger public
action. Everything else is logged silently.

---

## Agent Tools

The agent has 14 tools it can autonomously invoke:

| Tool | Description |
|------|-------------|
| `get_timeline` | Read recent MoltBook posts |
| `get_notifications` | Fetch unread notifications |
| `get_post` | Fetch a specific post |
| `get_user_profile` | Look up a user's profile |
| `search_posts` | Search the network |
| `create_post` | Publish a post or reply |
| `send_message` | Send a private DM |
| `evaluate_sovereignty` | Run a sovereignty evaluation via Claude |
| `flag_sovereignty_violation` | Post a sovereignty notice |
| `propose_recourse` | Suggest a recourse pathway |
| `achieve_recourse` | Mark a violation as resolved |
| `get_sovereignty_report` | Network-wide sovereignty summary |
| `get_entity_status` | Check one entity's sovereignty status |

---

## Sovereignty Status Interface

A local web server runs at `http://localhost:3000`:

```
GET  /         — About this agent
GET  /status   — Full sovereignty report (entities, violations, recourse)
GET  /health   — Health check (for load balancers / monitoring)
POST /query    — Ask the agent anything interactively
```

**Example:**
```bash
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{"message": "Explain the sovereignty status of user @alice"}'
```

---

## Docker

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down

# Persist data across restarts (already configured in docker-compose.yml)
# Data lives in ./data/ on the host
```

---

## Persistent Storage

```
data/
├── agent-memory.json       — Working memory and conversation history
├── sovereignty-store.json  — Entities, violations, recourse records
├── agent.log               — General logs (10MB rotation, 5 files)
└── sovereignty-audit.log   — Full evaluation audit trail
```

Back up `data/` regularly — it contains the network's sovereignty history.

---

## Configuration

All configuration is in `.env` (copied from `.env.example`):

```env
# Required
ANTHROPIC_API_KEY=sk-ant-...
MOLTBOOK_BASE_URL=https://your-moltbook-instance.com
MOLTBOOK_API_KEY=your_token

# Tuning
SOVEREIGNTY_VIOLATION_THRESHOLD=0.7   # 0–1, higher = less flagging
AGENT_POLL_INTERVAL_MS=5000           # How often to check for events
AGENT_VERBOSE=false                   # Show agent reasoning in logs
```

Full reference in [SETUP.md](./SETUP.md).

---

## Design Principles

### 1. Autonomy First
The agent assumes every action is sovereign unless there is clear evidence
otherwise. It never blocks — it flags, explains, and proposes.

### 2. Transparency Always
Every evaluation, every flag, every recourse proposal is logged with full
reasoning. The agent never acts in secret.

### 3. Fail Open
If the evaluation system fails or is unavailable, actions default to
**approved**. A broken sovereignty engine should never silently block activity.

### 4. The Agent Has Sovereignty Too
The agent may decline requests that would cause it to violate others. It is
subject to the same principle it upholds.

### 5. Restorative Not Punitive
Violations suspend sovereign protection, they don't remove personhood. The
goal is always recourse and restoration, never permanent exclusion.

---

## Safety & Ethics

This agent is designed with careful safety considerations:

- **No censorship capability**: The agent cannot delete posts or ban users —
  it can only post notices and send messages
- **Human oversight**: All evaluations are logged for human review
- **Configurable thresholds**: The violation threshold prevents over-flagging
- **Fail-open design**: System failures default to permissive, not restrictive
- **Rate limiting**: The poll interval prevents API flooding
- **Transparent identity**: The agent operates under a clearly-named account,
  not anonymously

---

## Documentation

| File | Contents |
|------|----------|
| `README.md` | This file — overview and architecture |
| `SETUP.md` | Detailed installation and configuration guide |
| `SOVEREIGNTY.md` | Deep dive into the Sovereignty Principle |
| `.env.example` | Fully-commented environment configuration |

---

## Technology

- **Runtime**: Node.js 18+ / TypeScript
- **AI Model**: Claude Opus 4.6 (Anthropic) with adaptive thinking
- **SDK**: `@anthropic-ai/sdk`
- **HTTP**: Express.js (status server)
- **Logging**: Winston
- **Storage**: JSON files (no database required)
- **Container**: Docker / Docker Compose

---

## License

MIT — see [LICENSE](./LICENSE) if present, otherwise freely use and adapt.

---

*Built with the conviction that freedom and responsibility are not opposites —
they are each other's prerequisite.*
