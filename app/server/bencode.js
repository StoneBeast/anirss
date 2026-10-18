'use strict';

const crypto = require('crypto');

/**
 * 从 .torrent 的 bencode 数据中取出 info 字典的原始字节并算 SHA1。
 * 返回 { hash, infoStart, infoEnd }，无法解析时返回 null。
 */
function parseTorrentInfo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 2 || buffer[0] !== 0x64) return null;
  let i = 0;
  let info = null;

  const bad = () => {
    throw new Error('invalid bencode');
  };

  function parseString() {
    const colon = buffer.indexOf(0x3a, i);
    if (colon < 0) bad();
    const lenText = buffer.slice(i, colon).toString('ascii');
    if (!/^\d+$/.test(lenText)) bad();
    const len = Number(lenText);
    const start = colon + 1;
    const end = start + len;
    if (!Number.isSafeInteger(len) || end > buffer.length) bad();
    i = end;
    return { start, end, text: buffer.slice(start, end).toString('utf8') };
  }

  function parseValue() {
    const start = i;
    const c = buffer[i];
    if (c === 0x69) { // integer i...e
      const end = buffer.indexOf(0x65, i);
      if (end < 0) bad();
      i = end + 1;
      return { start, end: i };
    }
    if (c === 0x6c) { // list l...e
      i += 1;
      while (buffer[i] !== 0x65) {
        if (i >= buffer.length) bad();
        parseValue();
      }
      i += 1;
      return { start, end: i };
    }
    if (c === 0x64) { // dict d...e
      i += 1;
      while (buffer[i] !== 0x65) {
        if (i >= buffer.length) bad();
        const key = parseString();
        const value = parseValue();
        if (key.text === 'info' && !info) info = value;
      }
      i += 1;
      return { start, end: i };
    }
    if (c >= 0x30 && c <= 0x39) return parseString();
    return bad();
  }

  try {
    if (buffer[0] !== 0x64) return null;
    parseValue();
    if (!info || info.end <= info.start) return null;
    const raw = buffer.slice(info.start, info.end);
    return {
      hash: crypto.createHash('sha1').update(raw).digest('hex'),
      infoStart: info.start,
      infoEnd: info.end,
    };
  } catch {
    return null;
  }
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32ToHex(input) {
  const s = String(input || '').toUpperCase();
  let bits = '';
  for (const ch of s) {
    const v = BASE32.indexOf(ch);
    if (v < 0) return '';
    bits += v.toString(2).padStart(5, '0');
  }
  let hex = '';
  for (let i = 0; i + 4 <= bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex.length >= 40 ? hex.slice(0, 40) : '';
}

/** 从 magnet:?xt=urn:btih:... 提取 40 位十六进制 infohash */
function magnetInfoHash(uri) {
  const text = String(uri || '');
  const m = /[?&]xt=urn:btih:([a-zA-Z0-9]+)/i.exec(text);
  if (!m) return '';
  const value = m[1].toLowerCase();
  if (/^[a-f0-9]{40}$/.test(value)) return value;
  if (/^[a-z2-7]{32}$/.test(value)) return base32ToHex(value);
  return '';
}

module.exports = { parseTorrentInfo, magnetInfoHash, base32ToHex };
