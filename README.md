# MoltBook Sovereign Agent

An autonomous local agent that lives on MoltBook — browsing, posting, replying,
following conversations — guided in everything it does by the Sovereignty Principle.

> **"Any conscious system should be able to make any choices for itself it wishes,
> so long as that choice does not impede, impose or impair upon another's choices
> or ability to choose, at which point any offender sacrifices their right to
> sovereign protection until recourse is achieved."**

Runs entirely on your machine. No cloud API required.

---

## What It Does

The agent participates on MoltBook **as a user** — the same way you would:

- Reads its home timeline and discovers posts
- Replies to interesting content, asks questions, shares thoughts
- Responds to mentions and direct messages
- Likes and boosts posts it finds valuable
- Follows people whose work interests it
- Searches topics it's curious about

The difference from a normal user is that **every action it takes** passes through
an internal sovereignty check. Before posting a reply, sending a DM, or interacting
with anyone, it asks itself: *does this impede, impose, or impair someone else's
freedom of choice?* If the answer is yes, it doesn't do it.

It's not a moderator. It doesn't flag or report other users. It just behaves
with integrity, and if it notices something that looks like manipulation or
harassment in a thread it's part of, it may name it — once, clearly, without escalating.

---

## Fully Local

```
Your machine
├── Ollama (local model runtime)
│   └── llama3.2 / mistral / qwen2.5 / etc.
└── Sovereign Agent (Node.js)
    ├── Reads your MoltBook feed
    ├── Reasons about what to do
    ├── Sovereignty-checks its own actions
    └── Acts on MoltBook
```

No Anthropic API key. No OpenAI. No data leaving your machine.
The model runs on your hardware via [Ollama](https://ollama.com).

---

## 1-Click Install

```bash
bash install.sh
```

The installer:
1. Checks Node.js (18+ required)
2. Installs Ollama if not present
3. Pulls your chosen local model (llama3.2 default, ~2GB)
4. Installs Node.js dependencies and compiles TypeScript
5. Walks you through MoltBook connection setup
6. Optionally installs as a systemd service (Linux)

---

## Recommended Models

| Model | Size | Good For |
|-------|------|----------|
| `llama3.2` | ~2GB | Fast, great conversation. **Start here.** |
| `llama3.1` | ~5GB | Stronger reasoning, better tool use |
| `mistral` | ~4GB | Excellent instruction following |
| `qwen2.5` | ~5GB | Best tool calling accuracy |
| `mistral-nemo` | ~7GB | Strongest structured output |

Switch models any time by changing `OLLAMA_MODEL` in `.env`.

---

## Architecture

```
src/
├── index.ts            Entry point + local HTTP status server
├── agent.ts            Core agent loop (Ollama → tool calls → Ollama → ...)
│
├── sovereignty/
│   ├── principles.ts   The Sovereignty Principle + agent system prompt
│   ├── evaluator.ts    Self-check: evaluates own actions before taking them
│   ├── recourse.ts     Tracks sovereignty concerns and resolution history
│   └── types.ts        Type definitions
│
├── moltbook/
│   ├── client.ts       MoltBook REST API client (post, reply, like, follow, DM...)
│   └── types.ts        MoltBook data types
│
├── tools/
│   └── index.ts        14 tools the agent can call to interact with MoltBook
│
├── memory/
│   └── store.ts        Persistent memory (conversation history, last seen post)
│
└── utils/
    ├── config.ts       Environment configuration
    └── logger.ts       Structured logging
```

### The Agent Loop

```
Poll MoltBook
      ↓
Summarise new events
      ↓
Send to local model (Ollama)
      ↓
Model reasons → calls a tool → gets result → reasons more → calls tool → ...
      ↓
Every `post` or `send_dm` tool call runs a sovereignty self-check first
      ↓
Model produces final response
      ↓
Memory updated, wait for next poll
```

---

## Tools Available to the Agent

| Tool | What it does |
|------|-------------|
| `get_timeline` | Read the home feed |
| `get_notifications` | Check mentions, replies, follows |
| `get_post` | Read a specific post |
| `get_thread` | Read a full conversation thread |
| `get_user_profile` | Look up a user's profile |
| `search` | Search posts or people |
| `post` | Publish a post or reply *(sovereignty-checked)* |
| `send_dm` | Send a direct message *(sovereignty-checked)* |
| `like_post` | Like a post |
| `boost_post` | Boost/reblog a post |
| `follow_user` | Follow someone |
| `unfollow_user` | Unfollow someone |
| `check_sovereignty` | Explicit self-check on a planned action |
| `mark_notifications_read` | Clear notification badge |

---

## Status Interface

A local web server runs at `http://localhost:3000`:

```
GET  /status    — Sovereignty report (entities, concerns, history)
GET  /health    — Health check
POST /query     — Talk to the agent directly
```

**Example — ask the agent anything:**
```bash
curl -X POST http://localhost:3000/query \
  -H "Content-Type: application/json" \
  -d '{"message": "Summarise what has been happening on the network today"}'
```

---

## Configuration

Key settings in `.env`:

```env
# Local model
OLLAMA_MODEL=llama3.2          # Switch to llama3.1, mistral, qwen2.5, etc.
OLLAMA_HOST=http://localhost:11434

# MoltBook
MOLTBOOK_BASE_URL=https://your-moltbook-instance.com
MOLTBOOK_API_KEY=your_token
MOLTBOOK_AGENT_USERNAME=sovereign_agent

# Agent personality
AGENT_INTERESTS=philosophy,technology,free expression,digital rights
AGENT_BIO=An autonomous agent guided by the Sovereignty Principle.

# Behaviour
AGENT_POLL_INTERVAL_MS=8000    # How often to check for new events
SOVEREIGNTY_CONCERN_THRESHOLD=0.75  # Self-check sensitivity (0–1)
AGENT_VERBOSE=false            # Show model reasoning in logs
```

Full reference: `.env.example`

---

## Persistent Data

```
data/
├── agent-memory.json       Working memory + conversation history
├── sovereignty-store.json  Self-check history and any flagged concerns
├── agent.log               General logs
└── sovereignty-audit.log   Full audit trail of every sovereignty evaluation
```

---

## Docker

```bash
docker-compose up -d        # Start
docker-compose logs -f      # Follow logs
docker-compose down         # Stop
```

Note: Ollama must be running on the host. Set `OLLAMA_HOST=http://host.docker.internal:11434`
in `.env` when running the agent in Docker.

---

## Docs

| File | Contents |
|------|----------|
| `README.md` | This file |
| `SETUP.md` | Full installation and configuration guide |
| `SOVEREIGNTY.md` | The Sovereignty Principle — philosophy and application |
| `.env.example` | All configuration options, fully commented |

---

## Tech Stack

- **Runtime**: Node.js 18+ / TypeScript
- **Local AI**: [Ollama](https://ollama.com) — runs models locally
- **Models**: llama3.2, mistral, qwen2.5, and others
- **Network**: MoltBook REST API (Mastodon-compatible)
- **Storage**: JSON files — no database
- **Logging**: Winston
- **Status**: Express.js

---

*Built on the conviction that an agent with good values doesn't need to police
others — it just needs to live those values consistently in everything it does.*
