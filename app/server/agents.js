'use strict';

/**
 * 出站 HTTP/HTTPS 的 keep-alive 连接池。
 *
 * qBittorrent 的 API 与 RSS/封面抓取都是高频短请求，每次新建 TCP（可能还有 TLS）
 * 握手会明显放大延迟；这里按「协议 + 证书策略」分池复用连接，
 * 避免不同 rejectUnauthorized 策略的请求复用同一条 TLS 连接。
 */

const http = require('http');
const https = require('https');

const POOL = new Map();

function agentFor(protocol, rejectUnauthorized) {
  const secure = protocol === 'https:';
  const key = secure ? `https|${rejectUnauthorized === false ? 0 : 1}` : 'http';
  let agent = POOL.get(key);
  if (!agent) {
    const opts = {
      keepAlive: true,
      keepAliveMsecs: 15000,
      maxSockets: 8,
      maxFreeSockets: 4,
      timeout: 65000,
    };
    agent = secure ? new https.Agent({ ...opts, rejectUnauthorized: rejectUnauthorized !== false }) : new http.Agent(opts);
    POOL.set(key, agent);
  }
  return agent;
}

/** 关闭空闲连接（进程退出时调用；正常服务期间不需要） */
function destroyAll() {
  for (const agent of POOL.values()) {
    try { agent.destroy(); } catch { /* ignore */ }
  }
  POOL.clear();
}

module.exports = { agentFor, destroyAll };
