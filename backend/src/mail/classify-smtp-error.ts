/**
 * - transient: safe to retry; the server certainly did not accept the message.
 * - permanent: retrying cannot help (e.g. 550 mailbox unavailable).
 * - uncertain: the session dropped mid-flight, so the message may already be accepted.
 *   Nodemailer labels every mid-session timeout or drop with command "CONN", so the
 *   command alone cannot tell "before DATA" from "after DATA".
 */
export type SmtpFailureKind = 'transient' | 'permanent' | 'uncertain';

interface SmtpErrorLike {
  code?: string;
  responseCode?: number;
  message?: string;
}

/** Failures that happen before an SMTP session exists or before any message transfer. */
const PRE_TRANSFER_CODES = new Set(['EDNS', 'ETLS', 'EAUTH', 'ENOAUTH', 'EREQUIREDAUTH']);
const PERMANENT_CODES = new Set(['EENVELOPE', 'EMESSAGE']);
const SESSION_DROP_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET']);
const NEVER_CONNECTED =
  /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|Connection timeout|Greeting never received/i;

export function classifySmtpError(err: unknown): SmtpFailureKind {
  const error = (err ?? {}) as SmtpErrorLike;

  if (typeof error.responseCode === 'number') {
    if (error.responseCode >= 500) return 'permanent';
    if (error.responseCode >= 400) return 'transient';
  }
  if (error.code && PERMANENT_CODES.has(error.code)) return 'permanent';
  if (error.code && PRE_TRANSFER_CODES.has(error.code)) return 'transient';
  if (error.code && SESSION_DROP_CODES.has(error.code)) {
    return NEVER_CONNECTED.test(error.message ?? '') ? 'transient' : 'uncertain';
  }
  return 'transient';
}
