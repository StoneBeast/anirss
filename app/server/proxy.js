'use strict';

const net = require('net');
const tls = require('tls');
const http = require('http');
const https = require('https');
const { httpError } = require('./util');

const PROXY_TYPES = ['http', 'https', 'socks5', 'socks5h'];

let currentProxy = defaultProxy();

function defaultProxy() {
  return {
    enabled: false,
    type: 'http',
    host: '',
    port: 0,
    username: '',
    password: '',
    noProxy: '',
    skipTlsVerify: false,
  };
}

function parseHostPort(raw, fallbackType) {
  const input = String(raw == null ? '' : raw).trim();
  if (!input) return { host: '', port: 0, type: '' };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    try {
      const u = new URL(input);
      const type = u.protocol === 'https:' ? 'https' : (u.protocol === 'socks5:' || u.protocol === 'socks5h:' ? 'socks5' : 'http');
      return { host: u.hostname, port: Number(u.port) || (type === 'https' ? 443 : 0), type };
    } catch {
      return { host: '', port: 0, type: '' };
    }
  }
  const m = /^\[?([^\]]+?)\]?(?::(\d{1,5}))?$/.exec(input);
  if (!m) return { host: input, port: 0, type: fallbackType || '' };
  return { host: m[1], port: m[2] ? Number(m[2]) : 0, type: fallbackType || '' };
}

function normalizeProxy(input, current) {
  const base = Object.assign(defaultProxy(), current || {});
  const src = Object.assign({}, base, input || {});

  let type = String(src.type || base.type || 'http').toLowerCase();
  if (type === 'socks5h') type = 'socks5';
  if (!PROXY_TYPES.includes(type)) type = 'http';

  let host = String(src.host || '').trim();
  let port = Number(src.port) || 0;
  const parsed = parseHostPort(host, type);
  if (parsed.host) {
    host = parsed.host;
    if (!port && parsed.port) port = parsed.port;
    if (parsed.type) type = parsed.type === 'socks5' ? 'socks5' : parsed.type;
  }
  if (!port && type === 'https') port = 443;
  if (port && (port < 1 || port > 65535)) port = 0;

  return {
    enabled: !!src.enabled,
    type,
    host,
    port,
    username: String(src.username || '').slice(0, 200),
    password: String(src.password == null ? '' : src.password).slice(0, 500),
    noProxy: String(src.noProxy || '').slice(0, 2000),
    skipTlsVerify: !!src.skipTlsVerify,
  };
}

function isProxyEnabled(proxy) {
  const p = proxy || currentProxy;
  return !!(p && p.enabled && p.host && p.port);
}

function splitNoProxy(text) {
  return String(text || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function matchNoProxyEntry(hostname, entry) {
  const host = String(hostname || '').toLowerCase();
  let e = String(entry || '').toLowerCase();
  if (!e) return false;
  if (e === '*') return true;
  const withPort = e.includes(':') && !e.startsWith('[');
  if (withPort) {
    const idx = e.lastIndexOf(':');
    const port = e.slice(idx + 1);
    if (/^\d+$/.test(port)) e = e.slice(0, idx);
  }
  if (e.startsWith('.')) return host.endsWith(e);
  if (e.startsWith('*.')) return host.endsWith(e.slice(1));
  if (host === e) return true;
  return host.endsWith('.' + e);
}

function isNoProxy(proxy, hostname) {
  const list = splitNoProxy(proxy && proxy.noProxy);
  if (!list.length) return false;
  return list.some((entry) => matchNoProxyEntry(hostname, entry));
}

function proxyLabel(proxy) {
  const p = proxy || currentProxy;
  if (!p || !p.host) return '未配置';
  return `${p.type}://${p.host}:${p.port || ''}`;
}

function publicProxy(proxy) {
  const p = normalizeProxy(proxy || currentProxy, currentProxy);
  return {
    enabled: p.enabled,
    type: p.type,
    host: p.host,
    port: p.port,
    username: p.username,
    hasPassword: !!p.password,
    noProxy: p.noProxy,
    skipTlsVerify: p.skipTlsVerify,
    configured: !!(p.host && p.port),
    label: proxyLabel(p),
  };
}

function setProxy(proxy) {
  currentProxy = normalizeProxy(proxy || {}, currentProxy);
  return currentProxy;
}

function getProxy() {
  return currentProxy;
}

// ---------- 底层 socket ----------

function readExact(socket, size, timeout, onDone) {
  let buf = Buffer.alloc(0);
  let timer = null;
  const cleanup = () => {
    socket.removeListener('data', onData);
    socket.removeListener('error', onError);
    socket.removeListener('close', onClose);
    if (timer) clearTimeout(timer);
  };
  const fail = (err) => {
    cleanup();
    onDone(err);
  };
  const onData = (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (buf.length >= size) {
      cleanup();
      const rest = buf.slice(size);
      if (rest.length) socket.unshift(rest);
      onDone(null, buf.slice(0, size));
    }
  };
  const onError = (err) => fail(err);
  const onClose = () => fail(new Error('代理连接已关闭'));
  socket.on('data', onData);
  socket.once('error', onError);
  socket.once('close', onClose);
  timer = setTimeout(() => fail(new Error('代理握手超时')), timeout);
  if (timeout <= 0) {
    clearTimeout(timer);
    timer = null;
  }
}

function connectTcp(host, port, timeout) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`连接代理 ${host}:${port} 超时`));
    }, timeout);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function tlsToProxy(socket, proxy, timeout) {
  return new Promise((resolve, reject) => {
    const t = tls.connect({
      socket,
      servername: proxy.host,
      rejectUnauthorized: !proxy.skipTlsVerify,
    }, () => resolve(t));
    const timer = setTimeout(() => {
      t.destroy();
      reject(new Error('代理 TLS 握手超时'));
    }, timeout);
    t.once('secureConnect', () => {
      clearTimeout(timer);
      resolve(t);
    });
    t.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function proxyAuthHeader(proxy) {
  if (!proxy.username && !proxy.password) return '';
  const token = Buffer.from(`${proxy.username}:${proxy.password}`, 'utf8').toString('base64');
  return `Proxy-Authorization: Basic ${token}\r\n`;
}

function connectHttpProxy(socket, proxy, target, timeout) {
  return new Promise((resolve, reject) => {
    const hostHeader = `${target.host}:${target.port}`;
    const req = `CONNECT ${hostHeader} HTTP/1.1\r\nHost: ${hostHeader}\r\n${proxyAuthHeader(proxy)}Proxy-Connection: keep-alive\r\n\r\n`;
    let buf = Buffer.alloc(0);
    let timer = null;
    const cleanup = () => {
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      if (timer) clearTimeout(timer);
    };
    const fail = (err) => {
      cleanup();
      reject(err);
    };
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx < 0) {
        if (buf.length > 32 * 1024) fail(new Error('代理响应头过大'));
        return;
      }
      cleanup();
      const head = buf.slice(0, idx).toString('latin1');
      const status = /^HTTP\/\d\.\d\s+(\d{3})/.exec(head);
      if (!status || Number(status[1]) !== 200) {
        const line = head.split('\r\n')[0] || '无响应';
        return reject(new Error(`代理 CONNECT 失败：${line}`));
      }
      const rest = buf.slice(idx + 4);
      if (rest.length) socket.unshift(rest);
      resolve(socket);
    };
    const onError = (err) => fail(err);
    socket.on('data', onData);
    socket.once('error', onError);
    timer = setTimeout(() => fail(new Error('代理 CONNECT 超时')), timeout);
    socket.write(req, 'latin1');
  });
}

function socksAuth(socket, proxy, timeout, done) {
  const user = Buffer.from(proxy.username, 'utf8');
  const pass = Buffer.from(proxy.password, 'utf8');
  const packet = Buffer.concat([
    Buffer.from([0x01, user.length]), user,
    Buffer.from([pass.length]), pass,
  ]);
  readExact(socket, 2, timeout, (err, head) => {
    if (err) return done(err);
    if (head[0] !== 0x01 || head[1] !== 0x00) return done(new Error('SOCKS5 用户名/密码认证失败'));
    done(null);
  });
  socket.write(packet);
}

function socksConnect(socket, proxy, target, timeout, done) {
  const methods = proxy.username || proxy.password ? [0x00, 0x02] : [0x00];
  const greeting = Buffer.from([0x05, methods.length, ...methods]);
  readExact(socket, 2, timeout, (err, head) => {
    if (err) return done(err);
    if (head[0] !== 0x05) return done(new Error('SOCKS5 代理响应无效'));
    if (head[1] === 0xff) return done(new Error('SOCKS5 代理不接受任何认证方式'));
    const needAuth = head[1] === 0x02;
    const afterAuth = () => {
      const hostBuf = Buffer.from(String(target.host), 'utf8');
      const isV4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(target.host);
      const atyp = isV4 ? 0x01 : 0x03;
      const addr = isV4
        ? Buffer.from(target.host.split('.').map((n) => Number(n)))
        : Buffer.concat([Buffer.from([hostBuf.length]), hostBuf]);
      const portBuf = Buffer.from([(target.port >> 8) & 0xff, target.port & 0xff]);
      readExact(socket, 4, timeout, (err2, resp) => {
        if (err2) return done(err2);
        if (resp[1] !== 0x00) return done(new Error(`SOCKS5 连接目标失败（code ${resp[1]}）`));
        const remaining = resp[3] === 0x01 ? 4 : (resp[3] === 0x04 ? 16 : 1);
        readExact(socket, remaining + 2, timeout, (err3) => done(err3 || null));
      });
      socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, atyp]), addr, portBuf]));
    };
    if (needAuth) socksAuth(socket, proxy, timeout, (err2) => (err2 ? done(err2) : afterAuth()));
    else afterAuth();
  });
  socket.write(greeting);
}

function createProxySocket(proxy, target, timeout) {
  const ms = Math.max(3000, Number(timeout) || 15000);
  return connectTcp(proxy.host, proxy.port, ms).then((socket) => {
    const afterTransport = (sock) => new Promise((resolve, reject) => {
      if (proxy.type === 'socks5') {
        socksConnect(sock, proxy, target, ms, (err) => (err ? reject(err) : resolve(sock)));
      } else {
        connectHttpProxy(sock, proxy, target, ms).then(resolve, reject);
      }
    });
    if (proxy.type === 'https') return tlsToProxy(socket, proxy, ms).then(afterTransport);
    return afterTransport(socket);
  });
}

class TunnelAgent extends http.Agent {
  constructor(socket) {
    super({ keepAlive: false, maxSockets: 1 });
    this.tunnelSocket = socket;
  }
  createConnection(options, cb) {
    cb(null, this.tunnelSocket);
  }
}

class TlsTunnelAgent extends https.Agent {
  constructor(socket, servername, rejectUnauthorized) {
    super({ keepAlive: false, maxSockets: 1 });
    this.tunnelSocket = socket;
    this.tunnelServername = servername;
    this.tunnelRejectUnauthorized = rejectUnauthorized !== false;
  }
  createConnection(options, cb) {
    const t = tls.connect({
      socket: this.tunnelSocket,
      servername: this.tunnelServername,
      rejectUnauthorized: this.tunnelRejectUnauthorized,
    }, () => cb(null, t));
    t.once('error', (e) => cb(e));
  }
}

/**
 * 根据代理类型生成请求方案：
 * - HTTP 目标的 http/https 代理：直接向代理发 absolute-form 请求；
 * - 其他情况：先 CONNECT/SOCKS5 建立隧道，再用 TunnelAgent 发请求。
 */
async function prepareProxyRequest(proxy, url, opts) {
  const options = opts || {};
  const u = url instanceof URL ? url : new URL(String(url));
  const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
  const timeout = options.timeout || 15000;
  if (!isProxyEnabled(proxy) || isNoProxy(proxy, u.hostname)) return null;

  const auth = proxy.username || proxy.password
    ? { 'Proxy-Authorization': `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`, 'utf8').toString('base64')}` }
    : {};

  if (u.protocol === 'http:' && (proxy.type === 'http' || proxy.type === 'https')) {
    const isHttpsProxy = proxy.type === 'https';
    return {
      mod: isHttpsProxy ? https : http,
      target: {
        protocol: isHttpsProxy ? 'https:' : 'http:',
        hostname: proxy.host,
        port: proxy.port,
        path: u.href,
      },
      headers: { Host: u.host, ...auth },
      agent: undefined,
    };
  }

  const socket = await createProxySocket(proxy, { host: u.hostname, port }, timeout);
  if (u.protocol === 'https:') {
    return {
      mod: https,
      target: u,
      headers: {},
      agent: new TlsTunnelAgent(socket, u.hostname, options.rejectUnauthorized !== false),
    };
  }
  return {
    mod: http,
    target: u,
    headers: {},
    agent: new TunnelAgent(socket),
  };
}

/** 直连情况下的明确错误包装 */
function proxyError(err) {
  const msg = err && err.message ? err.message : String(err);
  return httpError(502, `代理连接失败：${msg}`, 'PROXY_ERROR');
}

module.exports = {
  defaultProxy,
  normalizeProxy,
  publicProxy,
  isProxyEnabled,
  isNoProxy,
  proxyLabel,
  setProxy,
  getProxy,
  createProxySocket,
  prepareProxyRequest,
  proxyError,
  TunnelAgent,
  TlsTunnelAgent,
};
