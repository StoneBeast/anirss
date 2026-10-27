#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const urlmod = require('url');
const zlib = require('zlib');

const { Store } = require('./store');
const { Engine } = require('./engine');
const { destroyAll: destroyAgents } = require('./agents');
const {
  APP_NAME, APP_VERSION, uid, nowMs, httpError, badRequest,
  normalizeBaseUrl, composeUrl, parseBool, truncate,
} = require('./util');

const SERVER_DIR = __dirname;
const APP_DIR = path.resolve(SERVER_DIR, '..');
const WWW = path.join(APP_DIR, 'www');
// 环境变量统一用 ANIRSS_*；同时兼容旧的 QBRSS_*（1.7.0 之前的部署脚本）
const env = (name) => process.env['ANIRSS_' + name] || process.env['QBRSS_' + name] || '';
const SOCKET = env('SOCKET') ||
  (process.env.TRIM_APPDEST ? path.join(process.env.TRIM_APPDEST, 'app.sock') : '');
const IS_FNOS = !!(process.env.TRIM_APPDEST || process.env.TRIM_SERVICE_PORT);
const DATA_DIR = env('DATA') || process.env.TRIM_PKGVAR || path.join(APP_DIR, '..', 'data');
const PORT = env('PORT')
  ? Number(env('PORT'))
  : (Number(process.env.TRIM_SERVICE_PORT) || (SOCKET ? 0 : 8777));
const HOST = env('HOST') || (IS_FNOS ? '0.0.0.0' : '127.0.0.1');
const GATEWAY_PREFIX = '/app/' + (process.env.TRIM_APPNAME || APP_NAME);
const BODY_LIMIT = 2 * 1024 * 1024;

/** 1.7.0 起应用 id 由 qbrss 改为 anirss；首次启动时把旧目录的数据搬过来 */
function migrateLegacyData(dir) {
  if (fs.existsSync(path.join(dir, 'config.json'))) return;
  const candidates = [
    process.env.QBRSS_DATA || '',
    '/var/apps/qbrss/var',
    path.join(APP_DIR, '..', '..', 'qbrss', 'data'),
  ].filter(Boolean);
  for (const from of candidates) {
    try {
      if (!fs.existsSync(path.join(from, 'config.json'))) continue;
      fs.mkdirSync(dir, { recursive: true });
      fs.cpSync(from, dir, { recursive: true, force: false, errorOnExist: false });
      console.log(`[anirss] 已从旧数据目录迁移：${from} -> ${dir}`);
      return;
    } catch (e) {
      console.error(`[anirss] 迁移旧数据失败（${from}）：${e.message}`);
    }
  }
}

migrateLegacyData(DATA_DIR);

const store = new Store(path.join(DATA_DIR, 'config.json'));
const engine = new Engine(store);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

function baseHeaders(extra) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    ...(extra || {}),
  };
}

function sendJson(res, status, obj, extraHeaders) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, baseHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    ...(extraHeaders || {}),
  }));
  res.end(body);
}

function sendBuffer(res, status, buffer, type, extraHeaders) {
  res.writeHead(status, baseHeaders({
    'Content-Type': type || 'application/octet-stream',
    'Content-Length': buffer.length,
    ...(extraHeaders || {}),
  }));
  res.end(buffer);
}

function acceptsGzip(req) {
  return /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''));
}

// /api/state 的构建结果按 ETag 缓存：轮询窗口内数据没变就复用
// （字符串化 + gzip 只做一次），多标签页/多端同时轮询时共享
let stateCache = { etag: '', json: null, gz: null };

function stateCacheResponse(req, res, etag) {
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, Vary: 'Accept-Encoding' });
    return res.end();
  }
  if (stateCache.etag !== etag) {
    const json = Buffer.from(JSON.stringify(engine.state()), 'utf8');
    const gz = zlib.gzipSync(json, { level: 6 });
    stateCache = { etag, json, gz };
  }
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    ETag: etag,
    Vary: 'Accept-Encoding',
  };
  if (acceptsGzip(req)) {
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = stateCache.gz.length;
    res.writeHead(200, baseHeaders(headers));
    return res.end(stateCache.gz);
  }
  headers['Content-Length'] = stateCache.json.length;
  res.writeHead(200, baseHeaders(headers));
  return res.end(stateCache.json);
}

/** 大 JSON 响应（/api/state 等）：客户端支持时 gzip 传输，体积降到 1/5 左右 */
function sendJsonGz(req, res, status, obj, extraHeaders) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Accept-Encoding',
    ...(extraHeaders || {}),
  };
  if (acceptsGzip(req)) {
    const gz = zlib.gzipSync(body, { level: 6 });
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = gz.length;
    res.writeHead(status, baseHeaders(headers));
    return res.end(gz);
  }
  headers['Content-Length'] = body.length;
  res.writeHead(status, baseHeaders(headers));
  return res.end(body);
}

function readJson(req, limit) {
  const maxBytes = Number(limit) > 0 ? Number(limit) : BODY_LIMIT;
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) {
        done = true;
        reject(httpError(413, '请求体过大', 'BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      if (!chunks.length) return resolve({});
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!text.trim()) return resolve({});
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(badRequest('请求体必须是 JSON 对象', 'BAD_BODY'));
        }
        resolve(parsed);
      } catch {
        reject(badRequest('请求体不是有效的 JSON', 'BAD_BODY'));
      }
    });
    req.on('error', (e) => {
      if (!done) {
        done = true;
        reject(e);
      }
    });
  });
}

// 静态文件内存缓存：stat 校验 mtime/size 未变就直接复用，
// 文本资源额外预压缩一份 gzip；配合 ETag 让浏览器滚动更新时只走 304。
const STATIC_CACHE = new Map();
const GZIP_LEVEL = 6;

function staticEtag(st) {
  return 'W/"' + st.size.toString(36) + '-' + Math.round(st.mtimeMs).toString(36) + '"';
}

function isCompressibleType(type) {
  return /^(text\/|application\/(javascript|json))/.test(type) || type === 'image/svg+xml';
}

function respondStatic(req, res, cached) {
  const inm = req.headers['if-none-match'];
  if (inm && String(inm).split(/\s*,\s*/).includes(cached.etag)) {
    res.writeHead(304, { ETag: cached.etag, Vary: 'Accept-Encoding' });
    return res.end();
  }
  const canGzip = cached.gzip && acceptsGzip(req);
  const body = canGzip ? cached.gzip : cached.buf;
  res.writeHead(200, baseHeaders({
    'Content-Type': cached.contentType,
    'Content-Length': body.length,
    ETag: cached.etag,
    Vary: 'Accept-Encoding',
    'Cache-Control': cached.isHtml ? 'no-store' : 'no-cache',
    ...(canGzip ? { 'Content-Encoding': 'gzip' } : {}),
    ...(cached.isHtml ? { 'Content-Security-Policy': CSP } : {}),
  }));
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let rel = String(pathname || '/').replace(/^\/+/, '');
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  const full = path.resolve(WWW, rel);
  if (full !== WWW && !full.startsWith(WWW + path.sep)) {
    return sendJson(res, 404, { error: 'Not found' });
  }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) return sendJson(res, 404, { error: 'Not found' });
    const etag = staticEtag(st);
    const cached = STATIC_CACHE.get(rel);
    if (cached && cached.etag === etag) return respondStatic(req, res, cached);
    fs.readFile(full, (readErr, data) => {
      if (readErr) return sendJson(res, 500, { error: '读取静态文件失败' });
      const ext = path.extname(full).toLowerCase();
      const contentType = MIME[ext] || 'application/octet-stream';
      const entry = {
        etag,
        buf: data,
        contentType,
        isHtml: ext === '.html',
        gzip: isCompressibleType(contentType) ? zlib.gzipSync(data, { level: GZIP_LEVEL }) : null,
      };
      STATIC_CACHE.set(rel, entry);
      respondStatic(req, res, entry);
    });
  });
}

function normalizeBaseBody(body, existing) {
  const src = body || {};
  const name = String(src.name !== undefined ? src.name : existing ? existing.name : '').trim();
  const url = normalizeBaseUrl(src.url !== undefined ? src.url : existing ? existing.url : '');
  const note = String(src.note !== undefined ? src.note : existing ? existing.note : '').trim().slice(0, 300);
  if (!name) throw badRequest('请填写站点名称', 'EMPTY_BASE_NAME');
  if (name.length > 60) throw badRequest('站点名称不能超过 60 个字符', 'BASE_NAME_TOO_LONG');
  if (!url) throw badRequest('请填写站点基础地址', 'EMPTY_BASE_URL');
  return { name, url, note };
}

function normalizePathBody(body, existing) {
  const src = body || {};
  const name = String(src.name !== undefined ? src.name : existing ? existing.name : '').trim();
  const p = String(src.path !== undefined ? src.path : existing ? existing.path : '').trim().slice(0, 800);
  if (!name) throw badRequest('请填写路径名称', 'EMPTY_PATH_NAME');
  if (name.length > 60) throw badRequest('路径名称不能超过 60 个字符', 'PATH_NAME_TOO_LONG');
  if (!p) throw badRequest('请填写存储路径', 'EMPTY_SAVE_PATH');
  return { name, path: p, isDefault: src.isDefault !== undefined ? !!src.isDefault : !!(existing && existing.isDefault) };
}

async function handleApi(req, res, pathname, query) {
  const method = req.method || 'GET';

  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      app: APP_NAME,
      version: APP_VERSION,
      uptime: Math.round(process.uptime()),
      socket: !!SOCKET,
      port: PORT || null,
    });
  }

  if (pathname === '/api/state' && method === 'GET') {
    // 前端每 12 秒轮询：内容没变时用 ETag 返回 304，跳过全量重建、序列化与传输
    return stateCacheResponse(req, res, engine.stateEtag());
  }

  if (pathname === '/api/qb/test' && method === 'POST') {
    const body = await readJson(req);
    const result = await engine.testQb(body);
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/qb/config' && method === 'PUT') {
    const body = await readJson(req);
    return sendJson(res, 200, { ok: true, qb: engine.saveQb(body) });
  }

  if (pathname === '/api/qb/status' && method === 'GET') {
    const force = query.force === '1' || query.force === 'true';
    return sendJson(res, 200, await engine.qbStatus(force));
  }

  if (pathname === '/api/proxy' && method === 'PUT') {
    const body = await readJson(req);
    return sendJson(res, 200, { ok: true, proxy: engine.saveProxy(body) });
  }

  if (pathname === '/api/proxy/test' && method === 'POST') {
    const body = await readJson(req);
    return sendJson(res, 200, await engine.testProxy(body));
  }

  const coverMatch = pathname.match(/^\/api\/cover\/([^/]+)$/);
  if (coverMatch && method === 'GET') {
    const item = await engine.getCover(coverMatch[1]);
    return sendBuffer(res, 200, item.buffer, item.contentType, {
      'Cache-Control': 'public, max-age=21600',
    });
  }

  if (pathname === '/api/image' && method === 'GET') {
    const item = await engine.fetchImage(query.url);
    return sendBuffer(res, 200, item.buffer, item.contentType, {
      'Cache-Control': 'public, max-age=21600',
    });
  }

  if (pathname === '/api/search' && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      ...(await engine.searchBangumi({
        q: query.q,
        baseId: query.baseId,
        limit: query.limit,
        phase: query.phase,
      })),
    });
  }

  if (pathname === '/api/extras' && method === 'GET') {
    return sendJson(res, 200, { extras: engine.extrasPublic() });
  }

  if (pathname === '/api/extras' && method === 'POST') {
    const body = await readJson(req);
    const extra = await engine.addExtra(body);
    return sendJson(res, 201, { ok: true, extra });
  }

  if (pathname === '/api/extras/upload' && method === 'POST') {
    const body = await readJson(req, 12 * 1024 * 1024);
    const extra = await engine.addExtraFile(body);
    return sendJson(res, 201, { ok: true, extra });
  }

  if (pathname === '/api/extras/status' && method === 'POST') {
    return sendJson(res, 200, await engine.extrasStatus());
  }

  if (pathname === '/api/hardlink' && method === 'PUT') {
    const body = await readJson(req);
    return sendJson(res, 200, { ok: true, hardlink: engine.saveHardlink(body) });
  }
  if (pathname === '/api/hardlink/probe' && method === 'GET') {
    return sendJson(res, 200, { ok: true, probe: engine.probeHardlinkPath(query.path) });
  }

  const extraHardlinkMatch = pathname.match(/^\/api\/extras\/([^/]+)\/hardlink$/);
  if (extraHardlinkMatch && method === 'POST') {
    return sendJson(res, 200, await engine.linkExtra(extraHardlinkMatch[1]));
  }
  if (extraHardlinkMatch && method === 'PUT') {
    const body = await readJson(req);
    return sendJson(res, 200, { ok: true, extra: engine.updateExtraHardlink(extraHardlinkMatch[1], body) });
  }

  // 外挂字幕库：批量上传（文件/压缩包 base64）、链接自动抓取、删除
  const extraSubsUploadMatch = pathname.match(/^\/api\/extras\/([^/]+)\/subs\/upload$/);
  if (extraSubsUploadMatch && method === 'POST') {
    const body = await readJson(req, 64 * 1024 * 1024);
    return sendJson(res, 200, await engine.addExtraSubsUpload(extraSubsUploadMatch[1], body));
  }
  const extraSubsFetchMatch = pathname.match(/^\/api\/extras\/([^/]+)\/subs\/fetch$/);
  if (extraSubsFetchMatch && method === 'POST') {
    const body = await readJson(req);
    return sendJson(res, 200, await engine.addExtraSubsFromUrl(extraSubsFetchMatch[1], body));
  }
  const extraSubsMatch = pathname.match(/^\/api\/extras\/([^/]+)\/subs$/);
  if (extraSubsMatch && method === 'DELETE') {
    return sendJson(res, 200, engine.removeExtraSubs(extraSubsMatch[1], {
      name: query.name || '',
      all: query.all === '1' || query.all === 'true',
    }));
  }

  const extraMatch = pathname.match(/^\/api\/extras\/([^/]+)$/);
  if (extraMatch && method === 'DELETE') {
    const result = await engine.deleteExtra(extraMatch[1], {
      deleteTorrent: query.deleteTorrent === '1' || query.deleteTorrent === 'true',
      deleteFiles: query.deleteFiles === '1' || query.deleteFiles === 'true',
    });
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/bases' && method === 'GET') {
    return sendJson(res, 200, { bases: engine.data.bases });
  }

  if (pathname === '/api/bases' && method === 'POST') {
    const body = await readJson(req);
    const norm = normalizeBaseBody(body, null);
    const item = { id: uid('b_'), ...norm, createdAt: nowMs() };
    engine.data.bases.push(item);
    store.save();
    engine.log('info', `新增站点「${item.name}」：${item.url}`);
    return sendJson(res, 201, { ok: true, base: item });
  }

  const baseMatch = pathname.match(/^\/api\/bases\/([^/]+)$/);
  if (baseMatch) {
    const id = baseMatch[1];
    const base = engine.data.bases.find((b) => b.id === id);
    if (!base) throw httpError(404, '站点不存在', 'BASE_NOT_FOUND');
    if (method === 'PUT') {
      const body = await readJson(req);
      const norm = normalizeBaseBody(body, base);
      const urlChanged = norm.url !== base.url;
      Object.assign(base, norm);
      let affected = 0;
      if (urlChanged) {
        for (const sub of engine.data.subs) {
          if (sub.baseId === id && sub.path && !/^https?:\/\//i.test(sub.path)) {
            sub.url = composeUrl(base.url, sub.path);
            sub.needsSeed = true;
            sub.lastCheck = null;
            sub.updatedAt = nowMs();
            engine.cache.delete(sub.id);
            affected++;
          }
        }
      }
      store.save();
      engine.log('info', `更新站点「${base.name}」${affected ? `，同步 ${affected} 个追番地址` : ''}`);
      return sendJson(res, 200, { ok: true, base, affected });
    }
    if (method === 'DELETE') {
      const used = engine.data.subs.filter((s) => s.baseId === id).length;
      if (used > 0) {
        throw httpError(409, `有 ${used} 个追番正在使用该站点，请先修改或删除这些追番`, 'BASE_IN_USE');
      }
      engine.data.bases = engine.data.bases.filter((b) => b.id !== id);
      store.save();
      engine.log('info', `删除站点「${base.name}」`);
      return sendJson(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/paths' && method === 'GET') {
    return sendJson(res, 200, { paths: engine.data.paths });
  }

  if (pathname === '/api/paths' && method === 'POST') {
    const body = await readJson(req);
    const norm = normalizePathBody(body, null);
    if (norm.isDefault) engine.data.paths.forEach((p) => { p.isDefault = false; });
    const item = { id: uid('p_'), ...norm, createdAt: nowMs() };
    engine.data.paths.push(item);
    store.save();
    engine.log('info', `新增存储路径「${item.name}」：${item.path}`);
    return sendJson(res, 201, { ok: true, path: item });
  }

  const pathMatch = pathname.match(/^\/api\/paths\/([^/]+)$/);
  if (pathMatch) {
    const id = pathMatch[1];
    const item = engine.data.paths.find((p) => p.id === id);
    if (!item) throw httpError(404, '存储路径不存在', 'PATH_NOT_FOUND');
    if (method === 'PUT') {
      const body = await readJson(req);
      const norm = normalizePathBody(body, item);
      if (norm.isDefault) engine.data.paths.forEach((p) => { p.isDefault = false; });
      Object.assign(item, norm);
      store.save();
      return sendJson(res, 200, { ok: true, path: item });
    }
    if (method === 'DELETE') {
      engine.data.paths = engine.data.paths.filter((p) => p.id !== id);
      store.save();
      return sendJson(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/subs' && method === 'GET') {
    return sendJson(res, 200, { subs: engine.data.subs.map((s) => engine.publicSub(s)) });
  }

  if (pathname === '/api/subs' && method === 'POST') {
    const body = await readJson(req);
    const result = await engine.createSub(body);
    return sendJson(res, 201, result);
  }

  const subAction = pathname.match(/^\/api\/subs\/([^/]+)\/(check|preview|reset|toggle|download|download-existing|meta|items)$/);
  if (subAction) {
    const id = subAction[1];
    const action = subAction[2];
    const sub = engine.findSub(id);
    if (action === 'meta' && method === 'POST') {
      const result = await engine.refreshSubMeta(id, { throwOnError: true });
      return sendJson(res, 200, { ok: true, sub: result });
    }
    if (action === 'download-existing' && method === 'POST') {
      const result = await engine.downloadExisting(id);
      return sendJson(res, 200, result);
    }
    if (action === 'check' && method === 'POST') {
      const body = await readJson(req);
      const download = body.download === undefined ? true : !!body.download;
      const result = await engine.checkSub(sub, { download });
      return sendJson(res, 200, result);
    }
    if (action === 'preview' && method === 'POST') {
      const result = await engine.previewSub(id);
      return sendJson(res, 200, result);
    }
    if (action === 'reset' && method === 'POST') {
      return sendJson(res, 200, { ok: true, sub: engine.resetSub(id) });
    }
    if (action === 'toggle' && method === 'POST') {
      const body = await readJson(req);
      const enabled = body.enabled !== undefined ? !!body.enabled : sub.enabled === false;
      return sendJson(res, 200, { ok: true, sub: engine.toggleSub(id, enabled) });
    }
    if (action === 'download' && method === 'POST') {
      const body = await readJson(req);
      const record = await engine.downloadFromSub(id, body.key, { force: !!body.force });
      return sendJson(res, 200, { ok: record.status !== 'failed', record });
    }
    if (action === 'items' && method === 'GET') {
      return sendJson(res, 200, engine.getCachedItems(id));
    }
  }

  const subMatch = pathname.match(/^\/api\/subs\/([^/]+)$/);
  if (subMatch) {
    const id = subMatch[1];
    engine.findSub(id);
    if (method === 'PUT') {
      const body = await readJson(req);
      return sendJson(res, 200, { ok: true, sub: engine.updateSub(id, body) });
    }
    if (method === 'DELETE') {
      engine.deleteSub(id);
      return sendJson(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/guess-episode' && method === 'POST') {
    const body = await readJson(req);
    return sendJson(res, 200, { ok: true, ...engine.guessEpisodeTool(body.text) });
  }

  if (pathname === '/api/resolve' && method === 'POST') {
    const body = await readJson(req);
    return sendJson(res, 200, { ok: true, ...(await engine.resolveName(body)) });
  }

  if (pathname === '/api/preview' && method === 'POST') {
    const body = await readJson(req);
    return sendJson(res, 200, await engine.previewInput(body));
  }

  if (pathname === '/api/check-all' && method === 'POST') {
    return sendJson(res, 202, { ok: true, ...engine.checkAll() });
  }

  if (pathname === '/api/downloads' && method === 'GET') {
    const limit = Math.min(1000, Math.max(1, Number(query.limit) || 200));
    return sendJsonGz(req, res, 200, { downloads: engine.downloadsPublic(limit) });
  }

  if (pathname === '/api/downloads' && method === 'DELETE') {
    return sendJson(res, 200, { ok: true, ...engine.clearDownloads() });
  }

  const retryMatch = pathname.match(/^\/api\/downloads\/([^/]+)\/retry$/);
  if (retryMatch && method === 'POST') {
    const record = await engine.retryDownload(retryMatch[1]);
    return sendJson(res, 200, { ok: record.status === 'ok', record });
  }

  const allowMatch = pathname.match(/^\/api\/downloads\/([^/]+)\/allow-redownload$/);
  if (allowMatch && method === 'POST') {
    return sendJson(res, 200, engine.allowRedownload(allowMatch[1]));
  }

  if (pathname === '/api/logs' && method === 'GET') {
    return sendJson(res, 200, { logs: engine.data.logs.slice(0, 200) });
  }

  if (pathname === '/api/export' && method === 'GET') {
    const data = Buffer.from(JSON.stringify(engine.exportConfig(), null, 2), 'utf8');
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return sendBuffer(res, 200, data, 'application/json; charset=utf-8', {
      'Content-Disposition': `attachment; filename="anirss-backup-${stamp}.json"`,
    });
  }

  if (pathname === '/api/import' && method === 'POST') {
    const body = await readJson(req, 12 * 1024 * 1024);
    return sendJson(res, 200, engine.importConfig(body));
  }

  throw httpError(404, `接口不存在：${method} ${pathname}`, 'API_NOT_FOUND');
}

function handleRequest(req, res) {
  let pathname;
  let parsed;
  try {
    parsed = urlmod.parse(req.url, true);
    pathname = decodeURIComponent(parsed.pathname || '/');
  } catch {
    return sendJson(res, 400, { error: '无效的 URL' });
  }

  // 统一网关可能保留前缀，也可能已经剥离；两种都兼容
  if (pathname === GATEWAY_PREFIX) {
    res.writeHead(302, { Location: GATEWAY_PREFIX + '/' });
    return res.end();
  }
  if (pathname.startsWith(GATEWAY_PREFIX + '/')) {
    pathname = pathname.slice(GATEWAY_PREFIX.length);
  }

  if (pathname.startsWith('/api/')) {
    // 浏览器跨站请求防护：本站 UI 的写请求会是 same-origin / same-site。
    // 命令行 / curl 不带该头，不受影响。
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method || '') &&
        req.headers['sec-fetch-site'] === 'cross-site') {
      return sendJson(res, 403, { error: '拒绝跨站写请求', code: 'CROSS_SITE' });
    }
    handleApi(req, res, pathname, parsed.query || {})
      .catch((e) => {
        const status = Number(e && e.status) || 500;
        if (status >= 500) {
          engine.log('error', `${req.method} ${pathname} -> ${e.message}`);
          console.error(e && e.stack ? e.stack : e);
        }
        if (!res.headersSent) {
          sendJson(res, status, {
            error: e && e.message ? e.message : '服务器内部错误',
            code: (e && e.code) || (status >= 500 ? 'INTERNAL' : 'ERROR'),
          });
        } else {
          res.end();
        }
      });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  return serveStatic(req, res, pathname);
}

function start() {
  const servers = [];
  const listen = (server, target, cb) => {
    const isTcp = target && typeof target === 'object';
    server.once('error', (e) => {
      console.error(`[anirss] 监听失败 ${typeof target === 'string' ? target : HOST + ':' + PORT}：${e.message}`);
      process.exitCode = 1;
      // fnOS 桌面入口现在是独立端口，端口占用时直接失败，避免“图标能开但浏览器打不开”
      if (IS_FNOS && isTcp) {
        setTimeout(() => process.exit(1), 50);
      }
    });
    server.listen(target, cb);
    servers.push(server);
    return server;
  };

  if (PORT) {
    const tcpServer = http.createServer(handleRequest);
    listen(tcpServer, { port: PORT, host: HOST }, () => {
      console.log(`[anirss] listening on http://${HOST}:${PORT}`);
      if (HOST === '0.0.0.0') {
        console.log(`[anirss] 浏览器访问：http://<NAS-IP>:${PORT}`);
      } else {
        console.log('[anirss] 本机访问：http://127.0.0.1:' + PORT);
      }
    });
  }

  if (SOCKET) {
    try {
      if (fs.existsSync(SOCKET)) fs.unlinkSync(SOCKET);
    } catch (e) {
      console.error(`[anirss] 无法清理旧 socket：${e.message}`);
    }
    const socketServer = http.createServer(handleRequest);
    listen(socketServer, SOCKET, () => {
      try { fs.chmodSync(SOCKET, 0o660); } catch { /* ignore */ }
      console.log(`[anirss] listening on ${SOCKET}`);
      console.log(`[anirss] gateway prefix ${GATEWAY_PREFIX}`);
    });
  }

  console.log(`[anirss] version ${APP_VERSION}`);
  console.log(`[anirss] data dir ${DATA_DIR}`);
  engine.start();
  engine.log('info', `HTTP 服务已启动（${SOCKET ? 'socket ' + SOCKET : 'port ' + PORT}）`);

  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    console.log(`[anirss] ${signal} received, shutting down`);
    engine.stop();
    store.flush();
    destroyAgents();
    for (const s of servers) {
      try { s.close(); } catch { /* ignore */ }
    }
    try {
      if (SOCKET && fs.existsSync(SOCKET)) fs.unlinkSync(SOCKET);
    } catch { /* ignore */ }
    setTimeout(() => process.exit(0), 300);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  // 兜底：非常规退出路径（未捕获异常等）也别丢掉排队的配置写入
  process.on('exit', () => store.flush());
}

start();
