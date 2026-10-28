'use strict';

/**
 * 遮罩点击保护验收（CDP）：点在弹窗外面不再把表单误关掉。
 *
 * 覆盖：
 *   1. 空表单点遮罩 → 关（原有行为保留）
 *   2. 填过内容点遮罩 → 不关，并提示改用「取消」/「×」
 *   3. 在输入框里按下、拖到弹窗外松手 → 不关（以前这里会直接关掉，是主要误触来源）
 *   4. 点弹窗内部空白处 → 不关
 *   5. 填过内容按 Esc → 关（显式退出仍然有效）
 *   6. 填过内容点「取消」→ 关
 *
 * 前提：Chrome 9222 + anirss 实例 8777（同 dev/ui-actions.js）。
 * 可用 ANIRSS_CDP / ANIRSS_APP 覆盖地址，例如验证打包产物：ANIRSS_APP=http://127.0.0.1:8788
 */

const CDP = process.env.ANIRSS_CDP || 'http://127.0.0.1:9222';
const APP = process.env.ANIRSS_APP || 'http://127.0.0.1:8777';

let ws;
let nextId = 1;
const pending = new Map();
const pass = [];
const fail = [];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout ' + method)); }, 15000);
    pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

async function connect() {
  const targets = await (await fetch(CDP + '/json/list')).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('没有可用的页面 target');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      p(msg.result);
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails.exception && r.exceptionDetails.exception.description;
    throw new Error(d || r.exceptionDetails.text);
  }
  return r.result.value;
}

// 真实鼠标事件：mousedown / mousemove / mouseup 会经过浏览器的命中测试与 click 合成
async function mouse(type, x, y, buttons) {
  await send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons: buttons === undefined ? 1 : buttons, clickCount: 1,
    pointerType: 'mouse',
  });
}

async function clickAt(x, y) {
  await mouse('mousePressed', x, y, 1);
  await mouse('mouseReleased', x, y, 0);
  await sleep(120);
}

async function drag(x1, y1, x2, y2) {
  await mouse('mousePressed', x1, y1, 1);
  await sleep(30);
  await mouse('mouseMoved', (x1 + x2) / 2, (y1 + y2) / 2, 1);
  await mouse('mouseMoved', x2, y2, 1);
  await sleep(30);
  await mouse('mouseReleased', x2, y2, 0);
  await sleep(150);
}

async function pressEscape() {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(120);
}

function check(name, ok, detail) {
  if (ok) pass.push(name);
  else fail.push(name + (detail ? ' — ' + detail : ''));
}

const modalOpen = () => evaluate(`!!document.querySelector('#modal-root form#base-form')`);

/** 打开「站点」弹窗，并返回遮罩/卡片/输入框的关键坐标 */
async function openModal() {
  await evaluate(`document.querySelector('#view [data-action="open-base"]').click()`);
  await sleep(320); // 越过 250ms 的开窗保护窗口
  const geo = await evaluate(`(() => {
    const bd = document.querySelector('#modal-root .modal-backdrop');
    const md = document.querySelector('#modal-root .modal');
    const inp = document.querySelector('#modal-root #base-name');
    if (!bd || !md || !inp) return null;
    const b = bd.getBoundingClientRect();
    const m = md.getBoundingClientRect();
    const i = inp.getBoundingClientRect();
    return {
      backdrop: [b.left + 6, b.top + Math.max(40, b.height / 2)],
      panelGap: [m.left + 14, m.top + m.height - 8],
      input: [i.left + i.width / 2, i.top + i.height / 2],
      viewport: [innerWidth, innerHeight],
    };
  })()`);
  if (!geo) throw new Error('弹窗没打开');
  return geo;
}

async function typeIntoInput(pt) {
  await clickAt(pt[0], pt[1]);
  await send('Input.insertText', { text: 'Mikan' });
  await sleep(80);
}

async function main() {
  await connect();
  await send('Page.navigate', { url: APP + '/#/library' });
  await sleep(600);
  // 同 URL 只有 hash 变化时浏览器不会重载文档，必须显式重载才能拿到最新的 app.js
  await send('Page.reload', { ignoreCache: true });
  await sleep(1200);

  // 等首屏数据到位（站点页有「新增」按钮）
  for (let i = 0; i < 40; i++) {
    if (await evaluate(`!!document.querySelector('#view [data-action="open-base"]')`)) break;
    await sleep(250);
  }

  // 1. 空表单点遮罩 → 关闭
  let geo = await openModal();
  check('打开站点弹窗', await modalOpen());
  await clickAt(geo.backdrop[0], geo.backdrop[1]);
  check('空表单点遮罩 → 关闭', !(await modalOpen()));

  // 2. 填过内容点遮罩 → 不关，并提示
  geo = await openModal();
  await typeIntoInput(geo.input);
  check('输入后表单标记为已编辑', await evaluate(`!!document.querySelector('#modal-root #base-name').value`));
  await clickAt(geo.backdrop[0], geo.backdrop[1]);
  check('填过内容点遮罩 → 不关', await modalOpen());
  check('填过内容点遮罩 → 给出提示', await evaluate(
    `[...document.querySelectorAll('.toast-text')].some((e) => e.textContent.includes('表单已填写内容'))`,
  ));

  // 3. 在输入框里按下、拖到弹窗外松手 → 不关（以前这里是主要误触路径）
  await drag(geo.input[0], geo.input[1], geo.backdrop[0], geo.backdrop[1]);
  check('输入框内按下→弹窗外松手 → 不关', await modalOpen());

  // 4. 点弹窗内部空白处 → 不关
  await clickAt(geo.panelGap[0], geo.panelGap[1]);
  check('点弹窗内部空白 → 不关', await modalOpen());

  // 5. 填过内容按 Esc → 关（显式退出不受影响）
  await pressEscape();
  check('填过内容按 Esc → 关闭', !(await modalOpen()));

  // 6. 填过内容点「取消」→ 关
  geo = await openModal();
  await typeIntoInput(geo.input);
  await evaluate(`document.querySelector('#modal-root form#base-form [data-action="close-modal"]').click()`);
  await sleep(150);
  check('填过内容点「取消」→ 关闭', !(await modalOpen()));

  // 收尾：把输入留下的 toast 清掉
  await evaluate(`document.querySelectorAll('.toast').forEach((t) => t.remove())`);

  console.log('');
  for (const name of pass) console.log('✓ ' + name);
  for (const name of fail) console.log('✗ ' + name);
  console.log('');
  if (fail.length) {
    console.log(`遮罩点击保护：${fail.length} 项未通过`);
    process.exit(1);
  }
  console.log(`遮罩点击保护全部通过（${pass.length} 项）`);
  process.exit(0);
}

main().catch((e) => {
  console.error('验收脚本出错：', e && e.message ? e.message : e);
  process.exit(1);
});
