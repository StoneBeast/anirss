#!/usr/bin/env node
'use strict';

/**
 * 一条命令跑完浏览器交互测试。
 *
 * 以前跑 dev/ui-*.js 要手工做三件事：起演示数据、起 anirss、手动开一个带
 * --remote-debugging-port=9222 的 Chrome。这个脚本把三步都包了：
 *
 *   1. node dev/demo.js              假 qB(18080) + 假 RSS(18081) + 演示配置
 *   2. node app/server/index.js      演示实例 8777
 *   3. Chrome headless               远程调试 9222，跑完自动关
 *   4. 依次执行 dev/ui-actions.js 等脚本，汇总结果
 *
 * 用法：
 *   node dev/run-ui.js                          # 全部交互用例
 *   node dev/run-ui.js --only ui-modal-check,ui-history-check
 *   node dev/run-ui.js --headed                 # 想看着它点（本机有桌面时）
 *   node dev/run-ui.js --list                   # 只列可用脚本
 *   ANIRSS_CHROME="C:\...\chrome.exe" node dev/run-ui.js
 *
 * 注意：三个端口（8777 / 9222 / 18080 / 18081）会被占用，跑之前先关掉手头的演示实例。
 * 截图脚本（ui-shot.js）会改 docs/，空数据引导（ui-empty.js）需要另一个空实例，都不在默认列表里。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const IS_WIN = process.platform === 'win32';
const APP_PORT = 8777;
const CDP_PORT = 9222;
const QB_PORT = 18080;
const RSS_PORT = 18081;
const APP = `http://127.0.0.1:${APP_PORT}`;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const DEMO_DATA = path.resolve(ROOT, '..', 'work', 'anirss-demo-data');

const DEFAULT_SCRIPTS = [
  'ui-actions.js',
  'ui-subs-check.js',
  'ui-patch-check.js',
  'ui-modal-check.js',
  'ui-history-check.js',
];

const args = parseArgs(process.argv.slice(2));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'anirss-ui-'));
const children = [];
let chromeProfile = '';
let cleaned = false;

function parseArgs(argv) {
  const out = { only: [], headed: false, keep: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') {
      const v = argv[++i];
      if (!v) throw new Error('--only 需要脚本名，例如 --only ui-modal-check');
      out.only = v.split(',').map((s) => s.trim()).filter(Boolean).map((s) => (s.endsWith('.js') ? s : `${s}.js`));
    } else if (a === '--headed') out.headed = true;
    else if (a === '--keep') out.keep = true;
    else if (a === '--list') out.list = true;
    else if (a === '-h' || a === '--help') {
      console.log('用法：node dev/run-ui.js [--only a,b] [--headed] [--keep] [--list]');
      process.exit(0);
    } else {
      throw new Error(`不认识的参数：${a}`);
    }
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

function waitTcp(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (Date.now() > deadline) return reject(new Error(`等待端口 ${port} 超时`));
      const sock = net.connect(port, '127.0.0.1');
      sock.once('connect', () => {
        sock.destroy();
        resolve();
      });
      sock.once('error', () => {
        sock.destroy();
        setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

async function waitHttp(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch { /* 还没起来 */ }
    await sleep(200);
  }
  throw new Error(`等待 ${url} 超时`);
}

function tail(file, bytes = 3000) {
  try {
    return fs.readFileSync(file, 'utf8').slice(-bytes);
  } catch {
    return '';
  }
}

function spawnLogged(name, command, argv, options) {
  const logPath = path.join(TMP, `${name}.log`);
  const fd = fs.openSync(logPath, 'a');
  const child = spawn(command, argv, {
    cwd: options.cwd || ROOT,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  });
  fs.closeSync(fd);
  children.push({ name, child, logPath });
  return { child, logPath };
}

function killTree(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null) return;
  if (IS_WIN) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      child.kill(signal);
    } catch { /* 已退出 */ }
  }
}

function findChrome() {
  if (process.env.ANIRSS_CHROME) {
    if (!fs.existsSync(process.env.ANIRSS_CHROME)) throw new Error(`ANIRSS_CHROME 指向的文件不存在：${process.env.ANIRSS_CHROME}`);
    return process.env.ANIRSS_CHROME;
  }
  const candidates = IS_WIN
    ? [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      : ['/usr/bin/google-chrome', '/opt/google/chrome/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('找不到 Chrome / Edge，请用 ANIRSS_CHROME 指定可执行文件路径');
}

function chromeMajor(exe) {
  try {
    const res = spawnSync(exe, ['--version'], { encoding: 'utf8' });
    const text = `${res.stdout || ''}${res.stderr || ''}`;
    const match = text.match(/(\d+)\.\d+\.\d+/);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

async function launchChrome(exe) {
  chromeProfile = path.join(TMP, 'chrome-profile');
  fs.mkdirSync(chromeProfile, { recursive: true });
  const headlessFlag = chromeMajor(exe) >= 109 ? '--headless=new' : '--headless';
  const argv = [
    headlessFlag,
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${chromeProfile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--window-size=1280,900',
  ];
  if (args.headed) argv.splice(0, 1);
  if (!IS_WIN) argv.push('--no-sandbox');
  argv.push('about:blank');
  const proc = spawnLogged('chrome', exe, argv, {});
  try {
    await waitHttp(`${CDP}/json/version`, 20000);
  } catch (err) {
    throw new Error(`${err.message}\n${tail(proc.logPath)}`);
  }
  return proc;
}

async function closeChrome() {
  try {
    const info = await (await fetch(`${CDP}/json/version`)).json();
    const ws = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    await sleep(800);
  } catch { /* Chrome 可能已经退出 */ }
}

function runScript(script) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(NODE, [path.join('dev', script)], {
      cwd: ROOT,
      env: { ...process.env, ANIRSS_CDP: CDP, ANIRSS_APP: APP },
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('exit', (code) => resolve({ script, code: code === null ? 1 : code, ms: Date.now() - started }));
  });
}

async function main() {
  if (args.list) {
    for (const script of DEFAULT_SCRIPTS) console.log(script.replace(/\.js$/, ''));
    return;
  }
  const scripts = args.only.length ? args.only : DEFAULT_SCRIPTS;
  for (const script of scripts) {
    if (!fs.existsSync(path.join(ROOT, 'dev', script))) throw new Error(`没有这个 UI 脚本：dev/${script}`);
  }

  for (const port of [APP_PORT, CDP_PORT, QB_PORT, RSS_PORT]) {
    if (!(await portFree(port))) {
      throw new Error(`端口 ${port} 已被占用，先关掉手头的演示实例 / Chrome（或改掉 dev/run-ui.js 里的端口约定）`);
    }
  }

  const chromeExe = findChrome();
  console.log(`浏览器：${chromeExe}`);
  console.log(`临时目录：${TMP}`);

  console.log('[1/3] 启动假 qBittorrent / 假 RSS / 演示配置…');
  const demo = spawnLogged('demo', NODE, ['dev/demo.js'], {});
  try {
    await Promise.all([waitTcp(QB_PORT), waitTcp(RSS_PORT)]);
  } catch (err) {
    const detail = demo.child.exitCode !== null ? `\n${tail(demo.logPath)}` : '';
    throw new Error(`${err.message}${detail}`);
  }

  console.log('[2/3] 启动演示实例…');
  const server = spawnLogged('server', NODE, ['app/server/index.js'], {
    env: {
      ANIRSS_DEV_ALLOW_CUSTOM_BASES: '1',
      ANIRSS_DATA: DEMO_DATA,
      ANIRSS_PORT: String(APP_PORT),
      ANIRSS_HOST: '127.0.0.1',
    },
  });
  try {
    await waitHttp(`${APP}/api/health`);
  } catch (err) {
    throw new Error(`${err.message}\n${tail(server.logPath)}`);
  }

  console.log('[3/3] 启动 Chrome（headless）…');
  const chrome = await launchChrome(chromeExe);

  const results = [];
  for (const script of scripts) {
    console.log(`\n▶ ${script}`);
    results.push(await runScript(script));
  }

  await closeChrome();
  killTree(chrome.child);

  const failed = results.filter((r) => r.code !== 0);
  console.log('\nUI 交互测试结果：');
  for (const r of results) {
    console.log(`${r.code === 0 ? '✓' : '✗'} ${r.script}（${(r.ms / 1000).toFixed(1)}s）`);
  }
  console.log(`${results.length - failed.length}/${results.length} 通过`);
  process.exitCode = failed.length ? 1 : 0;
}

function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const { child } of children.slice().reverse()) killTree(child);
  if (!args.keep && chromeProfile) {
    try {
      fs.rmSync(chromeProfile, { recursive: true, force: true });
    } catch { /* Chrome 还没完全退出 */ }
  }
  if (args.keep) console.log(`临时目录保留在 ${TMP}`);
  else {
    try {
      fs.rmSync(TMP, { recursive: true, force: true });
    } catch { /* 忽略 */ }
  }
}

process.on('SIGINT', () => {
  console.log('\n已中断，正在清理…');
  cleanup();
  process.exit(130);
});
process.on('exit', cleanup);

main().catch((err) => {
  console.error(`\nUI 测试启动失败：${err.message}`);
  process.exitCode = 1;
}).finally(() => {
  cleanup();
});
