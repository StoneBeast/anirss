'use strict';

const { fetchBuffer } = require('./http');
const { httpError, hashKey, truncate, looksLikeHtml } = require('./util');

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™',
  middot: '·', bull: '•', deg: '°', times: '×', divide: '÷',
  laquo: '«', raquo: '»', eacute: 'é', agrave: 'à',
};

function decodeEntities(input) {
  return String(input == null ? '' : input).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named == null ? whole : named;
  });
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripCdata(input) {
  return String(input == null ? '' : input).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function stripTags(input) {
  return String(input == null ? '' : input)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
}

function cleanText(input, max) {
  let s = stripCdata(input);
  s = stripTags(s);
  s = decodeEntities(s);
  s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  return max ? truncate(s, max) : s;
}

// 标签名集合固定（title/guid/pubDate/enclosure…），编译结果缓存复用，
// 避免每个条目每次拉取都重新 new RegExp（一份 feed 会有上千次编译）。
const tagReCache = new Map();

function cachedTagRe(kind, name) {
  const key = kind + '|' + name;
  let re = tagReCache.get(key);
  if (!re) {
    const escaped = escapeRegExp(name);
    re = kind === 'block'
      ? new RegExp('<' + escaped + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + escaped + '\\s*>', 'i')
      : new RegExp('<' + escaped + '\\b[^>]*>', 'gi');
    tagReCache.set(key, re);
  }
  re.lastIndex = 0;
  return re;
}

function textOf(block, names) {
  for (const name of names) {
    const m = cachedTagRe('block', name).exec(block);
    if (m) {
      const value = cleanText(m[1]);
      if (value) return value;
    }
  }
  return '';
}

function attrsOf(tag) {
  const attrs = {};
  const re = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let m;
  while ((m = re.exec(tag))) {
    const name = m[1].toLowerCase();
    const value = m[3] != null ? m[3] : m[4] != null ? m[4] : m[5];
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

function findTagAttrs(block, tagName) {
  const re = cachedTagRe('attrs', tagName);
  const out = [];
  let m;
  while ((m = re.exec(block))) out.push(attrsOf(m[0]));
  return out;
}

function absolutize(value, baseUrl) {
  const v = String(value || '').trim();
  if (!v) return '';
  try {
    return new URL(v, baseUrl).href;
  } catch {
    return v;
  }
}

function parseDateValue(raw) {
  const s = String(raw || '').trim();
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function pickTorrentUrl(block, links, enclosures) {
  const candidates = [];

  for (const e of enclosures) {
    if (!e.url) continue;
    const type = String(e.type || '').toLowerCase();
    let score = 1;
    if (/^magnet:/i.test(e.url)) score = 6;
    else if (/\.torrent(?:[?#]|$)/i.test(e.url)) score = 5;
    else if (type.includes('bittorrent') || type.includes('torrent')) score = 4;
    candidates.push({ url: e.url, score, kind: 'enclosure' });
  }

  for (const l of links) {
    if (!l.href) continue;
    const rel = String(l.rel || '').toLowerCase();
    const type = String(l.type || '').toLowerCase();
    let score = 0;
    if (rel.includes('enclosure')) score = 3;
    if (/^magnet:/i.test(l.href)) score = 6;
    else if (/\.torrent(?:[?#]|$)/i.test(l.href)) score = 5;
    else if (type.includes('bittorrent') || type.includes('torrent')) score = 4;
    if (score > 0) candidates.push({ url: l.href, score, kind: 'link' });
  }

  const media = findTagAttrs(block, 'media:content');
  for (const m of media) {
    if (!m.url) continue;
    let score = 1;
    if (/\.torrent(?:[?#]|$)/i.test(m.url)) score = 5;
    else if (String(m.type || '').toLowerCase().includes('bittorrent')) score = 4;
    candidates.push({ url: m.url, score, kind: 'media' });
  }

  // 正文里常见的 magnet
  const magnetMatch = /magnet:\?[^"'\s<>]+/i.exec(block);
  if (magnetMatch) candidates.push({ url: decodeEntities(magnetMatch[0]), score: 6, kind: 'inline' });

  if (!candidates.length) return '';
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].url;
}

function parseFeed(xmlInput, feedUrl) {
  let xml = String(xmlInput == null ? '' : xmlInput).replace(/^\ufeff/, '');
  xml = xml.replace(/<!--[\s\S]*?-->/g, '');
  xml = xml.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

  const head = xml.split(/<item\b|<entry\b/i)[0] || xml;
  let feedTitle = textOf(head, ['title']);
  if (!feedTitle) {
    try {
      feedTitle = new URL(feedUrl).hostname;
    } catch {
      feedTitle = 'RSS 追番';
    }
  }

  const items = [];
  const itemRe = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  let match;
  while ((match = itemRe.exec(xml))) {
    const block = match[2];
    const title = textOf(block, ['title']) || '(无标题条目)';

    const linkTags = findTagAttrs(block, 'link');
    let link = textOf(block, ['link']);
    if (!link) {
      const alternate = linkTags.find((l) => l.href && (!l.rel || String(l.rel).toLowerCase() === 'alternate'));
      const firstHref = linkTags.find((l) => l.href);
      link = (alternate || firstHref || {}).href || '';
    }
    link = absolutize(link, feedUrl);

    const enclosureTags = findTagAttrs(block, 'enclosure');
    const enclosures = enclosureTags
      .filter((e) => e.url)
      .map((e) => ({ url: absolutize(e.url, feedUrl), type: e.type || '', length: Number(e.length) || 0 }));

    const links = linkTags.map((l) => ({ ...l, href: l.href ? absolutize(l.href, feedUrl) : '' }));
    // Atom 常把种子放在 <link rel="enclosure"> 里，长度也要计入
    for (const l of links) {
      if (l.href && String(l.rel || '').toLowerCase().includes('enclosure')) {
        enclosures.push({ url: l.href, type: l.type || '', length: Number(l.length) || 0 });
      }
    }
    const torrentUrl = pickTorrentUrl(block, links, enclosures);

    const guid = textOf(block, ['guid', 'id', 'dc:identifier']);
    const rawDate = textOf(block, ['pubDate', 'published', 'updated', 'dc:date', 'date']);
    const pubDate = parseDateValue(rawDate);
    const description = cleanText(textOf(block, ['description', 'summary', 'content:encoded', 'content']), 600);

    const enclosureSize = enclosures.reduce((acc, e) => (e.length > acc ? e.length : acc), 0);
    const key = (guid || link || torrentUrl || hashKey([title, rawDate])).toString().slice(0, 240);

    items.push({
      key,
      title,
      link,
      torrentUrl,
      pubDate,
      pubDateText: rawDate || '',
      size: enclosureSize,
      description,
    });
  }

  // 某些很老的 RSS 1.0 使用 <item rdf:about>，上面已覆盖；这里兜底判断是否真的是 feed
  if (!items.length) {
    const sample = xml.slice(0, 5000);
    if (looksLikeHtml(Buffer.from(sample)) && !/<(rss|feed|rdf:RDF|channel)\b/i.test(sample)) {
      throw httpError(502, '该地址返回的是网页而不是 RSS/Atom，请检查追番地址', 'NOT_A_FEED');
    }
  }

  return {
    title: feedTitle,
    url: feedUrl,
    fetchedAt: Date.now(),
    items,
  };
}

function decodeBuffer(buf, contentType) {
  let label = '';
  const fromHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(String(contentType || ''));
  if (fromHeader) label = fromHeader[1];
  if (!label) {
    const head = buf.slice(0, 300).toString('latin1');
    const fromXml = /encoding\s*=\s*["']([\w-]+)["']/i.exec(head);
    if (fromXml) label = fromXml[1];
  }
  label = String(label || 'utf-8').toLowerCase();
  if (label === 'gb2312' || label === 'gb_2312' || label === 'gbk') label = 'gbk';
  try {
    return new TextDecoder(label, { fatal: false }).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

async function fetchFeed(feedUrl, opts) {
  const options = opts || {};
  let res;
  try {
    res = await fetchBuffer(feedUrl, {
      timeout: options.timeout || 20000,
      deadline: options.deadline || 0,
      maxBytes: options.maxBytes || 8 * 1024 * 1024,
      headers: {
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
      rejectUnauthorized: options.rejectUnauthorized !== false,
      proxy: options.proxy,
    });
  } catch (e) {
    throw e;
  }

  const text = decodeBuffer(res.buffer, res.contentType);
  const sample = text.slice(0, 6000);
  if (!/<(rss|feed|rdf:RDF|channel|item|entry)\b/i.test(sample)) {
    if (looksLikeHtml(res.buffer)) {
      throw httpError(502, '该地址返回的是网页而不是 RSS/Atom，请检查追番地址', 'NOT_A_FEED');
    }
    throw httpError(502, '返回内容不是有效的 RSS/Atom（未找到 item/entry）', 'NOT_A_FEED');
  }

  const feed = parseFeed(text, res.url || feedUrl);
  feed.finalUrl = res.url || feedUrl;
  return feed;
}

module.exports = {
  decodeEntities,
  parseFeed,
  fetchFeed,
  decodeBuffer,
  textOf,
};
