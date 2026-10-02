import type { ContactChannel } from '@prisma/client';

/**
 * The WhatsApp or Telegram contact a reader gives with a lens request, so the
 * owner can arrange payment. The website and dashboard mirror these rules.
 */

const PHONE_SEPARATORS = /[\s\-().]/g;
const PHONE = /^\+\d{8,15}$/;
const TELEGRAM_USERNAME = /^@[a-zA-Z0-9_]{5,32}$/;

/** `+964 770-123 4567` → `+9647701234567`; null when not an international number. */
export function normalizePhone(value: string): string | null {
  const compact = value.trim().replace(PHONE_SEPARATORS, '');
  const withPlus = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
  return PHONE.test(withPlus) ? withPlus : null;
}

/** The stored form of a contact handle, or null when it is not valid for the channel. */
export function normalizeContact(channel: ContactChannel, handle: string): string | null {
  const value = handle.trim();
  if (channel === 'WHATSAPP') return normalizePhone(value);
  const username = value.startsWith('@') ? value : value.match(/^[a-zA-Z]/) ? `@${value}` : null;
  if (username && TELEGRAM_USERNAME.test(username)) return username.toLowerCase();
  return normalizePhone(value);
}

/** A link that opens a chat with the reader. */
export function contactLink(channel: ContactChannel, handle: string): string {
  if (channel === 'WHATSAPP') return `https://wa.me/${handle.replace(/^\+/, '')}`;
  return handle.startsWith('@') ? `https://t.me/${handle.slice(1)}` : `https://t.me/${handle}`;
}
