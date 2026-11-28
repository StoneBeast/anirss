import { esc, fmtBytes, fmtSpeed, icon, relTime } from './ui.mjs';

function pathTemplatePanelHTML(t) {
  const name = t ? esc(t.name) : '';
  const raw = t
    ? `模板 <code>${esc(t.template)}</code>${t.parsed.count ? ` · 共 ${t.parsed.count} 个空` : ''}${t.parsed.hasName ? ` · <code>${'${name}'}</code> 使用追番名称` : ''}`
    : '';
  const vars = t
    ? t.parsed.indices.map((idx) => `
        <label class="template-var">
          <span>变量 ${idx}</span>
          <input class="input" type="text" data-template-var="${idx}" value="${esc(t.values[idx] || '')}" placeholder="填写第 ${idx} 个空" autocomplete="off" spellcheck="false">
        </label>`).join('')
    : '';
  return `
    <div class="path-template ${t ? '' : 'hidden'}" id="path-template">
      <div class="path-template-head">
        <strong id="path-template-name">${name}</strong>
        <span class="spacer"></span>
        <button class="btn btn-sm btn-ghost" type="button" data-action="path-template-custom">改为自定义</button>
      </div>
      <div class="field-hint" id="path-template-raw">${raw}</div>
      <div class="template-vars" id="path-template-vars">${vars}</div>
    </div>`;
}

function qbStateText(state) {
  const map = {
    downloading: '下载中',
    stalledDL: '等待下载',
    metaDL: '获取元数据',
    forcedDL: '下载中',
    uploading: '做种中',
    stalledUP: '做种中',
    forcedUP: '做种中',
    pausedDL: '已暂停',
    pausedUP: '已暂停',
    stoppedDL: '已暂停',
    stoppedUP: '已暂停',
    queuedDL: '排队中',
    queuedUP: '排队中',
    checkingDL: '校验中',
    checkingUP: '校验中',
    checkingResumeData: '校验中',
    allocating: '分配空间',
    moving: '移动中',
    error: '出错',
    missingFiles: '文件缺失',
  };
  return map[state] || state || '已提交';
}

function qbStateBadge(state) {
  if (!state) return 'blue';
  if (/error|missing/i.test(state)) return 'red';
  if (/paused|stopped/i.test(state)) return 'gray';
  if (/upload|stall.*UP/i.test(state)) return 'green';
  return 'blue';
}

function etaText(eta) {
  const n = Number(eta);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n > 86400) return '>1 天';
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  if (h) return `${h} 小时 ${m} 分`;
  if (m) return `${m} 分`;
  return `${n} 秒`;
}

function hardlinkRowHTML(x) {
  const h = x.hardlink;
  if (!h || !h.dest) return '';
  let cls = '';
  let state = '下载后自动入库';
  if (h.enabled === false) {
    state = '入库已关闭';
  } else if (h.error && !/等待下载完成/.test(h.error)) {
    cls = h.done ? 'warn' : 'bad';
    state = h.error;
  } else if (h.done) {
    const counts = [h.videos && `${h.videos} 集`, h.subs && `${h.subs} 份字幕`].filter(Boolean);
    const available = h.linked || h.existed;
    cls = h.conflicts ? 'warn' : (available ? 'ok' : '');
    state = available ? `已入库${counts.length ? ` · ${counts.join(' / ')}` : ''}` : '没有新增入库文件';
    if (h.conflicts) state += ` · ${h.conflicts} 个同名冲突`;
  } else if (Number(x.qb && x.qb.progress) >= 0.9999) {
    state = '等待入库';
  }
  return `<div class="extra-hl ${cls}">${icon('link', 14)}<span class="extra-hl-state">${esc(state)}</span></div>`;
}

function extraCardHTML(x) {
  const qb = x.qb;
  const progress = Number(qb?.progress) || 0;
  const pct = Math.max(0, Math.min(progress >= 0.9999 ? 100 : 99, Math.round(progress * 100)));
  const state = qb?.state || (x.paused ? 'pausedDL' : '');
  const h = x.hardlink;
  const details = [
    ['来源', x.source === 'file' ? '种子文件' : '磁力链接'],
    ['添加时间', relTime(x.createdAt)],
    ['下载目录', x.savePath || 'qB 默认路径'],
    ['入库目录', h && (h.destResolved || h.dest)],
    ['分类', x.category],
    ['标签', x.tags],
    ['文件大小', qb?.size ? fmtBytes(qb.size) : ''],
    ['预计剩余', state === 'downloading' || state === 'forcedDL' ? etaText(qb?.eta) : ''],
  ];
  const id = esc(x.id);
  return `
    <article class="extra-card ${x.ok ? '' : 'failed'}" data-key="${id}">
      <div class="extra-title-row">
        <h3 class="extra-name">${esc(x.name)}</h3>
        ${x.episodeLabel ? `<span class="extra-episode">${esc(x.episodeLabel)}</span>` : ''}
        <span class="badge ${x.ok ? qbStateBadge(state) : 'red'}">${x.ok ? esc(qbStateText(state)) : '提交失败'}</span>
      </div>
      <div class="extra-status">
        ${x.ok && qb && pct < 100 ? `<div class="extra-progress"><div class="progress" role="progressbar" aria-label="下载进度" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div><span>${pct}%${qb.dlspeed ? ` · ${fmtSpeed(qb.dlspeed)}` : ''}</span></div>` : ''}
        ${hardlinkRowHTML(x)}
        ${x.error ? `<div class="sub-error">${icon('alert', 12)} ${esc(x.error)}</div>` : ''}
      </div>
      <details class="extra-disclosure extra-card-details" id="extra-details-${id}">
        <summary aria-label="${esc(x.name)}的详情和操作">详情 ${icon('chevron-down', 14)}</summary>
        <div class="extra-disclosure-body">
          <dl class="extra-facts">${details.filter(([, value]) => value).map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
          <div class="extra-actions">
            <button class="btn btn-sm" type="button" data-action="extra-subs" data-id="${id}">${icon('upload', 14)}字幕管理${x.subs?.length ? ` <span class="chip">${x.subs.length} 个外挂字幕</span>` : ''}</button>
            ${x.ok ? `<button class="btn btn-sm" type="button" data-action="extra-hardlink-edit" data-id="${id}">${icon('edit', 14)}入库设置</button>` : ''}
            ${h?.dest && h.enabled !== false ? `<button class="btn btn-sm" type="button" data-action="extra-hardlink" data-id="${id}">${icon('link', 14)}立即入库</button>` : ''}
            ${x.magnet || x.hash ? `<button class="btn btn-sm" type="button" data-action="extra-copy" data-id="${id}">${icon('copy', 14)}复制磁力链接</button>` : ''}
          </div>
          <div class="extra-actions extra-danger-actions">
            <button class="btn btn-sm btn-ghost" type="button" data-action="extra-delete" data-id="${id}">${icon('trash', 14)}仅删除记录</button>
            ${x.ok ? `<button class="btn btn-sm btn-danger" type="button" data-action="extra-delete-torrent" data-id="${id}">${icon('x', 14)}删除任务和文件</button>` : ''}
          </div>
        </div>
      </details>
    </article>`;
}

export function viewExtras(d, form) {
  const extras = d.extras || [];
  const qbOk = !!(d.qb && d.qb.lastTest && d.qb.lastTest.ok);
  const hl = d.hardlink || {
    mode: 'season', videoExts: '', subExts: '', excludeDirs: '', excludeTags: '',
    includeFonts: false, stripRoot: false, renamePattern: '${name} - ${episode2}', defaultDest: '',
  };
  return `
    <header class="extra-heading">
      <div class="page-head extra-page-head">
        <div class="extra-page-heading">
          <span class="extra-mark" aria-hidden="true">${icon('nav-extras', 28)}</span>
          <h1 class="page-title">补番</h1>
        </div>
        <div class="page-actions">
          <button class="btn" data-action="extras-status">${icon('refresh')}刷新状态</button>
        </div>
      </div>
      ${qbOk ? '' : `<div class="notice amber">${icon('alert')}<div>还没有成功连接 qBittorrent，<a href="#/connection">前往连接设置</a>。</div></div>`}
    </header>

    <div class="extra-controls">${extraControlsHTML(d.paths, hl, form)}</div>

    <section class="extra-records" aria-labelledby="extra-records-title">
      <div class="section-head">
        <h2 id="extra-records-title">补番记录</h2>
        <span class="extra-count">${extras.length} 条</span>
      </div>
      ${extras.length
        ? `<div class="extra-list">${extras.map(extraCardHTML).join('')}</div>`
        : `<div class="extra-empty">${icon('nav-downloads', 28)}<p>还没有补番记录</p></div>`}
    </section>`;
}

function extraControlsHTML(paths, hl, { preview, pathTemplate, libraryState }) {
  const presetOptions = [
    '<option value="">自定义 / qBittorrent 默认路径</option>',
    ...paths.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} — ${esc(p.path)}</option>`),
  ].join('');
  const hardlinkPresetOptions = [
    '<option value="">自定义 / 不选预设</option>',
    ...paths.map((p) => `<option value="${esc(p.id)}" data-path="${esc(p.path)}">${esc(p.name)} — ${esc(p.path)}</option>`),
  ].join('');
  return `
    <div class="card extra-compose">
      <div class="card-head">
        <h2 class="card-title">新增补番</h2>
      </div>
      <div class="card-body">
        <form id="extra-form" class="form" autocomplete="off">
          <div class="form-grid">
            <div class="field full">
              <label class="field-label" for="x-magnets">磁力链接</label>
              <textarea class="input mono" id="x-magnets" rows="3" placeholder="magnet:?xt=urn:btih:…&#10;每行一条，可留空只用种子文件" spellcheck="false"></textarea>
            </div>
            <div class="field">
              <label class="field-label" for="x-files">种子文件 <span class="tip">可多选，单个 ≤ 8MB</span></label>
              <input class="input" id="x-files" type="file" accept=".torrent,application/x-bittorrent" multiple>
            </div>
            <div class="field">
              <label class="field-label" for="f-name">名称</label>
              <input class="input" id="f-name" placeholder="留空自动用磁力或种子文件名" maxlength="120">
              <div class="field-hint" id="f-name-hint"></div>
            </div>
          </div>
          <details class="extra-disclosure" id="extra-download-options">
            <summary><span class="extra-summary-label">${icon('nav-downloads', 17)}下载选项</span>${icon('chevron-down', 16)}</summary>
            <div class="extra-disclosure-body form-grid">
              <div class="field">
                <label class="field-label" for="f-path-preset">存储路径预设</label>
                <select class="select" id="f-path-preset">${presetOptions}</select>
              </div>
              <div class="field">
                <label class="field-label" for="f-savepath">保存路径</label>
                <input class="input mono" id="f-savepath" placeholder="留空 = qBittorrent 默认路径" spellcheck="false">
                <div class="field-hint">支持 <code>${'${name}'}</code> 自动填入补番名称</div>
              </div>
              ${pathTemplatePanelHTML(pathTemplate)}
              <div class="field">
                <label class="field-label" for="x-category">分类</label>
                <input class="input" id="x-category" placeholder="例如 anime">
              </div>
              <div class="field">
                <label class="field-label" for="x-tags">标签</label>
                <input class="input" id="x-tags" placeholder="逗号分隔">
              </div>
              <label class="check full"><input type="checkbox" id="x-paused"><span>添加后暂停</span></label>
            </div>
          </details>
          <details class="extra-disclosure" id="extra-library-options">
            <summary><span class="extra-summary-label">${icon('nav-library', 17)}<span>媒体库入库 <small id="extra-library-state">${esc(libraryState)}</small></span></span>${icon('chevron-down', 16)}</summary>
            <div class="extra-disclosure-body form-grid">
              <div class="field full">
                <label class="check"><input type="checkbox" id="h-enabled" checked><span>下载完成后自动入库</span></label>
              </div>
              <div class="field">
                <label class="field-label" for="h-path-preset">入库路径预设</label>
                <select class="select" id="h-path-preset">${hardlinkPresetOptions}</select>
              </div>
              <div class="field">
                <label class="field-label" for="h-season">季号</label>
                <input class="input" id="h-season" type="number" min="0" max="999" step="1" value="1">
              </div>
              <div class="field full">
                <label class="field-label" for="h-dest">入库目录</label>
                <input class="input mono" id="h-dest" placeholder="例如 /media/动画/${'${name}'}/Season ${'${season}'}" spellcheck="false">
                <div class="field-hint${preview.bad ? ' bad' : ''}" id="h-dest-preview">${esc(preview.text)}</div>
                <button class="btn btn-ghost btn-sm extra-probe" type="button" data-action="hardlink-probe">${icon('search', 12)}检查目录权限</button>
              </div>
              <details class="extra-disclosure full" id="extra-episode-options" ${hl.mode === 'mirror' ? 'hidden' : ''}>
                <summary>集数与命名 ${icon('chevron-down', 16)}</summary>
                <fieldset class="extra-disclosure-body form-grid" ${hl.mode === 'mirror' ? 'disabled' : ''}>
                  <label class="check full"><input type="checkbox" id="h-rename"><span>按集数重命名</span></label>
                  <div class="field">
                    <label class="field-label" for="h-voffset">集数偏移</label>
                    <input class="input" id="h-voffset" type="number" min="-999" max="999" step="1" value="0">
                    <div class="field-hint">下载是 01–12、目标是 13–24 → 填 +12；视频和字幕一起平移</div>
                  </div>
                  <div class="field">
                    <label class="field-label" for="h-soffset">字幕偏移</label>
                    <input class="input" id="h-soffset" type="number" min="-999" max="999" step="1" value="" placeholder="留空 = 跟随整体偏移">
                    <div class="field-hint">字幕已用目标集数时，填 0</div>
                  </div>
                </fieldset>
              </details>
            </div>
          </details>
          <div class="btn-row extra-submit">
            <button class="btn btn-primary" type="submit">${icon('plus')}添加下载</button>
          </div>
        </form>
      </div>
    </div>

    <details class="card extra-disclosure extra-global-settings" id="extra-global-settings">
      <summary><span class="extra-summary-label">${icon('nav-connection', 17)}全局入库设置</span>${icon('chevron-down', 16)}</summary>
      <div class="extra-disclosure-body">
        <form id="hardlink-form" class="form" autocomplete="off">
          <div class="form-grid">
            <div class="field">
              <label class="field-label" for="hl-mode">链接内容</label>
              <select class="select" id="hl-mode">
                <option value="season" ${hl.mode === 'mirror' ? '' : 'selected'}>正片 + 字幕（平铺到季目录）</option>
                <option value="mirror" ${hl.mode === 'mirror' ? 'selected' : ''}>全部文件（保持种子内相对路径）</option>
              </select>
              <div class="field-hint">自动跳过 CDs、Scans、NCOP 等</div>
            </div>
            <div class="field">
              <label class="field-label" for="hl-default-dest">默认目标模板</label>
              <input class="input mono" id="hl-default-dest" value="${esc(hl.defaultDest)}" placeholder="/pathb/动画/${'${name}'}/Season ${'${season}'}" spellcheck="false">
            </div>
            <div class="field">
              <label class="field-label" for="hl-video-exts">视频扩展名</label>
              <input class="input mono" id="hl-video-exts" value="${esc(hl.videoExts)}" placeholder="mkv,mp4,ts" spellcheck="false">
            </div>
            <div class="field">
              <label class="field-label" for="hl-sub-exts">字幕扩展名</label>
              <input class="input mono" id="hl-sub-exts" value="${esc(hl.subExts)}" placeholder="ass,srt,ssa" spellcheck="false">
              <div class="field-hint">同名字幕、或同集数字幕（含 subs/ 目录）会一起链接</div>
            </div>
            <div class="field">
              <label class="field-label" for="hl-rename-pattern">重命名模板 <span class="tip">勾选「按集数重命名」时使用</span></label>
              <input class="input mono" id="hl-rename-pattern" value="${esc(hl.renamePattern || '${name} - ${episode2}')}" placeholder="${'${name}'} - ${'${episode2}'}" spellcheck="false">
              <div class="field-hint">变量：<code>${'${name}'}</code>、<code>${'${episode}'}</code>（13）、<code>${'${episode2}'}</code>（补零两位）、<code>${'${season}'}</code>；扩展名会自动保留</div>
            </div>
            <div class="field full">
              <label class="field-label" for="hl-exclude-dirs">排除目录 <span class="tip">目录名整段匹配</span></label>
              <input class="input mono" id="hl-exclude-dirs" value="${esc(hl.excludeDirs)}" spellcheck="false">
            </div>
            <div class="field full">
              <label class="field-label" for="hl-exclude-tags">排除标签 <span class="tip">文件名方括号里的整词，如 NCOP / SP01</span></label>
              <input class="input mono" id="hl-exclude-tags" value="${esc(hl.excludeTags)}" spellcheck="false">
            </div>
            <div class="field full">
              <label class="check"><input type="checkbox" id="hl-fonts" ${hl.includeFonts ? 'checked' : ''}><span><strong>连同字体</strong><span class="check-hint">把种子里 fonts/ 下的字体链到「目标/fonts/」，字幕需要字体时勾选</span></span></label>
            </div>
            <div class="field full">
              <label class="check"><input type="checkbox" id="hl-strip" ${hl.stripRoot ? 'checked' : ''}><span><strong>「全部文件」模式去掉种子顶层目录</strong><span class="check-hint">仅当链接内容选「全部文件」时生效</span></span></label>
            </div>
            <div class="field full">
              <div class="field-hint">首次使用请到 fnOS「应用设置 → 访问权限」把 qBittorrent 的下载目录和这里的硬链接目录都加进来（选「读写」），两个目录要在同一存储空间，否则会提示没有权限或无法跨分区。</div>
            </div>
          </div>
          <div class="btn-row">
            <button class="btn" type="submit">${icon('check')}保存全局入库设置</button>
          </div>
        </form>
      </div>
    </details>`;
}
