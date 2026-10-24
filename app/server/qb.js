'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const querystring = require('querystring');
const { normalizeBaseUrl, UA, httpError, truncate } = require('./util');
const { agentFor } = require('./agents');

const DEFAULT_TIMEOUT = 20000;

class QBClient {
  constructor(config) {
    const cfg = config || {};
    this.base = normalizeBaseUrl(cfg.baseUrl);
    if (!this.base) throw httpError(400, '请先填写 qBittorrent WebUI 地址', 'QB_NO_URL');
    this.username = String(cfg.username || '');
    this.password = String(cfg.password || '');
    this.skipTlsVerify = !!cfg.skipTlsVerify;
    this.cookie = '';
    this.loggedIn = false;
  }

  _rawRequest(method, path, options) {
    const opts = options || {};
    const target = new URL(this.base + path);
    const mod = target.protocol === 'https:' ? https : http;
    const headers = {
      'User-Agent': UA,
      'Accept': opts.accept || 'application/json, text/plain, */*',
      'Referer': this.base + '/',
      'Origin': this.base,
      ...(opts.headers || {}),
    };
    if (this.cookie) headers['Cookie'] = this.cookie;
    if (opts.body != null) {
      const bodyLength = Buffer.isBuffer(opts.body)
        ? opts.body.length
        : Buffer.byteLength(String(opts.body), 'utf8');
      if (!headers['Content-Length'] && !headers['content-length']) {
        headers['Content-Length'] = bodyLength;
      }
    }
    if (opts.body != null && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      };
      const req = mod.request(
        target,
        {
          method,
          headers,
          timeout: opts.timeout || DEFAULT_TIMEOUT,
          rejectUnauthorized: !this.skipTlsVerify,
          // qB API 是高频小请求，复用 keep-alive 连接省掉每次的 TCP/TLS 握手
          agent: agentFor(target.protocol, !this.skipTlsVerify),
        },
        (res) => {
          const chunks = [];
          let size = 0;
          res.on('data', (chunk) => {
            size += chunk.length;
            if (size > 8 * 1024 * 1024) {
              req.destroy();
              return fail(httpError(502, 'qBittorrent 响应过大', 'QB_TOO_LARGE'));
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            if (settled) return;
            settled = true;
            const setCookie = res.headers['set-cookie'] || [];
            resolve({
              status: res.statusCode || 0,
              headers: res.headers,
              text: Buffer.concat(chunks).toString('utf8'),
              setCookie,
            });
          });
          res.on('error', fail);
        }
      );

      req.on('timeout', () => {
        req.destroy();
        fail(httpError(504, `连接 qBittorrent 超时（${Math.round((opts.timeout || DEFAULT_TIMEOUT) / 1000)} 秒）`, 'QB_TIMEOUT'));
      });
      req.on('error', (e) => {
        if (e && e.status) return fail(e);
        const code = (e && e.code) || '';
        let msg;
        if (code === 'ECONNREFUSED') msg = `无法连接 qBittorrent：${this.base} 拒绝连接，请确认 WebUI 已启用且端口正确`;
        else if (code === 'ENOTFOUND') msg = `无法解析 qBittorrent 地址：${target.hostname}`;
        else if (code === 'CERT_HAS_EXPIRED' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
          msg = `qBittorrent HTTPS 证书校验失败（${code}），可启用「忽略证书校验」`;
        } else if (code === 'ECONNRESET') msg = `连接 qBittorrent 被重置：${this.base}`;
        else msg = `连接 qBittorrent 失败${code ? '（' + code + '）' : ''}：${e.message}`;
        fail(httpError(502, msg, 'QB_NETWORK'));
      });
      if (opts.body != null) req.write(opts.body);
      req.end();
    });
  }

  _extractCookie(setCookie) {
    const cookies = Array.isArray(setCookie) ? setCookie : [];
    for (const raw of cookies) {
      const first = String(raw).split(';')[0];
      if (/^SID=/i.test(first)) {
        this.cookie = first;
        return;
      }
    }
  }

  async login() {
    const body = querystring.stringify({ username: this.username, password: this.password });
    let res;
    try {
      res = await this._rawRequest('POST', '/api/v2/auth/login', {
        body,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Referer': this.base + '/',
        },
      });
    } catch (e) {
      throw e;
    }

    const text = String(res.text || '').replace(/^\ufeff/, '').trim();
    if (res.status === 403) {
      throw httpError(502, 'qBittorrent 拒绝了登录请求（403）。请确认地址正确；若失败次数过多，可能 IP 已被临时封禁。', 'QB_FORBIDDEN');
    }
    if (res.status < 200 || res.status >= 300) {
      throw httpError(502, `qBittorrent 登录失败（HTTP ${res.status}）`, 'QB_LOGIN');
    }
    if (/banned/i.test(text)) {
      throw httpError(502, '当前 IP 已被 qBittorrent 封禁，请在 qBittorrent 中解除或关闭「失败登录封禁」后重试。', 'QB_BANNED');
    }
    if (!/^ok\.?$/i.test(text)) {
      throw httpError(502, 'qBittorrent 登录失败：用户名或密码错误。', 'QB_AUTH');
    }
    this._extractCookie(res.setCookie);
    this.loggedIn = true;
    return { ok: true };
  }

  async ensureLogin() {
    if (this.loggedIn) return;
    await this.login();
  }

  async _api(method, path, options) {
    await this.ensureLogin();
    let res = await this._rawRequest(method, path, options);
    if (res.status === 403) {
      // SID 过期或 qB 重启：重登一次
      this.loggedIn = false;
      this.cookie = '';
      await this.login();
      res = await this._rawRequest(method, path, options);
    }
    return res;
  }

  async getText(path) {
    const res = await this._api('GET', path, { accept: 'text/plain, */*' });
    if (res.status < 200 || res.status >= 300) {
      throw httpError(502, `qBittorrent 请求失败（HTTP ${res.status}）`, 'QB_HTTP');
    }
    return String(res.text || '').trim();
  }

  async getJson(path) {
    const text = await this.getText(path);
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw httpError(502, 'qBittorrent 返回了非 JSON 数据，请确认 WebUI API 版本。', 'QB_BAD_JSON');
    }
  }

  /**
   * 轻量健康探测：真实发一个 GET，确认 qB 当前可达。
   * 不能只依赖 ensureLogin()，因为 SID 会缓存，qB 挂掉时本地仍以为已登录。
   */
  async ping() {
    const version = await this.getText('/api/v2/app/version');
    if (!version) throw httpError(502, 'qBittorrent 返回空版本号，可能服务异常', 'QB_EMPTY_VERSION');
    return version;
  }

  async test() {
    await this.login();
    const [version, webapi] = await Promise.all([
      this.getText('/api/v2/app/version'),
      this.getText('/api/v2/app/webapiVersion'),
    ]);
    let defaultSavePath = '';
    try {
      const raw = await this.getText('/api/v2/app/defaultSavePath');
      defaultSavePath = raw.replace(/^"(.*)"$/, '$1');
    } catch {
      /* 老版本可能没有这个接口 */
    }
    return {
      version: truncate(version || 'unknown', 80),
      webapi: truncate(webapi || 'unknown', 40),
      defaultSavePath,
    };
  }

  /** qB 中是否已有该 infohash（用于把重复种子识别为“跳过”而不是“失败”） */
  async hasTorrent(hash) {
    const h = String(hash || '').toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(h)) return false;
    try {
      const list = await this.getJson('/api/v2/torrents/info?hashes=' + encodeURIComponent(h));
      if (!Array.isArray(list)) return false;
      return list.some((item) => String(item && item.hash || '').toLowerCase() === h);
    } catch {
      return false;
    }
  }

  async addTorrent(opts) {
    const options = opts || {};
    const fields = {};
    if (options.savePath) {
      fields.savepath = String(options.savePath);
      fields.autoTMM = 'false';
    }
    if (options.category) fields.category = String(options.category);
    if (options.tags) fields.tags = String(options.tags);
    // qB 5.x 把 paused 改名为 stopped；同时发送，兼容 4.x / 5.x
    fields.paused = options.paused ? 'true' : 'false';
    fields.stopped = options.paused ? 'true' : 'false';

    let body;
    let contentType;
    if (options.buffer) {
      const boundary = '----anirss' + crypto.randomBytes(10).toString('hex');
      const parts = [];
      for (const [key, value] of Object.entries(fields)) {
        parts.push(Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
          'utf8'
        ));
      }
      const filename = String(options.filename || 'file.torrent').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="torrents"; filename="${filename}"\r\n` +
        'Content-Type: application/x-bittorrent\r\n\r\n',
        'utf8'
      ));
      parts.push(options.buffer);
      parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));
      body = Buffer.concat(parts);
      contentType = `multipart/form-data; boundary=${boundary}`;
    } else if (options.urls) {
      fields.urls = String(options.urls);
      body = Buffer.from(querystring.stringify(fields), 'utf8');
      contentType = 'application/x-www-form-urlencoded; charset=UTF-8';
    } else {
      throw httpError(400, '缺少种子文件或下载地址', 'QB_NO_TORRENT');
    }

    const res = await this._api('POST', '/api/v2/torrents/add', {
      body,
      headers: { 'Content-Type': contentType },
      timeout: 45000,
    });
    const text = String(res.text || '').trim();

    if (res.status === 415) {
      throw httpError(502, 'qBittorrent 认为种子文件无效（HTTP 415）', 'QB_INVALID_TORRENT');
    }
    if (res.status === 403) {
      throw httpError(502, 'qBittorrent 拒绝添加：未授权（403）', 'QB_FORBIDDEN');
    }
    if (res.status < 200 || res.status >= 300) {
      throw httpError(502, `qBittorrent 添加失败（HTTP ${res.status}）`, 'QB_ADD_FAILED');
    }
    if (/^fail/i.test(text)) {
      const err = httpError(502, 'qBittorrent 拒绝添加（Fails.）', 'QB_REJECTED');
      // 不记录密码/Cookie 值，只记录足以定位请求形态的信息
      err.debug = {
        bodyBytes: body.length,
        fields: Object.keys(fields),
        savePath: fields.savepath || '',
        hasCookie: !!this.cookie,
        contentType,
      };
      throw err;
    }
    if (text && !/^ok\.?$/i.test(text)) {
      // 一些版本会返回空字符串或 Ok.；其他文本按失败处理更安全
      throw httpError(502, `qBittorrent 返回了未知结果：${truncate(text, 120)}`, 'QB_UNKNOWN');
    }
    return { ok: true };
  }

  /** 批量查询种子信息（用于补番记录的状态刷新） */
  async torrentsInfo(hashes) {
    const list = (Array.isArray(hashes) ? hashes : [hashes])
      .map((h) => String(h || '').toLowerCase())
      .filter((h) => /^[a-f0-9]{40}$/.test(h));
    if (!list.length) return [];
    await this.ensureLogin();
    const data = await this.getJson('/api/v2/torrents/info?hashes=' + encodeURIComponent(list.join('|')));
    return Array.isArray(data) ? data : [];
  }

  /** 查询单个种子的文件列表（name 相对 save_path），用于硬链接 */
  async torrentsFiles(hash) {
    const h = String(hash || '').toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(h)) return [];
    await this.ensureLogin();
    const data = await this.getJson('/api/v2/torrents/files?hash=' + encodeURIComponent(h));
    return Array.isArray(data) ? data : [];
  }

  /** 删除种子（可选同时删除文件） */
  async deleteTorrents(hashes, deleteFiles) {
    const list = (Array.isArray(hashes) ? hashes : [hashes])
      .map((h) => String(h || '').toLowerCase())
      .filter((h) => /^[a-f0-9]{40}$/.test(h));
    if (!list.length) return { ok: true };
    const body = Buffer.from(querystring.stringify({
      hashes: list.join('|'),
      deleteFiles: deleteFiles ? 'true' : 'false',
    }), 'utf8');
    await this._api('POST', '/api/v2/torrents/delete', {
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      timeout: 20000,
    });
    return { ok: true };
  }

  async status() {
    await this.ensureLogin();
    const [version, webapi, transfer, torrents] = await Promise.all([
      this.getText('/api/v2/app/version').catch(() => ''),
      this.getText('/api/v2/app/webapiVersion').catch(() => ''),
      this.getJson('/api/v2/transfer/info').catch(() => ({})),
      this.getJson('/api/v2/torrents/info?filter=downloading&sort=added_on&reverse=true&limit=8').catch(() => []),
    ]);
    const list = Array.isArray(torrents) ? torrents : [];
    return {
      version,
      webapi,
      dlSpeed: Number(transfer.dl_info_speed) || 0,
      upSpeed: Number(transfer.up_info_speed) || 0,
      dlTotal: Number(transfer.dl_info_data) || 0,
      upTotal: Number(transfer.up_info_data) || 0,
      connectionStatus: transfer.connection_status || '',
      active: list.map((t) => ({
        hash: String(t.hash || ''),
        name: String(t.name || ''),
        size: Number(t.size) || 0,
        progress: Number(t.progress) || 0,
        dlspeed: Number(t.dlspeed) || 0,
        upspeed: Number(t.upspeed) || 0,
        state: String(t.state || ''),
        eta: Number.isFinite(Number(t.eta)) ? Number(t.eta) : 0,
        savePath: String(t.save_path || ''),
      })),
      activeCount: list.length,
      fetchedAt: Date.now(),
    };
  }
}

module.exports = { QBClient };
