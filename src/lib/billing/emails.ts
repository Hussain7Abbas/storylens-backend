import type { BillingRequest, ContactChannel } from '@prisma/client';
import { env } from '@/env';
import type { EmailMessage } from '@/lib/email';
import { contactLink } from './contact';

/** Email bodies interpolate reader text (names, notes, reasons): always escape it. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

type Lang = 'en' | 'ar';
const pick = (lang: Lang, text: { en: string; ar: string }) => (lang === 'ar' ? text.ar : text.en);
const langOf = (locale: string): Lang => (locale === 'ar' ? 'ar' : 'en');

// The website serves the lens coin PNG (umbrella `docs/branding/lens-coin/`); emails cannot rely on SVG.
const COIN_URL = `${env.WEBSITE_URL}/brand/lens-coin-64.png`;

function layout(lang: Lang, paragraphs: string[]): string {
  return `<div dir="${lang === 'ar' ? 'rtl' : 'ltr'}" style="font-family:Inter,Arial,sans-serif;color:#1f1b2e;line-height:1.5">
  <p><img src="${escapeHtml(COIN_URL)}" width="32" height="32" alt="" style="display:block"></p>
${paragraphs.map((paragraph) => `  <p>${paragraph}</p>`).join('\n')}
</div>`;
}

const CHANNEL_NAMES: Record<ContactChannel, string> = { WHATSAPP: 'WhatsApp', TELEGRAM: 'Telegram' };

type RequestForEmail = Pick<
  BillingRequest,
  'id' | 'lenses' | 'totalUsd' | 'contactChannel' | 'contactHandle' | 'note' | 'userEmail' | 'createdAt' | 'locale' | 'rejectionReason'
>;

/** To the owner: a new request, with a link that opens the chat to arrange payment. */
export function newRequestEmail(
  to: string,
  request: RequestForEmail,
  reader: { name: string; username: string },
): EmailMessage {
  const channel = CHANNEL_NAMES[request.contactChannel];
  const link = contactLink(request.contactChannel, request.contactHandle);
  const dashboard = `${env.DASHBOARD_URL}/billing-requests?status=PENDING`;
  const lines = [
    `${reader.name} (@${reader.username}, ${request.userEmail}) asked for ${request.lenses} lenses ($${request.totalUsd.toFixed(2)}).`,
    `${channel}: ${request.contactHandle} (${link})`,
    ...(request.note ? [`Note: ${request.note}`] : []),
    `Review it on the dashboard: ${dashboard}`,
  ];
  return {
    to,
    subject: `Lens request: ${request.lenses} lenses ($${request.totalUsd.toFixed(2)}) from ${request.userEmail}`,
    text: lines.join('\n\n'),
    html: layout('en', [
      `<strong>${escapeHtml(reader.name)}</strong> (@${escapeHtml(reader.username)}, ${escapeHtml(request.userEmail)}) asked for <strong>${request.lenses} lenses</strong> ($${request.totalUsd.toFixed(2)}).`,
      `${channel}: <a href="${escapeHtml(link)}">${escapeHtml(request.contactHandle)}</a>`,
      ...(request.note ? [`Note: ${escapeHtml(request.note)}`] : []),
      `<a href="${escapeHtml(dashboard)}">Review it on the dashboard</a>`,
    ]),
  };
}

/** To the reader, in the language they asked in: the lenses were added. */
export function requestApprovedEmail(request: RequestForEmail, balance: number): EmailMessage {
  const lang = langOf(request.locale);
  const balanceUrl = `${env.WEBSITE_URL}/${lang}/profile/balance/`;
  const intro = pick(lang, {
    en: `Your request was approved: ${request.lenses} lenses were added to your Story Lens account.`,
    ar: `تمت الموافقة على طلبك: أُضيفت ${request.lenses} عدسة إلى حسابك في عدسة القصة.`,
  });
  const now = pick(lang, { en: `Your balance is now ${balance} lenses.`, ar: `رصيدك الآن ${balance} عدسة.` });
  const link = pick(lang, { en: 'See your balance', ar: 'اعرض رصيدك' });
  return {
    to: request.userEmail,
    subject: pick(lang, { en: `${request.lenses} lenses added to Story Lens`, ar: `أُضيفت ${request.lenses} عدسة إلى عدسة القصة` }),
    text: `${intro}\n\n${now}\n\n${link}: ${balanceUrl}`,
    html: layout(lang, [escapeHtml(intro), escapeHtml(now), `<a href="${escapeHtml(balanceUrl)}">${escapeHtml(link)}</a>`]),
  };
}

/** To the reader: the request was rejected, with the owner's reason. */
export function requestRejectedEmail(request: RequestForEmail): EmailMessage {
  const lang = langOf(request.locale);
  const balanceUrl = `${env.WEBSITE_URL}/${lang}/profile/balance/`;
  const intro = pick(lang, {
    en: `Your request for ${request.lenses} lenses was not approved.`,
    ar: `لم تتم الموافقة على طلبك لشراء ${request.lenses} عدسة.`,
  });
  const reason = `${pick(lang, { en: 'Reason', ar: 'السبب' })}: ${request.rejectionReason ?? ''}`;
  const again = pick(lang, {
    en: 'You can send a new request from your balance page.',
    ar: 'يمكنك إرسال طلب جديد من صفحة رصيدك.',
  });
  return {
    to: request.userEmail,
    subject: pick(lang, { en: 'Your Story Lens lens request', ar: 'طلبك لشراء العدسات في عدسة القصة' }),
    text: `${intro}\n\n${reason}\n\n${again}\n${balanceUrl}`,
    html: layout(lang, [escapeHtml(intro), escapeHtml(reason), `<a href="${escapeHtml(balanceUrl)}">${escapeHtml(again)}</a>`]),
  };
}
