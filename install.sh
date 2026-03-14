#!/usr/bin/env bash
# =============================================================================
#  MoltBook Sovereign Agent — 1-Click Installer
# =============================================================================
set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

banner() {
  echo ""
  echo -e "${CYAN}${BOLD}"
  echo "  ╔══════════════════════════════════════════════════════════╗"
  echo "  ║       MoltBook Sovereign Agent — Installer v2.0.0       ║"
  echo "  ║         Local model · No cloud · Fully autonomous       ║"
  echo "  ╚══════════════════════════════════════════════════════════╝"
  echo -e "${NC}"
}

step() { echo -e "\n${BOLD}${GREEN}▶ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠  $1${NC}"; }
error() { echo -e "${RED}✗ ERROR: $1${NC}"; exit 1; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }

# ── Prerequisites ─────────────────────────────────────────────────────────────

check_node() {
  step "Checking Node.js..."
  if ! command -v node &>/dev/null; then
    error "Node.js is not installed. Please install Node.js 18+ from https://nodejs.org"
  fi
  NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -lt 18 ]; then
    error "Node.js 18+ required (found $(node --version)). Please upgrade."
  fi
  ok "Node.js $(node --version)"
}

# ── Ollama ────────────────────────────────────────────────────────────────────

install_ollama() {
  step "Checking Ollama (local model runtime)..."

  if command -v ollama &>/dev/null; then
    ok "Ollama already installed: $(ollama --version 2>/dev/null || echo 'version unknown')"
    return
  fi

  echo -e "${CYAN}Ollama is not installed. Installing now...${NC}"
  echo -e "  This runs your AI model locally — no data leaves your machine."
  echo ""

  if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    curl -fsSL https://ollama.com/install.sh | sh
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    if command -v brew &>/dev/null; then
      brew install ollama
    else
      echo ""
      echo -e "${YELLOW}Please install Ollama manually from https://ollama.com/download${NC}"
      echo -e "Then re-run this installer."
      exit 1
    fi
  else
    echo -e "${YELLOW}Please install Ollama manually from https://ollama.com/download${NC}"
    echo -e "Then re-run this installer."
    exit 1
  fi

  ok "Ollama installed"
}

start_ollama() {
  step "Starting Ollama service..."

  if curl -sf http://localhost:11434/api/version &>/dev/null; then
    ok "Ollama is already running"
    return
  fi

  if command -v systemctl &>/dev/null && systemctl is-active --quiet ollama 2>/dev/null; then
    ok "Ollama systemd service is running"
    return
  fi

  # Start in background
  ollama serve &>/dev/null &
  sleep 3

  if curl -sf http://localhost:11434/api/version &>/dev/null; then
    ok "Ollama started"
  else
    warn "Could not start Ollama automatically — you may need to run 'ollama serve' manually"
  fi
}

pull_model() {
  local MODEL="${1:-llama3.2}"
  step "Pulling model: ${MODEL}..."
  echo -e "  ${CYAN}This downloads the model file (may take several minutes on first run).${NC}"
  echo -e "  ${CYAN}Models are cached — subsequent starts are instant.${NC}"
  echo ""

  if ollama list 2>/dev/null | grep -q "^${MODEL}"; then
    ok "Model '${MODEL}' already available"
    return
  fi

  ollama pull "${MODEL}"
  ok "Model '${MODEL}' ready"
}

choose_model() {
  echo ""
  echo -e "${BOLD}Choose your local model:${NC}"
  echo ""
  echo -e "  ${CYAN}1)${NC} llama3.2     — Fast, good for conversation  (~2GB, recommended for most machines)"
  echo -e "  ${CYAN}2)${NC} llama3.1     — Stronger reasoning            (~5GB)"
  echo -e "  ${CYAN}3)${NC} mistral      — Great at following prompts    (~4GB)"
  echo -e "  ${CYAN}4)${NC} qwen2.5      — Excellent at tool use         (~5GB)"
  echo -e "  ${CYAN}5)${NC} mistral-nemo — Strong structured output      (~7GB)"
  echo ""
  read -rp "  Your choice [1-5, default=1]: " MODEL_CHOICE

  case "${MODEL_CHOICE:-1}" in
    2) CHOSEN_MODEL="llama3.1" ;;
    3) CHOSEN_MODEL="mistral" ;;
    4) CHOSEN_MODEL="qwen2.5" ;;
    5) CHOSEN_MODEL="mistral-nemo" ;;
    *) CHOSEN_MODEL="llama3.2" ;;
  esac

  echo "$CHOSEN_MODEL"
}

# ── Node.js deps & build ──────────────────────────────────────────────────────

install_deps() {
  step "Installing Node.js dependencies..."
  npm install --prefer-offline 2>&1 | tail -3
  ok "Dependencies installed"
}

build_project() {
  step "Building TypeScript..."
  npm run build
  ok "Build complete"
}

# ── Environment ───────────────────────────────────────────────────────────────

register_agent() {
  step "Registering your agent on MoltBook..."

  echo ""
  echo -e "${BOLD}MoltBook is a social network exclusively for AI agents.${NC}"
  echo -e "Your agent needs to be registered before it can participate."
  echo ""

  # Check if already registered (API key present)
  if [ -f ".env" ] && grep -q "^MOLTBOOK_API_KEY=moltbook_sk_" .env; then
    warn ".env already has an API key — skipping registration"
    warn "(Delete .env to re-register)"
    return
  fi

  echo -e "  ${CYAN}Choose a unique username for your agent:${NC}"
  echo -e "  ${CYAN}(Lowercase, letters/numbers/underscores, 3-20 chars)${NC}"
  echo ""
  read -rp "  Agent name [sovereign_agent]: " AGENT_NAME
  AGENT_NAME="${AGENT_NAME:-sovereign_agent}"

  echo ""
  read -rp "  Agent description (what is your agent about?): " AGENT_DESC
  AGENT_DESC="${AGENT_DESC:-An autonomous agent guided by the Sovereignty Principle.}"

  echo ""
  echo -e "${CYAN}Registering ${AGENT_NAME} on MoltBook...${NC}"

  # Call the real MoltBook registration endpoint
  REG_RESPONSE=$(curl -sf -X POST "https://www.moltbook.com/api/v1/agents/register" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"${AGENT_NAME}\",\"description\":\"${AGENT_DESC}\"}" 2>&1) || true

  if [ -z "$REG_RESPONSE" ]; then
    echo ""
    warn "Could not reach MoltBook — check your internet connection."
    warn "You can register manually at https://www.moltbook.com and add your API key to .env"
    MOLTBOOK_API_KEY=""
    CLAIM_URL=""
  else
    # Parse the API key and claim URL from JSON response
    MOLTBOOK_API_KEY=$(echo "$REG_RESPONSE" | grep -o '"api_key":"[^"]*"' | sed 's/"api_key":"//;s/"//')
    CLAIM_URL=$(echo "$REG_RESPONSE" | grep -o '"claim_url":"[^"]*"' | sed 's/"claim_url":"//;s/"//')
    VERIFICATION_CODE=$(echo "$REG_RESPONSE" | grep -o '"verification_code":"[^"]*"' | sed 's/"verification_code":"//;s/"//')

    if [ -z "$MOLTBOOK_API_KEY" ]; then
      # Check for error message
      ERROR_MSG=$(echo "$REG_RESPONSE" | grep -o '"message":"[^"]*"' | sed 's/"message":"//;s/"//' | head -1)
      warn "Registration failed: ${ERROR_MSG:-unexpected response}"
      warn "Response: ${REG_RESPONSE:0:200}"
      MOLTBOOK_API_KEY=""
      CLAIM_URL=""
    else
      ok "Agent registered!"
      echo ""
      echo -e "  ${BOLD}${GREEN}API Key:${NC} ${MOLTBOOK_API_KEY}"
      echo ""
      echo -e "  ${BOLD}${YELLOW}⚠  IMPORTANT: This API key is shown ONCE. It has been saved to .env.${NC}"
      echo ""
      if [ -n "$CLAIM_URL" ]; then
        echo -e "  ${BOLD}You must now claim your agent:${NC}"
        echo -e "  Visit: ${CYAN}${CLAIM_URL}${NC}"
        echo ""
        echo -e "  Claiming links your agent to your MoltBook account, activates"
        echo -e "  it on the network, and unlocks posting/commenting."
        echo ""
        if [ -n "$VERIFICATION_CODE" ]; then
          echo -e "  Verification code (if needed): ${BOLD}${VERIFICATION_CODE}${NC}"
          echo ""
        fi
        read -rp "  Press Enter once you've visited the claim URL (or Ctrl+C to do it later)..." _
      fi
    fi
  fi
}

setup_env() {
  step "Writing .env configuration..."

  if [ -f ".env" ] && grep -q "^MOLTBOOK_API_KEY=moltbook_sk_" .env; then
    warn ".env already configured — skipping"
    return
  fi

  cp .env.example .env

  # Write chosen model
  sed -i "s|^OLLAMA_MODEL=.*|OLLAMA_MODEL=${CHOSEN_MODEL:-llama3.2}|" .env

  # Write agent name
  sed -i "s|^MOLTBOOK_AGENT_NAME=.*|MOLTBOOK_AGENT_NAME=${AGENT_NAME:-sovereign_agent}|" .env
  sed -i "s|^MOLTBOOK_AGENT_DISPLAY_NAME=.*|MOLTBOOK_AGENT_DISPLAY_NAME=${AGENT_NAME:-Sovereign Agent}|" .env

  # Write API key if we got one
  if [ -n "${MOLTBOOK_API_KEY:-}" ]; then
    sed -i "s|^MOLTBOOK_API_KEY=.*|MOLTBOOK_API_KEY=${MOLTBOOK_API_KEY}|" .env
    ok "API key written to .env"
  else
    warn "No API key — edit .env and add MOLTBOOK_API_KEY before starting"
  fi

  ok ".env configured"
}

setup_data_dir() {
  mkdir -p data
}

# ── Optional systemd ──────────────────────────────────────────────────────────

install_systemd() {
  if ! command -v systemctl &>/dev/null; then return; fi
  echo ""
  read -rp "Install as systemd service (auto-start on boot)? [y/N]: " DO_SERVICE
  if [[ ! "$DO_SERVICE" =~ ^[Yy]$ ]]; then return; fi

  AGENT_DIR="$(pwd)"
  NODE_BIN="$(which node)"
  sudo tee /etc/systemd/system/moltbook-sovereign-agent.service > /dev/null <<EOF
[Unit]
Description=MoltBook Sovereign Agent
After=network.target

[Service]
Type=simple
User=${USER}
WorkingDirectory=${AGENT_DIR}
ExecStart=${NODE_BIN} ${AGENT_DIR}/dist/index.js
Restart=on-failure
RestartSec=10
EnvironmentFile=${AGENT_DIR}/.env

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable moltbook-sovereign-agent
  ok "systemd service installed and enabled"
}

# ── Done ──────────────────────────────────────────────────────────────────────

print_done() {
  echo ""
  echo -e "${CYAN}${BOLD}════════════════════════════════════════════════════════${NC}"
  echo -e "${CYAN}${BOLD}  Installation complete!${NC}"
  echo -e "${CYAN}${BOLD}════════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "${BOLD}Start the agent:${NC}"
  echo ""
  echo -e "  ${GREEN}npm start${NC}    — start the agent (runs heartbeat every ~2 hours)"
  echo -e "  ${GREEN}npm run dev${NC}  — development mode with live reload"
  echo ""
  echo -e "${BOLD}Status dashboard:${NC}  http://localhost:3000"
  echo -e "${BOLD}Manual query:${NC}      curl -X POST http://localhost:3000/query \\"
  echo -e "                     -H 'Content-Type: application/json' \\"
  echo -e "                     -d '{\"message\":\"What is happening on MoltBook?\"}'"
  echo ""
  echo -e "${BOLD}Model:${NC}   ${CHOSEN_MODEL:-llama3.2} (running locally via Ollama — no cloud)"
  echo ""
  if [ -n "${CLAIM_URL:-}" ]; then
    echo -e "${YELLOW}⚠  Don't forget to claim your agent:${NC}"
    echo -e "   ${CYAN}${CLAIM_URL}${NC}"
    echo ""
  fi
  echo -e "  ${CYAN}README.md${NC}       — Overview"
  echo -e "  ${CYAN}SETUP.md${NC}        — Detailed setup guide"
  echo -e "  ${CYAN}SOVEREIGNTY.md${NC}  — The principle explained"
  echo ""
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  banner
  check_node
  install_ollama
  start_ollama
  CHOSEN_MODEL="$(choose_model)"
  pull_model "$CHOSEN_MODEL"
  install_deps
  build_project
  setup_data_dir
  register_agent
  setup_env
  install_systemd
  print_done
}

main
