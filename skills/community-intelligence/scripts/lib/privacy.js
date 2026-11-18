'use strict';

/**
 * Privacy layer: everything that leaves the parser passes through here before
 * it touches disk.
 *
 * - Display names are replaced by keyed pseudonyms (HMAC-SHA256 with a random
 *   per-installation salt). Names are never written to disk.
 * - Phone numbers, e-mails, documents (CPF/CNPJ), @mentions, profile/invite
 *   links and participant names quoted inside messages are redacted.
 * - Participants who opt out are dropped by pseudonym.
 * - Conversations with fewer than MIN_GROUP_PARTICIPANTS authors are refused,
 *   since they look like private chats rather than a group.
 */

const crypto = require('crypto');
const { normalize, escapeRegExp, STOPWORDS } = require('./text');
const { GTA_ANCHORS, BUILT_IN_TOPICS } = require('./taxonomy');

const MIN_GROUP_PARTICIPANTS = 3;

const PRIVATE_LINK_HOSTS = [
  'wa.me', 'chat.whatsapp.com', 'whatsapp.com', 't.me', 'telegram.me', 'instagram.com', 'facebook.com',
  'fb.com', 'linkedin.com', 'tiktok.com', 'vm.tiktok.com', 'discord.gg', 'discord.com', 'forms.gle',
  'docs.google.com', 'drive.google.com', 'maps.google.com', 'goo.gl', 'maps.app.goo.gl', 'bit.ly'
];

const PROTECTED_WORDS = new Set(
  [...GTA_ANCHORS, ...BUILT_IN_TOPICS.flatMap(topic => topic.keywords)]
    .flatMap(word => normalize(word).split(/\s+/))
);

function generateSalt() {
  return crypto.randomBytes(32).toString('hex');
}

function pseudonymize(author, salt) {
  if (!salt) throw new Error('Salt de pseudonimização ausente; rode "init" primeiro');
  const digest = crypto.createHmac('sha256', salt).update(normalize(author).trim()).digest('hex');
  return `p_${digest.slice(0, 12)}`;
}

function hostOf(url) {
  try {
    const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, '');
  } catch (_error) {
    return null;
  }
}

function redactUrl(url) {
  const host = hostOf(url);
  if (!host) return '[link]';
  const isPrivate = PRIVATE_LINK_HOSTS.some(blocked => host === blocked || host.endsWith(`.${blocked}`));
  return isPrivate ? '[link]' : `[link:${host}]`;
}

const ACCENT_CLASSES = {
  a: '[aáàâãä]', e: '[eéèêë]', i: '[iíìîï]', o: '[oóòôõö]', u: '[uúùûü]', c: '[cç]', n: '[nñ]'
};

function accentInsensitive(part) {
  return Array.from(part).map(char => ACCENT_CLASSES[char] || escapeRegExp(char)).join('');
}

function digitsOf(value) {
  return value.replace(/\D/g, '');
}

/**
 * Build a redactor bound to the participant names of one import, so that
 * people quoted by name inside messages are also removed.
 */
function buildRedactor(authorNames = []) {
  const nameParts = new Set();
  for (const name of authorNames) {
    for (const part of normalize(name).split(/[^a-z0-9]+/)) {
      if (part.length >= 3 && !STOPWORDS.has(part) && !PROTECTED_WORDS.has(part) && !/^\d+$/.test(part)) {
        nameParts.add(part);
      }
    }
  }
  const namePattern = nameParts.size > 0
    ? new RegExp(`(^|[^\\p{L}\\p{N}])(${Array.from(nameParts).map(accentInsensitive).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'giu')
    : null;

  return function redact(text) {
    let output = String(text);
    output = output.replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[email]');
    output = output.replace(/\b(?:https?:\/\/|www\.)[^\s<>"]+/gi, match => redactUrl(match));
    output = output.replace(/@[\p{L}\p{N}_.+-]+/gu, '[menção]');
    output = output.replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[documento]');
    output = output.replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, '[documento]');
    output = output.replace(/\+?\(?\d[\d\s().-]{7,}\d/g, match => {
      const digits = digitsOf(match);
      const looksLikePhone = digits.length >= 10 || (digits.length === 9 && digits.startsWith('9')) || match.trim().startsWith('+');
      if (!looksLikePhone || digits.length > 15) return match;
      return '[telefone]';
    });
    if (namePattern) {
      output = output.replace(namePattern, (_match, prefix) => `${prefix}[participante]`);
    }
    return output;
  };
}

function assertConsent(config) {
  if (!config || !config.consent || config.consent.confirmed !== true) {
    throw new Error(
      'Consentimento não registrado. Rode "init --consent-confirmed --consent-note \'...\'" '
      + 'somente depois que o administrador autorizou a análise e as regras do grupo permitem.'
    );
  }
}

function assertGroupConversation(distinctAuthors) {
  if (distinctAuthors < MIN_GROUP_PARTICIPANTS) {
    throw new Error(
      `Importação recusada: apenas ${distinctAuthors} participante(s). Conversas com menos de `
      + `${MIN_GROUP_PARTICIPANTS} autores parecem mensagens privadas e não são aceitas.`
    );
  }
}

module.exports = {
  MIN_GROUP_PARTICIPANTS,
  generateSalt,
  pseudonymize,
  buildRedactor,
  redactUrl,
  assertConsent,
  assertGroupConversation
};
