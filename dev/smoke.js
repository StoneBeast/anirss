'use strict';

/**
 * 本地端到端烟测：
 *   - 内置一个假 qBittorrent WebUI
 *   - 内置一个假 RSS 源（可动态加条目）
 *   - 拉起真实 anirss 服务，逐项断言追番 / 正则 / 去重 / 失败重试 / 种子提交
 *
 * 运行：node dev/smoke.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { spawn } = require('child_process');
const { parseTorrentInfo } = require('../app/server/bencode');
const { buildZip } = require('./zip-builder');

const NODE = process.execPath;
const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'app', 'server', 'index.js');
const DATA_DIR = path.join(ROOT, '..', 'work', 'anirss-smoke-data');
const APP_PORT = 8788;
const QB_PORT = 18080;
const RSS_PORT = 18081;
const PROXY_PORT = 18082;
const APP = `http://127.0.0.1:${APP_PORT}`;
const QB = `http://127.0.0.1:${QB_PORT}`;
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let qbMode = 'ok'; // ok | fail | down
let rssItems = [];
const qbAdds = [];
const qbDeletes = [];
const knownHashes = new Set();
const qbTorrents = new Map();
const qbFiles = new Map();
let rssHits = 0;
let proxyHits = 0;

function torrentFor(id) {
  const name = `demo-${id}`;
  const info = `d4:name${name.length}:${name}6:lengthi1024ee`;
  return Buffer.from(`d8:announce3:url4:info${info}e`, 'utf8');
}

function startServer(handler, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
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

async function startQbMock() {
  return startServer(async (req, res) => {
    const u = new URL(req.url, QB);
    const p = u.pathname;

    if (p === '/api/v2/auth/login') {
      const body = (await readBody(req)).toString();
      if (qbMode === 'down') return text(res, 'Service Unavailable', 503);
      if (!body.includes('username=admin') || !body.includes('password=secret')) {
        return text(res, 'Fails.');
      }
      return text(res, 'Ok.', 200, { 'Set-Cookie': 'SID=smoke-session; HttpOnly; path=/' });
    }

    if (!String(req.headers.cookie || '').includes('SID=smoke-session')) {
      return text(res, 'Forbidden', 403);
    }
    if (qbMode === 'down') return text(res, 'Service Unavailable', 503);

    if (p === '/api/v2/app/version') return text(res, 'v5.0.2');
    if (p === '/api/v2/app/webapiVersion') return text(res, '2.11.2');
    if (p === '/api/v2/app/defaultSavePath') return text(res, '/downloads/default');
    if (p === '/api/v2/transfer/info') {
      return json(res, {
        dl_info_speed: 1024 * 1024,
        up_info_speed: 2048,
        dl_info_data: 1024 * 1024 * 100,
        up_info_data: 1024 * 1024,
        connection_status: 'connected',
      });
    }
    if (p === '/api/v2/torrents/info') {
      if (u.searchParams.has('hashes')) {
        const wanted = String(u.searchParams.get('hashes') || '').split('|').filter(Boolean);
        const out = [];
        for (const hash of wanted) {
          if (qbTorrents.has(hash)) out.push({ hash, ...qbTorrents.get(hash) });
          else if (knownHashes.has(hash)) out.push({ hash, name: 'known', size: 1, progress: 1, state: 'stalledUP', save_path: '/downloads/anime' });
        }
        return json(res, out);
      }
      return json(res, [{
        hash: 'abc123', name: 'Test Anime - 01', size: 1024 * 1024 * 500,
        progress: 0.42, dlspeed: 1024 * 1024, upspeed: 2048,
        state: 'downloading', eta: 300, save_path: '/downloads/anime',
      }]);
    }
    if (p === '/api/v2/torrents/files') {
      const hash = String(u.searchParams.get('hash') || '').toLowerCase();
      return json(res, qbFiles.get(hash) || []);
    }
    if (p === '/api/v2/torrents/delete') {
      const raw = (await readBody(req)).toString('utf8');
      const form = new URLSearchParams(raw);
      const hashes = String(form.get('hashes') || '').split('|').filter(Boolean);
      for (const hash of hashes) {
        knownHashes.delete(hash);
        qbTorrents.delete(hash);
      }
      qbDeletes.push({ hashes, deleteFiles: form.get('deleteFiles') === 'true', at: Date.now() });
      return text(res, 'Ok.');
    }
    if (p === '/api/v2/torrents/add') {
      // qB 的 multipart 文件上传需要标准 Content-Length；chunked 请求可能被拒绝
      if (!req.headers['content-length']) return text(res, 'Length Required', 411);
      const body = await readBody(req);
      const hasFile = body.includes('filename="');
      if (qbMode === 'fail') return text(res, 'Fails.');
      if (qbMode === 'reject-file' && hasFile) return text(res, 'Fails.');
      const raw = body.toString('utf8');
      let savePath = '';
      const mp = /name="savepath"\r\n\r\n([^\r]*)/.exec(raw);
      if (mp) savePath = mp[1];
      else {
        const form = new URLSearchParams(raw);
        savePath = form.get('savepath') || '';
      }
      qbAdds.push({ savePath, hasFile, size: body.length, at: Date.now() });
      return text(res, 'Ok.');
    }
    return text(res, 'Not Found', 404);
  }, QB_PORT);
}

function rssXml() {
  const items = rssItems.map((it) => `
    <item>
      <title><![CDATA[${it.title}]]></title>
      <link>http://127.0.0.1:${RSS_PORT}/post/${it.id}</link>
      <guid isPermaLink="false">mock-${it.id}</guid>
      <pubDate>${new Date(it.at).toUTCString()}</pubDate>
      <description><![CDATA[<p>Mock item ${it.id}</p>]]></description>
      <enclosure url="http://127.0.0.1:${RSS_PORT}/t/${it.id}.torrent" length="123456" type="application/x-bittorrent" />
    </item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Mock Anime Feed</title>
    <link>http://127.0.0.1:${RSS_PORT}/</link>
    <description>smoke test feed</description>
    ${items}
  </channel>
</rss>`;
}

const SEARCH_EPISODES = [
  { hash: 'a'.repeat(40), subgroup: '203', title: '【字幕组A】FX战士久留美 - 01 [1080p]' },
  { hash: 'b'.repeat(40), subgroup: '71', title: '【字幕组B】FX战士久留美 - 02 [1080p]' },
];

function subgroupXml(count, subgroupId) {
  const items = Array.from({ length: count }, (_, i) => `
    <item>
      <title><![CDATA[【字幕组${subgroupId === '203' ? 'A' : 'B'}】FX战士久留美 [${String(i + 1).padStart(2, '0')}] [1080p]]]></title>
      <link>http://127.0.0.1:${RSS_PORT}/Home/Episode/${String(i + 1).padStart(40, 'a')}</link>
      <guid isPermaLink="false">sg-${subgroupId}-${i + 1}</guid>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <enclosure url="http://127.0.0.1:${RSS_PORT}/t/${i + 1}.torrent" length="123456" type="application/x-bittorrent" />
    </item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Mikan Project - 字幕组${subgroupId}</title>
  <link>http://127.0.0.1:${RSS_PORT}/</link>
  ${items}
</channel></rss>`;
}

function searchXml() {  const items = SEARCH_EPISODES.map((e) => `
    <item>
      <title><![CDATA[${e.title}]]></title>
      <link>http://127.0.0.1:${RSS_PORT}/Home/Episode/${e.hash}</link>
      <guid isPermaLink="false">${e.hash}</guid>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <enclosure url="http://127.0.0.1:${RSS_PORT}/Download/20261018/${e.hash}.torrent" length="123456" type="application/x-bittorrent" />
    </item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Mikan Project - 搜索结果</title>
  <link>http://127.0.0.1:${RSS_PORT}/</link>
  ${items}
</channel></rss>`;
}

async function startRssMock() {
  return startServer((req, res) => {
    const u = new URL(req.url, `http://127.0.0.1:${RSS_PORT}`);
    if (u.pathname === '/feed' || u.pathname === '/RSS/Bangumi') {
      const sg = u.searchParams.get('subgroupid');
      if (sg === '203') return text(res, subgroupXml(3, sg), 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
      if (sg === '71') return text(res, subgroupXml(2, sg), 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
      rssHits++;
      return text(res, rssXml(), 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    }
    if (u.pathname === '/RSS/Search') {
      return text(res, searchXml(), 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    }
    if (/^\/Home\/Episode\/[0-9a-f]{40}$/i.test(u.pathname)) {
      const hash = u.pathname.split('/').pop();
      const ep = SEARCH_EPISODES.find((x) => x.hash === hash) || SEARCH_EPISODES[0];
      return text(res, `<!doctype html><html><head><title>Mikan Project - Episode</title></head><body>
        <div class="bangumi-poster" style="background-image: url('http://127.0.0.1:${RSS_PORT}/cover.jpg');"></div>
        <p class="bangumi-title"><a href="/Home/Bangumi/4059">FX&#x6218;&#x58EB;&#x4E45;&#x7559;&#x7F8E;</a>
          <a href="/RSS/Bangumi?bangumiId=4059&subgroupid=${ep.subgroup}" class="mikan-rss">RSS</a></p>
      </body></html>`, 200, { 'Content-Type': 'text/html; charset=utf-8' });
    }
    if (u.pathname === '/Home/Bangumi/4059') {
      return text(res, `<!doctype html><html><head><title>Mikan Project - Mock</title></head><body>
        <div class="bangumi-poster" style="background-image: url('http://127.0.0.1:${RSS_PORT}/cover.jpg');"></div>
        <p class="bangumi-title">FX&#x6218;&#x58EB;&#x4E45;&#x7559;&#x7F8E;</p>
        <p class="bangumi-info">放送日期：星期四</p>
        <p class="bangumi-info">总集数：12</p>
        <p class="bangumi-info">Bangumi番组计划链接：<br /><a href="https://bgm.tv/subject/622288">https://bgm.tv/subject/622288</a></p>
        <div class="subgroup-text" id="203"><a href="/Home/PublishGroup/70">字幕组A</a>
          <a href="/RSS/Bangumi?bangumiId=4059&subgroupid=203" class="mikan-rss">RSS</a></div>
        <div class="episode-table">
          <tr><td><input type="checkbox" class="js-episode-select" /></td><td><a class="magnet-link-wrap" href="/Home/Episode/${'1'.repeat(40)}">【字幕组A】FX战士久留美 [01] [1080p]</a></td></tr>
          <tr><td><input type="checkbox" class="js-episode-select" /></td><td><a class="magnet-link-wrap" href="/Home/Episode/${'2'.repeat(40)}">【字幕组A】FX战士久留美 [02] [1080p]</a></td></tr>
          <tr><td><input type="checkbox" class="js-episode-select" /></td><td><a class="magnet-link-wrap" href="/Home/Episode/${'3'.repeat(40)}">【字幕组A】FX战士久留美 [03] [1080p]</a></td></tr>
        </div>
        <div class="subgroup-text" id="71"><a href="/Home/PublishGroup/70">字幕组B</a>
          <a href="/RSS/Bangumi?bangumiId=4059&subgroupid=71" class="mikan-rss">RSS</a></div>
        <div class="episode-table">
          <tr><td><input type="checkbox" class="js-episode-select" /></td><td><a class="magnet-link-wrap" href="/Home/Episode/${'4'.repeat(40)}">【字幕组B】FX战士久留美 - 01 [1080p]</a></td></tr>
          <tr><td><input type="checkbox" class="js-episode-select" /></td><td><a class="magnet-link-wrap" href="/Home/Episode/${'5'.repeat(40)}">【字幕组B】FX战士久留美 - 02 [1080p]</a></td></tr>
        </div>
      </body></html>`, 200, { 'Content-Type': 'text/html; charset=utf-8' });
    }
    if (u.pathname === '/cover.jpg') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG_1PX.length });
      return res.end(PNG_1PX);
    }
    if (/^\/t\/\d+\.torrent$/.test(u.pathname)) {
      const id = Number(u.pathname.match(/\/t\/(\d+)\.torrent/)[1]);
      const buf = torrentFor(id);
      res.writeHead(200, { 'Content-Type': 'application/x-bittorrent', 'Content-Length': buf.length });
      return res.end(buf);
    }
    if (/^\/subs\/dl\/[\w.-]+\.(ass|srt|zip)$/.test(u.pathname)) {
      const body = Buffer.from('url subtitle content');
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length });
      return res.end(body);
    }
    return text(res, 'Not Found', 404);
  }, RSS_PORT);
}

async function startProxyMock() {
  return startServer((req, res) => {
    proxyHits++;
    let target;
    try {
      target = new URL(req.url);
    } catch {
      res.writeHead(400);
      return res.end('bad proxy target');
    }
    const proxied = http.request({
      hostname: target.hostname,
      port: Number(target.port) || 80,
      path: target.pathname + target.search,
      method: req.method,
      headers: { ...req.headers, host: target.host },
    }, (upstream) => {
      res.writeHead(upstream.statusCode || 502, upstream.headers);
      upstream.pipe(res);
    });
    proxied.on('error', () => {
      res.writeHead(502);
      res.end('proxy upstream error');
    });
    req.pipe(proxied);
  }, PROXY_PORT);
}

function seedItems() {
  const now = Date.now();
  rssItems = [
    { id: 1, title: '[Sub] Test Anime - 01 [1080p][简日]', at: now - 4000 },
    { id: 2, title: '[Sub] Test Anime - 02 [720p][简日]', at: now - 3000 },
    { id: 3, title: '[Sub] Test Anime - 03 [1080p][合集]', at: now - 2000 },
    { id: 4, title: '[Other] Another Show - 01 [1080p]', at: now - 1000 },
    { id: 5, title: '[Sub] Test Anime - 04 [1080p][简日]', at: now },
  ];
}

async function api(pathname, options) {
  const opts = options || {};
  const init = { method: opts.method || 'GET', headers: {} };
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(APP + pathname, init);
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = { raw }; }
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function expectError(fn, status, substr) {
  try {
    await fn();
  } catch (e) {
    assert.strictEqual(e.status, status, `期望 HTTP ${status}，实际 ${e.status}：${e.message}`);
    if (substr) assert.ok(e.message.includes(substr), `错误信息应包含「${substr}」，实际：${e.message}`);
    return e;
  }
  throw new Error('期望请求失败，但它成功了');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealth() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(APP + '/api/health');
      if (res.ok) return;
    } catch { /* retry */ }
    await sleep(100);
  }
  throw new Error('anirss 未在预期时间内启动');
}

async function main() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  seedItems();
  const qbServer = await startQbMock();
  const rssServer = await startRssMock();
  const proxyServer = await startProxyMock();

  const logPath = path.join(DATA_DIR, 'stdout.log');
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(NODE, [SERVER], {
    cwd: ROOT,
    env: { ...process.env, ANIRSS_DATA: DATA_DIR, ANIRSS_PORT: String(APP_PORT), ANIRSS_HOST: '127.0.0.1' },
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });

  const cleanup = async () => {
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    await sleep(300);
    try { qbServer.close(); } catch { /* ignore */ }
    try { rssServer.close(); } catch { /* ignore */ }
    try { proxyServer.close(); } catch { /* ignore */ }
    try { fs.closeSync(logFd); } catch { /* ignore */ }
  };

  try {
    await waitHealth();

    let state = await api('/api/state');
    assert.strictEqual(state.bases.length, 1, '应有一个默认 Mikan 站点');
    assert.ok(state.bases[0].url.includes('mikanime.tv'));
    console.log('✓ 初始状态 / 默认站点');

    const test = await api('/api/qb/test', {
      method: 'POST',
      body: { baseUrl: QB, username: 'admin', password: 'secret', skipTlsVerify: false },
    });
    assert.strictEqual(test.ok, true);
    assert.strictEqual(test.version, 'v5.0.2');
    assert.strictEqual(test.defaultSavePath, '/downloads/default');
    console.log('✓ qBittorrent 连接测试');

    await api('/api/qb/config', {
      method: 'PUT',
      body: { baseUrl: QB, username: 'admin', password: 'secret', skipTlsVerify: false },
    });
    state = await api('/api/state');
    assert.strictEqual(state.qb.hasPassword, true);
    assert.strictEqual(state.qb.baseUrl, QB);
    console.log('✓ qBittorrent 配置保存 / 密码不明文回传');

    const pathRes = await api('/api/paths', {
      method: 'POST',
      body: { name: '番剧', path: '/downloads/anime', isDefault: true },
    });
    const pathId = pathRes.path.id;
    assert.strictEqual(pathRes.path.isDefault, true);
    console.log('✓ 存储路径预设');

    const baseRes = await api('/api/bases', {
      method: 'POST',
      body: { name: 'Mock 站点', url: `http://127.0.0.1:${RSS_PORT}`, note: '本地烟测' },
    });
    const mockBaseId = baseRes.base.id;
    assert.strictEqual(baseRes.base.url, `http://127.0.0.1:${RSS_PORT}`);

    const preview = await api('/api/preview', {
      method: 'POST',
      body: {
        baseId: mockBaseId,
        path: '/feed',
        include: '1080p',
        exclude: '合集',
        ignoreCase: true,
      },
    });
    assert.strictEqual(preview.total, 5);
    assert.strictEqual(preview.matched, 3);
    assert.strictEqual(preview.url, `http://127.0.0.1:${RSS_PORT}/feed`);
    console.log('✓ 基础地址 + 路径拼接 / 正则预览');

    const created = await api('/api/subs', {
      method: 'POST',
      body: {
        name: '测试番剧',
        baseId: mockBaseId,
        path: '/feed',
        include: '1080p',
        exclude: '合集',
        ignoreCase: true,
        savePath: '/downloads/anime',
        category: 'anime',
        tags: 'rss,test',
        intervalMin: 10,
        maxPerCheck: 5,
        enabled: true,
        downloadExisting: true,
      },
    });
    const subId = created.sub.id;
    assert.strictEqual(created.check.downloaded, 3, '初始应下载 3 个匹配条目');
    assert.strictEqual(qbAdds.length, 3, 'qB 应收到 3 个种子');
    assert.strictEqual(qbAdds[0].savePath, '/downloads/anime');
    assert.strictEqual(qbAdds[0].hasFile, true, '应优先上传种子文件');
    console.log('✓ 新增追番 / 下载现有匹配 / 保存路径 / 种子文件上传');

    let check = await api(`/api/subs/${subId}/check`, { method: 'POST', body: {} });
    assert.strictEqual(check.newCount, 0);
    assert.strictEqual(check.downloaded, 0);
    assert.strictEqual(qbAdds.length, 3);
    console.log('✓ 去重：重复检查不会重复下载');

    rssItems.push({ id: 6, title: '[Sub] Test Anime - 05 [1080p][简日]', at: Date.now() });
    check = await api(`/api/subs/${subId}/check`, { method: 'POST', body: {} });
    assert.strictEqual(check.newCount, 1);
    assert.strictEqual(check.downloaded, 1);
    assert.strictEqual(qbAdds.length, 4);
    console.log('✓ 自动发现新增条目');

    rssItems.push({ id: 7, title: '[Sub] Test Anime - 06 [1080p][合集]', at: Date.now() });
    check = await api(`/api/subs/${subId}/check`, { method: 'POST', body: {} });
    assert.strictEqual(check.newCount, 1);
    assert.strictEqual(check.downloaded, 0);
    const item7 = check.items.find((it) => it.title.includes('06'));
    assert.ok(item7 && !item7.matched && item7.reason === 'exclude', '合集应被排除规则过滤');
    assert.strictEqual(qbAdds.length, 4);
    console.log('✓ 排除规则生效');

    const created2 = await api('/api/subs', {
      method: 'POST',
      body: {
        name: '重复追番',
        baseId: mockBaseId,
        path: '/feed',
        include: '1080p',
        exclude: '合集',
        savePath: '/downloads/anime',
        downloadExisting: true,
      },
    });
    assert.strictEqual(qbAdds.length, 4, '跨追番相同种子地址不应重复提交');
    assert.ok(created2.check.downloaded >= 1);
    console.log('✓ 跨追番重复地址去重');

    const stateBefore = await api('/api/state');
    const subBefore = stateBefore.subs.find((s) => s.id === subId);
    const seenBefore = subBefore.seenCount;
    const previewSub = await api(`/api/subs/${subId}/preview`, { method: 'POST', body: {} });
    assert.strictEqual(previewSub.total, 7);
    const stateAfterPreview = await api('/api/state');
    assert.strictEqual(stateAfterPreview.subs.find((s) => s.id === subId).seenCount, seenBefore);
    console.log('✓ 预览不会标记已见');

    rssItems.push({ id: 8, title: '[Sub] Test Anime - 07 [1080p][简日]', at: Date.now() });
    qbMode = 'down';
    await expectError(
      () => api(`/api/subs/${subId}/check`, { method: 'POST', body: {} }),
      502,
      'qBittorrent 不可用'
    );
    const stateDown = await api('/api/state');
    assert.strictEqual(stateDown.subs.find((s) => s.id === subId).seenCount, seenBefore, 'qB 不可用时不应吞掉新条目');
    qbMode = 'ok';
    check = await api(`/api/subs/${subId}/check`, { method: 'POST', body: {} });
    assert.strictEqual(check.downloaded, 1);
    assert.strictEqual(qbAdds.length, 5);
    console.log('✓ qB 不可用时不标记已见，恢复后自动补下');

    rssItems.push({ id: 9, title: '[Sub] Test Anime - 08 [1080p][简日]', at: Date.now() });
    qbMode = 'fail';
    check = await api(`/api/subs/${subId}/check`, { method: 'POST', body: {} });
    assert.strictEqual(check.downloaded, 0);
    assert.strictEqual(check.failed, 1);
    qbMode = 'ok';
    const downloads = (await api('/api/state')).downloads;
    const failedRec = downloads.find((d) => d.status === 'failed' && d.title.includes('08'));
    assert.ok(failedRec, '应有失败记录');
    const retried = await api(`/api/downloads/${failedRec.id}/retry`, { method: 'POST', body: {} });
    assert.strictEqual(retried.record.status, 'ok');
    console.log('✓ 失败记录与手动重试');

    // qB 中已经存在同 infohash：应标记为 duplicate，而不是 failed
    rssItems.push({ id: 10, title: '[Sub] Test Anime - 09 [1080p][简日]', at: Date.now() });
    const knownInfo = parseTorrentInfo(torrentFor(10));
    assert.ok(knownInfo && knownInfo.hash);
    knownHashes.add(knownInfo.hash);
    const addsBeforeDuplicate = qbAdds.length;
    check = await api(`/api/subs/${subId}/check`, { method: 'POST', body: {} });
    assert.strictEqual(check.downloaded, 1);
    assert.strictEqual(qbAdds.length, addsBeforeDuplicate, '重复种子不应再次提交到 qB');
    const dupRec = (await api('/api/state')).downloads.find((d) => d.title.includes('09') && d.status === 'duplicate');
    assert.ok(dupRec, '重复种子应记录为 duplicate');
    assert.ok(dupRec.error.includes('已存在相同种子'), dupRec.error);
    console.log('✓ 已存在于 qB 的种子识别为重复，不再误报失败');

    // qB 拒绝 .torrent 文件上传时，应自动改用 URL 再提交一次
    rssItems.push({ id: 11, title: '[Sub] Test Anime - 10 [1080p][简日]', at: Date.now() });
    qbMode = 'reject-file';
    const addsBeforeFallback = qbAdds.length;
    check = await api(`/api/subs/${subId}/check`, { method: 'POST', body: {} });
    qbMode = 'ok';
    assert.strictEqual(check.downloaded, 1);
    assert.strictEqual(qbAdds.length, addsBeforeFallback + 1);
    assert.strictEqual(qbAdds[qbAdds.length - 1].hasFile, false, '回退请求应使用 URL，而不是文件');
    const urlRec = (await api('/api/state')).downloads.find((d) => d.title.includes('10') && d.status === 'ok');
    assert.ok(urlRec, 'URL 回退应成功写入记录');
    assert.strictEqual(urlRec.mode, 'url');
    console.log('✓ qB 拒绝 .torrent 文件时自动改用 URL 重试');

    // 一键补下当前已存在的匹配条目（会重置已见后立即检查）
    const existing = await api(`/api/subs/${subId}/download-existing`, { method: 'POST', body: {} });
    assert.ok(existing.downloaded >= 1, '补下现有应至少处理一条');
    console.log('✓ 补下现有匹配');

    // 清空已见 + 旧下载记录不再去重：模拟用户在 qB 里删掉任务后要重新下载
    const resetRes = await api(`/api/subs/${subId}/reset`, { method: 'POST', body: {} });
    assert.ok(resetRes.sub.clearedRecords >= 1, JSON.stringify(resetRes.sub));
    const addsBeforeRedownload = qbAdds.length;
    check = await api(`/api/subs/${subId}/check`, { method: 'POST', body: {} });
    assert.ok(check.downloaded >= 1, JSON.stringify(check));
    assert.ok(qbAdds.length > addsBeforeRedownload, '清空已见后应能重新提交历史条目');
    console.log('✓ 清空已见后旧记录不再拦下载');

    // 单条「重新下载」：忽略本应用的下载记录，强制再提交一次
    const stateForForce = await api('/api/state');
    const forceTarget = stateForForce.downloads.find((d) => d.status === 'ok' && d.itemKey);
    assert.ok(forceTarget, '应有一条成功记录可用于强制重下');
    const forceRes = await api(`/api/subs/${subId}/download`, {
      method: 'POST',
      body: { key: forceTarget.itemKey, force: true },
    });
    assert.strictEqual(forceRes.record.status, 'ok', JSON.stringify(forceRes.record));
    console.log('✓ 单条强制重新下载');

    // 下载记录页的「允许重下」
    const allowTarget = (await api('/api/state')).downloads.find((d) => d.status === 'ok' && d.dedupe !== false);
    if (allowTarget) {
      const allowRes = await api(`/api/downloads/${allowTarget.id}/allow-redownload`, { method: 'POST', body: {} });
      assert.strictEqual(allowRes.ok, true);
      const after = (await api('/api/state')).downloads.find((d) => d.id === allowTarget.id);
      assert.strictEqual(after.dedupe, false);
      console.log('✓ 下载记录标记为允许重下');
    }

    await expectError(
      () => api('/api/preview', { method: 'POST', body: { url: `http://127.0.0.1:${RSS_PORT}/feed`, include: '[' } }),
      400,
      '正则'
    );
    console.log('✓ 非法正则被拒绝');

    await expectError(
      () => api(`/api/bases/${mockBaseId}`, { method: 'DELETE' }),
      409,
      '正在使用'
    );
    console.log('✓ 使用中的站点不可删除');

    const status = await api('/api/qb/status');
    assert.strictEqual(status.ok, true);
    assert.strictEqual(status.active.length, 1);
    console.log('✓ qBittorrent 状态/活动任务');

    // 番组主页 / 封面 / bgm.tv 链接
    const resolved = await api('/api/resolve', {
      method: 'POST',
      body: { url: `http://127.0.0.1:${RSS_PORT}/RSS/Bangumi?bangumiId=4059` },
    });
    assert.strictEqual(resolved.name, 'FX战士久留美');
    assert.ok(resolved.meta && resolved.meta.bgmUrl.includes('bgm.tv/subject/622288'), JSON.stringify(resolved.meta));
    const metaRes = await api('/api/subs', {
      method: 'POST',
      body: {
        url: `http://127.0.0.1:${RSS_PORT}/RSS/Bangumi?bangumiId=4059`,
        downloadExisting: false,
      },
    });
    const metaSub = metaRes.sub;
    assert.strictEqual(metaSub.name, 'FX战士久留美', '未填名称时应从追番地址自动获取');
    assert.ok(metaSub.meta.homeUrl.includes('/Home/Bangumi/4059'), JSON.stringify(metaSub.meta));
    assert.ok(metaSub.meta.bgmUrl.includes('bgm.tv/subject/622288'), JSON.stringify(metaSub.meta));
    assert.ok(metaSub.meta.title.includes('FX战士久留美'), JSON.stringify(metaSub.meta));
    const coverRes = await fetch(`${APP}/api/cover/${metaSub.id}`);
    assert.strictEqual(coverRes.status, 200);
    assert.ok((coverRes.headers.get('content-type') || '').startsWith('image/'));
    assert.ok((await coverRes.arrayBuffer()).byteLength > 0);
    await api(`/api/subs/${metaSub.id}`, { method: 'DELETE' });
    console.log('✓ 番组主页封面 / bgm.tv 链接');

    // 网络代理保存与测试
    await api('/api/proxy', {
      method: 'PUT',
      body: { enabled: true, type: 'http', host: '127.0.0.1', port: PROXY_PORT, noProxy: '' },
    });
    const proxyState = await api('/api/state');
    assert.strictEqual(proxyState.proxy.enabled, true);
    assert.strictEqual(proxyState.proxy.hasPassword, false);
    const proxyTest = await api('/api/proxy/test', {
      method: 'POST',
      body: { url: `http://127.0.0.1:${RSS_PORT}/feed` },
    });
    if (!proxyTest.ok) console.error('proxyTest debug:', JSON.stringify(proxyTest));
    assert.strictEqual(proxyTest.ok, true, String(proxyTest.error || ''));    assert.ok(proxyHits > 0, '代理服务器应收到请求');
    await api('/api/proxy', {
      method: 'PUT',
      body: { enabled: false, type: 'http', host: '', port: 0, noProxy: '' },
    });
    console.log('✓ 网络代理保存 / 测试');

    // 搜索番剧：番剧 + 发布组
    const found = await api(`/api/search?q=${encodeURIComponent('久留美')}&baseId=${mockBaseId}`);
    assert.strictEqual(found.results.length, 1, JSON.stringify(found));
    const hit = found.results[0];
    assert.strictEqual(hit.bangumiId, '4059');
    assert.ok(hit.title.includes('FX战士久留美'), hit.title);
    const groupNames = hit.subgroups.map((s) => s.name);
    assert.ok(groupNames.includes('字幕组A') && groupNames.includes('字幕组B'), JSON.stringify(groupNames));
    const hitSub = hit.subgroups.find((s) => s.id === '203');
    assert.ok(hitSub && hitSub.matched >= 1 && hitSub.rssUrl.includes('subgroupid=203'), JSON.stringify(hitSub));
    assert.strictEqual(hitSub.episodeCount, 3, '应按番组主页统计真实集数，而不是搜索样本数');
    assert.strictEqual(hitSub.episodeText, '1-3', hitSub.episodeText);
    const hitSubB = hit.subgroups.find((s) => s.id === '71');
    assert.strictEqual(hitSubB.episodeCount, 2, JSON.stringify(hitSubB));
    console.log('✓ 站点搜索：番剧 + 发布组 + 真实集数');

    // 集数识别工具
    const guessed = await api('/api/guess-episode', {
      method: 'POST',
      body: { text: '[LoliHouse] 某番剧 - 07 [WebRip 1080p HEVC-10bit AAC]\n某番剧 第12集 [1080p]\n[Sub] 某番剧 [01-12合集][1080p]' },
    });
    assert.strictEqual(guessed.results[0].episode, 7);
    assert.strictEqual(guessed.results[1].episode, 12);
    assert.strictEqual(guessed.results[2].kind, 'range');
    assert.strictEqual(guessed.results[2].to, 12);
    console.log('✓ 集数识别工具');

    // 搜索结果封面走同源代理
    const imgRes = await fetch(`${APP}/api/image?url=${encodeURIComponent(`http://127.0.0.1:${RSS_PORT}/cover.jpg`)}`);
    assert.strictEqual(imgRes.status, 200);
    assert.ok((imgRes.headers.get('content-type') || '').startsWith('image/'));
    console.log('✓ 搜索结果封面同源代理');

    // 补番：磁力链接 + 状态刷新
    const magnetHash = 'c'.repeat(40);
    const magnetUri = `magnet:?xt=urn:btih:${magnetHash}&dn=Extra+Test+01`;
    const extraAddsBefore = qbAdds.length;
    const extraRes = await api('/api/extras', {
      method: 'POST',
      body: { magnet: magnetUri, savePath: '/downloads/anime', category: 'anime', tags: 'extra' },
    });
    assert.strictEqual(extraRes.extra.hash, magnetHash);
    assert.strictEqual(extraRes.extra.source, 'magnet');
    assert.strictEqual(extraRes.extra.name, 'Extra Test 01');
    assert.strictEqual(extraRes.extra.episodeLabel, '第 1 集');
    assert.strictEqual(qbAdds.length, extraAddsBefore + 1, '补番应提交到 qB');
    qbTorrents.set(magnetHash, {
      name: 'Extra Test 01', size: 1000, progress: 0.25, dlspeed: 100, upspeed: 0,
      state: 'downloading', eta: 60, save_path: '/downloads/anime',
    });
    const extraStatus = await api('/api/extras/status', { method: 'POST', body: {} });
    const extraRec = extraStatus.extras.find((x) => x.hash === magnetHash);
    assert.ok(extraRec && extraRec.qb, JSON.stringify(extraStatus.extras));
    assert.strictEqual(extraRec.qb.progress, 0.25);
    assert.strictEqual(extraRec.qb.state, 'downloading');
    console.log('✓ 补番：磁力链接提交 / 状态刷新');

    // 补番：种子文件（base64 上传）
    const fileBuf = torrentFor(99);
    const fileRes = await api('/api/extras/upload', {
      method: 'POST',
      body: { fileBase64: fileBuf.toString('base64'), fileName: 'extra-99.torrent', savePath: '/downloads/anime' },
    });
    assert.strictEqual(fileRes.extra.source, 'file');
    assert.ok(/^[a-f0-9]{40}$/.test(fileRes.extra.hash), fileRes.extra.hash);
    console.log('✓ 补番：种子文件上传');

    // 重复补番应被拒绝
    await expectError(
      () => api('/api/extras', { method: 'POST', body: { magnet: magnetUri } }),
      409,
      '已在补番记录'
    );
    knownHashes.add('d'.repeat(40));
    await expectError(
      () => api('/api/extras', { method: 'POST', body: { magnet: `magnet:?xt=urn:btih:${'d'.repeat(40)}&dn=Dup` } }),
      409,
      '已存在相同种子'
    );
    console.log('✓ 补番：重复种子识别');

    // 补番：下载完成后自动挑正片 + 字幕，平铺到季目录
    const hlHash = 'e'.repeat(40);
    const dlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'anirss-smoke-dl-'));
    const linkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'anirss-smoke-hl-'));
    const showDir = path.join(dlRoot, 'Show');
    fs.mkdirSync(path.join(showDir, 'subs'), { recursive: true });
    fs.mkdirSync(path.join(showDir, 'CDs'), { recursive: true });
    fs.mkdirSync(path.join(showDir, 'Scans'), { recursive: true });
    fs.writeFileSync(path.join(showDir, '[G] Show [01][1080p].mkv'), Buffer.alloc(2048, 7));
    fs.writeFileSync(path.join(showDir, '[G] Show [01][1080p].ass'), 'ass1');
    fs.writeFileSync(path.join(showDir, '[G] Show [02][1080p].mkv'), Buffer.alloc(1024, 8));
    fs.writeFileSync(path.join(showDir, 'subs', '[G] Show [02].ass'), 'ass2');
    fs.writeFileSync(path.join(showDir, '[G] Show [NCOP][1080p].mkv'), 'ncop');
    fs.writeFileSync(path.join(showDir, 'CDs', '01.flac'), 'flac');
    fs.writeFileSync(path.join(showDir, 'Scans', '01.webp'), 'webp');
    const destTpl = path.join(linkRoot, '${name}', 'Season ${season}');
    const hlAdd = await api('/api/extras', {
      method: 'POST',
      body: {
        magnet: `magnet:?xt=urn:btih:${hlHash}&dn=Hardlink+Test`,
        name: 'Hardlink Test',
        savePath: dlRoot,
        hardlinkDest: destTpl,
        season: 1,
      },
    });
    const hlRec = hlAdd.extra;
    assert.strictEqual(hlRec.hardlink.dest, destTpl);
    assert.strictEqual(hlRec.hardlink.season, 1);
    assert.ok(/Hardlink Test[\\/]Season 1$/.test(hlRec.hardlink.destResolved), hlRec.hardlink.destResolved);
    qbTorrents.set(hlHash, {
      name: 'Hardlink Test', size: 4096, progress: 1, dlspeed: 0, upspeed: 0,
      state: 'stalledUP', eta: 0, save_path: dlRoot,
    });
    qbFiles.set(hlHash, [
      { name: 'Show/[G] Show [01][1080p].mkv', size: 2048, progress: 1, priority: 1 },
      { name: 'Show/[G] Show [01][1080p].ass', size: 4, progress: 1, priority: 1 },
      { name: 'Show/[G] Show [02][1080p].mkv', size: 1024, progress: 1, priority: 1 },
      { name: 'Show/subs/[G] Show [02].ass', size: 4, progress: 1, priority: 1 },
      { name: 'Show/[G] Show [NCOP][1080p].mkv', size: 4, progress: 1, priority: 1 },
      { name: 'Show/CDs/01.flac', size: 4, progress: 1, priority: 1 },
      { name: 'Show/Scans/01.webp', size: 4, progress: 1, priority: 1 },
      { name: 'Show/[G] Show [03][1080p].mkv', size: 100, progress: 0.4, priority: 1 },
    ]);
    const hlStatus = await api('/api/extras/status', { method: 'POST', body: {} });
    const hlDone = hlStatus.extras.find((x) => x.hash === hlHash);
    assert.ok(hlDone && hlDone.hardlink && hlDone.hardlink.done, JSON.stringify(hlDone && hlDone.hardlink));
    const seasonDir = path.join(linkRoot, 'Hardlink Test', 'Season 1');
    assert.strictEqual(hlDone.hardlink.videos, 2);
    assert.strictEqual(hlDone.hardlink.subs, 2);
    assert.strictEqual(hlDone.hardlink.linked, 4);
    assert.ok(fs.existsSync(path.join(seasonDir, '[G] Show [01][1080p].mkv')), '正片应平铺到季目录');
    assert.ok(fs.existsSync(path.join(seasonDir, '[G] Show [01][1080p].ass')), '同名字幕应一起链接');
    assert.ok(fs.existsSync(path.join(seasonDir, '[G] Show [02].ass')), 'subs/ 里的同集字幕应匹配');
    assert.ok(!fs.existsSync(path.join(seasonDir, '01.flac')), 'CDs 应被排除');
    assert.ok(!fs.existsSync(path.join(seasonDir, '[G] Show [NCOP][1080p].mkv')), 'NCOP 应被排除');
    assert.ok(!fs.existsSync(path.join(seasonDir, '[G] Show [03][1080p].mkv')), '未下载完的文件不应链接');
    assert.strictEqual(fs.statSync(path.join(showDir, '[G] Show [01][1080p].mkv')).nlink, 2, '源文件应保持做种');
    console.log('✓ 补番：自动挑正片 + 字幕到季目录');

    // 手动再跑一次：识别为已存在，不重复创建
    const hlAgain = await api(`/api/extras/${hlRec.id}/hardlink`, { method: 'POST', body: {} });
    assert.strictEqual(hlAgain.ok, true, JSON.stringify(hlAgain));
    assert.strictEqual(hlAgain.result.linked, 0);
    assert.strictEqual(hlAgain.result.existed, 4);
    console.log('✓ 补番：硬链接幂等');

    // 集数偏移 + 重命名：视频 01/02 → 13/14，字幕按目标集数配对
    const renamedRoot = path.join(linkRoot, 'renamed');
    const renamed = await api(`/api/extras/${hlRec.id}/hardlink`, {
      method: 'PUT',
      body: { dest: renamedRoot, rename: true, videoOffset: 12, subOffset: 12 },
    });
    assert.strictEqual(renamed.extra.hardlink.rename, true, JSON.stringify(renamed.extra.hardlink));
    assert.strictEqual(renamed.extra.hardlink.videoOffset, 12);
    assert.strictEqual(renamed.extra.hardlink.subOffset, 12);
    const renamedRun = await api(`/api/extras/${hlRec.id}/hardlink`, { method: 'POST', body: {} });
    assert.strictEqual(renamedRun.ok, true, JSON.stringify(renamedRun));
    assert.ok(fs.existsSync(path.join(renamedRoot, 'Hardlink Test - 13.mkv')), '视频应重命名为 13');
    assert.ok(fs.existsSync(path.join(renamedRoot, 'Hardlink Test - 13.ass')), '同名字幕应跟随 13');
    assert.ok(fs.existsSync(path.join(renamedRoot, 'Hardlink Test - 14.ass')), 'subs/ 里的 02 集字幕应配对到 14');
    console.log('✓ 补番：集数偏移 + 重命名');

    // 外挂字幕库：上传 zip（含目录层级）→ 自动解压入库 → 自动重新硬链接
    const subsZip = buildZip([
      { name: 'chs/02.ass', data: 'chs subtitle', utf8Name: true },
      { name: 'cht/02.ass', data: 'cht subtitle', utf8Name: true },
      { name: 'readme.txt', data: '不是字幕', utf8Name: true },
    ]);
    const subsUp = await api(`/api/extras/${hlRec.id}/subs/upload`, {
      method: 'POST',
      body: { files: [{ name: 'subs.zip', data: subsZip.toString('base64') }] },
    });
    assert.strictEqual(subsUp.ok, true, JSON.stringify(subsUp));
    assert.strictEqual(subsUp.added.length, 2, JSON.stringify(subsUp));
    assert.deepStrictEqual(subsUp.added.map((s) => s.name), ['chs/02.ass', 'cht/02.ass'], JSON.stringify(subsUp));
    assert.ok(subsUp.skipped.some((s) => s.name === 'readme.txt'), '非字幕文件应被跳过');
    assert.ok(subsUp.link && (subsUp.link.linked + subsUp.link.copied) >= 2, JSON.stringify(subsUp.link));
    // 同集字幕总数变多后，种子自带字幕也会改用带序号的新名字（sub1），外挂的两份是 sub2/sub3
    assert.ok(fs.existsSync(path.join(renamedRoot, 'Hardlink Test - 14.sub1.ass')), '种子字幕随同集多份改为序号命名');
    assert.ok(fs.existsSync(path.join(renamedRoot, 'Hardlink Test - 14.sub2.ass')), '外挂字幕应按目标集数配对并加语言序号');
    assert.ok(fs.existsSync(path.join(renamedRoot, 'Hardlink Test - 14.sub3.ass')), '第二份字幕应有独立命名');
    assert.ok(fs.existsSync(path.join(DATA_DIR, 'subtitles', hlRec.id, 'chs', '02.ass')), '字幕应保留压缩包目录层级入库');
    console.log('✓ 补番：字幕 zip 上传自动解压并重新硬链接');

    // 从链接抓取单个字幕文件
    const subsFetch = await api(`/api/extras/${hlRec.id}/subs/fetch`, {
      method: 'POST',
      body: { url: `http://127.0.0.1:${RSS_PORT}/subs/dl/02.ass` },
    });
    assert.strictEqual(subsFetch.ok, true, JSON.stringify(subsFetch));
    assert.strictEqual(subsFetch.added.length, 1, JSON.stringify(subsFetch));
    assert.ok(fs.existsSync(path.join(renamedRoot, 'Hardlink Test - 14.sub4.ass')), 'URL 字幕应入库并链接');
    console.log('✓ 补番：从链接抓取字幕');

    // 删除单个 / 清空字幕库
    const rmOne = await api(`/api/extras/${hlRec.id}/subs?name=${encodeURIComponent('chs/02.ass')}`, { method: 'DELETE' });
    assert.strictEqual(rmOne.ok, true, JSON.stringify(rmOne));
    assert.ok(!fs.existsSync(path.join(DATA_DIR, 'subtitles', hlRec.id, 'chs', '02.ass')), '删除后源文件应消失');
    const stateAfterRm = await api('/api/extras/status', { method: 'POST', body: {} });
    const recAfterRm = stateAfterRm.extras.find((x) => x.hash === hlHash);
    assert.strictEqual(recAfterRm.subs.length, 2, JSON.stringify(recAfterRm.subs));
    const rmAll = await api(`/api/extras/${hlRec.id}/subs?all=1`, { method: 'DELETE' });
    assert.strictEqual(rmAll.ok, true, JSON.stringify(rmAll));
    const stateAfterAll = await api('/api/extras/status', { method: 'POST', body: {} });
    assert.strictEqual(stateAfterAll.extras.find((x) => x.hash === hlHash).subs.length, 0);
    console.log('✓ 补番：字幕库删除 / 清空');

    // 本次不硬链接：手动触发也会被拒绝，目标模板保留
    const disabled = await api(`/api/extras/${hlRec.id}/hardlink`, { method: 'PUT', body: { enabled: false } });
    assert.strictEqual(disabled.extra.hardlink.enabled, false);
    await expectError(
      () => api(`/api/extras/${hlRec.id}/hardlink`, { method: 'POST', body: {} }),
      400,
      '已关闭'
    );
    const reenabled = await api(`/api/extras/${hlRec.id}/hardlink`, {
      method: 'PUT',
      body: { enabled: true, rename: false, videoOffset: 0, subOffset: 0 },
    });
    assert.strictEqual(reenabled.extra.hardlink.enabled, true);
    assert.strictEqual(reenabled.extra.hardlink.rename, false);
    console.log('✓ 补番：本次是否硬链接开关');

    // 修改目标模板与季：旧目录里的链接保留，新目录由手动/巡检补齐
    const movedRoot = path.join(linkRoot, 'moved');
    const moved = await api(`/api/extras/${hlRec.id}/hardlink`, {
      method: 'PUT',
      body: { dest: path.join(movedRoot, '${name}', 'Season ${season}'), season: 2 },
    });
    assert.strictEqual(moved.extra.hardlink.season, 2);
    assert.strictEqual(moved.extra.hardlink.done, false);
    assert.ok(/Hardlink Test[\\/]Season 2$/.test(moved.extra.hardlink.destResolved), moved.extra.hardlink.destResolved);
    const movedRun = await api(`/api/extras/${hlRec.id}/hardlink`, { method: 'POST', body: {} });
    assert.strictEqual(movedRun.ok, true, JSON.stringify(movedRun));
    assert.strictEqual(movedRun.result.linked, 4);
    assert.ok(fs.existsSync(path.join(movedRoot, 'Hardlink Test', 'Season 2', '[G] Show [01][1080p].mkv')));
    assert.ok(fs.existsSync(path.join(seasonDir, '[G] Show [01][1080p].mkv')), '旧目录里的硬链接应保留');
    console.log('✓ 补番：修改目标/季后重新链接');

    // 设置：模式、扩展名、排除规则、默认模板
    const hlCfg = await api('/api/hardlink', {
      method: 'PUT',
      body: {
        mode: 'season', videoExts: 'mkv', subExts: 'ass', excludeDirs: 'cds,scans,sp',
        excludeTags: 'ncop,sp', includeFonts: false, stripRoot: false, defaultDest: destTpl,
      },
    });
    assert.strictEqual(hlCfg.hardlink.mode, 'season');
    assert.strictEqual(hlCfg.hardlink.videoExts, 'mkv');
    assert.strictEqual(hlCfg.hardlink.subExts, 'ass');
    assert.strictEqual(hlCfg.hardlink.defaultDest, destTpl);
    const stateHl = (await api('/api/state')).hardlink;
    assert.strictEqual(stateHl.excludeTags, 'ncop,sp');
    await expectError(
      () => api('/api/hardlink', { method: 'PUT', body: { defaultDest: 'relative/path' } }),
      400,
      '绝对路径'
    );
    console.log('✓ 补番：硬链接设置保存 / 校验');

    // 目录权限检查：用于解释「无法创建目标目录」
    const probe = await api(`/api/hardlink/probe?path=${encodeURIComponent(dlRoot)}`);
    assert.strictEqual(probe.probe.exists, true, JSON.stringify(probe));
    assert.strictEqual(probe.probe.writable, true, JSON.stringify(probe));
    await expectError(() => api('/api/hardlink/probe?path=relative/path'), 400, '绝对路径');
    console.log('✓ 补番：目录权限检查');

    // 镜像模式：全部匹配文件 + 去掉种子顶层目录
    const mirrorDest = path.join(linkRoot, 'mirror');
    const mirrorCfg = await api('/api/hardlink', { method: 'PUT', body: { mode: 'mirror', stripRoot: true } });
    assert.strictEqual(mirrorCfg.hardlink.mode, 'mirror');
    await api(`/api/extras/${hlRec.id}/hardlink`, { method: 'PUT', body: { dest: mirrorDest } });
    const mirrorRun = await api(`/api/extras/${hlRec.id}/hardlink`, { method: 'POST', body: {} });
    assert.strictEqual(mirrorRun.ok, true, JSON.stringify(mirrorRun));
    assert.strictEqual(mirrorRun.result.linked, 3);
    assert.ok(fs.existsSync(path.join(mirrorDest, '[G] Show [01][1080p].mkv')), 'stripRoot 后应去掉 Show/ 这一层');
    assert.ok(fs.existsSync(path.join(mirrorDest, '[G] Show [NCOP][1080p].mkv')), '镜像模式不排除 NCOP');
    console.log('✓ 补番：镜像模式 / 去掉种子顶层目录');

    // 没有设置硬链接目录时手动触发应报错
    await expectError(
      () => api(`/api/extras/${extraRec.id}/hardlink`, { method: 'POST', body: {} }),
      400,
      '没有设置硬链接目录'
    );
    fs.rmSync(dlRoot, { recursive: true, force: true });
    fs.rmSync(linkRoot, { recursive: true, force: true });
    console.log('✓ 补番：未设置目标目录时拒绝执行');

    // 删除补番记录 / 删除 qB 任务
    const delRes = await api(`/api/extras/${extraRec.id}`, { method: 'DELETE' });
    assert.strictEqual(delRes.ok, true);
    const fileRec = (await api('/api/extras')).extras.find((x) => x.source === 'file' && x.ok);
    assert.ok(fileRec, '应有种子文件补番记录');
    await api(`/api/extras/${fileRec.id}?deleteTorrent=1&deleteFiles=1`, { method: 'DELETE' });
    assert.ok(qbDeletes.length >= 1, '应调用 qB 删除接口');
    assert.strictEqual(qbDeletes[qbDeletes.length - 1].deleteFiles, true);
    console.log('✓ 补番：删除记录 / 删除任务');

    const exported = await fetch(APP + '/api/export');
    assert.strictEqual(exported.status, 200);
    const exp = await exported.json();
    assert.ok(exp.subs.length >= 2);
    assert.strictEqual(exp.qb.password, undefined);
    console.log('✓ 配置导出不含密码');

    const finalState = await api('/api/state');
    const stats = finalState.stats;
    assert.strictEqual(stats.subs, 2);
    assert.ok(stats.downloadsTotal >= 4);
    console.log(`✓ 统计：追番 ${stats.subs}，下载成功 ${stats.downloadsTotal}，失败 ${stats.failed}`);

    // 健康检查标识与导入配置（放在统计之后，因为导入是覆盖式的）
    const health = await api('/api/health');
    assert.strictEqual(health.app, 'anirss');
    const pwBefore = (await api('/api/state')).qb.hasPassword;
    const imported = await api('/api/import', {
      method: 'POST',
      body: {
        app: 'anirss',
        bases: [{ id: 'b_imported', name: '导入站点', url: 'https://example.test', note: '' }],
        paths: [{ id: 'p_imported', name: '导入路径', template: '/imported/${name}' }],
        subs: [{
          id: 's_imported',
          name: '导入追番',
          url: 'https://example.test/RSS/Bangumi?bangumiId=1',
          include: '1080p',
          exclude: '',
          savePath: '/imported/导入追番',
          enabled: false,
          intervalMinutes: 30,
          maxPerCheck: 3,
          ignoreCase: true,
          needsSeed: true,
        }],
        extras: [],
        qb: { baseUrl: 'http://127.0.0.1:18080', username: 'admin', skipTlsVerify: false },
      },
    });
    assert.strictEqual(imported.totals.subs, 1);
    assert.strictEqual(imported.totals.bases, 1);
    assert.strictEqual(imported.totals.paths, 1);
    const afterImport = await api('/api/state');
    assert.strictEqual(afterImport.subs.length, 1, '导入是覆盖式的');
    assert.strictEqual(afterImport.subs[0].name, '导入追番');
    assert.strictEqual(afterImport.qb.hasPassword, pwBefore, '导入不应清掉本机 qB 密码');
    await expectError(() => api('/api/import', { method: 'POST', body: { hello: 1 } }), 400, '没有可导入的配置项');
    console.log('✓ 配置导入（覆盖式 / 保留密码 / 拒绝空文件）');

    console.log(`\n全部通过。qB 收到 ${qbAdds.length} 个种子，RSS 拉取 ${rssHits} 次。`);
  } finally {
    await cleanup();
  }
}

main().catch(async (e) => {
  console.error('\n烟测失败：', e && e.stack ? e.stack : e);
  try {
    const log = fs.readFileSync(path.join(DATA_DIR, 'stdout.log'), 'utf8');
    console.error('\n--- anirss log ---\n' + log.slice(-4000));
  } catch { /* ignore */ }
  process.exitCode = 1;
});
