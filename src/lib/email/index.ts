import { Resend } from 'resend';
import { env } from '@/env';

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

/**
 * Sends a transactional email through Resend and reports whether it was
 * accepted. Without Resend configured, development and test print the message
 * instead; production reports a failure.
 */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  if (!resend || !env.EMAIL_FROM) {
    if (env.NODE_ENV === 'production') {
      console.error('[email] RESEND_API_KEY and EMAIL_FROM must be set to send email');
      return false;
    }
    console.info(`[email] Resend is not configured; would send to ${message.to}:\n${message.text}`);
    return true;
  }

  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });

  if (error) {
    console.error(`[email] Resend rejected a message: ${error.name}: ${error.message}`);
    return false;
  }

  return true;
}
