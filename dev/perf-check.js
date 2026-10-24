'use strict';

/**
 * 性能相关行为的端到端验证：
 * 1. 静态资源 gzip + ETag/304
 * 2. /api/state 的 ETag/304 与变更后失效
 * 3. /api/state gzip 体积对比
 * 用法：node dev/perf-check.js
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const PORT = 18777;
const APP = `http://127.0.0.1:${PORT}`;
const DATA_DIR = path.join(ROOT, '..', 'work', 'anirss-perf-data');

function fail(msg) {
  console.error('✗ ' + msg);
  process.exitCode = 1;
  throw new Error(msg);
}

async function main() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // 预置一个追番，避免空状态
  fs.writeFileSync(path.join(DATA_DIR, 'config.json'), JSON.stringify({
    qb: { baseUrl: 'http://127.0.0.1:18999', username: 'u', password: 'p' },
    subs: [{
      id: 's_perf1', name: '性能验证番', url: 'http://127.0.0.1:18999/rss.xml',
      seen: {}, createdAt: Date.now(), updatedAt: Date.now(), intervalMin: 10,
    }],
  }));

  const child = spawn(process.execPath, [path.join(ROOT, 'app', 'server', 'index.js')], {
    env: { ...process.env, ANIRSS_DATA: DATA_DIR, ANIRSS_PORT: String(PORT), ANIRSS_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(d));

  const waitHealth = async () => {
    for (let i = 0; i < 50; i++) {
      try {
        const r = await fetch(`${APP}/api/health`);
        if (r.ok) return;
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    fail('服务未启动');
  };
  await waitHealth();

  try {
    // --- 静态资源：gzip + ETag + 304 ---
    let res = await fetch(`${APP}/`);
    const htmlEtag = res.headers.get('etag');
    if (!htmlEtag) fail('index.html 缺少 ETag');
    await res.arrayBuffer();
    res = await fetch(`${APP}/`, { headers: { 'If-None-Match': htmlEtag } });
    if (res.status !== 304) fail(`index.html If-None-Match 应返回 304，实际 ${res.status}`);

    res = await fetch(`${APP}/app.js`);
    if (res.headers.get('content-encoding') !== 'gzip') fail('app.js 应该 gzip 传输');
    if (!res.headers.get('etag')) fail('app.js 缺少 ETag');
    const gzLen = Number(res.headers.get('content-length'));
    const jsEtag = res.headers.get('etag');
    await res.arrayBuffer(); // Node fetch 会自动解压，体积用 Content-Length 比较
    const plain = await fetch(`${APP}/app.js`, { headers: { 'Accept-Encoding': 'identity' } });
    const plainLen = Number(plain.headers.get('content-length'));
    await plain.arrayBuffer();
    if (!(gzLen > 0 && gzLen < plainLen)) fail(`gzip 体积异常：${gzLen} >= ${plainLen}`);
    console.log(`✓ app.js 压缩传输：${plainLen} -> ${gzLen} 字节（${Math.round(gzLen * 100 / plainLen)}%）`);

    res = await fetch(`${APP}/app.js`, { headers: { 'If-None-Match': jsEtag } });
    if (res.status !== 304) fail(`app.js If-None-Match 应返回 304，实际 ${res.status}`);
    console.log('✓ 静态资源 ETag/304');

    // --- /api/state：ETag + 304 + gzip ---
    res = await fetch(`${APP}/api/state`);
    if (res.headers.get('content-encoding') !== 'gzip') fail('/api/state 应该 gzip 传输');
    const stateGzLen = Number(res.headers.get('content-length'));
    const stateEtag = res.headers.get('etag');
    if (!stateEtag) fail('/api/state 缺少 ETag');
    const stateBuf = Buffer.from(await res.arrayBuffer()); // fetch 已解压
    const state = JSON.parse(stateBuf.toString('utf8'));
    if (!Array.isArray(state.subs) || state.subs.length !== 1) fail('/api/state 数据异常');
    const plainState = await fetch(`${APP}/api/state`, { headers: { 'Accept-Encoding': 'identity' } });
    const plainStateLen = Number(plainState.headers.get('content-length'));
    await plainState.arrayBuffer();
    console.log(`✓ /api/state 压缩传输：${plainStateLen} -> ${stateGzLen} 字节（${Math.round(stateGzLen * 100 / plainStateLen)}%）`);

    res = await fetch(`${APP}/api/state`, { headers: { 'If-None-Match': stateEtag } });
    if (res.status !== 304) fail(`/api/state If-None-Match 应返回 304，实际 ${res.status}`);
    console.log('✓ /api/state 轮询命中 304');

    // --- 变更后 ETag 失效 ---
    const toggle = await fetch(`${APP}/api/subs/s_perf1/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: APP, 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ enabled: false }),
    });
    if (!toggle.ok) fail('toggle 请求失败');
    res = await fetch(`${APP}/api/state`, { headers: { 'If-None-Match': stateEtag } });
    if (res.status !== 200) fail(`变更后 /api/state 应返回 200，实际 ${res.status}`);
    const state2 = await res.json();
    if (state2.subs[0].enabled !== false) fail('变更后的数据不对');
    console.log('✓ 变更后 ETag 失效，返回新数据');

    // --- /api/downloads 轻量化仍可用 ---
    res = await fetch(`${APP}/api/downloads?limit=5`);
    const dl = await res.json();
    if (!Array.isArray(dl.downloads)) fail('/api/downloads 结构异常');
    console.log('✓ /api/downloads 轻量接口');

    console.log('\nperf-check 全部通过');
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
