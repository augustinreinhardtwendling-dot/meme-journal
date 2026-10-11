#!/usr/bin/env bash
# Lance un passage Claude Code non interactif (abonnement, jeton OAuth).
# Usage : pipeline/claude/run.sh <classement|fiches|watchlist> <tours max>
set -u
step="$1"
turns="$2"

# Un jeton copié depuis un terminal peut contenir un retour à la ligne ou des espaces
# (le terminal coupe les longues lignes) : on les retire avant de l'utiliser.
CLAUDE_CODE_OAUTH_TOKEN="$(printf '%s' "${CLAUDE_CODE_OAUTH_TOKEN:-}" | tr -d '[:space:]')"
export CLAUDE_CODE_OAUTH_TOKEN

claude -p "$(cat "pipeline/claude/prompt-$step.md")" \
  --settings pipeline/claude/settings.json \
  --permission-mode dontAsk \
  --permission-prompts none \
  --output-format json \
  --model "${CLAUDE_MODEL:-sonnet}" \
  --max-turns "$turns" \
  > "work/claude-$step.json"
