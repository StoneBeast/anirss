'use strict';

const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { UA, httpError, looksLikeHtml, formatBytes } = require('./util');
const { getProxy, prepareProxyRequest, proxyError } = require('./proxy');
const { agentFor } = require('./agents');

const MAX_REDIRECTS = 5;

function safeHost(rawUrl) {
  try {
    return new URL(rawUrl).host;
  } catch {
    return String(rawUrl || '');
  }
}

function decompress(buf, encoding) {
  const enc = String(encoding || '').toLowerCase().trim();
  if (!enc || enc === 'identity') return buf;
  try {
    if (enc.includes('br')) return zlib.brotliDecompressSync(buf);
    if (enc.includes('gzip')) return zlib.gunzipSync(buf);
    if (enc.includes('deflate')) {
      try {
        return zlib.inflateSync(buf);
      } catch {
        return zlib.inflateRawSync(buf);
      }
    }
  } catch (e) {
    throw httpError(502, '响应解压失败：' + e.message, 'DECOMPRESS_FAILED');
  }
  return buf;
}

/**
 * 抓取一个 URL（GET），跟随重定向、自动解压、限制大小。
 * `timeout` 只约束连接空闲（站点慢速回传时可以远超它），
 * `deadline` 是整个请求的硬上限（含重定向与回传），两者可以同时给。
 * @returns {Promise<{buffer:Buffer, headers:object, status:number, url:string, contentType:string}>}
 */
function fetchBuffer(inputUrl, opts) {
  const options = opts || {};
  const timeout = options.timeout || 20000;
  const maxBytes = options.maxBytes || 10 * 1024 * 1024;
  const maxRedirects = options.maxRedirects == null ? MAX_REDIRECTS : options.maxRedirects;
  const requestHeaders = {
    'User-Agent': options.userAgent || UA,
    'Accept': options.accept || '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    ...(options.headers || {}),
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    let currentReq = null;
    let deadlineTimer = null;
    const clearDeadline = () => {
      if (deadlineTimer) {
        clearTimeout(deadlineTimer);
        deadlineTimer = null;
      }
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearDeadline();
      reject(err);
    };
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearDeadline();
      resolve(value);
    };

    if (options.deadline > 0) {
      deadlineTimer = setTimeout(() => {
        const seconds = Math.max(1, Math.round(options.deadline / 1000));
        fail(httpError(504, `请求超时（总时长 ${seconds} 秒）：${safeHost(inputUrl)}`, 'TIMEOUT'));
        if (currentReq) {
          try { currentReq.destroy(); } catch { /* ignore */ }
        }
      }, options.deadline);
      if (deadlineTimer.unref) deadlineTimer.unref();
    }

    const go = async (target, redirectsLeft) => {
      let u;
      try {
        u = new URL(target);
      } catch {
        return fail(httpError(400, '无效的地址：' + target, 'BAD_URL'));
      }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return fail(httpError(400, '仅支持 http / https 地址', 'BAD_URL'));
      }

      const proxy = options.proxy === undefined ? getProxy() : options.proxy;
      let plan = null;
      try {
        plan = await prepareProxyRequest(proxy, u, {
          timeout,
          rejectUnauthorized: options.rejectUnauthorized !== false,
        });
      } catch (e) {
        return fail(proxyError(e));
      }
      const mod = plan ? plan.mod : (u.protocol === 'https:' ? https : http);
      const reqOptions = {
        method: 'GET',
        headers: plan && plan.headers ? { ...requestHeaders, ...plan.headers } : requestHeaders,
        timeout,
        rejectUnauthorized: options.rejectUnauthorized !== false,
      };
      if (plan && plan.agent !== undefined) reqOptions.agent = plan.agent;
      else if (!plan) reqOptions.agent = agentFor(u.protocol, options.rejectUnauthorized !== false);
      const onResponse = (res) => {
          const status = res.statusCode || 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            if (redirectsLeft <= 0) {
              return fail(httpError(502, '重定向次数过多', 'TOO_MANY_REDIRECTS'));
            }
            let next;
            try {
              next = new URL(res.headers.location, u).href;
            } catch {
              return fail(httpError(502, '重定向地址无效', 'BAD_REDIRECT'));
            }
            go(next, redirectsLeft - 1).catch(fail);
            return;
          }

          if (status < 200 || status >= 300) {
            const chunks = [];
            let size = 0;
            res.on('data', (chunk) => {
              size += chunk.length;
              if (size <= 16 * 1024) chunks.push(chunk);
            });
            res.on('end', () => {
              const excerpt = Buffer.concat(chunks).toString('utf8')
                .replace(/[\u0000-\u001f\u007f\ufffd]+/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 160);
              fail(httpError(
                502,
                `请求失败（HTTP ${status}）${u.host}${excerpt ? '：' + excerpt : ''}`,
                'HTTP_STATUS'
              ));
            });
            res.on('error', fail);
            return;
          }

          const declared = Number(res.headers['content-length'] || 0);
          if (declared && declared > maxBytes) {
            res.resume();
            return fail(httpError(413, `内容过大（${formatBytes(declared)}），上限 ${formatBytes(maxBytes)}`, 'TOO_LARGE'));
          }

          const chunks = [];
          let size = 0;
          res.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
              req.destroy();
              return fail(httpError(413, `内容过大，超过上限 ${formatBytes(maxBytes)}`, 'TOO_LARGE'));
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            try {
              const raw = Buffer.concat(chunks);
              const body = decompress(raw, res.headers['content-encoding']);
              done({
                buffer: body,
                headers: res.headers,
                status,
                url: u.href,
                contentType: String(res.headers['content-type'] || ''),
              });
            } catch (e) {
              fail(e);
            }
          });
          res.on('error', fail);
      };
      const useMergedOptions = plan && plan.target && typeof plan.target === 'object' && !(plan.target instanceof URL);
      const req = useMergedOptions
        ? mod.request(Object.assign({}, plan.target, reqOptions), onResponse)
        : mod.request(plan ? plan.target : u, reqOptions, onResponse);
      currentReq = req;

      req.on('timeout', () => {
        req.destroy();
        fail(httpError(504, `请求超时（${Math.round(timeout / 1000)} 秒）：${u.host}`, 'TIMEOUT'));
      });
      req.on('error', (e) => {
        if (e && e.status) return fail(e);
        const code = e && e.code ? e.code : '';
        let msg;
        if (code === 'ENOTFOUND') msg = `无法解析域名：${u.hostname}`;
        else if (code === 'ECONNREFUSED') msg = `连接被拒绝：${u.host}`;
        else if (code === 'ECONNRESET') msg = `连接被重置：${u.host}`;
        else if (code === 'CERT_HAS_EXPIRED' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
          msg = `TLS 证书校验失败：${code}（可在连接设置中启用「忽略证书校验」）`;
        } else msg = `网络错误${code ? '（' + code + '）' : ''}：${e.message}`;
        fail(httpError(502, msg, 'NETWORK'));
      });
      req.end();
    };

    go(inputUrl, maxRedirects).catch(fail);
  });
}

function isHtmlResponse(res) {
  if (!res) return false;
  const ct = String(res.contentType || '').toLowerCase();
  if (ct.includes('text/html')) return true;
  return looksLikeHtml(res.buffer);
}

module.exports = { fetchBuffer, isHtmlResponse };
