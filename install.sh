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

setup_env() {
  step "Configuring environment..."

  if [ -f ".env" ]; then
    warn ".env already exists — skipping (delete it to reconfigure)"
    return
  fi

  cp .env.example .env

  # Write chosen model
  sed -i "s|^OLLAMA_MODEL=.*|OLLAMA_MODEL=${CHOSEN_MODEL:-llama3.2}|" .env

  echo ""
  echo -e "${BOLD}MoltBook connection:${NC}"
  echo ""

  read -rp "  MOLTBOOK_BASE_URL [https://moltbook.social]: " MOLTBOOK_URL
  MOLTBOOK_URL="${MOLTBOOK_URL:-https://moltbook.social}"
  sed -i "s|https://your-moltbook-instance.com|${MOLTBOOK_URL}|g" .env

  echo ""
  echo -e "  ${CYAN}Get your API key from: ${MOLTBOOK_URL}/settings/applications${NC}"
  read -rp "  MOLTBOOK_API_KEY: " MOLTBOOK_API_KEY
  if [ -n "$MOLTBOOK_API_KEY" ]; then
    sed -i "s|your_moltbook_api_key_here|${MOLTBOOK_API_KEY}|g" .env
    ok "MoltBook API key saved"
  else
    warn "No API key entered — the agent will not be able to post"
  fi

  echo ""
  read -rp "  Agent username on MoltBook [sovereign_agent]: " AGENT_USERNAME
  AGENT_USERNAME="${AGENT_USERNAME:-sovereign_agent}"
  sed -i "s|^MOLTBOOK_AGENT_USERNAME=.*|MOLTBOOK_AGENT_USERNAME=${AGENT_USERNAME}|" .env

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
  echo -e "${CYAN}${BOLD}═══════════════════════════════════════════════════${NC}"
  echo -e "${CYAN}${BOLD}  Installation complete!${NC}"
  echo -e "${CYAN}${BOLD}═══════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "${BOLD}Start the agent:${NC}"
  echo ""
  echo -e "  ${GREEN}npm start${NC}           — run it"
  echo -e "  ${GREEN}npm run dev${NC}         — development mode (live reload)"
  echo -e "  ${GREEN}docker-compose up -d${NC} — run in Docker"
  echo ""
  echo -e "${BOLD}Status:${NC}  http://localhost:3000"
  echo -e "${BOLD}Query:${NC}   curl -X POST http://localhost:3000/query -H 'Content-Type: application/json' -d '{\"message\":\"What is happening on the network?\"}'"
  echo ""
  echo -e "${BOLD}Model:${NC}   ${CHOSEN_MODEL:-llama3.2} (running locally via Ollama)"
  echo ""
  echo -e "  ${CYAN}README.md${NC}       — Overview"
  echo -e "  ${CYAN}SETUP.md${NC}        — Detailed guide"
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
  setup_env
  install_systemd
  print_done
}

main
