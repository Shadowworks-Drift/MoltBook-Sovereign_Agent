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
NC='\033[0m' # No Colour

banner() {
  echo ""
  echo -e "${CYAN}${BOLD}"
  echo "  ╔══════════════════════════════════════════════════════════╗"
  echo "  ║       MoltBook Sovereign Agent — Installer v1.0.0       ║"
  echo "  ╚══════════════════════════════════════════════════════════╝"
  echo -e "${NC}"
}

step() { echo -e "\n${BOLD}${GREEN}▶ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠  $1${NC}"; }
error() { echo -e "${RED}✗ $1${NC}"; exit 1; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }

# ── Prerequisites Check ───────────────────────────────────────────────────────

check_prerequisites() {
  step "Checking prerequisites..."

  # Node.js
  if ! command -v node &>/dev/null; then
    error "Node.js is not installed. Please install Node.js 18+ from https://nodejs.org"
  fi
  NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -lt 18 ]; then
    error "Node.js 18+ required (found $(node --version)). Please upgrade."
  fi
  ok "Node.js $(node --version)"

  # npm
  if ! command -v npm &>/dev/null; then
    error "npm is not installed. It usually comes with Node.js."
  fi
  ok "npm $(npm --version)"

  # git (optional but recommended)
  if command -v git &>/dev/null; then
    ok "git $(git --version | awk '{print $3}')"
  else
    warn "git not found — that's okay but recommended"
  fi
}

# ── Dependencies ──────────────────────────────────────────────────────────────

install_dependencies() {
  step "Installing Node.js dependencies..."
  npm install --prefer-offline 2>&1 | tail -5
  ok "Dependencies installed"
}

# ── Build ─────────────────────────────────────────────────────────────────────

build_project() {
  step "Building TypeScript..."
  npm run build
  ok "Build successful"
}

# ── Environment Setup ─────────────────────────────────────────────────────────

setup_env() {
  step "Setting up environment configuration..."

  if [ -f ".env" ]; then
    warn ".env already exists — skipping (delete it to reconfigure)"
    return
  fi

  cp .env.example .env
  echo ""
  echo -e "${CYAN}Please enter your configuration:${NC}"
  echo ""

  # ANTHROPIC_API_KEY
  echo -e "${BOLD}Anthropic API Key${NC} (get one at https://console.anthropic.com/)"
  read -rp "  ANTHROPIC_API_KEY: " ANTHROPIC_API_KEY
  if [ -z "$ANTHROPIC_API_KEY" ]; then
    warn "No API key entered — you will need to edit .env manually"
  else
    sed -i "s|your_anthropic_api_key_here|${ANTHROPIC_API_KEY}|g" .env
    ok "Anthropic API key saved"
  fi

  echo ""
  echo -e "${BOLD}MoltBook Instance URL${NC} (your MoltBook server URL)"
  read -rp "  MOLTBOOK_BASE_URL [https://moltbook.social]: " MOLTBOOK_URL
  MOLTBOOK_URL="${MOLTBOOK_URL:-https://moltbook.social}"
  sed -i "s|https://your-moltbook-instance.com|${MOLTBOOK_URL}|g" .env
  ok "MoltBook URL: ${MOLTBOOK_URL}"

  echo ""
  echo -e "${BOLD}MoltBook API Key${NC} (from your MoltBook agent account settings)"
  read -rp "  MOLTBOOK_API_KEY: " MOLTBOOK_API_KEY
  if [ -n "$MOLTBOOK_API_KEY" ]; then
    sed -i "s|your_moltbook_api_key_here|${MOLTBOOK_API_KEY}|g" .env
    ok "MoltBook API key saved"
  else
    warn "No MoltBook API key — the agent will operate in read-only mode"
  fi

  echo ""
  ok ".env configured"
}

# ── Data Directory ────────────────────────────────────────────────────────────

setup_data_dir() {
  step "Creating data directory..."
  mkdir -p data
  ok "data/ directory ready"
}

# ── Launch Options ────────────────────────────────────────────────────────────

print_launch_instructions() {
  echo ""
  echo -e "${CYAN}${BOLD}═══════════════════════════════════════════════════${NC}"
  echo -e "${CYAN}${BOLD}  Installation complete! 🎉${NC}"
  echo -e "${CYAN}${BOLD}═══════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "${BOLD}To start the agent:${NC}"
  echo ""
  echo -e "  ${GREEN}npm start${NC}          — production mode (compiled)"
  echo -e "  ${GREEN}npm run dev${NC}        — development mode (live reload)"
  echo ""
  echo -e "${BOLD}Or with Docker:${NC}"
  echo ""
  echo -e "  ${GREEN}docker-compose up -d${NC}   — run in background"
  echo -e "  ${GREEN}docker-compose logs -f${NC} — view logs"
  echo ""
  echo -e "${BOLD}Status interface:${NC}  http://localhost:3000"
  echo -e "${BOLD}Sovereignty report:${NC} http://localhost:3000/status"
  echo ""
  echo -e "${BOLD}Documentation:${NC}"
  echo -e "  README.md       — Full overview"
  echo -e "  SETUP.md        — Detailed setup guide"
  echo -e "  SOVEREIGNTY.md  — Sovereignty law reference"
  echo ""
  echo -e "${YELLOW}Remember to review .env before running in production.${NC}"
  echo ""
}

# ── Optional: systemd service ─────────────────────────────────────────────────

install_systemd_service() {
  if ! command -v systemctl &>/dev/null; then
    return
  fi

  echo ""
  read -rp "Install as a systemd service (auto-start on boot)? [y/N]: " INSTALL_SERVICE
  if [[ "$INSTALL_SERVICE" =~ ^[Yy]$ ]]; then
    AGENT_DIR="$(pwd)"
    NODE_BIN="$(which node)"
    SERVICE_FILE="/etc/systemd/system/moltbook-sovereign-agent.service"

    sudo tee "$SERVICE_FILE" > /dev/null <<EOF
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
    echo -e "  ${GREEN}sudo systemctl start moltbook-sovereign-agent${NC}"
    echo -e "  ${GREEN}sudo systemctl status moltbook-sovereign-agent${NC}"
  fi
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  banner
  check_prerequisites
  install_dependencies
  build_project
  setup_data_dir
  setup_env
  install_systemd_service
  print_launch_instructions
}

main
