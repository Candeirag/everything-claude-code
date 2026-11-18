// Remove segredos e dados pessoais antes de gravar logs/auditoria.

const SECRET_KEY = /token|secret|password|passwd|authorization|cookie|api[-_]?key|credential/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;

export const redactString = (text) => text.replace(BEARER, '$1 [REDACTED]').replace(EMAIL, '[EMAIL]');

export const redact = (value, depth = 0) => {
  if (depth > 8) return '[DEPTH]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, SECRET_KEY.test(key) ? '[REDACTED]' : redact(child, depth + 1)]),
    );
  }
  return value;
};
