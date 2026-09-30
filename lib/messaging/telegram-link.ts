/**
 * Helpers for generating Telegram bot deep links.
 */

/** Link for existing staff to connect their Telegram account. */
export function getTelegramConnectLink(staffId: string): string | null {
  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? process.env.TELEGRAM_BOT_USERNAME;
  if (!bot) return null;
  return `https://t.me/${bot}?start=link_${staffId}`;
}

/** Link for new staff to self-register via an invite code. */
export function getTelegramJoinLink(inviteCode: string): string | null {
  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? process.env.TELEGRAM_BOT_USERNAME;
  if (!bot) return null;
  return `https://t.me/${bot}?start=join_${inviteCode}`;
}
