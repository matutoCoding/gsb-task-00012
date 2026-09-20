'use strict';
/* 装窑排器 —— 纯前端，localStorage 持久化，可离线双击打开 */

const STORE_KEY = 'zhuangyao_state_v1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 8);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayStr = () => new Date().toISOString().slice(0, 10);

/* ---------------- 状态 ---------------- */
let state = null;

function defaultState() {
  return {
    settings: { kilnSpan: 40, adjSpan: 20 },
    owners: ['老陈', '阿英', '赵姐', '小林', '阿珍'],
    pieces: [],
    kilns: [],
    records: []
  };
}

function seedData() {
  const s = defaultState();
  s.kilns = [
    { id: 'k1', name: '一号窑', layers: 3, cols: 4, locked: true,
      cost: 120, placements: {
        '2-0': 'p1', '2-1': 'p2', '2-2': 'p3', '1-1': 'p4', '1-2': 'p5', '0-2': 'p6'
      } },
    { id: 'k2', name: '二号窑', layers: 3, cols: 4, locked: false,
      cost: 100, placements: { '2-0': 'p7', '2-1': 'p8' } },
    { id: 'k3', name: '三号窑', layers: 2, cols: 3, locked: false,
      cost: 0, placements: { '1-1': 'p13' } }
  ];
  const P = (id, name, owner, temp, drip = false, size = 1, note = '', fixed = false) =>
    ({ id, name, owner, temp, drip, size, note, fixed });
  s.pieces = [
    P('p1', '青釉茶碗×6', '老陈', 1280, false, 1),
    P('p2', '青瓷盘', '阿英', 1270, false, 1),
    P('p3', '米白釉罐', '赵姐', 1290, false, 1),
    P('p4', '天青瓶', '小林', 1260, false, 1),
    P('p5', '青釉小盅×10', '老陈', 1275, false, 1),
    P('p6', '酱釉滴釉大缸', '阿英', 1255, true, 1, '釉会顺壁往下滴'),
    P('p7', '低温烤花盘', '阿珍', 820, false, 1),
    P('p8', '素烧小花盆', '小林', 840, false, 2),
    P('p9', '霁蓝釉大缸', '赵姐', 1295, true, 1, '厚釉必滴'),
    P('p10', '白瓷盖碗', '阿英', 1280, false, 1),
    P('p11', '釉上彩茶杯', '阿珍', 800, false, 1),
    P('p12', '粗陶大缸', '赵姐', 1250, false, 2, '占地大，需连续两格'),
    P('p13', '窑变釉滴罐', '小林', 1265, true, 1, '放错层示例：釉滴件在上层'),
    P('p14', '高白瓷观音瓶', '阿珍', 1320, false, 1, '窑温够不着，示例摆不下')
  ];
  s.records = [{
    id: 'r1', kilnName: '一号窑', startDate: '2026-09-12', endDate: '2026-09-14',
    cost: 110,
    rows: [
      { pieceName: '青釉碗', owner: '老陈', layer: 2, temp: 1280, status: 'ok', fault: '' },
      { pieceName: '青瓷盘', owner: '阿英', layer: 2, temp: 1270, status: 'ok', fault: '' },
      { pieceName: '酱釉缸', owner: '阿英', layer: 1, temp: 1255, status: 'bad', fault: '滴釉粘连，未放最底层，底下垫饼被釉粘住' },
      { pieceName: '粗陶缸', owner: '赵姐', layer: 1, temp: 1250, status: 'bad', fault: '靠窑壁一侧生烧，温差不均' },
      { pieceName: '素烧坯', owner: '小林', layer: 0, temp: 850, status: 'ok', fault: '' }
    ]
  }];
  return s;
}

function save() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) { state = JSON.parse(raw); return; }
  } catch (e) { /* 数据损坏则重建 */ }
  state = seedData();
  save();
}

/* ---------------- 领域逻辑 ---------------- */
const pieceById = (id) => state.pieces.find(p => p.id === id);
const layerLabel = (kiln, i) => i === 0 ? '最底层' : `第${i + 1}层`;

/* 窑内每件坯的占用信息 */
function occupants(kiln) {
  const list = [];
  for (const [key, pid] of Object.entries(kiln.placements)) {
    const [layer, col] = key.split('-').map(Number);
    const piece = pieceById(pid);
    if (piece) list.push({ layer, col, piece });
  }
  return list;
}

function freeAt(kiln, layer, col) {
  if (layer < 0 || layer >= kiln.layers || col < 0 || col >= kiln.cols) return false;
  for (const occ of occupants(kiln)) {
    const size = occ.piece.size || 1;
    if (occ.layer === layer && col >= occ.col && col < occ.col + size) return false;
  }
  return true;
}

/* 该格能否摆下（只看连续空位） */
function fitsAt(kiln, piece, layer, col) {
  if (col + piece.size > kiln.cols) return false;
  for (let c = col; c < col + piece.size; c++) {
    if (!freeAt(kiln, layer, c)) return false;
  }
  return true;
}

/* 整窑风险评估；extra = 试摆的一件 {layer,col,piece} */
function evaluateKiln(kiln, extra = null) {
  const issues = new Map();             // pieceId -> {errors:[],warnings:[]}
  const kilnErrors = [], kilnWarnings = [];
  const tag = (id, type, msg) => {
    if (!id) return;
    if (!issues.has(id)) issues.set(id, { errors: [], warnings: [] });
    issues.get(id)[type === 'error' ? 'errors' : 'warnings'].push(msg);
  };

  const occ = occupants(kiln);
  if (extra) occ.push({ layer: extra.layer, col: extra.col, piece: extra.piece });

  /* 1) 全窑温差 */
  if (occ.length) {
    let mn = occ[0], mx = occ[0];
    for (const o of occ) {
      if (o.piece.temp < mn.piece.temp) mn = o;
      if (o.piece.temp > mx.piece.temp) mx = o;
    }
    const span = mx.piece.temp - mn.piece.temp;
    if (span > state.settings.kilnSpan) {
      const msg = `同窑温差 ${span}℃（超过 ${state.settings.kilnSpan}℃）：${mn.piece.name} ${mn.piece.temp}℃ ↔ ${mx.piece.name} ${mx.piece.temp}℃`;
      kilnErrors.push(msg);
      tag(mn.piece.id, 'error', msg);
      if (mx.piece.id !== mn.piece.id) tag(mx.piece.id, 'error', msg);
    }
  }

  /* 2) 同层相邻温差 */
  const byLayer = {};
  for (const o of occ) (byLayer[o.layer] ??= []).push(o);
  for (const [ly, rows] of Object.entries(byLayer)) {
    rows.sort((a, b) => a.col - b.col);
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i], b = rows[i + 1];
      if (b.col !== a.col + a.piece.size) continue;   // 中间隔着空格不算贴邻
      const d = Math.abs(a.piece.temp - b.piece.temp);
      if (d > state.settings.adjSpan) {
        const msg = `${layerLabel(kiln, +ly)}相邻温差 ${d}℃：${a.piece.name} ${a.piece.temp}℃ 与 ${b.piece.name} ${b.piece.temp}℃ 贴太近`;
        kilnWarnings.push(msg);
        tag(a.piece.id, 'warn', msg);
        tag(b.piece.id, 'warn', msg);
      }
    }
  }

  /* 3) 釉滴件必须在最底层 */
  for (const o of occ) {
    if (o.piece.drip && o.layer !== 0) {
      const msg = `${o.piece.name} 釉会滴，不能放${layerLabel(kiln, o.layer)}，须放最底层`;
      kilnErrors.push(msg);
      tag(o.piece.id, 'error', msg);
    }
  }

  return { issues, kilnErrors, kilnWarnings };
}

/* 一件坯对某窑是否找得到“无冲突”的摆位；返回 {fit, cells:[{layer,col,warnings}]}
   warnings 只包含“加入此件后新出现”的警告（与该件有关） */
function findPlacements(kiln, piece) {
  const result = { fit: false, cells: [], errorReason: '' };
  const reasons = new Set();
  const baseWarns = new Set(evaluateKiln(kiln).kilnWarnings);

  if (piece.drip) {
    for (let c = 0; c < kiln.cols; c++) {
      if (!fitsAt(kiln, piece, 0, c)) continue;
      const ev = evaluateKiln(kiln, { layer: 0, col: c, piece });
      if (ev.kilnErrors.length) ev.kilnErrors.forEach(m => reasons.add(m));
      else {
        const mine = (ev.issues.get(piece.id)?.warnings || []).filter(m => !baseWarns.has(m));
        result.cells.push({ layer: 0, col: c, warnings: mine });
      }
    }
    if (!result.cells.length && !reasons.size) reasons.add('最底层没有空位');
  } else {
    for (let l = 0; l < kiln.layers; l++) {
      for (let c = 0; c < kiln.cols; c++) {
        if (!fitsAt(kiln, piece, l, c)) continue;
        const ev = evaluateKiln(kiln, { layer: l, col: c, piece });
        if (ev.kilnErrors.length) ev.kilnErrors.forEach(m => reasons.add(m));
        else {
          const mine = (ev.issues.get(piece.id)?.warnings || []).filter(m => !baseWarns.has(m));
          result.cells.push({ layer: l, col: c, warnings: mine });
        }
      }
    }
    if (!result.cells.length && !reasons.size) {
      reasons.add(piece.size > 1 ? `没有连续 ${piece.size} 个空格` : '窑已满，无空位');
    }
  }
  result.fit = result.cells.length > 0;
  result.errorReason = [...reasons].join('；');
  return result;
}

/* 待烧件在所有窑的可摆情况 */
function pieceFitMap(piece) {
  return state.kilns.map(k => ({ kiln: k, ...findPlacements(k, piece) }));
}

/* 窑内分账 */
function occupancyByOwner(kiln) {
  const map = {};
  for (const o of occupants(kiln)) {
    const m = map[o.piece.owner] ??= { owner: o.piece.owner, cells: 0, pieces: 0 };
    m.cells += o.piece.size;
    m.pieces += 1;
  }
  return Object.values(map);
}

/* ---------------- 渲染：装窑页 ---------------- */
let selectedPieceId = null;
let dragPieceId = null;

function placedPieceIds() {
  const ids = new Set();
  for (const k of state.kilns) Object.values(k.placements).forEach(id => ids.add(id));
  return ids;
}

function currentEval(kiln) { return evaluateKiln(kiln); }

function renderLoad() {
  renderSummary();
  renderWaiting();
  renderKilns();
}

function renderSummary() {
  const placed = placedPieceIds();
  const waiting = state.pieces.filter(p => !placed.has(p.id));
  const totalErr = state.kilns.reduce((n, k) => n + currentEval(k).kilnErrors.length, 0);
  const totalWarn = state.kilns.reduce((n, k) => n + currentEval(k).kilnWarnings.length, 0);
  const locked = state.kilns.filter(k => k.locked).length;
  $('#summaryBar').innerHTML = [
    ['待烧', waiting.length, ''],
    ['窑炉', state.kilns.length, ''],
    ['已锁炉', locked, ''],
    ['硬冲突', totalErr, totalErr ? 'alert' : ''],
    ['风险提示', totalWarn, totalWarn ? 'warn' : '']
  ].map(([t, v, cls]) => `<div class="stat ${cls}"><b>${v}</b><span>${t}</span></div>`).join('');
}

function pieceCardHtml(piece, fitInfo) {
  const placed = !fitInfo;
  let tags = '', cardCls = '';
  if (!placed) {
    const fits = fitInfo.filter(f => f.fit);
    if (fits.length) {
      const clean = fits.filter(f => f.cells.every(c => !c.warnings.length));
      const names = fits.map(f => f.kiln.name).join('、');
      tags += `<span class="tag fit">可入：${esc(names)}</span>`;
      if (!clean.length) tags += `<span class="tag warn">无论摆哪都有相邻温差风险，落位时标黄</span>`;
      else if (clean.length < fits.length) tags += `<span class="tag warn">${esc(clean.map(f=>f.kiln.name).join('、'))} 有无风险位</span>`;
    } else {
      const reason = fitInfo.map(f => f.errorReason).filter(Boolean)[0] || '没有窑炉';
      tags += `<span class="tag nofit">摆不下：${esc(reason)}</span>`;
      cardCls = 'p-err';
    }
  }
  const drip = piece.drip ? '<span class="pc-meta"><span style="color:#3f78a8">▼ 釉会滴 · 只能最底层</span></span>' : '';
  const fixed = piece.fixed ? '<span class="tag" style="background:#eee">已定死</span>' : '';
  return `<div class="piece-card ${cardCls} ${placed ? 'placed' : ''}" draggable="${!placed}" data-piece="${piece.id}">
    <button class="pc-edit" data-edit-piece="${piece.id}" title="编辑">✎</button>
    <div class="pc-top">${esc(piece.name)}
      ${piece.size > 1 ? '<span class="tag" style="background:#e9e2d6">2×</span>' : ''}${fixed}
      <span class="pc-owner">${esc(piece.owner)}</span></div>
    <div class="pc-meta"><span>🌡 ${piece.temp}℃</span>${piece.note ? `<span>${esc(piece.note)}</span>` : ''}</div>
    ${drip}
    <div class="pc-tags">${tags}</div>
  </div>`;
}

function renderWaiting() {
  const placed = placedPieceIds();
  $('#waitingCount').textContent = state.pieces.filter(p => !placed.has(p.id)).length;
  const box = $('#waitingList');
  const waiting = state.pieces.filter(p => !placed.has(p.id));
  if (!waiting.length) {
    box.innerHTML = '<div class="empty-hint">没有待烧坯体。<br>点右上角「＋ 登记坯体」开始。</div>';
    return;
  }
  box.innerHTML = waiting.map(p => pieceCardHtml(p, pieceFitMap(p))).join('');
  if (selectedPieceId && placed.has(selectedPieceId)) selectedPieceId = null;
  box.querySelectorAll('[data-piece]').forEach(el => {
    if (el.dataset.piece === selectedPieceId) el.classList.add('selected');
  });
}

function renderKilns() {
  const stack = $('#kilnStack');
  if (!state.kilns.length) {
    stack.innerHTML = '<div class="empty-hint">还没有窑炉，点右上角「＋ 新窑炉」建一个。</div>';
    return;
  }
  stack.innerHTML = state.kilns.map(renderKiln).join('');
}

function renderKiln(kiln) {
  const ev = currentEval(kiln);
  const occList = occupants(kiln);
  const usedCells = occList.reduce((n, o) => n + o.piece.size, 0);
  const total = kiln.layers * kiln.cols;

  /* 选中待烧件时，算出可落的格子 */
  let canDrop = new Set();
  let selPiece = null;
  if (selectedPieceId) {
    selPiece = pieceById(selectedPieceId);
    if (selPiece) {
      const fp = findPlacements(kiln, selPiece);
      for (const c of fp.cells) {
        for (let i = 0; i < selPiece.size; i++) canDrop.add(`${c.layer}-${c.col + i}`);
      }
    }
  }

  const layersHtml = [];
  for (let l = kiln.layers - 1; l >= 0; l--) {
    const here = occList.filter(o => o.layer === l);
    const temps = here.map(o => o.piece.temp);
    const tempText = temps.length
      ? (temps.length > 1
        ? `本层 ${Math.min(...temps)}~${Math.max(...temps)}℃（温差 ${Math.max(...temps) - Math.min(...temps)}℃）`
        : `本层 ${temps[0]}℃`) : '空层';
    let cells = '';
    for (let c = 0; c < kiln.cols; c++) {
      const o = here.find(x => c >= x.col && c < x.col + x.piece.size);
      if (o && c !== o.col) continue;
      if (o) {
        const iss = ev.issues.get(o.piece.id);
        const cls = iss?.errors.length ? 'err' : iss?.warnings.length ? 'warn' : '';
        const s2 = o.piece.size > 1 ? `s2` : '';
        const removable = !kiln.locked && !o.piece.fixed;
        cells += `<div class="cell ${s2}" title="${esc(o.piece.name)}">
          <div class="occ ${cls} ${o.piece.fixed ? 'fixed' : ''}">
            <span class="nm">${esc(o.piece.name)}</span>
            <span class="mt">${esc(o.piece.owner)} · ${o.piece.temp}℃${o.piece.drip ? ' · 滴釉' : ''}</span>
            ${removable ? `<button class="rm" data-remove="${o.piece.id}" title="取出">×</button>` : ''}
          </div></div>`;
      } else {
        const key = `${l}-${c}`;
        const hl = canDrop.has(key);
        cells += `<div class="cell dropzone ${hl ? 'hl' : ''}"
          data-kiln="${kiln.id}" data-layer="${l}" data-col="${c}"
          title="${kiln.locked ? '炉已锁，点此处申请加入并整窑复评' : ''}">${hl ? '放这里' : (kiln.locked ? '空🔒' : '空')}</div>`;
      }
    }
    layersHtml.push(`<div class="layer ${l === 0 ? 'bottom' : ''}">
      <div class="layer-row"><span class="layer-label">${l === 0 ? '最底层' : `第${l + 1}层`}</span>
        <div class="cells">${cells}</div><span class="layer-temp">${tempText}</span></div></div>`);
  }

  const warnHtml = ev.kilnErrors.length
    ? `<div class="kiln-warnings error">${ev.kilnErrors.map(m => `⛔ ${esc(m)}`).join('<br>')}</div>`
    : ev.kilnWarnings.length
      ? `<div class="kiln-warnings">${ev.kilnWarnings.map(m => `⚠️ ${esc(m)}`).join('<br>')}</div>` : '';

  return `<div class="kiln-card" data-kiln-card="${kiln.id}">
    <div class="kiln-head">
      <h3>${esc(kiln.name)}</h3>
      <span class="kiln-range">${kiln.layers}层 × ${kiln.cols}格 · 已用 ${usedCells}/${total}</span>
      <span class="kiln-state ${kiln.locked ? 'locked' : 'free'}">${kiln.locked ? '🔒 已锁定' : '可调整'}</span>
      <div class="kiln-actions">
        <button class="btn small ghost" data-edit-kiln="${kiln.id}">窑设置</button>
        <button class="lock-btn ${kiln.locked ? 'locked' : ''}" data-lock="${kiln.id}">${kiln.locked ? '解锁' : '锁住此炉'}</button>
        <button class="fire-btn" data-fire="${kiln.id}" ${occList.length ? '' : 'disabled'}>出窑登记</button>
      </div>
    </div>
    ${warnHtml}
    <div class="kiln-body">${layersHtml.join('')}</div>
    ${renderFoot(kiln, occList)}
  </div>`;
}

function renderFoot(kiln, occList) {
  const rows = occupancyByOwner(kiln);
  const totalCells = kiln.layers * kiln.cols;
  const used = occList.reduce((n, o) => n + o.piece.size, 0);
  let split = '';
  if (kiln.cost > 0 && rows.length) {
    const sorted = [...rows].sort((a, b) => b.cells - a.cells);
    let remain = kiln.cost;
    const moneyMap = {};
    sorted.forEach((r, i) => {
      const v = i === sorted.length - 1 ? Math.round(remain * 100) / 100
        : Math.round(kiln.cost * r.cells / used * 100) / 100;
      remain -= v; moneyMap[r.owner] = v;
    });
    const amounts = rows.map(r => ({ ...r, money: moneyMap[r.owner] }));
    split = `<table class="split-table"><thead><tr><th>主人</th><th>件数</th><th>占格</th><th>分摊（元）</th></tr></thead>
      <tbody>${amounts.map(r => `<tr><td>${esc(r.owner)}</td><td>${r.pieces}</td><td>${r.cells}</td><td>${r.money.toFixed(2)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td>合计</td><td>${rows.reduce((n, r) => n + r.pieces, 0)}</td><td>${used}</td><td>${kiln.cost.toFixed(2)}</td></tr></tfoot></table>`;
  }
  const who = rows.length
    ? rows.map(r => `<span class="kv">${esc(r.owner)}：<b>${r.pieces}</b> 件 / <b>${r.cells}</b> 格</span>`).join('')
    : '<span class="kv">空窑</span>';
  return `<div class="kiln-foot">${who}<span class="kv">空位 ${totalCells - used} 格</span>
    ${kiln.cost > 0 ? `<span class="kv">柴火费 ${kiln.cost} 元，按占格分摊</span>` : ''}
    ${split ? `<div style="flex-basis:100%">${split}</div>` : ''}</div>`;
}

/* ---------------- 装窑 / 取出动作 ---------------- */
function placePiece(pieceId, kilnId, layer, col, viaRecheck = false) {
  const piece = pieceById(pieceId);
  const kiln = state.kilns.find(k => k.id === kilnId);
  if (!piece || !kiln) return;
  if (!fitsAt(kiln, piece, layer, col)) { toast('这里摆不下，格子不够或被占', 'err'); return; }

  const ev = evaluateKiln(kiln, { layer, col, piece });
  if (ev.kilnErrors.length) {
    toast('放不进去：' + ev.kilnErrors[0], 'err');
    return;
  }
  if (kiln.locked && !viaRecheck) {
    openRecheck(kiln, piece, layer, col, ev);
    return;
  }
  /* 存入（占连续 size 格，键记在首格） */
  kiln.placements[`${layer}-${col}`] = piece.id;
  selectedPieceId = null;
  save(); renderLoad();
  if (ev.kilnWarnings.length) toast('已摆入，但有风险已标黄：' + ev.kilnWarnings[0], 'err');
  else toast(`${piece.name} → ${kiln.name} ${layerLabel(kiln, layer)}`, 'ok');
}

function removePiece(pieceId) {
  const piece = pieceById(pieceId);
  for (const kiln of state.kilns) {
    for (const [key, pid] of Object.entries(kiln.placements)) {
      if (pid === pieceId) {
        if (kiln.locked) { toast(`${kiln.name} 已锁，不能取出`, 'err'); return; }
        if (piece.fixed) { toast('这件位置已定死，不能动', 'err'); return; }
        delete kiln.placements[key];
        save(); renderLoad();
        toast(`已取出 ${piece.name}`);
        return;
      }
    }
  }
}

/* ---------------- 锁窑复评 ---------------- */
let recheckCtx = null;
function openRecheck(kiln, piece, layer, col, ev) {
  recheckCtx = { kiln, piece, layer, col };
  $('#rc_kilnName').textContent = kiln.name;
  $('#rc_pieceName').textContent = `${piece.name}（${piece.owner} ${piece.temp}℃）`;
  const errs = ev.kilnErrors.map(m => `<li>${esc(m)}</li>`).join('');
  const warns = ev.kilnWarnings.map(m => `<li>${esc(m)}</li>`).join('');
  const dripNote = piece.drip ? `<div class="rc-block ok">釉滴件将放最底层，不会滴到别人。</div>` : '';
  $('#rc_result').innerHTML =
    (errs ? `<div class="rc-block err"><b>⛔ 硬冲突，不能加入</b><ul>${errs}</ul></div>` : '') +
    (warns ? `<div class="rc-block warn"><b>⚠️ 存在风险</b><ul>${warns}</ul>
       <label class="ack"><input type="checkbox" id="rc_ack"> 我已确认风险，仍要加入这件</label></div>`
      : `<div class="rc-block ok"><b>✔ 整窑复核无冲突</b>：温度、釉滴、位置都过关。</div>`) + dripNote;
  const btn = $('#rc_confirm');
  if (errs) { btn.disabled = true; btn.textContent = '有硬冲突，不能加入'; }
  else if (warns) { btn.disabled = true; btn.textContent = '勾选已知晓风险后确认'; }
  else { btn.disabled = false; btn.textContent = '确认加入'; }
  $('#recheckModal').classList.add('show');
}

/* ---------------- 出窑登记 ---------------- */
let firingKilnId = null;
function openFiring(kilnId) {
  const kiln = state.kilns.find(k => k.id === kilnId);
  if (!kiln || !Object.keys(kiln.placements).length) return;
  firingKilnId = kilnId;
  $('#fm_kilnName').textContent = kiln.name;
  $('#fm_start').value = todayStr();
  $('#fm_end').value = todayStr();
  const rows = occupants(kiln).sort((a, b) => a.layer - b.layer || a.col - b.col);
  $('#fm_rows').innerHTML = rows.map((o, i) => `
    <div class="fr-row" data-row="${i}">
      <div><b>${esc(o.piece.name)}</b><br><span style="color:#7a6757">${esc(o.piece.owner)} · ${o.piece.temp}℃</span></div>
      <div>${layerLabel(kiln, o.layer)}</div>
      <select data-fstatus>
        <option value="ok">完好</option>
        <option value="bad">烧坏了</option>
      </select>
      <input data-ffault placeholder="坏在哪/什么毛病（完好留空）">
      <input type="hidden" data-flayer value="${o.layer}">
    </div>`).join('');
  $('#firingModal').classList.add('show');
}

$('#fm_rows')?.addEventListener('change', e => {
  if (e.target.matches('[data-fstatus]')) {
    e.target.closest('.fr-row').classList.toggle('bad', e.target.value === 'bad');
  }
});

function saveFiring() {
  const kiln = state.kilns.find(k => k.id === firingKilnId);
  if (!kiln) return;
  const occ = occupants(kiln).slice().sort((a, b) => a.layer - b.layer || a.col - b.col);
  const rows = $$('#fm_rows .fr-row').map((row, i) => {
    const o = occ[i];
    return {
      pieceName: o.piece.name, owner: o.piece.owner,
      layer: +row.querySelector('[data-flayer]').value,
      temp: o.piece.temp,
      status: row.querySelector('[data-fstatus]').value,
      fault: row.querySelector('[data-ffault]').value.trim()
    };
  });
  const badEmpty = rows.some(r => r.status === 'bad' && !r.fault);
  if (badEmpty) { toast('烧坏的件要写清毛病和层，方便以后翻', 'err'); return; }

  const record = {
    id: uid('r'), kilnId: kiln.id, kilnName: kiln.name,
    startDate: $('#fm_start').value, endDate: $('#fm_end').value,
    cost: kiln.cost || 0, rows
  };
  state.records.unshift(record);

  /* 清窑：烧坏的坯从清单删除；完好的也出窑（已完成烧制） */
  const firedIds = new Set(Object.values(kiln.placements));
  state.pieces = state.pieces.filter(p => !firedIds.has(p.id));
  kiln.placements = {};
  firingKilnId = null;
  save();
  closeModals();
  renderLoad(); renderHistory();
  toast(`已记入档案：${kiln.name}，烧坏 ${rows.filter(r => r.status === 'bad').length} 件`, 'ok');
  switchTab('history');
}

/* ---------------- 烧窑记录页 ---------------- */
function renderHistory() {
  const q = ($('#historySearch')?.value || '').trim();
  let recs = state.records;
  if (q) {
    const needle = q.toLowerCase();
    recs = recs.filter(r =>
      r.kilnName.toLowerCase().includes(needle) ||
      r.rows.some(x => x.owner.toLowerCase().includes(needle) || x.pieceName.toLowerCase().includes(needle)));
  }

  const totalFired = state.records.reduce((n, r) => n + r.rows.length, 0);
  const totalBad = state.records.reduce((n, r) => n + r.rows.filter(x => x.status === 'bad').length, 0);
  const layerBad = {};
  for (const r of state.records)
    for (const x of r.rows) if (x.status === 'bad') layerBad[x.layer] = (layerBad[x.layer] || 0) + 1;
  const topLayer = Object.entries(layerBad).sort((a, b) => b[1] - a[1])[0];

  $('#historySummary').innerHTML = [
    ['烧过窑次', state.records.length, ''],
    ['累计件数', totalFired, ''],
    ['烧坏件数', totalBad, totalBad ? 'alert' : ''],
    ['坏件最多', topLayer ? (topLayer[0] == 0 ? '最底层' : `第${+topLayer[0] + 1}层`) + `（${topLayer[1]}件）` : '—', topLayer ? 'warn' : '']
  ].map(([t, v, cls]) => `<div class="stat ${cls}"><b>${v}</b><span>${t}</span></div>`).join('');

  const box = $('#historyList');
  if (!recs.length) {
    box.innerHTML = `<div class="no-record">${state.records.length ? '没有匹配的记录' : '还没烧过窑。出窑登记后，坏件、坏层都能在这里翻。'}</div>`;
    return;
  }
  box.innerHTML = recs.map(recordHtml).join('');
}

function recordHtml(r) {
  const bad = r.rows.filter(x => x.status === 'bad');
  const good = r.rows.length - bad.length;

  /* 按层坏件 */
  const lm = {};
  bad.forEach(x => (lm[x.layer] ??= []).push(x));
  const maxCount = Math.max(1, ...Object.values(lm).map(v => v.length));
  const layerMax = Math.max(0, ...r.rows.map(x => x.layer));
  const layerBars = [];
  for (let l = layerMax; l >= 0; l--) {
    const n = lm[l]?.length || 0;
    layerBars.push(`<div class="layer-hit"><span style="width:48px">${l === 0 ? '最底层' : '第' + (l + 1) + '层'}</span>
      <span class="bar" style="width:${(n / maxCount) * 120 + 4}px;${n ? '' : 'opacity:.15'}"></span>
      <span>${n ? n + ' 件坏' : '—'}</span></div>`);
  }

  /* 按主人分账 */
  const om = {};
  r.rows.forEach(x => {
    const m = om[x.owner] ??= { good: 0, bad: 0 };
    x.status === 'bad' ? m.bad++ : m.good++;
  });
  const ownerSplit = Object.entries(om).map(([owner, m]) => {
    let money = '';
    if (r.cost > 0) {
      const share = r.rows.filter(x => x.owner === owner).length / r.rows.length;
      money = ` · 摊 ${(r.cost * share).toFixed(2)} 元`;
    }
    return `<div class="layer-hit">${esc(owner)}：好 ${m.good} / 坏 ${m.bad}${money}</div>`;
  }).join('');

  const badList = bad.map(x =>
    `<div class="damage-item">⛔ <b>${esc(x.pieceName)}</b>（${esc(x.owner)}，${x.layer === 0 ? '最底层' : '第' + (x.layer + 1) + '层'}，${x.temp}℃）：${esc(x.fault)}</div>`
  ).join('') || '<div style="font-size:12px;color:#3f7d4e">这一窑全好 ✔</div>';

  return `<div class="record-card">
    <div class="rec-head">
      <h3>${esc(r.kilnName)}</h3>
      <span class="dates">${esc(r.startDate)} 开烧 · ${esc(r.endDate)} 出窑 · 共 ${r.rows.length} 件${r.cost ? ' · 柴火费 ' + r.cost + ' 元' : ''}</span>
      <div class="rec-badges">
        <span class="badge good">完好 ${good}</span>
        <span class="badge bad">烧坏 ${bad.length}</span>
        <button class="btn small ghost" data-export-record="${r.id}">导出本窑 CSV</button>
      </div>
    </div>
    <div class="rec-grid">
      <div><h4>烧坏明细（下次装窑重点看）</h4>${badList}</div>
      <div><h4>坏件集中在哪层</h4>${layerBars.join('')}</div>
      <div><h4>各人结果${r.cost ? '与分摊' : ''}</h4>${ownerSplit}</div>
    </div>
  </div>`;
}

function csvOfRecord(r) {
  const head = ['窑号', '开烧', '出窑', '坯体', '主人', '温度', '所在层', '结果', '毛病'];
  const lines = [head.join(',')];
  for (const x of r.rows) {
    lines.push([r.kilnName, r.startDate, r.endDate, x.pieceName, x.owner, x.temp,
      x.layer === 0 ? '最底层' : '第' + (x.layer + 1) + '层',
      x.status === 'bad' ? '烧坏' : '完好', x.fault].map(csvCell).join(','));
  }
  return lines.join('\n');
}
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function downloadCsv(name, text) {
  const blob = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------------- 坯体 / 窑炉 / 设置 表单 ---------------- */
let editingPieceId = null, editingKilnId = null;

function fillOwnerOptions(sel) {
  sel.innerHTML = state.owners.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')
    + `<option value="__new__">＋ 新主人…</option>`;
}
function promptNewOwner() {
  const name = prompt('新主人的名字：');
  if (name && name.trim() && !state.owners.includes(name.trim())) {
    state.owners.push(name.trim()); save();
  }
  return name ? name.trim() : '';
}

function openPieceModal(id = null) {
  editingPieceId = id;
  fillOwnerOptions($('#pf_owner'));
  const p = id ? pieceById(id) : null;
  $('#pieceModalTitle').textContent = p ? '编辑坯体' : '登记坯体';
  $('#pf_name').value = p?.name || '';
  $('#pf_owner').value = p?.owner || state.owners[0];
  $('#pf_temp').value = p?.temp ?? 1280;
  $('#pf_size').value = p?.size || 1;
  $('#pf_drip').checked = !!p?.drip;
  $('#pf_lockedPiece').checked = !!p?.fixed;
  $('#pf_note').value = p?.note || '';
  $('#pf_delete').style.display = p ? '' : 'none';
  $('#pieceModal').classList.add('show');
}

function savePieceForm() {
  const ownerSel = $('#pf_owner');
  let owner = ownerSel.value;
  if (owner === '__new__') {
    owner = promptNewOwner();
    if (!owner) return;
    fillOwnerOptions(ownerSel);
    ownerSel.value = owner;
  }
  const data = {
    name: $('#pf_name').value.trim(),
    owner,
    temp: +$('#pf_temp').value,
    size: +$('#pf_size').value,
    drip: $('#pf_drip').checked,
    fixed: $('#pf_lockedPiece').checked,
    note: $('#pf_note').value.trim()
  };
  if (!data.name) { toast('要写坯体名称', 'err'); return; }
  if (!(data.temp >= 500 && data.temp <= 1500)) { toast('温度要在 500–1500℃ 之间', 'err'); return; }

  if (editingPieceId) {
    const p = pieceById(editingPieceId);
    /* 已在窑内的件改尺寸/类型可能造成冲突，保存后立即重验并提示 */
    Object.assign(p, data);
    save(); renderLoad();
    const k = state.kilns.find(k => Object.values(k.placements).includes(p.id));
    if (k && currentEval(k).kilnErrors.length) toast('改完后该窑出现冲突，已标红，请重新摆', 'err');
  } else {
    state.pieces.push({ id: uid('p'), ...data });
    save(); renderLoad();
    toast(`已登记：${data.name}`);
  }
  closeModals();
}

function deletePiece() {
  if (!editingPieceId) return;
  const inKiln = state.kilns.some(k => Object.values(k.placements).includes(editingPieceId));
  if (inKiln) { toast('还在窑里，先取出来再删', 'err'); return; }
  state.pieces = state.pieces.filter(p => p.id !== editingPieceId);
  save(); closeModals(); renderLoad();
}

function openKilnModal(id = null) {
  editingKilnId = id;
  const k = id ? state.kilns.find(x => x.id === id) : null;
  $('#kilnModalTitle').textContent = k ? '窑炉设置' : '新建窑炉';
  $('#kf_name').value = k?.name || `${['一', '二', '三', '四', '五', '六'][state.kilns.length] || ''}号窑`;
  $('#kf_layers').value = k?.layers ?? 3;
  $('#kf_cols').value = k?.cols ?? 4;
  $('#kf_cost').value = k?.cost ?? '';
  $('#kf_delete').style.display = k && !Object.keys(k.placements).length ? '' : 'none';
  $('#kilnModal').classList.add('show');
}

function saveKilnForm() {
  const data = {
    name: $('#kf_name').value.trim(),
    layers: +$('#kf_layers').value,
    cols: +$('#kf_cols').value,
    cost: +$('#kf_cost').value || 0
  };
  if (!data.name) { toast('要写窑号', 'err'); return; }
  if (!(data.layers >= 1 && data.layers <= 12) || !(data.cols >= 1 && data.cols <= 20)) {
    toast('层数 1–12、格位 1–20', 'err'); return;
  }
  if (editingKilnId) {
    const k = state.kilns.find(x => x.id === editingKilnId);
    /* 缩窑：超出范围的坯自动退回待烧 */
    for (const [key, pid] of Object.entries(k.placements)) {
      const [l, c] = key.split('-').map(Number);
      const piece = pieceById(pid);
      if (l >= data.layers || c + (piece?.size || 1) > data.cols) delete k.placements[key];
    }
    Object.assign(k, data);
    save(); renderLoad();
    if (currentEval(k).kilnErrors.length) toast('调整后该窑出现冲突，已标红', 'err');
  } else {
    state.kilns.push({ id: uid('k'), ...data, locked: false, placements: {} });
    save(); renderLoad();
    toast(`已建窑：${data.name}`);
  }
  closeModals();
}

function deleteKiln() {
  if (!editingKilnId) return;
  const k = state.kilns.find(x => x.id === editingKilnId);
  if (Object.keys(k.placements).length) { toast('窑里还有坯，不能删', 'err'); return; }
  if (!confirm(`确认删除「${k.name}」？`)) return;
  state.kilns = state.kilns.filter(x => x.id !== editingKilnId);
  save(); closeModals(); renderLoad();
}

function openSettings() {
  $('#sf_kilnSpan').value = state.settings.kilnSpan;
  $('#sf_adjSpan').value = state.settings.adjSpan;
  $('#settingsModal').classList.add('show');
}

/* ---------------- 锁窑 ---------------- */
function toggleLock(kilnId) {
  const kiln = state.kilns.find(k => k.id === kilnId);
  if (!kiln.locked) {
    const ev = currentEval(kiln);
    if (ev.kilnErrors.length) {
      toast('有硬冲突没解决，不能锁：' + ev.kilnErrors[0], 'err');
      return;
    }
    if (ev.kilnWarnings.length &&
        !confirm(`「${kiln.name}」还有 ${ev.kilnWarnings.length} 条相邻温差风险：\n\n` +
          ev.kilnWarnings.join('\n') + '\n\n仍要锁住吗？')) return;
    kiln.locked = true;
    save(); renderLoad();
    toast(`「${kiln.name}」已锁住，后来的人只能挑剩下的位置`, 'ok');
  } else {
    kiln.locked = false;
    save(); renderLoad();
    toast(`「${kiln.name}」已解锁`);
  }
}

/* ---------------- 通用 UI ---------------- */
function closeModals() { $$('.modal-mask').forEach(m => m.classList.remove('show')); }
let toastTimer = null;
function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = 'toast', 3600);
}
function switchTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'history') renderHistory();
  else renderLoad();
}

/* ---------------- 事件绑定 ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  load();
  renderLoad();

  $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  $('#btnAddPiece').addEventListener('click', () => openPieceModal());
  $('#btnAddKiln').addEventListener('click', () => openKilnModal());
  $('#btnSettings').addEventListener('click', openSettings);
  $('#historySearch').addEventListener('input', renderHistory);
  $('#btnExportHistory').addEventListener('click', () => {
    if (!state.records.length) { toast('还没有记录', 'err'); return; }
    const csv = state.records.map(csvOfRecord).join('\n');
    downloadCsv('烧窑记录汇总.csv', csv);
  });

  /* 待烧列表：点选 / 拖拽 / 编辑 */
  $('#waitingList').addEventListener('click', e => {
    const edit = e.target.closest('[data-edit-piece]');
    if (edit) { e.stopPropagation(); openPieceModal(edit.dataset.editPiece); return; }
    const card = e.target.closest('[data-piece]');
    if (card) {
      const id = card.dataset.piece;
      selectedPieceId = selectedPieceId === id ? null : id;
      renderLoad();
    }
  });
  $('#waitingList').addEventListener('dragstart', e => {
    const card = e.target.closest('[data-piece]');
    if (card) { dragPieceId = card.dataset.piece; e.dataTransfer.setData('text/plain', dragPieceId); }
  });

  /* 窑区：点空格落位、取出、锁、出窑、编辑 */
  $('#kilnStack').addEventListener('click', e => {
    const remove = e.target.closest('[data-remove]');
    if (remove) { removePiece(remove.dataset.remove); return; }
    const lock = e.target.closest('[data-lock]');
    if (lock) { toggleLock(lock.dataset.lock); return; }
    const fire = e.target.closest('[data-fire]');
    if (fire) { openFiring(fire.dataset.fire); return; }
    const edit = e.target.closest('[data-edit-kiln]');
    if (edit) { openKilnModal(edit.dataset.editKiln); return; }
    const zone = e.target.closest('.dropzone');
    if (zone) {
      const id = selectedPieceId;
      if (!id) { toast('先点左边选一件坯，再点空格', 'err'); return; }
      placePiece(id, zone.dataset.kiln, +zone.dataset.layer, +zone.dataset.col);
    }
  });
  $('#kilnStack').addEventListener('dragover', e => {
    if (dragPieceId && e.target.closest('.dropzone')) e.preventDefault();
  });
  $('#kilnStack').addEventListener('drop', e => {
    const zone = e.target.closest('.dropzone');
    if (!zone) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || dragPieceId;
    if (id) placePiece(id, zone.dataset.kiln, +zone.dataset.layer, +zone.dataset.col);
    dragPieceId = null;
  });

  /* 记录页导出 */
  $('#historyList').addEventListener('click', e => {
    const btn = e.target.closest('[data-export-record]');
    if (btn) {
      const r = state.records.find(x => x.id === btn.dataset.exportRecord);
      if (r) downloadCsv(`${r.kilnName}_${r.endDate}.csv`, csvOfRecord(r));
    }
  });

  /* 弹窗按钮 */
  $('#pf_save').addEventListener('click', savePieceForm);
  $('#pf_delete').addEventListener('click', deletePiece);
  $('#kf_save').addEventListener('click', saveKilnForm);
  $('#kf_delete').addEventListener('click', deleteKiln);
  $('#fm_save').addEventListener('click', saveFiring);

  $('#sf_save').addEventListener('click', () => {
    state.settings.kilnSpan = +$('#sf_kilnSpan').value || 40;
    state.settings.adjSpan = +$('#sf_adjSpan').value || 20;
    save(); closeModals(); renderLoad();
    toast('阈值已保存，全窑重新校验');
  });
  $('#sf_reset').addEventListener('click', () => {
    if (!confirm('清空全部坯体、窑炉和记录，恢复示例数据？')) return;
    localStorage.removeItem(STORE_KEY);
    load(); closeModals(); selectedPieceId = null; renderLoad(); renderHistory();
    toast('已恢复示例数据');
  });

  /* 复评：勾选后才允许带风险加入 */
  $('#rc_result').addEventListener('change', e => {
    if (e.target.id === 'rc_ack') $('#rc_confirm').disabled = !e.target.checked;
  });
  $('#rc_confirm').addEventListener('click', () => {
    if (!recheckCtx) return;
    const { kiln, piece, layer, col } = recheckCtx;
    closeModals();
    placePiece(piece.id, kiln.id, layer, col, true);
  });

  /* 点遮罩/取消关闭 */
  $$('.modal-mask').forEach(m => m.addEventListener('click', e => {
    if (e.target === m || e.target.closest('[data-close]')) closeModals();
  }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModals(); });
});
