#!/usr/bin/env bash
set -euo pipefail

# Telegram Bot + Webhook Setup
# Run: bash scripts/setup-telegram.sh

echo "=== Telegram Bot Setup ==="
echo ""

# 1. Collect inputs
read -rp "TELEGRAM_BOT_TOKEN (from @BotFather): " BOT_TOKEN
if [[ -z "$BOT_TOKEN" ]]; then
  echo "Error: Bot token is required." >&2
  exit 1
fi

read -rp "Webhook URL (e.g. https://your-app.com/api/webhooks/telegram): " WEBHOOK_URL
if [[ -z "$WEBHOOK_URL" ]]; then
  echo "Error: Webhook URL is required." >&2
  exit 1
fi

WEBHOOK_SECRET=$(openssl rand -hex 32)
echo "Generated TELEGRAM_WEBHOOK_SECRET: $WEBHOOK_SECRET"

# 2. Verify bot token with getMe
echo ""
echo "Verifying bot token..."
ME_RESPONSE=$(curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getMe")
if echo "$ME_RESPONSE" | grep -q '"ok":true'; then
  BOT_NAME=$(echo "$ME_RESPONSE" | grep -o '"username":"[^"]*"' | cut -d'"' -f4)
  echo "Bot verified: @${BOT_NAME}"
  BOT_USERNAME="$BOT_NAME"
else
  echo "Error: Invalid bot token. Response:" >&2
  echo "$ME_RESPONSE" >&2
  exit 1
fi

# 3. Register webhook
echo ""
echo "Registering webhook..."
WH_RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"${WEBHOOK_URL}\",\"secret_token\":\"${WEBHOOK_SECRET}\"}")

if echo "$WH_RESPONSE" | grep -q '"ok":true'; then
  echo "Webhook registered successfully."
else
  echo "Error setting webhook:" >&2
  echo "$WH_RESPONSE" >&2
  exit 1
fi

# 4. Print env vars
echo ""
echo "=== Add these to your .env ==="
echo ""
echo "TELEGRAM_BOT_TOKEN=${BOT_TOKEN}"
echo "TELEGRAM_WEBHOOK_SECRET=${WEBHOOK_SECRET}"
echo "TELEGRAM_BOT_USERNAME=${BOT_USERNAME}"
echo ""
echo "Done."
