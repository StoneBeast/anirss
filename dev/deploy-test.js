#!/usr/bin/env node
'use strict';

/**
 * 部署矩阵冒烟：同一份源码按不同「部署形态」装进临时目录，各自用真实的启动方式拉起，
 * 再跑同一套部署契约。目的是替代「手工打包 → 装到 NAS → 点一遍页面」的重复劳动。
 *
 * 覆盖的形态：
 *   release    解压即用的裸 Node 目录，走 start.sh / start.cmd
 *   docker     按 Dockerfile 的 COPY 清单组装（只有 app/ + package.json），
 *              用镜像里的生产环境变量（HOST=0.0.0.0 / DATA=/data / NODE_ENV=production）
 *   fpk        真的跑 python dev/build-fpk.py 打成安装包，解包后：
 *                - fpk-payload    直接启动 app.tgz 里的服务端
 *                - fpk-lifecycle  POSIX 上再走 cmd/main start|status|stop，
 *                                 验证 pid、日志、优雅退出与重复启动
 *   migration  旧版 qbrss 数据目录（QBRSS_DATA）在首次启动时自动迁移
 *
 * 每个形态都检查同一组「部署契约」：
 *   健康检查 / 静态资源（ETag 304、gzip）/ 数据目录 == 配置的目录 /
 *   配置写盘 / 重启后配置仍在 / 安装目录不被写脏 / 退出不丢配置
 *
 * 用法：
 *   node dev/deploy-test.js                  # 全部形态
 *   node dev/deploy-test.js --modes release,docker
 *   node dev/deploy-test.js --keep           # 保留临时目录，方便翻日志
 *   ANIRSS_PYTHON=python3 node dev/deploy-test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const assert = require('assert');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const IS_WIN = process.platform === 'win32';
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const ALL_MODES = ['release', 'docker', 'fpk', 'migration'];

const args = parseArgs(process.argv.slice(2));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'anirss-deploy-'));
const LOG_DIR = path.join(TMP, 'logs');
const IGNORED_INSTALL_FILES = new Set(['app.sock', 'app.pid', 'app.log']);

function parseArgs(argv) {
  const out = { modes: [], keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--keep') out.keep = true;
    else if (a === '--modes') {
      const v = argv[++i];
      if (!v) throw new Error('--modes 需要一个值，例如 --modes release,docker');
      out.modes = v.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a.startsWith('--modes=')) {
      out.modes = a.slice('--modes='.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '-h' || a === '--help') {
      console.log('用法：node dev/deploy-test.js [--modes release,docker,fpk,migration] [--keep]');
      process.exit(0);
    } else {
      throw new Error(`不认识的参数：${a}`);
    }
  }
  for (const m of out.modes) {
    if (!ALL_MODES.includes(m)) throw new Error(`未知形态：${m}（可选 ${ALL_MODES.join(' / ')}）`);
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function baseEnv() {
  const env = { ...process.env };
  // 避免把调用者的 ANIRSS_* / QBRSS_* / TRIM_* 带进被测进程，保证每次都是干净环境
  for (const key of Object.keys(env)) {
    if (/^(ANIRSS_|QBRSS_|TRIM_)/.test(key)) delete env[key];
  }
  return env;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function copyInto(destRoot, rel) {
  const from = path.join(ROOT, rel);
  const to = path.join(destRoot, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

function tailFile(file, bytes = 4000) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text.slice(-bytes);
  } catch {
    return '';
  }
}

function rawGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('请求超时')));
  });
}

async function getJson(url, options) {
  const res = await fetch(url, options);
  const body = await res.json();
  return { status: res.status, body };
}

/** 递归记录安装目录里所有文件的哈希，用来证明「运行时不往安装目录写脏」 */
function hashTree(dir, ignoreNames) {
  const out = new Map();
  const walk = (current, rel) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (ignoreNames && ignoreNames.has(entry.name)) continue;
      const abs = path.join(current, entry.name);
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, next);
      else if (entry.isFile()) out.set(next, crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex'));
    }
  };
  walk(dir, '');
  return out;
}

function spawnLogged(name, command, argv, options) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logPath = path.join(LOG_DIR, `${name}.log`);
  const fd = fs.openSync(logPath, 'a');
  fs.writeSync(fd, `\n=== ${new Date().toISOString()} ${command} ${argv.join(' ')} ===\n`);
  const child = spawn(command, argv, {
    cwd: options.cwd,
    env: { ...baseEnv(), ...options.env },
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  });
  fs.closeSync(fd);
  let exitInfo = null;
  const done = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      exitInfo = { code, signal };
      resolve(exitInfo);
    });
  });
  const handle = {
    child,
    logPath,
    done,
    get exitInfo() {
      return exitInfo;
    },
  };
  return handle;
}

async function forceKill(handle) {
  if (!handle.child || handle.exitInfo) return;
  if (IS_WIN) {
    spawnSync('taskkill', ['/pid', String(handle.child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      handle.child.kill('SIGKILL');
    } catch { /* 已退出 */ }
  }
  await Promise.race([handle.done, sleep(3000)]);
}

/** 停止一个直接拉起的进程；POSIX 上先 SIGTERM，给服务端时间 flush 配置 */
async function stopDirect(handle, graceful) {
  if (!handle || handle.exitInfo) return handle ? handle.exitInfo : null;
  const canSignal = graceful && !IS_WIN;
  if (canSignal) {
    try {
      handle.child.kill('SIGTERM');
    } catch { /* 忽略 */ }
  } else {
    await forceKill(handle);
    return handle.exitInfo;
  }
  const info = await Promise.race([handle.done, sleep(6000).then(() => null)]);
  if (!info) {
    await forceKill(handle);
    return handle.exitInfo;
  }
  return info;
}

async function waitReady(handle, url, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (handle.exitInfo) {
      throw new Error(`进程提前退出（code=${handle.exitInfo.code}）\n${tailFile(handle.logPath)}`);
    }
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return await res.json();
    } catch { /* 还没起来 */ }
    await sleep(150);
  }
  throw new Error(`等待 ${url} 超时\n${tailFile(handle.logPath)}`);
}

/** 起一个 `node <script>` 形态的实例并等到健康检查通过 */
async function startNodeInstance(spec) {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const proc = spawnLogged(`${spec.name}-${port}`, NODE, [spec.script], {
    cwd: spec.cwd,
    env: { ...spec.env, ANIRSS_PORT: String(port) },
  });
  try {
    const health = await waitReady(proc, url);
    return {
      url,
      port,
      health,
      serverLog: proc.logPath,
      stop: (opts = {}) => stopDirect(proc, opts.graceful !== false),
    };
  } catch (err) {
    await stopDirect(proc, false);
    throw err;
  }
}

/** 起一个走 start.sh / start.cmd 的实例 */
async function startWrapperInstance(spec) {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const env = { ...spec.env, ANIRSS_PORT: String(port) };
  const proc = IS_WIN
    ? spawnLogged(`${spec.name}-${port}`, 'cmd.exe', ['/d', '/c', 'start.cmd'], { cwd: spec.cwd, env })
    : spawnLogged(`${spec.name}-${port}`, 'bash', ['start.sh'], { cwd: spec.cwd, env });
  try {
    const health = await waitReady(proc, url);
    return {
      url,
      port,
      health,
      serverLog: proc.logPath,
      stop: (opts = {}) => stopDirect(proc, opts.graceful !== false),
    };
  } catch (err) {
    await stopDirect(proc, false);
    throw err;
  }
}

function assertStateDir(state, dataDir) {
  const norm = (p) => {
    const abs = path.resolve(String(p || ''));
    return IS_WIN ? abs.toLowerCase() : abs;
  };
  assert.strictEqual(norm(state.app.dataDir), norm(dataDir), `状态里的数据目录应为 ${dataDir}`);
}

/** 部署契约：每个形态都要过这一套 */
async function runContract(spec) {
  const checks = [];
  const ok = (label) => checks.push(label);
  const before = hashTree(spec.installRoot, IGNORED_INSTALL_FILES);

  let handle = await spec.start();
  try {
    assert.strictEqual(handle.health.app, 'anirss');
    assert.strictEqual(handle.health.version, VERSION);
    assert.strictEqual(handle.health.port, handle.port);
    ok('健康检查');

    const home = await rawGet(`${handle.url}/`);
    assert.strictEqual(home.status, 200);
    assert.match(home.headers['content-type'] || '', /text\/html/);
    assert.ok(home.headers.etag, '首页应带 ETag');
    const cached = await rawGet(`${handle.url}/`, { 'If-None-Match': home.headers.etag });
    assert.strictEqual(cached.status, 304, 'If-None-Match 应返回 304');
    const asset = await rawGet(`${handle.url}/app.js`, { 'Accept-Encoding': 'gzip' });
    assert.strictEqual(asset.status, 200);
    assert.strictEqual(asset.headers['content-encoding'], 'gzip', 'app.js 应 gzip 传输');
    const css = await rawGet(`${handle.url}/style.css`);
    assert.strictEqual(css.status, 200, '静态样式应随包发布');
    ok('静态资源 · ETag 304 · gzip');

    const state = (await getJson(`${handle.url}/api/state`)).body;
    assertStateDir(state, spec.dataDir);
    assert.ok(Array.isArray(state.subs));
    assert.ok(state.qb && typeof state.qb === 'object');
    ok('数据目录与首启状态');

    const saved = await getJson(`${handle.url}/api/qb/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'http://127.0.0.1:18099', username: 'deploy-check', password: 'secret' }),
    });
    assert.strictEqual(saved.status, 200);
    const wrote = (await getJson(`${handle.url}/api/state`)).body;
    assert.strictEqual(wrote.qb.username, 'deploy-check');
    ok('配置写入');
  } finally {
    await handle.stop({ graceful: true });
  }

  const configPath = path.join(spec.dataDir, 'config.json');
  assert.ok(fs.existsSync(configPath), `退出后应落盘 ${configPath}`);
  const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.strictEqual(onDisk.qb.username, 'deploy-check', '退出后配置应已落盘');
  ok('退出落盘');

  const logAfterStop = tailFile(handle.serverLog, 6000);
  if (!IS_WIN) {
    assert.match(logAfterStop, /SIGTERM received/, 'POSIX 上应走 SIGTERM 优雅退出');
    ok('优雅退出');
  }

  // 重启：同一个安装目录、同一个数据目录，配置必须还在
  handle = await spec.start();
  try {
    const again = (await getJson(`${handle.url}/api/state`)).body;
    assert.strictEqual(again.qb.username, 'deploy-check', '重启后配置应保持');
    assert.strictEqual(again.app.version, VERSION);
    ok('重启后配置保持');
  } finally {
    await handle.stop({ graceful: true });
  }

  const after = hashTree(spec.installRoot, IGNORED_INSTALL_FILES);
  const changed = [];
  for (const [file, digest] of before) {
    if (after.get(file) !== digest) changed.push(file);
  }
  for (const file of after.keys()) {
    if (!before.has(file)) changed.push(`${file}(新增)`);
  }
  assert.deepStrictEqual(changed, [], `运行不应写脏安装目录：${changed.join(', ')}`);
  ok('安装目录只读');
  return checks;
}

async function prepareRelease() {
  const dir = path.join(TMP, 'release');
  fs.mkdirSync(dir, { recursive: true });
  for (const rel of ['app', 'package.json', 'start.sh', 'start.cmd', 'LICENSE']) copyInto(dir, rel);
  if (!IS_WIN) fs.chmodSync(path.join(dir, 'start.sh'), 0o755);
  const dataDir = path.join(TMP, 'data', 'release');
  const name = 'release';
  return {
    name,
    installRoot: dir,
    dataDir,
    start: () => startWrapperInstance({
      name,
      cwd: dir,
      env: { ANIRSS_HOST: '127.0.0.1', ANIRSS_DATA: dataDir },
    }),
  };
}

async function prepareDocker() {
  const dir = path.join(TMP, 'docker');
  fs.mkdirSync(dir, { recursive: true });
  // 严格照 Dockerfile：只 COPY app/ 与 package.json
  for (const rel of ['app', 'package.json']) copyInto(dir, rel);
  const dataDir = path.join(TMP, 'data', 'docker');
  const name = 'docker';
  return {
    name,
    installRoot: dir,
    dataDir,
    start: () => startNodeInstance({
      name,
      cwd: dir,
      script: 'app/server/index.js',
      env: {
        NODE_ENV: 'production',
        ANIRSS_HOST: '0.0.0.0',
        ANIRSS_DATA: dataDir,
        TZ: 'Asia/Shanghai',
      },
    }),
  };
}

function pythonCommand() {
  if (process.env.ANIRSS_PYTHON) return process.env.ANIRSS_PYTHON;
  for (const candidate of ['python3', 'python']) {
    const probe = spawnSync(candidate, ['-c', 'import tarfile,gzip'], { stdio: 'ignore' });
    if (probe.status === 0) return candidate;
  }
  throw new Error('找不到可用的 Python 3，FPK 形态需要 python3（或用 ANIRSS_PYTHON 指定）');
}

function extractTar(archive, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const res = spawnSync('tar', ['-xzf', archive, '-C', dest], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`解包失败 ${archive}：${res.stderr || res.stdout}`);
}

/** 真的构建 FPK，解包成 fnOS 的 target/ 布局 */
async function prepareFpk() {
  const py = pythonCommand();
  const fpk = path.join(TMP, 'dist', `anirss-${VERSION}.fpk`);
  fs.mkdirSync(path.dirname(fpk), { recursive: true });
  const build = spawnSync(py, [path.join(ROOT, 'dev', 'build-fpk.py'), '-o', fpk], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (build.status !== 0) {
    throw new Error(`build-fpk.py 失败：\n${build.stderr || build.stdout}`);
  }
  const outer = path.join(TMP, 'fpk-outer');
  extractTar(fpk, outer);
  for (const rel of ['manifest', 'cmd/main', 'app.tgz', 'config/privilege', 'wizard/uninstall']) {
    assert.ok(fs.existsSync(path.join(outer, rel)), `安装包里缺少 ${rel}`);
  }
  const appdest = path.join(TMP, 'apps', 'anirss', 'target');
  extractTar(path.join(outer, 'app.tgz'), appdest);
  for (const rel of ['server/index.js', 'www/index.html', 'www/app.js', 'config/privilege']) {
    assert.ok(fs.existsSync(path.join(appdest, rel)), `app.tgz 里缺少 ${rel}`);
  }
  const dataDir = path.join(TMP, 'data', 'fpk');
  return { outer, appdest, dataDir };
}

/** app.tgz 里的服务端能不能直接跑（等价于把包解开后手工启动） */
async function prepareFpkPayload(appdest, dataDir) {
  const name = 'fpk-payload';
  return {
    name,
    installRoot: appdest,
    dataDir,
    start: () => startNodeInstance({
      name,
      cwd: appdest,
      script: 'server/index.js',
      env: {
        NODE_ENV: 'production',
        ANIRSS_HOST: '127.0.0.1',
        ANIRSS_DATA: dataDir,
      },
    }),
  };
}

/** 走 fnOS 生命周期脚本：cmd/main start|status|stop（Windows 没有 bash 语义，跳过） */
async function prepareFpkLifecycle(outer, appdest) {
  const name = 'fpk-lifecycle';
  const dataDir = path.join(TMP, 'data', 'fpk-lifecycle');
  const vardir = path.join(TMP, 'apps', 'anirss', 'var');
  const nodeDir = path.dirname(NODE);
  let lastPort = 0;
  const call = (action) => spawnSync('bash', [path.join(outer, 'cmd', 'main'), action], {
    env: {
      ...baseEnv(),
      PATH: `${nodeDir}${path.delimiter}${process.env.PATH || ''}`,
      TRIM_APPDEST: appdest,
      TRIM_PKGVAR: vardir,
      TRIM_APPNAME: 'anirss',
      TRIM_SERVICE_PORT: String(lastPort),
      ANIRSS_DATA: dataDir,
    },
    encoding: 'utf8',
  });
  return {
    name,
    installRoot: appdest,
    dataDir,
    start: async () => {
      lastPort = await freePort();
      const started = call('start');
      assert.strictEqual(started.status, 0, `cmd/main start 失败：${started.stdout || started.stderr}`);
      const status = call('status');
      assert.strictEqual(status.status, 0, 'cmd/main status 应报告运行中');
      assert.ok(fs.existsSync(path.join(vardir, 'app.pid')), '应写入 pid 文件');
      const url = `http://127.0.0.1:${lastPort}`;
      const probe = { get exitInfo() { return null; }, logPath: path.join(vardir, 'app.log') };
      let health;
      try {
        health = await waitReady(probe, url);
      } catch (err) {
        call('stop');
        throw err;
      }
      return {
        url,
        port: lastPort,
        health,
        serverLog: path.join(vardir, 'app.log'),
        stop: async () => {
          const stopped = call('stop');
          assert.strictEqual(stopped.status, 0, `cmd/main stop 失败：${stopped.stdout || stopped.stderr}`);
          return { code: 0, signal: null };
        },
      };
    },
  };
}

/** 旧版 qbrss 数据目录迁移：QBRSS_DATA 里的 config.json 应被搬到新目录 */
async function runMigration() {
  const dir = path.join(TMP, 'migration');
  fs.mkdirSync(dir, { recursive: true });
  for (const rel of ['app', 'package.json']) copyInto(dir, rel);
  const legacy = path.join(TMP, 'legacy-qbrss');
  const dataDir = path.join(TMP, 'data', 'migration');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'config.json'), JSON.stringify({
    version: 1,
    qb: { baseUrl: 'http://127.0.0.1:18099', username: 'legacy-user', password: '', skipTlsVerify: false },
    subs: [],
    paths: [],
    bases: [],
    extras: [],
    downloads: [],
    logs: [],
  }, null, 2));

  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const proc = spawnLogged('migration', NODE, ['app/server/index.js'], {
    cwd: dir,
    env: {
      ANIRSS_HOST: '127.0.0.1',
      ANIRSS_PORT: String(port),
      ANIRSS_DATA: dataDir,
      QBRSS_DATA: legacy,
    },
  });
  try {
    const health = await waitReady(proc, url);
    assert.strictEqual(health.app, 'anirss');
    const state = (await getJson(`${url}/api/state`)).body;
    assert.strictEqual(state.qb.username, 'legacy-user', '应迁移旧配置');
    const log = tailFile(proc.logPath, 8000);
    assert.match(log, /已从旧数据目录迁移/, '日志里应说明迁移来源');
    assert.ok(fs.existsSync(path.join(dataDir, 'config.json')), '迁移后新目录应有 config.json');
    return ['旧数据目录迁移', '迁移后配置生效'];
  } finally {
    await stopDirect(proc, true);
  }
}

async function main() {
  const modes = args.modes.length ? args.modes : ALL_MODES;
  console.log(`部署矩阵：${modes.join(' / ')}（临时目录 ${TMP}）`);
  const results = [];

  for (const mode of modes) {
    try {
      let checks;
      if (mode === 'migration') {
        checks = await runMigration();
      } else if (mode === 'release') {
        checks = await runContract(await prepareRelease());
      } else if (mode === 'docker') {
        checks = await runContract(await prepareDocker());
      } else if (mode === 'fpk') {
        const { outer, appdest, dataDir } = await prepareFpk();
        const payloadChecks = await runContract(await prepareFpkPayload(appdest, dataDir));
        let lifecycleChecks = [];
        if (!IS_WIN) {
          lifecycleChecks = await runContract(await prepareFpkLifecycle(outer, appdest));
        }
        checks = [
          ...payloadChecks.map((c) => `包内启动/${c}`),
          ...(IS_WIN
            ? ['生命周期脚本（POSIX 专属，本机跳过）']
            : lifecycleChecks.map((c) => `cmd\\/main/${c}`)),
        ];
      }
      results.push({ mode, ok: true });
      console.log(`✓ ${mode}\n    ${checks.join('\n    ')}`);
    } catch (err) {
      results.push({ mode, ok: false, error: err });
      console.error(`✗ ${mode}：${err.message}`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n部署矩阵：${results.length - failed.length}/${results.length} 通过`);
  if (args.keep || failed.length) console.log(`临时目录保留在 ${TMP}`);
  else fs.rmSync(TMP, { recursive: true, force: true });
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((err) => {
  console.error('部署矩阵异常：', err && err.stack ? err.stack : err);
  console.log(`临时目录保留在 ${TMP}`);
  process.exitCode = 1;
});
