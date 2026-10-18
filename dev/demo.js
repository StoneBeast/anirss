'use strict';

/**
 * 演示环境：假 qBittorrent + 假 RSS + 一份预置配置
 * 用法：node dev/demo.js
 * 然后另开进程：ANIRSS_DATA=../work/anirss-demo-data ANIRSS_PORT=8777 node app/server/index.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, '..', 'work', 'anirss-demo-data');
const QB_PORT = 18080;
const RSS_PORT = 18081;
const NOW = Date.now();

const qbAdds = [];
const qbDeletes = [];

const DEMO_TORRENTS = {
  ['e1'.padEnd(40, '0')]: { name: '[Lilith-Raws] 药屋少女的呢喃 - 19 [Baha][WEB-DL][1080p][AVC AAC][CHT][MP4]', size: 798_000_000, progress: 0.35, dlspeed: 2_100_000, upspeed: 8_000, state: 'downloading', eta: 360, save_path: '/volume1/media/anime/药屋少女的呢喃' },
  ['e2'.padEnd(40, '1')]: { name: '[ANi] 葬送的芙莉莲 - 28 [1080P][Baha][WEB-DL][AAC AVC][CHT][MP4]', size: 1_284_000_000, progress: 1, dlspeed: 0, upspeed: 512_000, state: 'stalledUP', eta: 0, save_path: '/volume1/media/anime/葬送的芙莉莲' },
  ['e3'.padEnd(40, '2')]: { name: '[SubsPlease] 某剧场版 [1080p][BDRip]', size: 4_600_000_000, progress: 0.08, dlspeed: 0, upspeed: 0, state: 'pausedDL', eta: 0, save_path: '/volume1/media/movies' },
};

function startServer(handler, port) {
  return new Promise((resolve, reject) => {
    const s = http.createServer(handler);
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function json(res, data, status) {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(status || 200, { 'Content-Type': 'application/json', 'Content-Length': body.length });
  res.end(body);
}

function text(res, body, status, headers) {
  const buf = Buffer.from(String(body));
  res.writeHead(status || 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': buf.length,
    ...(headers || {}),
  });
  res.end(buf);
}

const QB_ACTIVE = [
  {
    hash: 'a1b2c3d4', name: '[Lilith-Raws] 葬送的芙莉莲 - 28 [Baha][WEB-DL][1080p][AVC AAC][CHT][MP4]',
    size: 1_284_000_000, progress: 0.68, dlspeed: 3_355_443, upspeed: 102_400,
    state: 'downloading', eta: 240, save_path: '/volume1/media/anime/葬送的芙莉莲',
  },
  {
    hash: 'e5f6a7b8', name: '[ANi] 药屋少女的呢喃 - 19 [1080P][Baha][WEB-DL][AAC AVC][CHT][MP4]',
    size: 812_000_000, progress: 0.31, dlspeed: 1_887_436, upspeed: 12_288,
    state: 'downloading', eta: 900, save_path: '/volume1/media/anime/药屋少女的呢喃',
  },
  {
    hash: 'c9d0e1f2', name: '[Lilith-Raws] 迷宫饭 - 12 [Baha][WEB-DL][1080p][AVC AAC][CHT][MP4]',
    size: 1_102_000_000, progress: 0.92, dlspeed: 655_360, upspeed: 4_096,
    state: 'stalledDL', eta: 180, save_path: '/volume1/media/anime/迷宫饭',
  },
];

async function startQb() {
  return startServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1:' + QB_PORT);
    const p = u.pathname;
    if (p === '/api/v2/auth/login') {
      const body = (await readBody(req)).toString();
      if (!body.includes('username=admin') || !body.includes('password=secret')) return text(res, 'Fails.');
      return text(res, 'Ok.', 200, { 'Set-Cookie': 'SID=demo-session; HttpOnly; path=/' });
    }
    if (!String(req.headers.cookie || '').includes('SID=demo-session')) return text(res, 'Forbidden', 403);
    if (p === '/api/v2/app/version') return text(res, 'v5.0.2');
    if (p === '/api/v2/app/webapiVersion') return text(res, '2.11.2');
    if (p === '/api/v2/app/defaultSavePath') return text(res, '/volume1/downloads');
    if (p === '/api/v2/transfer/info') {
      return json(res, {
        dl_info_speed: 5_898_239,
        up_info_speed: 118_784,
        dl_info_data: 87_654_321_000,
        up_info_data: 12_345_678_000,
        connection_status: 'connected',
      });
    }
    if (p === '/api/v2/torrents/info') {
      if (u.searchParams.has('hashes')) {
        const wanted = String(u.searchParams.get('hashes') || '').split('|').filter(Boolean);
        return json(res, wanted.filter((hash) => DEMO_TORRENTS[hash]).map((hash) => ({ hash, ...DEMO_TORRENTS[hash] })));
      }
      return json(res, QB_ACTIVE);
    }
    if (p === '/api/v2/torrents/delete') {
      const raw = (await readBody(req)).toString('utf8');
      const form = new URLSearchParams(raw);
      qbDeletes.push({ hashes: String(form.get('hashes') || '').split('|'), deleteFiles: form.get('deleteFiles') === 'true', at: Date.now() });
      return text(res, 'Ok.');
    }
    if (p === '/api/v2/torrents/add') {
      const body = await readBody(req);
      const raw = body.toString('utf8');
      const mp = /name="savepath"\r\n\r\n([^\r]*)/.exec(raw);
      qbAdds.push({ savePath: mp ? mp[1] : '', at: Date.now(), bytes: body.length });
      return text(res, 'Ok.');
    }
    return text(res, 'Not Found', 404);
  }, QB_PORT);
}

const KUSURIYA_ITEMS = [
  { key: 'demo-kusuriya-1', title: '[ANi] 药屋少女的呢喃 - 18 [1080P][Baha][WEB-DL][AAC AVC][CHT][MP4]', size: 812_000_000 },
  { key: 'demo-kusuriya-2', title: '[Lilith-Raws] 药屋少女的呢喃 - 19 [Baha][WEB-DL][1080p][AVC AAC][CHT][MP4]', size: 798_000_000 },
  { key: 'demo-kusuriya-3', title: '[ANi] 药屋少女的呢喃 - 19 [720P][Baha][WEB-DL]', size: 412_000_000 },
  { key: 'demo-kusuriya-4', title: '[Lilith-Raws] 药屋少女的呢喃 - 01-12 [合集] [1080p]', size: 9_800_000_000 },
  { key: 'demo-kusuriya-5', title: '[ANi] 药屋少女的呢喃 - 20 [1080P][Baha][WEB-DL][AAC AVC][CHT][MP4]', size: 822_000_000 },
  { key: 'demo-kusuriya-6', title: '[Lilith-Raws] 药屋少女的呢喃 - 20 [Baha][WEB-DL][1080p][AVC AAC][CHT][MP4]', size: 801_000_000 },
];

const MOVIE_ITEMS = [
  { key: 'demo-movie-1', title: '[Lilith-Raws] 剧场版 转生成蜘蛛又怎样 - 1080p [Baha][WEB-DL][CHT]', size: 3_200_000_000 },
  { key: 'demo-movie-2', title: '[预告] 剧场版 转生成蜘蛛又怎样 - 正式预告 [1080p]', size: 82_000_000 },
];

function rssXml(title, items) {
  const list = items.map((it, i) => `
    <item>
      <title><![CDATA[${it.title}]]></title>
      <link>http://127.0.0.1:${RSS_PORT}/post/${it.key}</link>
      <guid isPermaLink="false">${it.key}</guid>
      <pubDate>${new Date(NOW - i * 3600_000).toUTCString()}</pubDate>
      <description><![CDATA[<p>演示条目</p>]]></description>
      <enclosure url="http://127.0.0.1:${RSS_PORT}/torrents/${it.key}.torrent" length="${it.size}" type="application/x-bittorrent" />
    </item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${title}</title>
    <link>http://127.0.0.1:${RSS_PORT}/</link>
    <description>demo feed</description>
    ${list}
  </channel>
</rss>`;
}

function subgroupRows(count, label) {
  let out = '';
  for (let i = 1; i <= count; i++) {
    const ep = String(i).padStart(2, '0');
    out += `<tr><td><input type="checkbox" class="js-episode-select" /></td>`
      + `<td><a class="magnet-link-wrap" href="/Home/Episode/${String(i).padStart(40, 'a')}">`
      + `【${label}】药屋少女的呢喃 [${ep}] [1080p]</a></td></tr>`;
  }
  return out;
}

function coverSvg(label, color) {  const safe = String(label || '').replace(/[<>&"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#1b2a4a"/></linearGradient></defs>
    <rect width="120" height="160" fill="url(#g)"/>
    <text x="60" y="84" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#fff">${safe}</text>
  </svg>`;
}

async function startRss() {
  return startServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1:' + RSS_PORT);
    if (u.pathname === '/rss/kusuriya') {
      return text(res, rssXml('Mikan · 药屋少女的呢喃', KUSURIYA_ITEMS), 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    }
    if (u.pathname === '/rss/movie') {
      return text(res, rssXml('Mikan · 剧场版', MOVIE_ITEMS), 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    }
    if (u.pathname === '/rss/broken') {
      return text(res, '演示：RSS 源暂时不可用', 503);
    }
    if (u.pathname === '/RSS/Bangumi') {
      const sg = u.searchParams.get('subgroupid');
      const counts = { 203: [12, '桜都字幕组'], 71: [8, 'TSDM字幕组'], 1236: [6, '绿茶字幕组'] };
      if (sg && counts[sg]) {
        const [n, label] = counts[sg];
        const items = Array.from({ length: n }, (_, i) => `
          <item>
            <title><![CDATA[【${label}】药屋少女的呢喃 [${String(i + 1).padStart(2, '0')}] [1080p][简繁内封]]]></title>
            <link>http://127.0.0.1:${RSS_PORT}/Home/Episode/${String(i + 1).padStart(40, 'a')}</link>
            <guid isPermaLink="false">demo-sg-${sg}-${i + 1}</guid>
            <pubDate>${new Date(NOW - i * 3600_000).toUTCString()}</pubDate>
            <enclosure url="http://127.0.0.1:${RSS_PORT}/torrents/demo-sg-${sg}-${i + 1}.torrent" length="${800_000_000 + i}" type="application/x-bittorrent" />
          </item>`).join('');
        return text(res, `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
          <title>Mikan Project - ${label}</title><link>http://127.0.0.1:${RSS_PORT}/</link>${items}
        </channel></rss>`, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
      }
      return text(res, rssXml('Mikan Project - 药屋少女的呢喃', KUSURIYA_ITEMS), 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    }
    if (u.pathname === '/RSS/Search') {
      const items = [
        { key: 'demo-search-1', title: '【桜都字幕组】药屋少女的呢喃 - 19 [1080p][简繁内封]', size: 798_000_000 },
        { key: 'demo-search-2', title: '【ANi】药屋少女的呢喃 - 19 [1080P][Baha][WEB-DL]', size: 812_000_000 },
        { key: 'demo-search-3', title: '【Lilith-Raws】药屋少女的呢喃 - 20 [Baha][WEB-DL][1080p]', size: 806_000_000 },
      ];
      const list = items.map((it, i) => `
        <item>
          <title><![CDATA[${it.title}]]></title>
          <link>http://127.0.0.1:${RSS_PORT}/Home/Episode/${String(i + 1).padStart(40, 'a')}</link>
          <guid isPermaLink="false">${it.key}</guid>
          <pubDate>${new Date(NOW - i * 3600_000).toUTCString()}</pubDate>
          <enclosure url="http://127.0.0.1:${RSS_PORT}/torrents/${it.key}.torrent" length="${it.size}" type="application/x-bittorrent" />
        </item>`).join('');
      return text(res, `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
        <title>Mikan Project - 搜索结果</title><link>http://127.0.0.1:${RSS_PORT}/</link>${list}
      </channel></rss>`, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    }
    if (/^\/Home\/Episode\/a{40}$/.test(u.pathname) || /^\/Home\/Episode\/[0-9a-f]{40}$/i.test(u.pathname)) {
      const hash = u.pathname.split('/').pop();
      const idx = Math.max(0, hash.charCodeAt(0) - 97);
      const subgroup = ['203', '71', '1236'][idx % 3];
      return text(res, `<!doctype html><html><head><title>Mikan Project - Episode</title></head><body>
        <div class="bangumi-poster" style="background-image: url('http://127.0.0.1:${RSS_PORT}/cover/kusuriya.svg');"></div>
        <p class="bangumi-title"><a href="/Home/Bangumi/4059">药屋少女的呢喃</a>
          <a href="/RSS/Bangumi?bangumiId=4059&subgroupid=${subgroup}" class="mikan-rss">RSS</a></p>
      </body></html>`, 200, { 'Content-Type': 'text/html; charset=utf-8' });
    }
    if (u.pathname === '/Home/Bangumi/4059') {
      return text(res, `<!doctype html><html><head><title>Mikan Project - 药屋少女的呢喃</title></head><body>
        <div class="bangumi-poster" style="background-image: url('http://127.0.0.1:${RSS_PORT}/cover/kusuriya.svg');"></div>
        <p class="bangumi-title">药屋少女的呢喃</p>
        <p class="bangumi-info">放送日期：星期六</p>
        <p class="bangumi-info">总集数：24</p>
        <p class="bangumi-info">放送开始：10/22/2023</p>
        <p class="bangumi-info">Bangumi番组计划链接：<br /><a href="https://bgm.tv/subject/382179">https://bgm.tv/subject/382179</a></p>
        <div class="subgroup-text" id="203"><a href="/Home/PublishGroup/12">桜都字幕组</a>
          <a href="/RSS/Bangumi?bangumiId=4059&subgroupid=203" class="mikan-rss">RSS</a></div>
        <div class="episode-table">${subgroupRows(12, '桜都字幕组')}</div>
        <div class="subgroup-text" id="71"><a href="/Home/PublishGroup/70">TSDM字幕组</a>
          <a href="/RSS/Bangumi?bangumiId=4059&subgroupid=71" class="mikan-rss">RSS</a></div>
        <div class="episode-table">${subgroupRows(8, 'TSDM字幕组')}</div>
        <div class="subgroup-text" id="1236"><a href="/Home/PublishGroup/88">绿茶字幕组</a>
          <a href="/RSS/Bangumi?bangumiId=4059&subgroupid=1236" class="mikan-rss">RSS</a></div>
        <div class="episode-table">${subgroupRows(6, '绿茶字幕组')}</div>
      </body></html>`, 200, { 'Content-Type': 'text/html; charset=utf-8' });
    }
    if (u.pathname === '/cover/frieren.svg') {
      const svg = coverSvg('芙莉莲', '#5b7cfa');
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Content-Length': Buffer.byteLength(svg) });
      return res.end(svg);
    }
    if (u.pathname === '/cover/kusuriya.svg') {
      const svg = coverSvg('药屋少女', '#2fa8a0');
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Content-Length': Buffer.byteLength(svg) });
      return res.end(svg);
    }
    if (/^\/torrents\/.+\.torrent$/.test(u.pathname)) {
      const buf = Buffer.from('d8:announce26:http://127.0.0.1/announce4:infod4:name4:demo6:lengthi1024eee');
      res.writeHead(200, { 'Content-Type': 'application/x-bittorrent', 'Content-Length': buf.length });
      return res.end(buf);
    }
    return text(res, 'Not Found', 404);
  }, RSS_PORT);
}

function seenFrom(items) {
  const obj = {};
  items.forEach((it, i) => { obj[it.key] = NOW - (i + 1) * 1800_000; });
  return obj;
}

function writeConfig() {
  const seenK = seenFrom(KUSURIYA_ITEMS.slice(0, 2));
  const seenM = seenFrom(MOVIE_ITEMS.slice(0, 1));
  const config = {
    version: 1,
    appVersion: '1.0.0',
    createdAt: NOW - 30 * 86400_000,
    updatedAt: NOW,
    qb: {
      baseUrl: 'http://127.0.0.1:' + QB_PORT,
      username: 'admin',
      password: 'secret',
      skipTlsVerify: false,
      verifiedAt: NOW - 60_000,
      lastTest: {
        at: NOW - 60_000,
        ok: true,
        baseUrl: 'http://127.0.0.1:' + QB_PORT,
        version: 'v5.0.2',
        webapi: '2.11.2',
        defaultSavePath: '/volume1/downloads',
        error: '',
      },
    },
    bases: [
      { id: 'b_mikan', name: 'Mikan', url: 'https://mikanime.tv', note: '蜜柑计划 · 默认站点', createdAt: NOW - 30 * 86400_000 },
      { id: 'b_demo', name: '本地演示 RSS', url: 'http://127.0.0.1:' + RSS_PORT, note: '演示用，含测试条目', createdAt: NOW - 20 * 86400_000 },
    ],
    paths: [
      { id: 'p_template', name: '番剧季度模板', path: '/vol2/1000/media/动画/${{1}}/Season ${{}}', isDefault: true, createdAt: NOW - 2 * 86400_000 },
      { id: 'p_anime', name: '番剧 · 1080P', path: '/volume1/media/anime', isDefault: false, createdAt: NOW - 30 * 86400_000 },
      { id: 'p_movie', name: '剧场版', path: '/volume1/media/movies', isDefault: false, createdAt: NOW - 20 * 86400_000 },
      { id: 'p_byname', name: '按番剧名归档', path: '/volume1/media/anime/${name}', isDefault: false, createdAt: NOW - 12 * 86400_000 },
      { id: 'p_temp', name: '临时目录', path: '/volume1/downloads/temp', isDefault: false, createdAt: NOW - 10 * 86400_000 },
    ],
    subs: [
      {
        id: 's_frieren',
        name: '葬送的芙莉莲 · 简日 1080P',
        url: 'https://mikanime.tv/RSS/Bangumi?bangumiId=3870&subgroupid=203',
        baseId: 'b_mikan',
        path: 'RSS/Bangumi?bangumiId=3870&subgroupid=203',
        include: '1080p\n简日|繁日',
        exclude: '合集|SP',
        ignoreCase: true,
        savePath: '/volume1/media/anime/葬送的芙莉莲',
        category: 'anime',
        tags: '1080p,简日',
        intervalMin: 10,
        maxPerCheck: 5,
        enabled: true,
        seen: Object.fromEntries(Array.from({ length: 128 }, (_, i) => ['seed-frieren-' + i, NOW - i * 1800_000])),
        needsSeed: false,
        totalDownloads: 18,
        lastDownloadAt: NOW - 2 * 60_000,
        lastCheck: { at: NOW - 4 * 60_000, ok: true, feedTitle: 'Mikan · 葬送的芙莉莲', total: 128, newCount: 1, downloaded: 1, failed: 0, seedOnly: false, error: '', durationMs: 940 },
        lastRunAt: NOW - 4 * 60_000,
        meta: {
          homeUrl: 'https://mikanime.tv/Home/Bangumi/3870',
          cover: 'http://127.0.0.1:' + RSS_PORT + '/cover/frieren.svg',
          title: '葬送的芙莉莲',
          bgmUrl: 'https://bgm.tv/subject/400602',
          bgmId: '400602',
          airWeekday: '星期五',
          episodes: '28',
          startDate: '9/29/2023',
          officialSite: 'https://frieren-anime.jp/',
          fetchedAt: NOW - 3600_000,
          error: '',
        },
        createdAt: NOW - 30 * 86400_000, updatedAt: NOW - 4 * 60_000,
      },
      {
        id: 's_kusuriya',
        name: '药屋少女的呢喃 · 1080P',
        url: 'http://127.0.0.1:' + RSS_PORT + '/rss/kusuriya',
        baseId: 'b_demo',
        path: '/rss/kusuriya',
        include: '1080p|1080P',
        exclude: '合集',
        ignoreCase: true,
        savePath: '/volume1/media/anime/药屋少女的呢喃',
        category: 'anime',
        tags: '1080p',
        intervalMin: 15,
        maxPerCheck: 8,
        enabled: true,
        seen: seenK,
        needsSeed: false,
        totalDownloads: 12,
        lastDownloadAt: NOW - 6 * 60_000,
        lastCheck: { at: NOW - 2 * 60_000, ok: true, feedTitle: 'Mikan · 药屋少女的呢喃', total: KUSURIYA_ITEMS.length, newCount: 4, downloaded: 1, failed: 0, seedOnly: false, error: '', durationMs: 620 },
        lastRunAt: NOW - 2 * 60_000,
        meta: {
          homeUrl: 'https://mikanime.tv/Home/Bangumi/4014',
          cover: 'http://127.0.0.1:' + RSS_PORT + '/cover/kusuriya.svg',
          title: '药屋少女的呢喃',
          bgmUrl: 'https://bgm.tv/subject/382179',
          bgmId: '382179',
          airWeekday: '星期六',
          episodes: '24',
          startDate: '10/22/2023',
          officialSite: '',
          fetchedAt: NOW - 7200_000,
          error: '',
        },
        createdAt: NOW - 20 * 86400_000,
        updatedAt: NOW - 2 * 60_000,
      },
      {
        id: 's_movie',
        name: '剧场版 / OVA 收藏',
        url: 'http://127.0.0.1:' + RSS_PORT + '/rss/movie',
        baseId: 'b_demo',
        path: '/rss/movie',
        include: '1080p',
        exclude: '预告',
        ignoreCase: true,
        savePath: '/volume1/media/movies',
        category: 'movie',
        tags: '剧场版',
        intervalMin: 60,
        maxPerCheck: 3,
        enabled: false,
        seen: seenM,
        needsSeed: false,
        totalDownloads: 4,
        lastDownloadAt: NOW - 26 * 3600_000,
        lastCheck: { at: NOW - 2 * 3600_000, ok: true, feedTitle: 'Mikan · 剧场版', total: MOVIE_ITEMS.length, newCount: 0, downloaded: 0, failed: 0, seedOnly: false, error: '', durationMs: 480 },
        lastRunAt: NOW - 2 * 3600_000,
        createdAt: NOW - 18 * 86400_000,
        updatedAt: NOW - 2 * 3600_000,
      },
      {
        id: 's_broken',
        name: '迷宫饭 · 第二季（源异常示例）',
        url: 'http://127.0.0.1:' + RSS_PORT + '/rss/broken',
        baseId: 'b_demo',
        path: '/rss/broken',
        include: '1080p',
        exclude: '合集',
        ignoreCase: true,
        savePath: '/volume1/media/anime/迷宫饭',
        category: 'anime',
        tags: '',
        intervalMin: 20,
        maxPerCheck: 5,
        enabled: true,
        seen: {},
        needsSeed: false,
        totalDownloads: 0,
        lastDownloadAt: 0,
        lastCheck: { at: NOW - 3 * 60_000, ok: false, feedTitle: '', total: 0, newCount: 0, downloaded: 0, failed: 0, seedOnly: false, error: '请求失败（HTTP 503）127.0.0.1：演示：RSS 源暂时不可用', durationMs: 180 },
        lastRunAt: NOW - 3 * 60_000,
        createdAt: NOW - 15 * 86400_000,
        updatedAt: NOW - 3 * 60_000,
      },
    ],
    extras: [
      {
        id: 'x_demo_1',
        name: '[Lilith-Raws] 药屋少女的呢喃 - 19 [Baha][WEB-DL][1080p][AVC AAC][CHT][MP4]',
        source: 'magnet',
        magnet: 'magnet:?xt=urn:btih:' + 'e1'.padEnd(40, '0') + '&dn=extra-demo-1',
        hash: 'e1'.padEnd(40, '0'),
        fileName: '',
        savePath: '/volume1/media/anime/药屋少女的呢喃',
        category: 'anime',
        tags: '补番',
        paused: false,
        ok: true,
        error: '',
        createdAt: NOW - 26 * 60_000,
        qb: { state: 'downloading', progress: 0.35, size: 798_000_000, dlspeed: 2_100_000, upspeed: 8_000, eta: 360, savePath: '/volume1/media/anime/药屋少女的呢喃', name: '', at: NOW - 60_000 },
      },
      {
        id: 'x_demo_2',
        name: '[ANi] 葬送的芙莉莲 - 28 [1080P][Baha][WEB-DL][AAC AVC][CHT][MP4]',
        source: 'file',
        magnet: '',
        hash: 'e2'.padEnd(40, '1'),
        fileName: 'frieren-28.torrent',
        savePath: '/volume1/media/anime/葬送的芙莉莲',
        category: 'anime',
        tags: '补番,1080p',
        paused: false,
        ok: true,
        error: '',
        createdAt: NOW - 5 * 3600_000,
        qb: { state: 'stalledUP', progress: 1, size: 1_284_000_000, dlspeed: 0, upspeed: 512_000, eta: 0, savePath: '/volume1/media/anime/葬送的芙莉莲', name: '', at: NOW - 120_000 },
      },
      {
        id: 'x_demo_3',
        name: '[SubsPlease] 某剧场版 [1080p][BDRip]',
        source: 'magnet',
        magnet: 'magnet:?xt=urn:btih:' + 'e3'.padEnd(40, '2') + '&dn=movie-demo',
        hash: 'e3'.padEnd(40, '2'),
        fileName: '',
        savePath: '/volume1/media/movies',
        category: 'movie',
        tags: '',
        paused: true,
        ok: true,
        error: '',
        createdAt: NOW - 2 * 86400_000,
        qb: { state: 'pausedDL', progress: 0.08, size: 4_600_000_000, dlspeed: 0, upspeed: 0, eta: 0, savePath: '/volume1/media/movies', name: '', at: NOW - 3 * 3600_000 },
      },
      {
        id: 'x_demo_4',
        name: '某失效磁力示例',
        source: 'magnet',
        magnet: 'magnet:?xt=urn:btih:' + 'e4'.padEnd(40, '3') + '&dn=broken',
        hash: 'e4'.padEnd(40, '3'),
        fileName: '',
        savePath: '',
        category: '',
        tags: '',
        paused: false,
        ok: false,
        error: 'qBittorrent 拒绝添加（Fails.）：保存路径不可用',
        createdAt: NOW - 3 * 86400_000,
        qb: null,
      },
    ],
    downloads: [
      {
        id: 'd_1', subId: 's_frieren', subName: '葬送的芙莉莲 · 简日 1080P',
        itemKey: 'demo-frieren-28', title: '[Lilith-Raws] 葬送的芙莉莲 - 28 [Baha][WEB-DL][1080p][AVC AAC][CHT][MP4]',
        torrentUrl: 'https://mikanani.me/Download/20261018/abc.torrent',
        savePath: '/volume1/media/anime/葬送的芙莉莲', category: 'anime', tags: '1080p',
        mode: 'file', status: 'ok', error: '', createdAt: NOW - 2 * 60_000, updatedAt: NOW - 2 * 60_000,
      },
      {
        id: 'd_2', subId: 's_kusuriya', subName: '药屋少女的呢喃 · 1080P',
        itemKey: 'demo-kusuriya-1', title: KUSURIYA_ITEMS[0].title,
        torrentUrl: 'http://127.0.0.1:' + RSS_PORT + '/torrents/demo-kusuriya-1.torrent',
        savePath: '/volume1/media/anime/药屋少女的呢喃', category: 'anime', tags: '1080p',
        mode: 'file', status: 'ok', error: '', createdAt: NOW - 6 * 60_000, updatedAt: NOW - 6 * 60_000,
      },
      {
        id: 'd_3', subId: 's_frieren', subName: '葬送的芙莉莲 · 简日 1080P',
        itemKey: 'demo-frieren-27', title: '[ANi] 葬送的芙莉莲 - 27 [1080P][Baha][WEB-DL][AAC AVC][CHT][MP4]',
        torrentUrl: 'https://mikanani.me/Download/20261011/def.torrent',
        savePath: '/volume1/media/anime/葬送的芙莉莲', category: 'anime', tags: '1080p',
        mode: 'file', status: 'ok', error: '', createdAt: NOW - 36 * 60_000, updatedAt: NOW - 36 * 60_000,
      },
      {
        id: 'd_4', subId: 's_broken', subName: '迷宫饭 · 第二季（源异常示例）',
        itemKey: 'demo-frieren-12', title: '[Lilith-Raws] 迷宫饭 - 12 [Baha][WEB-DL][1080p][AVC AAC][CHT][MP4]',
        torrentUrl: 'https://mikanani.me/Download/20261018/ghi.torrent',
        savePath: '/volume1/media/anime/迷宫饭', category: 'anime', tags: '',
        mode: '', status: 'failed', error: '获取种子失败：请求超时（30 秒）；交由 qBittorrent 直接下载也失败：连接 qBittorrent 超时（45 秒）',
        createdAt: NOW - 70 * 60_000, updatedAt: NOW - 68 * 60_000,
      },
      {
        id: 'd_5', subId: 's_movie', subName: '剧场版 / OVA 收藏',
        itemKey: 'demo-movie-1', title: MOVIE_ITEMS[0].title,
        torrentUrl: 'http://127.0.0.1:' + RSS_PORT + '/torrents/demo-movie-1.torrent',
        savePath: '/volume1/media/movies', category: 'movie', tags: '剧场版',
        mode: 'file', status: 'ok', error: '', createdAt: NOW - 26 * 3600_000, updatedAt: NOW - 26 * 3600_000,
      },
      {
        id: 'd_6', subId: 's_kusuriya', subName: '药屋少女的呢喃 · 1080P',
        itemKey: 'demo-kusuriya-2', title: KUSURIYA_ITEMS[1].title,
        torrentUrl: 'http://127.0.0.1:' + RSS_PORT + '/torrents/demo-kusuriya-2.torrent',
        savePath: '/volume1/media/anime/药屋少女的呢喃', category: 'anime', tags: '1080p',
        mode: 'file', status: 'duplicate', error: '相同地址已提交过，已跳过', createdAt: NOW - 120 * 60_000, updatedAt: NOW - 120 * 60_000,
      },
    ],
    logs: [
      { at: NOW - 45_000, level: 'info', msg: '「药屋少女的呢喃 · 1080P」检查完成：共 6 条，新增 4，下载 1' },
      { at: NOW - 46_000, level: 'info', msg: '已提交下载「[ANi] 药屋少女的呢喃 - 19 [1080P][Baha][WEB-DL][AAC AVC][CHT][MP4]」（file）' },
      { at: NOW - 3 * 60_000, level: 'error', msg: '「迷宫饭 · 第二季（源异常示例）」检查失败：请求失败（HTTP 503）' },
      { at: NOW - 4 * 60_000, level: 'info', msg: '「葬送的芙莉莲 · 简日 1080P」检查完成：共 128 条，新增 1，下载 1' },
      { at: NOW - 5 * 60_000, level: 'info', msg: 'qBittorrent 连接成功：v5.0.2' },
      { at: NOW - 6 * 60_000, level: 'info', msg: '自动检查调度器已启动（每 15 秒扫描一次到期追番）' },
    ],
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
  console.log('[demo] config written to', path.join(DATA_DIR, 'config.json'));
}

(async () => {
  writeConfig();
  const qb = await startQb();
  const rss = await startRss();
  console.log('[demo] mock qBittorrent on http://127.0.0.1:' + QB_PORT);
  console.log('[demo] mock RSS on http://127.0.0.1:' + RSS_PORT);
  console.log('[demo] 现在启动 anirss：ANIRSS_DATA="' + DATA_DIR + '" ANIRSS_PORT=8777 node app/server/index.js');
  const stop = () => {
    qb.close();
    rss.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
})();
