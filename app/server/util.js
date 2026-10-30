'use strict';

const crypto = require('crypto');

const APP_NAME = 'anirss';
const APP_VERSION = '1.13.4';
// 站点已内置（蜜柑计划 / 蜜柑计划(境外)），不再支持自定义。smoke / demo 等
// 本地测试需要一个指向本机假 RSS 的站点，显式设置 ANIRSS_DEV_ALLOW_CUSTOM_BASES=1
// 时才保留配置文件里的非内置站点、放开 bases 增删改接口。名字里带 DEV 是为了
// 避免生产部署误开：打开它会同时关掉「站点只读」这条产品约束。
const ALLOW_CUSTOM_BASES = process.env.ANIRSS_DEV_ALLOW_CUSTOM_BASES === '1';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 anirss/' + APP_VERSION;

function uid(prefix) {
  return (prefix || '') + crypto.randomBytes(6).toString('hex');
}

function nowMs() {
  return Date.now();
}

function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code || 'ERROR';
  return err;
}

function badRequest(message, code) {
  return httpError(400, message, code || 'BAD_REQUEST');
}

function isHttpUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeBaseUrl(input) {
  let s = String(input == null ? '' : input).trim();
  if (!s) return '';
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) s = 'http://' + s;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw badRequest('地址格式不正确：' + s, 'BAD_URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw badRequest('仅支持 http / https 地址', 'BAD_URL');
  }
  u.hash = '';
  return u.href.replace(/\/+$/, '');
}

function validateFeedUrl(input) {
  const s = String(input == null ? '' : input).trim();
  if (!s) throw badRequest('请填写 RSS 地址', 'EMPTY_URL');
  if (!isHttpUrl(s)) throw badRequest('RSS 地址必须是 http / https 链接', 'BAD_URL');
  return s;
}

function composeUrl(base, subPath) {
  const b = String(base == null ? '' : base).trim().replace(/\/+$/, '');
  const p = String(subPath == null ? '' : subPath).trim();
  if (!p) return b;
  if (/^https?:\/\//i.test(p)) return p;
  if (!b) return p;
  return b + '/' + p.replace(/^\/+/, '');
}

function splitPatterns(text) {
  return String(text == null ? '' : text)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));
}

function compilePatterns(text, ignoreCase) {
  const patterns = splitPatterns(text);
  const flags = ignoreCase === false ? '' : 'i';
  const out = [];
  const errors = [];
  patterns.forEach((p, i) => {
    try {
      out.push(new RegExp(p, flags));
    } catch (e) {
      errors.push({ line: i + 1, pattern: p, message: e.message });
    }
  });
  if (errors.length) {
    const first = errors[0];
    const err = badRequest(
      `正则表达式无效（第 ${first.line} 行「${first.pattern}」）：${first.message}`,
      'BAD_REGEX'
    );
    err.details = errors;
    throw err;
  }
  return out;
}

function compileFilters(includeText, excludeText, ignoreCase) {
  return {
    include: compilePatterns(includeText, ignoreCase),
    exclude: compilePatterns(excludeText, ignoreCase),
  };
}

/**
 * 用编译好的过滤器判断标题。
 * 返回 { matched, reason }，reason: match | exclude | include | no-title
 */
function matchTitle(title, filters) {
  const t = String(title == null ? '' : title);
  if (!t.trim()) return { matched: false, reason: 'no-title' };
  for (const re of filters.exclude) {
    if (re.test(t)) return { matched: false, reason: 'exclude' };
  }
  if (filters.include.length && !filters.include.some((re) => re.test(t))) {
    return { matched: false, reason: 'include' };
  }
  return { matched: true, reason: 'match' };
}

function hashKey(parts) {
  return crypto.createHash('sha1').update(parts.map((x) => String(x == null ? '' : x)).join('\u0001')).digest('hex').slice(0, 20);
}

function truncate(str, max) {
  const s = String(str == null ? '' : str);
  const limit = max || 300;
  return s.length > limit ? s.slice(0, limit - 1) + '…' : s;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function parseBool(value, fallback) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

function looksLikeHtml(buf) {
  if (!buf || !buf.length) return false;
  const head = buf.slice(0, 800).toString('utf8').trim().toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html') ||
    head.startsWith('<?xml') || head.startsWith('<');
}

function isMagnet(value) {
  return /^magnet:\?/i.test(String(value || ''));
}

/**
 * 从文件名 / 种子名 / 磁力名里猜集数。
 * 返回 { episode, from, to, kind, label, source } 或 null。
 * kind：single（单集）、range（合集范围）、special（特别篇/OP/ED 等）
 *
 * 结果按标题缓存：state() 每次轮询都会对全部下载记录/补番重新识别，
 * 同一部番的标题会反复出现，缓存把重复的正则开销省掉。
 */
const GUESS_CACHE_MAX = 4096;
const guessCache = new Map();

function guessEpisode(title) {
  const raw0 = String(title == null ? '' : title);
  if (guessCache.has(raw0)) return guessCache.get(raw0);
  const result = guessEpisodeUncached(raw0);
  if (guessCache.size >= GUESS_CACHE_MAX) guessCache.clear();
  guessCache.set(raw0, result);
  return result;
}

function guessEpisodeUncached(title) {
  const raw = String(title == null ? '' : title)
    .replace(/&#x([0-9a-f]+);/gi, (m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (m, dec) => String.fromCodePoint(Number(dec)))
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return null;

  const isNoise = (n, ctx) => {
    if (!Number.isFinite(n) || n < 1 || n > 1999) return true;
    if (n >= 1900 && n <= 2100) return true; // 年份
    if (n === 480 || n === 540 || n === 576 || n === 720 || n === 1080 || n === 1440 || n === 2160) return true; // 分辨率
    if (/(?:bit|fps|khz|kbps|hz|声道|ch\b)/i.test(ctx)) return true;
    if (/(?:年|月)\s*番/.test(ctx)) return true;
    return false;
  };
  const single = (n, source) => ({ episode: n, from: n, to: n, kind: 'single', label: `第 ${n} 集`, source });
  const special = (label, source) => ({ episode: null, from: null, to: null, kind: 'special', label, source });

  // S01E02
  let m = /\bS\d{1,2}\s*[._-]?\s*E(?:P)?\s*0*(\d{1,3})\b/i.exec(raw);
  if (m && !isNoise(Number(m[1]), m[0])) return single(Number(m[1]), m[0]);

  // 第 12 集 / 12 话
  m = /第\s*0*(\d{1,3})\s*[集话話]/.exec(raw);
  if (m && !isNoise(Number(m[1]), m[0])) return single(Number(m[1]), m[0]);

  // EP12 / E12 / - 12 END（也允许直接跟扩展名，如 EP13.ass）
  m = /(?:^|[\s\-_\[\(【])(?:EP|E)\s*0*(\d{1,3})(?:v\d)?(?=[\s\-_\]\)】]|\.|$)/i.exec(raw);
  if (m && !isNoise(Number(m[1]), m[0])) return single(Number(m[1]), m[0]);

  // 合集范围：01-12 / 01~12
  m = /(?:^|[\s\-_\[\(【])(\d{1,3})\s*[-~～]\s*(\d{1,3})(?:v\d)?(?!\d)/.exec(raw);
  if (m) {
    const from = Number(m[1]);
    const to = Number(m[2]);
    if (!isNoise(from, m[0]) && !isNoise(to, m[0]) && to > from) {
      return { episode: null, from, to, kind: 'range', label: `第 ${from}–${to} 集`, source: m[0].trim() };
    }
  }

  // [12] / [12v2] / (12) / 【12】
  const bracket = /[\[\(【]\s*0*(\d{1,3})(?:v\d)?\s*[\]\)】]/g;
  while ((m = bracket.exec(raw))) {
    const n = Number(m[1]);
    if (!isNoise(n, m[0])) return single(n, m[0]);
  }

  //  - 12 / _12 / 12 END
  const tail = /(?:^|[\s\-_])(\d{1,3})(?:v\d)?(?=[\s\-_\[]|$)/g;
  while ((m = tail.exec(raw))) {
    const n = Number(m[1]);
    const ctx = raw.slice(Math.max(0, m.index - 12), m.index + m[0].length + 12);
    if (!isNoise(n, ctx)) return single(n, m[0].trim());
  }

  // 数字直接跟扩展名：Show - 13.ass / Show 13.mkv / Show - 13v2.ass
  m = /(?:^|[\s\-_])(\d{1,3})(?:v\d)?\.(?:ass|srt|ssa|vtt|sup|mkv|mp4|m2ts|ts|avi|wmv|flv|mov|rmvb|webm|iso|m4v)$/i.exec(raw);
  if (m) {
    const n = Number(m[1]);
    const ctx = raw.slice(Math.max(0, m.index - 12), m.index + m[0].length);
    if (!isNoise(n, ctx)) return single(n, m[0].trim());
  }

  if (/\b(?:NCOP|NCED|NCOP2|OP\d?|ED\d?|OVA|OAD|SP\d?|PV|CM|特别篇|番外|预告)\b/i.test(raw)) {
    const tag = (raw.match(/\b(?:NCOP|NCED|OVA|OAD|SP\d?|PV|CM)\b/i) || [])[0] || '特别篇';
    return special(tag.toUpperCase(), tag);
  }

  return null;
}

function episodeLabel(guess) {
  return guess && guess.label ? guess.label : '';
}

/** 把集数数组压成区间文本，例如 [1..12,15] -> "1-12, 15" */
function episodeRanges(nums) {
  const list = (Array.isArray(nums) ? nums : [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (!list.length) return '';
  const parts = [];
  let start = list[0];
  let prev = list[0];
  for (let i = 1; i <= list.length; i++) {
    const n = list[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? String(start) : `${start}-${prev}`);
    start = n;
    prev = n;
  }
  return parts.join(', ');
}

function filenameFromUrl(url, fallback) {
  try {
    const u = new URL(url);
    const base = decodeURIComponent((u.pathname.split('/').pop() || '').trim());
    if (base && base !== '/') return base.replace(/[\\/:*?"<>|]+/g, '_');
  } catch {
    /* ignore */
  }
  return fallback || 'download.torrent';
}

function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function deepMerge(base, extra) {
  if (Array.isArray(base) || Array.isArray(extra)) return extra === undefined ? base : extra;
  if (base && typeof base === 'object' && extra && typeof extra === 'object') {
    const out = { ...base };
    for (const key of Object.keys(extra)) {
      out[key] = deepMerge(base[key], extra[key]);
    }
    return out;
  }
  return extra === undefined ? base : extra;
}

function formatBytes(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num < 0) return '-';
  if (num < 1024) return num + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = num / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' ' + units[i];
}

/**
 * 按字节预算的 LRU 缓存（存封面/图片这类 Buffer 对象）。
 * 单条超预算也至少保留 1 条，避免超大图造成的取用抖动。
 */
class ByteLruCache {
  constructor(maxBytes, maxCount) {
    this.maxBytes = maxBytes;
    this.maxCount = maxCount;
    this.map = new Map();
    this.bytes = 0;
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    // 命中即移到队尾（Map 迭代顺序 = 插入顺序）
    if (this.map.size > 1) {
      this.map.delete(key);
      this.map.set(key, entry);
    }
    return entry.value;
  }

  set(key, value, byteLength) {
    const existing = this.map.get(key);
    if (existing) {
      this.bytes -= existing.bytes;
      this.map.delete(key);
    }
    const bytes = Number(byteLength) || 0;
    this.map.set(key, { value, bytes });
    this.bytes += bytes;
    while (this.map.size > 1 && (this.bytes > this.maxBytes || this.map.size > this.maxCount)) {
      const oldest = this.map.keys().next().value;
      const removed = this.map.get(oldest);
      this.bytes -= removed.bytes;
      this.map.delete(oldest);
    }
  }

  delete(key) {
    const entry = this.map.get(key);
    if (entry) {
      this.bytes -= entry.bytes;
      this.map.delete(key);
    }
  }

  keys() {
    return this.map.keys();
  }

  clear() {
    this.map.clear();
    this.bytes = 0;
  }
}

module.exports = {
  APP_NAME,
  APP_VERSION,
  UA,
  ALLOW_CUSTOM_BASES,
  uid,
  nowMs,
  httpError,
  badRequest,
  isHttpUrl,
  normalizeBaseUrl,
  validateFeedUrl,
  composeUrl,
  splitPatterns,
  compilePatterns,
  compileFilters,
  matchTitle,
  hashKey,
  truncate,
  clampNumber,
  parseBool,
  looksLikeHtml,
  isMagnet,
  filenameFromUrl,
  guessEpisode,
  episodeLabel,
  episodeRanges,
  todayStart,
  deepMerge,
  formatBytes,
  ByteLruCache,
};
