'use strict';

/**
 * Minimal ZIP reader (no dependencies) used to open WhatsApp "Export chat"
 * archives (iOS ships `_chat.txt` inside a .zip).
 *
 * Only the chat transcript is read. Media entries are never extracted, which
 * keeps photos, audio, contacts and documents out of the pipeline entirely.
 */

const zlib = require('zlib');

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_TRANSCRIPT_BYTES = 200 * 1024 * 1024;

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset--) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error('Arquivo ZIP inválido: diretório central não encontrado');
}

function listEntries(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = [];

  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error('Arquivo ZIP inválido: entrada do diretório central corrompida');
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + nameLength).toString('utf8');
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntry(buffer, entry) {
  if (entry.uncompressedSize > MAX_TRANSCRIPT_BYTES) {
    throw new Error(`Transcrição muito grande (${entry.uncompressedSize} bytes)`);
  }
  const local = entry.localHeaderOffset;
  if (buffer.readUInt32LE(local) !== LOCAL_SIGNATURE) {
    throw new Error('Arquivo ZIP inválido: cabeçalho local corrompido');
  }
  const nameLength = buffer.readUInt16LE(local + 26);
  const extraLength = buffer.readUInt16LE(local + 28);
  const start = local + 30 + nameLength + extraLength;
  const data = buffer.slice(start, start + entry.compressedSize);

  if (entry.method === 0) return data;
  if (entry.method === 8) {
    return zlib.inflateRawSync(data, { maxOutputLength: MAX_TRANSCRIPT_BYTES });
  }
  throw new Error(`Método de compressão ZIP não suportado: ${entry.method}`);
}

/**
 * Return the chat transcript text from a WhatsApp export archive.
 */
function extractChatTranscript(buffer) {
  const entries = listEntries(buffer).filter(entry => !entry.name.endsWith('/'));
  const textEntries = entries.filter(entry => /\.txt$/i.test(entry.name) && !entry.name.startsWith('__MACOSX/'));
  if (textEntries.length === 0) {
    throw new Error('Nenhuma transcrição .txt encontrada no ZIP exportado');
  }
  const preferred = textEntries.find(entry => /(^|\/)_chat\.txt$/i.test(entry.name))
    || textEntries.find(entry => /whatsapp/i.test(entry.name))
    || textEntries[0];
  return {
    text: readEntry(buffer, preferred).toString('utf8'),
    ignoredEntries: entries.length - 1
  };
}

module.exports = { listEntries, extractChatTranscript };
