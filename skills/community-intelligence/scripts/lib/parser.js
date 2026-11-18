'use strict';

/**
 * Parsers for authorized message sources.
 *
 * 1. WhatsApp "Export chat" transcripts (.txt, or the .zip produced on iOS),
 *    exported by a group admin. Android and iOS layouts, pt-BR and en locales,
 *    12h and 24h clocks, multi-line messages.
 * 2. Normalized JSON / JSONL ({ timestamp, author, text }) produced by any
 *    other authorized pipeline. This is a neutral format, not a WhatsApp API.
 */

const fs = require('fs');
const path = require('path');
const { extractChatTranscript } = require('./zip');
const { normalize } = require('./text');

const DATE = '(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{2,4})';
const TIME = '(\\d{1,2}):(\\d{2})(?::(\\d{2}))?(?:\\s*([AaPp])\\.?\\s?[Mm]\\.?)?';
const ANDROID_HEADER = new RegExp(`^${DATE},?\\s+(?:as\\s+|às\\s+)?${TIME}\\s+[-–]\\s+(.*)$`);
const IOS_HEADER = new RegExp(`^\\[${DATE},?\\s+${TIME}\\]\\s+(.*)$`);

const MEDIA_PATTERNS = [
  /^<?\s*(media omitted|midia oculta|arquivo de midia oculto|midia omitida)\s*>?$/,
  /^(image|video|audio|sticker|gif|document|contact card|imagem|audio|figurinha|documento|cartao de contato)\s+(omitted|ocultad[oa]|omitid[oa])$/,
  /^<\s*(attached|anexado)\s*:/,
  /\((file attached|arquivo anexado)\)\s*$/,
  /^[\w\- .()]+\.(vcf|opus|jpg|jpeg|png|webp|mp4|pdf|docx?)$/,
  /^(location|localizacao|localizacao em tempo real|live location)\s*:/,
  /^(live location shared|localizacao em tempo real compartilhada)/
];

const DELETED_PATTERNS = [
  /^(this message was deleted|you deleted this message)$/,
  /^(essa|esta) mensagem foi apagada$/,
  /^voce apagou esta mensagem$/,
  /^mensagem apagada$/,
  /^null$/
];

const SYSTEM_PATTERNS = [
  /criptografia de ponta a ponta/,
  /end-to-end encrypted/
];

const EDITED_SUFFIX = /\s*<\s*(this message was edited|mensagem editada|esta mensagem foi editada|editada)\s*>\s*$/i;

function cleanLine(line) {
  return line.replace(/[\u200e\u200f\ufeff\u202a-\u202e]/g, '').replace(/[\u202f\u00a0]/g, ' ').trimEnd();
}

function matchHeader(line) {
  const ios = IOS_HEADER.exec(line);
  if (ios) return ios;
  return ANDROID_HEADER.exec(line);
}

function detectDateOrder(headers, fallback) {
  let firstOver12 = false;
  let secondOver12 = false;
  for (const header of headers) {
    if (Number(header[1]) > 12) firstOver12 = true;
    if (Number(header[2]) > 12) secondOver12 = true;
  }
  if (firstOver12 && !secondOver12) return 'dmy';
  if (secondOver12 && !firstOver12) return 'mdy';
  return fallback === 'mdy' ? 'mdy' : 'dmy';
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function toTimestamp(header, order) {
  const a = Number(header[1]);
  const b = Number(header[2]);
  let year = Number(header[3]);
  if (year < 100) year += 2000;
  const day = order === 'mdy' ? b : a;
  const month = order === 'mdy' ? a : b;
  let hour = Number(header[4]);
  const minute = Number(header[5]);
  const second = header[6] ? Number(header[6]) : 0;
  const meridiem = header[7] ? header[7].toLowerCase() : null;
  if (meridiem === 'p' && hour < 12) hour += 12;
  if (meridiem === 'a' && hour === 12) hour = 0;

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

function classifyBody(body) {
  const normalized = normalize(body).trim();
  if (!normalized) return 'empty';
  if (DELETED_PATTERNS.some(pattern => pattern.test(normalized))) return 'deleted';
  if (MEDIA_PATTERNS.some(pattern => pattern.test(normalized))) return 'media';
  return 'message';
}

/**
 * Parse a WhatsApp export transcript.
 * @returns {{ messages: Array, stats: object, dateOrder: string }}
 */
function parseWhatsAppExport(text, options = {}) {
  const rawLines = String(text).split(/\r?\n/);
  const lines = rawLines.map(cleanLine);
  const headerMatches = [];
  for (const line of lines) {
    const header = matchHeader(line);
    if (header) headerMatches.push(header);
  }
  if (headerMatches.length === 0) {
    throw new Error('Formato não reconhecido: nenhuma linha no padrão de exportação do WhatsApp');
  }
  const dateOrder = detectDateOrder(headerMatches, options.dateOrder);

  const raw = [];
  let current = null;
  lines.forEach((line, index) => {
    const header = matchHeader(line);
    if (header) {
      if (current) raw.push(current);
      const rest = header[8];
      const timestamp = toTimestamp(header, dateOrder);
      const separator = rest.indexOf(': ');
      if (separator > 0) {
        // iOS marks system notices (group created, member added...) with a
        // left-to-right mark at the start of the body.
        const lrmBody = /:\s\u200e/.test(rawLines[index]);
        current = { timestamp, author: rest.slice(0, separator).trim(), body: rest.slice(separator + 2), lrmBody };
      } else {
        current = { timestamp, author: null, body: rest };
      }
    } else if (current) {
      current.body += `\n${line}`;
    }
  });
  if (current) raw.push(current);

  const stats = { lines: lines.length, parsed: raw.length, messages: 0, system: 0, media: 0, deleted: 0, invalidDate: 0 };
  const messages = [];
  for (const entry of raw) {
    if (!entry.timestamp) {
      stats.invalidDate++;
      continue;
    }
    if (!entry.author) {
      stats.system++;
      continue;
    }
    const body = entry.body.replace(EDITED_SUFFIX, '').trim();
    const kind = classifyBody(body);
    if (kind === 'media') {
      stats.media++;
      continue;
    }
    if (kind === 'deleted' || kind === 'empty') {
      stats.deleted++;
      continue;
    }
    if (entry.lrmBody || SYSTEM_PATTERNS.some(pattern => pattern.test(normalize(body)))) {
      stats.system++;
      continue;
    }
    stats.messages++;
    messages.push({ timestamp: entry.timestamp, author: entry.author, text: body });
  }
  return { messages, stats, dateOrder };
}

function normalizeTimestamp(value) {
  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toISOString().slice(0, 19);
  }
  const str = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/.test(str)) {
    const base = str.replace(' ', 'T').slice(0, 19);
    return base.length === 16 ? `${base}:00` : base;
  }
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 19);
}

/**
 * Parse normalized JSON (array) or JSONL with { timestamp, author, text }.
 */
function parseNormalizedJson(text) {
  const trimmed = String(text).trim();
  let records;
  if (trimmed.startsWith('[')) {
    records = JSON.parse(trimmed);
  } else {
    records = trimmed.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`JSONL inválido na linha ${index + 1}: ${error.message}`);
      }
    });
  }
  const stats = { lines: records.length, parsed: records.length, messages: 0, system: 0, media: 0, deleted: 0, invalidDate: 0 };
  const messages = [];
  for (const record of records) {
    const timestamp = normalizeTimestamp(record.timestamp);
    if (!timestamp) {
      stats.invalidDate++;
      continue;
    }
    if (!record.author || typeof record.text !== 'string' || !record.text.trim()) {
      stats.system++;
      continue;
    }
    if (record.type && record.type !== 'text') {
      stats.media++;
      continue;
    }
    stats.messages++;
    messages.push({ timestamp, author: String(record.author), text: record.text.trim() });
  }
  return { messages, stats, dateOrder: 'iso' };
}

function detectFormat(filePath, buffer) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.zip' || (buffer.length > 4 && buffer.readUInt32LE(0) === 0x04034b50)) return 'whatsapp-zip';
  if (ext === '.jsonl' || ext === '.json') return 'jsonl';
  return 'whatsapp';
}

/**
 * Read and parse a source file. Returns parsed messages plus the raw bytes'
 * format for the import manifest.
 */
function parseSourceFile(filePath, options = {}) {
  const buffer = fs.readFileSync(filePath);
  const format = options.format && options.format !== 'auto' ? options.format : detectFormat(filePath, buffer);

  if (format === 'whatsapp-zip') {
    const { text, ignoredEntries } = extractChatTranscript(buffer);
    const result = parseWhatsAppExport(text, options);
    return { ...result, format, ignoredArchiveEntries: ignoredEntries, buffer };
  }
  if (format === 'jsonl' || format === 'json') {
    return { ...parseNormalizedJson(buffer.toString('utf8')), format: 'jsonl', buffer };
  }
  if (format === 'whatsapp') {
    return { ...parseWhatsAppExport(buffer.toString('utf8'), options), format, buffer };
  }
  throw new Error(`Formato desconhecido: ${format} (use auto, whatsapp, whatsapp-zip ou jsonl)`);
}

module.exports = {
  parseWhatsAppExport,
  parseNormalizedJson,
  parseSourceFile,
  detectDateOrder,
  normalizeTimestamp
};
