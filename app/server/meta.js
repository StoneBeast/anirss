'use strict';

const { fetchBuffer } = require('./http');
const { decodeEntities } = require('./rss');
const { guessEpisode } = require('./util');

/** 从 Mikan 追番地址推导番组主页，例如 /RSS/Bangumi?bangumiId=4059 -> /Home/Bangumi/4059 */
function deriveHomeUrl(subUrl) {
  let u;
  try {
    u = new URL(String(subUrl || ''));
  } catch {
    return '';
  }
  const homeMatch = /^\/Home\/Bangumi\/(\d+)\/?$/i.exec(u.pathname);
  if (homeMatch) return `${u.origin}/Home/Bangumi/${homeMatch[1]}`;
  if (!/\/RSS\/Bangumi/i.test(u.pathname)) return '';
  const id = u.searchParams.get('bangumiId');
  if (!id || !/^\d+$/.test(id)) return '';
  return `${u.origin}/Home/Bangumi/${id}`;
}

function stripTags(input) {
  return String(input == null ? '' : input)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
}

function cleanText(input) {
  return decodeEntities(stripTags(input))
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(base, href) {
  try {
    return new URL(String(href), base).href;
  } catch {
    return String(href || '');
  }
}

/** 把追番源标题整理成适合做追番名称的短标题 */
function cleanFeedTitle(title) {
  let s = String(title || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(?:Mikan(?:\s*Project)?|蜜柑计划)\s*[-–—|·:]\s*/i, '');
  s = s.replace(/\s*[-–—|·]\s*(?:RSS|Feed)\s*$/i, '');
  return s.trim().slice(0, 80);
}

/** 从 Mikan 页面提取番剧封面（.bangumi-poster 背景图或 og:image） */
function extractPoster(text, baseUrl) {
  const poster = /class=["'][^"']*bangumi-poster[^"']*["'][^>]*style=["]([^"]*)["]/i.exec(text)
    || /class=["'][^"']*bangumi-poster[^"']*["'][^>]*style=[']([^']*)[']/i.exec(text)
    || /style=["]([^"]*)["][^>]*class=["'][^"']*bangumi-poster/i.exec(text)
    || /style=[']([^']*)['][^>]*class=["'][^"']*bangumi-poster/i.exec(text);
  if (poster) {
    const m = /background-image\s*:\s*url\(\s*(['"]?)([^'")]+)\1\s*\)/i.exec(poster[1]);
    if (m && m[2]) return absoluteUrl(baseUrl, decodeEntities(m[2].trim()));
  }
  const og = /<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(text)
    || /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i.exec(text);
  if (og && og[1]) return absoluteUrl(baseUrl, decodeEntities(og[1].trim()));
  return '';
}

function rssUrlFor(baseUrl, bangumiId, subgroupId) {
  try {
    const origin = new URL(baseUrl).origin;
    return `${origin}/RSS/Bangumi?bangumiId=${bangumiId}&subgroupid=${subgroupId}`;
  } catch {
    return '';
  }
}

function homeUrlFor(baseUrl, bangumiId) {
  try {
    return `${new URL(baseUrl).origin}/Home/Bangumi/${bangumiId}`;
  } catch {
    return '';
  }
}

/** 解析番组主页的「字幕组列表」：id -> 名称 */
function parseSubgroups(html, homeUrl, bangumiId) {
  const text = String(html || '');
  const re = /class=["'][^"']*subgroup-text[^"']*["'][^>]*id=["'](\d+)["']([\s\S]*?)(?=class=["'][^"']*subgroup-text|$)/gi;
  const out = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(text))) {
    const id = m[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const body = m[2];
    const nameMatch = /<a[^>]+href=["'][^"']*\/Home\/PublishGroup\/\d+[^"']*["'][^>]*>([\s\S]*?)<\/a>/i.exec(body)
      || /<a[^>]+href=["'][^"']*\/RSS\/Bangumi[^"']*["'][^>]*>([\s\S]*?)<\/a>/i.exec(body);
    const name = nameMatch ? cleanText(nameMatch[1]) : '';
    out.push({
      id,
      name: name || `字幕组 ${id}`,
      rssUrl: rssUrlFor(homeUrl, bangumiId, id),
    });
  }
  return out;
}
/** 解析 Mikan 番组主页：封面、标题、bgm.tv 链接、放送信息、官网、字幕组 */
/** 解析番组主页每个字幕组块下的集数表格，得到真实集数（不是搜索结果样本数） */
function parseSubgroupEpisodes(html) {
  const text = String(html || '');
  const re = /class=["']subgroup-text["'][^>]*id=["'](\d+)["']/g;
  const marks = [];
  let m;
  while ((m = re.exec(text))) marks.push({ id: m[1], idx: m.index });
  const map = new Map();
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].idx : text.length;
    const seg = text.slice(marks[i].idx, end);
    const titles = [...seg.matchAll(/<a\b[^>]*\bmagnet-link-wrap\b[^>]*>([\s\S]*?)<\/a>/g)]
      .map((x) => cleanText(x[1]));
    const rows = (seg.match(/js-episode-select/g) || []).length;
    const episodes = new Set();
    let batch = false;
    let specials = 0;
    for (const title of titles) {
      const guess = guessEpisode(title);
      if (!guess) continue;
      if (guess.kind === 'range') {
        batch = true;
        for (let n = guess.from; n <= guess.to && n - guess.from < 500; n++) episodes.add(n);
      } else if (guess.kind === 'single' && guess.episode) {
        episodes.add(guess.episode);
      } else {
        specials++;
      }
    }
    map.set(marks[i].id, {
      rows,
      titles: titles.length,
      episodes: Array.from(episodes).sort((a, b) => a - b),
      batch,
      specials,
    });
  }
  return map;
}

function parseMikanHome(html, homeUrl) {
  const text = String(html || '');
  const meta = {
    homeUrl: homeUrl || '',
    bangumiId: (/(\d+)/.exec(String(homeUrl || '').split('/').pop() || '') || [])[1] || '',
    cover: '',
    title: '',
    bgmUrl: '',
    bgmId: '',
    airWeekday: '',
    episodes: '',
    startDate: '',
    officialSite: '',
    subgroups: [],
    fetchedAt: Date.now(),
  };

  meta.cover = extractPoster(text, homeUrl);

  const title = /<p[^>]*class=["'][^"']*bangumi-title[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(text);
  if (title) meta.title = cleanText(title[1]).replace(/\s*RSS\s*$/i, '').trim();
  if (!meta.bangumiId) {
    const bg = /\/Home\/Bangumi\/(\d+)/i.exec(text);
    if (bg) meta.bangumiId = bg[1];
  }

  const bgm = /https?:\/\/(?:bgm\.tv|bangumi\.tv)\/subject\/(\d+)/i.exec(text);
  if (bgm) {
    meta.bgmId = bgm[1];
    meta.bgmUrl = `https://bgm.tv/subject/${bgm[1]}`;
  }

  const info = (label) => {
    const re = new RegExp('class=["\'][^"\']*bangumi-info[^"\']*["\'][^>]*>\\s*' + label + '：([\\s\\S]*?)<\\/p>', 'i');
    const m = re.exec(text);
    return m ? cleanText(m[1]) : '';
  };
  meta.airWeekday = info('放送日期');
  meta.episodes = info('总集数');
  meta.startDate = info('放送开始');

  const official = /官方网站：[\s\S]{0,240}?href=["']([^"']+)["']/i.exec(text);
  if (official) meta.officialSite = absoluteUrl(homeUrl, decodeEntities(official[1].trim()));

  const episodeMap = parseSubgroupEpisodes(text);
  meta.subgroups = parseSubgroups(text, homeUrl, meta.bangumiId).map((s) => {
    const info = episodeMap.get(String(s.id)) || null;
    // 同一集可能有多个版本（简/繁、不同分辨率），优先用识别出的不同集数
    const count = info ? (info.episodes.length || info.rows) : 0;    return {
      ...s,
      episodeCount: count,
      episodeRows: info ? info.rows : 0,
      episodes: info ? info.episodes.slice(0, 240) : [],
      batch: !!(info && info.batch),
      specials: info ? info.specials : 0,
    };
  });
  return meta;
}

/** 解析 Mikan 单集页面：所属番剧、字幕组、封面 */
function parseEpisodePage(html, pageUrl) {
  const text = String(html || '');
  const url = String(pageUrl || '');
  const meta = {
    url,
    bangumiId: '',
    subgroupId: '',
    title: '',
    cover: '',
    homeUrl: '',
    rssUrl: '',
  };
  const bg = /\/Home\/Bangumi\/(\d+)/i.exec(text);
  if (bg) meta.bangumiId = bg[1];
  const title = /<p[^>]*class=["'][^"']*bangumi-title[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(text);
  if (title) {
    const a = /<a[^>]*>([\s\S]*?)<\/a>/i.exec(title[1]);
    meta.title = cleanText(a ? a[1] : title[1]).replace(/\s*RSS\s*$/i, '').trim();
  }
  meta.cover = extractPoster(text, url);
  const rss = /\/RSS\/Bangumi\?bangumiId=(\d+)(?:&amp;|&)subgroupid=(\d+)/i.exec(text);
  if (rss) {
    meta.bangumiId = meta.bangumiId || rss[1];
    meta.subgroupId = rss[2];
    meta.rssUrl = rssUrlFor(url, rss[1], rss[2]);
  }
  if (meta.bangumiId) meta.homeUrl = homeUrlFor(url, meta.bangumiId);
  return meta;
}

/** 抓取并解析追番对应的番组元数据；无法推导主页时返回 null */
async function fetchSubMeta(subUrl, opts) {
  const homeUrl = deriveHomeUrl(subUrl);
  if (!homeUrl) return null;
  const options = opts || {};
  const res = await fetchBuffer(homeUrl, {
    timeout: options.timeout || 20000,
    maxBytes: options.maxBytes || 5 * 1024 * 1024,
    headers: { 'Accept': 'text/html,application/xhtml+xml,*/*' },
    proxy: options.proxy,
  });
  const meta = parseMikanHome(res.buffer.toString('utf8'), res.url || homeUrl);
  meta.sourceUrl = res.url || homeUrl;
  meta.fetchedAt = Date.now();
  return meta;
}

module.exports = {
  deriveHomeUrl, parseMikanHome, parseEpisodePage, parseSubgroups, parseSubgroupEpisodes,
  fetchSubMeta, cleanText, cleanFeedTitle, rssUrlFor, homeUrlFor,
};
