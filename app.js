/* REHAB 氣瓶管制系統 — 純前端，資料先存手機 localStorage，有設定 Apps Script 時同步到 Google 試算表。
   僅供現場管制參考，不取代醫療專業判斷。 */
(function () {
'use strict';
const CFG = window.REHAB_CONFIG || {};
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const app = $('#app');
const LS = { roster: 'rehab.roster', records: 'rehab.records', settings: 'rehab.settings', incident: 'rehab.incident', queue: 'rehab.queue', rosterSrc: 'rehab.rosterSrc' };
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const num = v => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200); }

/* ---------- 判定標準（可在設定頁修改） ---------- */
// src: 'EMSer' = 來自 EMSer 後勤照護簡報第 4 頁（消防月刊整理之 NFPA 1584）與 Terry 指定的觸發條件；'NFPA' = 系統預設（NFPA 1584 / 一般到院前常用值），EMSer 未給數值
const DEFAULT_TH = {
  cyl1Min:   { v: 45,  label: '第 1 支氣瓶使用 ≥（分鐘）→ 進 REHAB', src: 'EMSer', note: 'Terry 指定；EMSer 資料：一支 45／60 分鐘氣瓶' },
  cyl2Min:   { v: 30,  label: '第 2 支（含以後）氣瓶使用 ≥（分鐘）→ 進 REHAB', src: 'EMSer', note: 'Terry 指定；EMSer：30 分鐘氣瓶用完 2 支' },
  sbpHigh:   { v: 160, label: '收縮壓 >（mmHg）', src: 'EMSer', note: 'EMSer：>160/100 不得離開 REHAB' },
  dbpHigh:   { v: 100, label: '舒張壓 >（mmHg）', src: 'EMSer', note: 'EMSer：>160/100 不得離開 REHAB' },
  sbpLow:    { v: 80,  label: '收縮壓 <（mmHg）→ 緊急救護', src: 'EMSer', note: 'EMSer：SBP <80 緊急救護' },
  hrHigh:    { v: 100, label: '脈搏 >（次/分）', src: 'EMSer', note: 'EMSer：休息 10 分鐘後仍 >100，持續 20 分鐘須持續照護' },
  hrRestMin: { v: 10,  label: '脈搏判定需休息滿（分鐘）', src: 'EMSer', note: '未滿此時間脈搏偏高只顯示黃色「請複測」' },
  spo2Low:   { v: 94,  label: '血氧 SpO2 <（%）', src: 'NFPA', note: 'EMSer 未提供；採一般到院前常用下限' },
  tempHigh:  { v: 38.0, label: '體溫 ≥（°C）', src: 'NFPA', note: 'EMSer 只寫「持續升高超過 20 分鐘須持續監測」；採 NFPA 1584 常用 38°C（100.4°F）' },
  tempRiseMin:{ v: 20, label: '體溫持續上升超過（分鐘）', src: 'EMSer', note: 'EMSer：體溫持續升高超過 20 分鐘須持續監測' },
  spcoHigh:  { v: 5,   label: 'SpCO >（%）不得離開', src: 'EMSer', note: 'EMSer：>5% 不得離開；>15% 給高濃度氧氣' },
  spcoO2:    { v: 15,  label: 'SpCO >（%）給高濃度氧氣', src: 'EMSer', note: 'EMSer' },
  restMin:   { v: 10,  label: 'REHAB 最少休息（分鐘）', src: 'EMSer', note: 'EMSer 資料：至少 10–20 分鐘強制休息' }
};
function th() { const s = load(LS.settings, {}); const o = {}; for (const k in DEFAULT_TH) o[k] = (s.th && s.th[k] != null && s.th[k] !== '') ? Number(s.th[k]) : DEFAULT_TH[k].v; return o; }
function settings() { return Object.assign({ apiUrl: CFG.APPS_SCRIPT_URL || '', key: '', baseUrl: '' }, load(LS.settings, {})); }
function setSettings(p) { save(LS.settings, Object.assign(load(LS.settings, {}), p)); }
function apiUrl() { return (settings().apiUrl || CFG.APPS_SCRIPT_URL || '').trim(); }
function baseUrl() { const b = (settings().baseUrl || '').trim(); return b || (location.origin + location.pathname); }

/* ---------- 名冊 ---------- */
const DEMO = [['T001', '大雅分隊', '小隊長', '範例甲'], ['T002', '大雅分隊', '隊員', '範例乙'], ['T003', '大雅分隊', '隊員', '範例丙'], ['T004', '清水分隊', '隊員', '範例丁'], ['T005', '神岡分隊', '替代役', '範例戊']].map(r => ({ id: r[0], unit: r[1], title: r[2], name: r[3] }));
function roster() { const r = load(LS.roster, null); if (!r) { save(LS.roster, DEMO); save(LS.rosterSrc, '內建範例（假資料）'); return DEMO; } return r; }
function findMember(id) { id = String(id || '').trim(); return roster().find(m => String(m.id).toLowerCase() === id.toLowerCase()); }
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, ''); const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',' || c === '\t') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c; }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
function rowsToRoster(rows) {
  if (!rows.length) return [];
  const h = rows[0].map(x => x.trim()); const idx = n => h.findIndex(x => x.includes(n));
  let iId = idx('臂章'), iU = idx('分隊'), iT = idx('職稱'), iN = idx('姓名'); let start = 1;
  if (iId < 0) { iId = 0; iU = 1; iT = 2; iN = 3; start = 0; }
  return rows.slice(start).map(r => ({ id: (r[iId] || '').trim(), unit: (r[iU] || '').trim(), title: (r[iT] || '').trim(), name: (r[iN] || '').trim() })).filter(m => m.id);
}

/* ---------- 紀錄 ---------- */
function records() { return load(LS.records, []); }
function saveRecord(rec) { const all = records(); const i = all.findIndex(r => r.id === rec.id); rec.updatedAt = new Date().toISOString(); if (i >= 0) all[i] = rec; else all.unshift(rec); save(LS.records, all); queueSync(rec); }
function getRecord(id) { return records().find(r => r.id === id); }
function incident() { const i = load(LS.incident, null); if (i && i.date === todayStr()) return i; return { date: todayStr(), address: '' }; }
function openRecordFor(memberId) { const inc = incident(); return records().find(r => r.memberId === memberId && r.date === inc.date && r.address === inc.address && !r.closed); }
function newRecord(m) { const inc = incident(); return { id: uid(), memberId: m.id, unit: m.unit, title: m.title, name: m.name, date: inc.date, address: inc.address, cylinders: [{ no: 1, gas: '', gasUnit: 'bar', start: '', end: '' }], vitals: [], rehabAt: null, closed: false, createdAt: new Date().toISOString() }; }

/* ---------- 計算 ---------- */
function toMin(t) { if (!t || !/^\d{1,2}:\d{2}/.test(t)) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function cylMinutes(c, live = true) {
  const s = toMin(c.start), e = toMin(c.end);
  if (s != null && e != null) { let d = e - s; if (d < 0) d += 1440; return { min: d, live: false }; }
  if (s != null && live) { let d = toMin(hhmm()) - s; if (d < 0) d += 1440; if (d <= 120) return { min: d, live: true }; return { min: null, live: false, stale: true }; }
  if (c.gasUnit === 'min' && num(c.gas) != null) return { min: num(c.gas), live: false, fromGas: true };
  return { min: null, live: false };
}
function rehabCheck(rec) {
  const T = th(); const hits = [];
  rec.cylinders.forEach((c, i) => { const cm = cylMinutes(c); const d = cm.min; if (d == null) return; const lim = i === 0 ? T.cyl1Min : T.cyl2Min; if (d >= lim) hits.push({ i, d, lim, live: cm.live }); });
  return hits;
}
function minsBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 60000); }
function evalVital(v, rec, prevList) {
  const T = th(); const bad = [], warn = [], cells = {}; let emergency = false, o2 = false;
  const sbp = num(v.sbp), dbp = num(v.dbp), hr = num(v.hr), spo2 = num(v.spo2), t = num(v.temp), co = num(v.spco);
  if (sbp != null && sbp > T.sbpHigh) { bad.push(`收縮壓 ${sbp} > ${T.sbpHigh}`); cells.sbp = 'bad'; }
  if (sbp != null && sbp < T.sbpLow) { bad.push(`收縮壓 ${sbp} < ${T.sbpLow}（緊急救護）`); cells.sbp = 'bad'; emergency = true; }
  if (dbp != null && dbp > T.dbpHigh) { bad.push(`舒張壓 ${dbp} > ${T.dbpHigh}`); cells.dbp = 'bad'; }
  if (hr != null && hr > T.hrHigh) {
    const rest = rec && rec.rehabAt ? minsBetween(rec.rehabAt, v.time) : null;
    if (rest != null && rest < T.hrRestMin) { warn.push(`脈搏 ${hr} > ${T.hrHigh}（休息未滿 ${T.hrRestMin} 分鐘，請複測）`); cells.hr = 'warn'; }
    else { bad.push(`脈搏 ${hr} > ${T.hrHigh}`); cells.hr = 'bad'; }
  }
  if (spo2 != null && spo2 < T.spo2Low) { bad.push(`血氧 ${spo2}% < ${T.spo2Low}%`); cells.spo2 = 'bad'; }
  if (t != null && t >= T.tempHigh) { bad.push(`體溫 ${t}°C ≥ ${T.tempHigh}°C`); cells.temp = 'bad'; }
  if (t != null && prevList && prevList.length) {
    const seq = prevList.filter(p => num(p.temp) != null && new Date(p.time) < new Date(v.time)).sort((a, b) => new Date(a.time) - new Date(b.time));
    // 從最早一筆起，體溫一路沒有下降且跨越 ≥ tempRiseMin 分鐘
    if (seq.length) { let k = seq.length - 1, last = t; while (k >= 0 && num(seq[k].temp) <= last) { last = num(seq[k].temp); k--; }
      const first = seq[k + 1]; if (first && num(first.temp) < t && minsBetween(first.time, v.time) >= T.tempRiseMin) { bad.push(`體溫持續上升 ${minsBetween(first.time, v.time)} 分鐘`); cells.temp = 'bad'; } }
  }
  if (co != null && co > T.spcoHigh) { bad.push(`SpCO ${co}% > ${T.spcoHigh}%`); cells.spco = 'bad'; }
  if (co != null && co > T.spcoO2) { o2 = true; }
  return { bad, warn, cells, emergency, o2, level: bad.length ? 'red' : warn.length ? 'amber' : 'green' };
}
function recStatus(rec) {
  if (rec.closed) return { k: 'gray', t: '已結束' };
  const last = rec.vitals[rec.vitals.length - 1];
  if (last) { const e = evalVital(last, rec, rec.vitals.slice(0, -1)); if (e.level === 'red') return { k: 'red', t: '紅色警戒' }; }
  if (rec.rehabAt || rehabCheck(rec).length) return { k: 'amber', t: 'REHAB' };
  return { k: 'green', t: '作業中' };
}

/* ---------- 同步（Apps Script） ---------- */
function cylRows(rec) { return rec.cylinders.map((c, i) => { const d = cylMinutes(c, false).min; const hit = rehabCheck(rec).some(h => h.i === i);
  return { sheet: '氣瓶紀錄', id: rec.id + '-C' + (i + 1), row: [rec.id + '-C' + (i + 1), new Date().toLocaleString('zh-TW', { hour12: false }), rec.date, rec.address, rec.memberId, rec.unit, rec.title, rec.name, i + 1, c.gas, c.gasUnit === 'min' ? '分鐘' : 'bar', c.start, c.end, d == null ? '' : d, hit ? '是' : '', rec.closed ? '已結束' : ''] }; }); }
function vitRows(rec) { return rec.vitals.map((v, i) => { const e = evalVital(v, rec, rec.vitals.slice(0, i));
  return { sheet: '生命徵象', id: v.id, row: [v.id, new Date().toLocaleString('zh-TW', { hour12: false }), rec.date, rec.address, rec.memberId, rec.name, v.time.replace('T', ' '), v.sbp, v.dbp, v.hr, v.spo2, v.temp, v.spco, v.note, e.level === 'red' ? '紅色警戒' : e.level === 'amber' ? '注意' : '正常', e.bad.concat(e.warn).join('；')] }; }); }
function queueSync(rec) { const q = load(LS.queue, []); if (!q.includes(rec.id)) q.push(rec.id); save(LS.queue, q); flush(); }
let flushing = false;
async function flush() {
  updateBadge(); const url = apiUrl(); if (!url || flushing || !navigator.onLine) return; const q = load(LS.queue, []); if (!q.length) return;
  flushing = true;
  try {
    const rows = []; q.forEach(id => { const r = getRecord(id); if (r) rows.push(...cylRows(r), ...vitRows(r)); });
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'upsert', key: settings().key, rows }) });
    const j = await res.json(); if (!j.ok) throw new Error(j.error || '同步失敗');
    const left = load(LS.queue, []).filter(id => !q.includes(id)); save(LS.queue, left);
  } catch (e) { console.warn(e); $('#syncBadge').title = String(e.message || e); }
  flushing = false; updateBadge();
}
function updateBadge() { const b = $('#syncBadge'); const q = load(LS.queue, []).length;
  if (!apiUrl()) { b.textContent = '本機模式'; b.className = 'badge warn'; } else if (q) { b.textContent = `待同步 ${q}`; b.className = 'badge warn'; } else { b.textContent = '已同步'; b.className = 'badge ok'; } }
async function pullRoster() {
  const url = apiUrl(); if (!url) { toast('尚未設定 Apps Script 網址，請用 CSV 匯入'); return false; }
  try { const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'action=roster&key=' + encodeURIComponent(settings().key || ''));
    const j = await res.json(); if (!j.ok) throw new Error(j.error || '讀取失敗');
    const list = rowsToRoster(j.rows); if (!list.length) throw new Error('名冊是空的'); save(LS.roster, list); save(LS.rosterSrc, 'Google 試算表 ' + new Date().toLocaleString('zh-TW', { hour12: false })); toast(`已載入 ${list.length} 人`); return true;
  } catch (e) { toast('讀取名冊失敗：' + e.message); return false; }
}
window.addEventListener('online', flush);

/* ---------- 畫面 ---------- */
const DISC = '<p class="disclaimer">本系統依 REHAB 準則提供現場管制參考，不取代救護人員與醫師之專業判斷。</p>';
const COOLING = `<ol>
<li>移至冷區（上風處、遮蔭通風），先做初級濕式除污再卸除消防衣、SCBA</li>
<li><b>前臂與雙手浸泡 10–17°C 冷水</b>（主動降溫，效果優於只休息吹風）</li>
<li>輔助：濕毛巾、水冷扇、冰敷頸部／腋下／鼠蹊，可飲用冰沙</li>
<li>補充水分與電解質（作業逾 1 小時加電解質），避免咖啡因、高糖飲料</li>
<li>每 5–10 分鐘複測生命徵象；未恢復前<b>不得歸隊</b></li>
<li>意識改變、胸痛、SBP &lt;80、體溫持續上升或降溫無效 → 立即依救護程序後送</li></ol>
<div class="small" style="margin-top:6px;font-weight:400">依據：EMSer 整理之 REHAB 文獻（前臂浸泡 10–17°C、冰沙、主動降溫）及消防署後勤照護指引。</div>`;

function setTab(t) { $$('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === t)); }
let timer = null;
function route() {
  clearInterval(timer); stopScan();
  const h = location.hash.replace(/^#\/?/, ''); const [p, a] = h.split('/').map(decodeURIComponent);
  window.scrollTo(0, 0);
  if (p === 'm') return viewMember(a);
  if (p === 'r') return viewRecord(a);
  if (p === 'v') return viewVitals(a);
  if (p === 'scan') return viewScan();
  if (p === 'roster') return viewRoster();
  if (p === 'qr') return viewQR();
  if (p === 'records') return viewRecords();
  if (p === 'settings') return viewSettings();
  return viewHome();
}

function viewHome() {
  setTab('home'); const inc = incident(); const recs = records().filter(r => r.date === inc.date && !r.closed);
  const order = { red: 0, amber: 1, green: 2, gray: 3 };
  recs.sort((a, b) => order[recStatus(a).k] - order[recStatus(b).k]);
  app.innerHTML = `
  <div class="card"><h2>目前案件</h2>
    <div class="grid2"><div><label>日期</label><input type="date" id="incDate" value="${esc(inc.date)}"></div>
    <div><label>案件地址</label><input id="incAddr" placeholder="例：大雅區○○路○號" value="${esc(inc.address)}"></div></div>
    <p class="muted small">掃描或點選人員時，會自動帶入這個日期和地址。</p>
  </div>
  <a href="#/scan" class="btn btn-red btn-block" style="font-size:19px;padding:16px">📷 掃描臂章 QR Code 建檔</a>
  <div class="card"><div class="row"><div><label>或輸入臂章號碼</label><input id="manualId" placeholder="臂章號碼" autocapitalize="characters"></div><button class="btn-blue now" id="goManual">開啟</button></div></div>
  <div class="card"><h3>本案人員（${recs.length}）</h3>
    ${recs.length ? `<ul class="list">${recs.map(r => { const s = recStatus(r); const n = r.cylinders.filter(c => c.start || c.gas).length;
      return `<li><a href="#/r/${esc(r.id)}"><b>${esc(r.name)}</b> <span class="muted small">${esc(r.memberId)}｜${esc(r.unit)}｜第 ${n} 支</span></a><span class="pill ${s.k}">${s.t}</span></li>`; }).join('')}</ul>` : '<p class="muted">尚無人員，請掃描臂章 QR Code。</p>'}
  </div>${DISC}`;
  const saveInc = () => save(LS.incident, { date: $('#incDate').value || todayStr(), address: $('#incAddr').value.trim() });
  $('#incDate').onchange = saveInc; $('#incAddr').onchange = saveInc;
  $('#goManual').onclick = () => { const v = $('#manualId').value.trim(); if (v) location.hash = '#/m/' + encodeURIComponent(v); };
  $('#manualId').onkeydown = e => { if (e.key === 'Enter') $('#goManual').click(); };
  timer = setInterval(() => { if (!document.activeElement || document.activeElement.tagName !== 'INPUT') viewHome(); }, 30000);
}

function viewMember(id) {
  setTab('home'); let m = findMember(id);
  if (!m) {
    app.innerHTML = `<div class="card"><h2>名冊查無：${esc(id)}</h2><p class="muted">可先臨時建檔（只存在這支手機），之後再補進試算表名冊。</p>
    <label>臂章號碼</label><input id="tId" value="${esc(id || '')}"><label>分隊別</label><input id="tU" placeholder="例：大雅分隊"><label>職稱</label><input id="tT"><label>姓名</label><input id="tN">
    <button class="btn btn-red btn-block" id="tSave">臨時建檔並開始紀錄</button></div>`;
    $('#tSave').onclick = () => { const nm = { id: $('#tId').value.trim(), unit: $('#tU').value.trim(), title: $('#tT').value.trim(), name: $('#tN').value.trim() || '(未填)', temp: true };
      if (!nm.id) return toast('請填臂章號碼'); const r = roster(); r.push(nm); save(LS.roster, r); location.hash = '#/m/' + encodeURIComponent(nm.id); };
    return;
  }
  let rec = openRecordFor(m.id);
  if (!rec) { rec = newRecord(m); saveRecord(rec); toast(`已為 ${m.name} 建檔`); }
  location.replace('#/r/' + encodeURIComponent(rec.id));
}

function viewRecord(rid) {
  setTab('home'); const rec = getRecord(rid); if (!rec) { app.innerHTML = '<div class="card">找不到紀錄</div>'; return; }
  const T = th();
  const render = () => {
    const hits = rehabCheck(rec);
    // 只有「已填結束時間」的氣瓶達標才鎖定 REHAB 開始時間；計時中達標先顯示，避免補登開始時間時誤觸發
    const solid = hits.find(h => !h.live);
    if (solid && !rec.rehabAt) { const c = rec.cylinders[solid.i]; rec.rehabAt = c.end ? `${rec.date}T${c.end}` : `${todayStr()}T${hhmm()}`; saveRecord(rec); }
    const st = recStatus(rec);
    const lastV = rec.vitals[rec.vitals.length - 1]; const lastE = lastV ? evalVital(lastV, rec, rec.vitals.slice(0, -1)) : null;
    const rest = rec.rehabAt ? Math.max(0, minsBetween(rec.rehabAt, new Date())) : null;
    app.innerHTML = `
    <div class="card"><div class="row" style="align-items:center"><div><h2 style="margin:0">${esc(rec.name)}</h2><div class="muted small">臂章 ${esc(rec.memberId)}｜${esc(rec.unit)}｜${esc(rec.title)}</div></div><span class="pill ${st.k}" style="flex:0 0 auto">${st.t}</span></div></div>
    ${rec.rehabAt || hits.length ? `<div class="banner ${st.k === 'red' ? 'red' : 'amber'}">⚠️ 已達 REHAB 條件，請撤出至休息區
      <div style="font-weight:400;margin-top:4px">${hits.map(h => `第 ${h.i + 1} 支使用 ${h.d} 分鐘（≥ ${h.lim} 分）`).join('；') || '已啟動'}${rest != null ? `｜已休息 ${rest} 分鐘（最少 ${T.restMin} 分）` : '｜計時中達標，填上結束時間後開始計算休息'}</div>
      <a href="#/v/${esc(rec.id)}" class="btn btn-block" style="background:#fff;color:#b91c1c;font-size:18px">🩺 生命徵象監測表單（${rec.vitals.length} 筆）</a></div>` : ''}
    ${lastE && lastE.level === 'red' ? `<div class="banner red">🚨 紅色警戒：建議進入低溫處置流程<div style="font-weight:400">${esc(lastE.bad.join('；'))}</div></div>` : ''}
    <div class="card"><h3>案件</h3><div class="grid2"><div><label>今天日期</label><input type="date" id="rDate" value="${esc(rec.date)}"></div><div><label>案件地址</label><input id="rAddr" value="${esc(rec.address)}" placeholder="案件地址"></div></div></div>
    <div class="card"><h3>氣瓶使用情形</h3>
      <p class="muted small">REHAB 條件：第 1 支 ≥ ${T.cyl1Min} 分鐘，或第 2 支 ≥ ${T.cyl2Min} 分鐘。只填開始時間會即時計時。</p>
      ${rec.cylinders.map((c, i) => { const d = cylMinutes(c); const hit = hits.some(h => h.i === i);
      return `<div class="cyl ${hit ? 'hit' : ''}" data-i="${i}"><div class="hd"><span>第 ${i + 1} 支氣瓶</span><span class="dur ${hit ? 'hit' : ''}">${d.min == null ? (d.stale ? '請填結束' : '—') : d.min + ' 分'}${d.live ? ' <span class="pill blue">計時中</span>' : ''}</span></div>
        <div class="row"><div><label>用氣量</label><input inputmode="decimal" data-f="gas" value="${esc(c.gas)}" placeholder="例：300 或 30"></div><div style="flex:0 0 96px"><label>單位</label><select data-f="gasUnit"><option value="bar" ${c.gasUnit !== 'min' ? 'selected' : ''}>bar</option><option value="min" ${c.gasUnit === 'min' ? 'selected' : ''}>分鐘</option></select></div></div>
        <div class="row"><div><label>氣瓶開始使用時間</label><input type="time" data-f="start" value="${esc(c.start)}"></div><button class="now" data-now="start">現在</button></div>
        <div class="row"><div><label>${i === rec.cylinders.length - 1 ? '最後氣瓶使用結束時間' : '使用結束時間'}</label><input type="time" data-f="end" value="${esc(c.end)}"></div><button class="now" data-now="end">現在</button></div>
        ${rec.cylinders.length > 1 && i === rec.cylinders.length - 1 ? '<button class="btn-sm" data-del style="margin-top:8px">刪除這支</button>' : ''}</div>`; }).join('')}
      <button class="btn btn-blue btn-block" id="addCyl">＋ 換下一支氣瓶（第 ${rec.cylinders.length + 1} 支）</button>
      ${!rec.rehabAt ? `<button class="btn btn-block" id="manRehab">手動進入 REHAB（身體不適等）</button>` : ''}
    </div>
    <div class="card"><button class="btn btn-block" id="closeRec">${rec.closed ? '重新開啟紀錄' : '結束此人紀錄（歸隊／離場）'}</button><a class="btn btn-block" href="#/">← 回現場</a></div>${DISC}`;
    $('#rDate').onchange = e => { rec.date = e.target.value; saveRecord(rec); };
    $('#rAddr').onchange = e => { rec.address = e.target.value.trim(); saveRecord(rec); };
    $$('.cyl').forEach(el => { const i = +el.dataset.i; const c = rec.cylinders[i];
      $$('[data-f]', el).forEach(inp => inp.onchange = () => { c[inp.dataset.f] = inp.value; saveRecord(rec); render(); });
      $$('[data-now]', el).forEach(b => b.onclick = () => { c[b.dataset.now] = hhmm(); saveRecord(rec); render(); });
      const del = $('[data-del]', el); if (del) del.onclick = () => { if (confirm('刪除第 ' + (i + 1) + ' 支？')) { rec.cylinders.splice(i, 1); saveRecord(rec); render(); } };
    });
    $('#addCyl').onclick = () => { const last = rec.cylinders[rec.cylinders.length - 1]; if (last.start && !last.end) last.end = hhmm();
      rec.cylinders.push({ no: rec.cylinders.length + 1, gas: '', gasUnit: last.gasUnit || 'bar', start: '', end: '' }); saveRecord(rec); render(); };
    const mr = $('#manRehab'); if (mr) mr.onclick = () => { rec.rehabAt = `${todayStr()}T${hhmm()}`; saveRecord(rec); render(); };
    $('#closeRec').onclick = () => { if (!rec.closed && rec.rehabAt) { const le = lastE; if (!le) { if (!confirm('尚未量測生命徵象，確定結束？')) return; } else if (le.level === 'red') { if (!confirm('最後一次生命徵象為紅色警戒，確定結束？')) return; } else if (rest < T.restMin) { if (!confirm(`休息未滿 ${T.restMin} 分鐘，確定結束？`)) return; } }
      rec.closed = !rec.closed; saveRecord(rec); render(); };
  };
  render();
  timer = setInterval(() => { const a = document.activeElement; if (!a || !['INPUT', 'SELECT', 'TEXTAREA'].includes(a.tagName)) render(); }, 20000);
}

function viewVitals(rid) {
  setTab('home'); const rec = getRecord(rid); if (!rec) { app.innerHTML = '<div class="card">找不到紀錄</div>'; return; }
  const T = th();
  const render = () => {
    const evs = rec.vitals.map((v, i) => evalVital(v, rec, rec.vitals.slice(0, i)));
    const last = evs[evs.length - 1];
    const now = new Date(); const nowLocal = `${todayStr(now)}T${hhmm(now)}`;
    app.innerHTML = `
    <div class="card"><h2 style="margin:0">🩺 生命徵象監測</h2><div class="muted small">${esc(rec.name)}｜臂章 ${esc(rec.memberId)}｜${esc(rec.address || '未填地址')}｜REHAB 開始 ${rec.rehabAt ? esc(rec.rehabAt.slice(11)) : '—'}</div></div>
    ${last && last.level === 'red' ? `<div class="banner red" id="redAlert">🚨 紅色警戒：建議進入低溫處置流程
      <div style="font-weight:400;margin-top:4px">超過 REHAB 數值：${esc(last.bad.join('；'))}</div>
      ${last.emergency ? '<div style="margin-top:6px">⛑️ 收縮壓過低：立即緊急救護／後送</div>' : ''}${last.o2 ? `<div style="margin-top:6px">🫁 SpCO > ${T.spcoO2}%：給予高濃度氧氣</div>` : ''}
      ${COOLING}</div>` : last && last.level === 'amber' ? `<div class="banner amber">⚠️ 注意：${esc(last.warn.join('；'))}</div>` : last ? `<div class="banner green">✅ 最近一次量測在 REHAB 數值內（仍須休息滿 ${T.restMin} 分鐘並由救護人員評估）</div>` : ''}
    <div class="card"><h3>新增量測</h3>
      <label>量測時間</label><input type="datetime-local" id="vTime" value="${nowLocal}">
      <div class="grid2"><div><label>收縮壓 SBP</label><input id="vSbp" inputmode="numeric" placeholder="mmHg"></div><div><label>舒張壓 DBP</label><input id="vDbp" inputmode="numeric" placeholder="mmHg"></div></div>
      <div class="grid2"><div><label>脈搏</label><input id="vHr" inputmode="numeric" placeholder="次/分"></div><div><label>血氧 SpO2</label><input id="vSpo2" inputmode="numeric" placeholder="%"></div></div>
      <div class="grid2"><div><label>體溫</label><input id="vTemp" inputmode="decimal" placeholder="°C"></div><div><label>SpCO（選填）</label><input id="vSpco" inputmode="decimal" placeholder="%"></div></div>
      <label>其他備註</label><textarea id="vNote" placeholder="症狀、意識、處置（例：前臂浸泡冷水）"></textarea>
      <button class="btn btn-red btn-block" id="vSave">儲存這次量測</button>
      <p class="muted small">標準：BP &gt;${T.sbpHigh}/${T.dbpHigh} 或 SBP &lt;${T.sbpLow}｜脈搏 &gt;${T.hrHigh}（休息 ${T.hrRestMin} 分後）｜SpO2 &lt;${T.spo2Low}%｜體溫 ≥${T.tempHigh}°C 或持續上升 ${T.tempRiseMin} 分｜SpCO &gt;${T.spcoHigh}%。可在「設定」修改。</p>
    </div>
    <div class="card"><h3>量測紀錄（${rec.vitals.length}）</h3>
      ${rec.vitals.length ? `<div style="overflow-x:auto"><table class="vt"><tr><th>時間</th><th>血壓</th><th>脈搏</th><th>SpO2</th><th>體溫</th><th>SpCO</th><th></th></tr>
      ${rec.vitals.map((v, i) => { const e = evs[i]; const c = k => e.cells[k] || '';
        const bpc = (c('sbp') || c('dbp')) === 'bad' || c('sbp') === 'bad' || c('dbp') === 'bad' ? 'bad' : '';
        return `<tr><td>${esc(v.time.slice(11))}</td><td class="${bpc}">${esc(v.sbp || '-')}/${esc(v.dbp || '-')}</td><td class="${c('hr')}">${esc(v.hr || '-')}</td><td class="${c('spo2')}">${esc(v.spo2 || '-')}</td><td class="${c('temp')}">${esc(v.temp || '-')}</td><td class="${c('spco')}">${esc(v.spco || '-')}</td><td><button class="btn-sm" data-dv="${i}">刪</button></td></tr>${v.note ? `<tr><td colspan="7" class="muted small" style="text-align:left">備註：${esc(v.note)}</td></tr>` : ''}`; }).join('')}</table></div>` : '<p class="muted">尚無量測。</p>'}
    </div>
    <a class="btn btn-block" href="#/r/${esc(rec.id)}">← 回氣瓶紀錄</a>${DISC}`;
    // 輸入時即時標紅
    const live = () => { const v = { time: $('#vTime').value, sbp: $('#vSbp').value, dbp: $('#vDbp').value, hr: $('#vHr').value, spo2: $('#vSpo2').value, temp: $('#vTemp').value, spco: $('#vSpco').value };
      const e = evalVital(v, rec, rec.vitals); const map = { sbp: '#vSbp', dbp: '#vDbp', hr: '#vHr', spo2: '#vSpo2', temp: '#vTemp', spco: '#vSpco' };
      for (const k in map) $(map[k]).classList.toggle('bad', e.cells[k] === 'bad'); };
    $$('#vSbp,#vDbp,#vHr,#vSpo2,#vTemp,#vSpco').forEach(i => i.oninput = live);
    $('#vSave').onclick = () => { const v = { id: rec.id + '-V' + uid(), time: $('#vTime').value || nowLocal, sbp: $('#vSbp').value.trim(), dbp: $('#vDbp').value.trim(), hr: $('#vHr').value.trim(), spo2: $('#vSpo2').value.trim(), temp: $('#vTemp').value.trim(), spco: $('#vSpco').value.trim(), note: $('#vNote').value.trim() };
      if (!v.sbp && !v.dbp && !v.hr && !v.spo2 && !v.temp && !v.spco && !v.note) return toast('請至少填一項');
      if (!rec.rehabAt) rec.rehabAt = v.time;
      rec.vitals.push(v); rec.vitals.sort((a, b) => a.time.localeCompare(b.time)); saveRecord(rec); toast('已儲存'); render(); };
    $$('[data-dv]').forEach(b => b.onclick = () => { if (confirm('刪除這筆量測？')) { rec.vitals.splice(+b.dataset.dv, 1); saveRecord(rec); render(); } });
  };
  render();
}

let scanner = null;
function stopScan() { if (scanner) { const s = scanner; scanner = null; s.stop().catch(() => {}).then(() => { try { s.clear(); } catch (e) {} }); } }
function loadScript(src) { return new Promise((ok, no) => { if ($(`script[src="${src}"]`)) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); }
function idFromText(t) { t = String(t || '').trim(); try { const u = new URL(t); const id = u.searchParams.get('id'); if (id) return id; const m = u.hash.match(/#\/m\/([^/?]+)/); if (m) return decodeURIComponent(m[1]); } catch (e) {} return t; }
async function viewScan() {
  setTab('scan');
  app.innerHTML = `<div class="card"><h2>掃描臂章 QR Code</h2><div id="reader"></div><p class="muted small">也可以直接用手機相機掃描，會自動開啟此系統。若相機無法啟動，請允許相機權限，或改用下方輸入。</p>
  <div class="row"><div><input id="sId" placeholder="臂章號碼"></div><button class="btn-blue now" id="sGo">開啟</button></div></div>`;
  $('#sGo').onclick = () => { const v = $('#sId').value.trim(); if (v) location.hash = '#/m/' + encodeURIComponent(v); };
  try { await loadScript('vendor/html5-qrcode.min.js'); if (location.hash !== '#/scan') return;
    scanner = new Html5Qrcode('reader');
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: 230 }, txt => { const id = idFromText(txt); if (navigator.vibrate) navigator.vibrate(80); stopScan(); location.hash = '#/m/' + encodeURIComponent(id); }, () => {});
  } catch (e) { $('#reader').innerHTML = `<p style="color:#fff;padding:14px">無法啟動相機：${esc(e.message || e)}</p>`; }
}

function viewRoster() {
  setTab('roster'); const r = roster();
  app.innerHTML = `<div class="card"><h2>人員名冊（${r.length}）</h2><p class="muted small">來源：${esc(load(LS.rosterSrc, ''))}</p>
    <div class="grid2"><button class="btn-blue" id="pull">從試算表更新</button><label class="btn" style="margin:0;color:var(--ink)">匯入 CSV<input type="file" id="csv" accept=".csv,.tsv,.txt,text/csv" class="hidden"></label></div>
    <a class="btn btn-red btn-block" href="#/qr">🖨️ 產生全部 QR Code（可列印）</a>
    <p class="muted small">試算表欄位：臂章號碼、分隊別、職稱、姓名（第一列為標題）。${CFG.SHEET_URL ? `<a href="${esc(CFG.SHEET_URL)}" target="_blank" rel="noopener">開啟試算表</a>｜` : ''}<a href="sample-roster.csv" download>下載 CSV 範本</a></p></div>
  <div class="card"><ul class="list">${r.map(m => `<li><a href="#/m/${encodeURIComponent(m.id)}"><b>${esc(m.name)}</b> <span class="muted small">${esc(m.id)}｜${esc(m.unit)}｜${esc(m.title)}${m.temp ? '｜臨時' : ''}</span></a></li>`).join('')}</ul></div>`;
  $('#pull').onclick = async () => { if (await pullRoster()) viewRoster(); };
  $('#csv').onchange = e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { const list = rowsToRoster(parseCSV(rd.result)); if (!list.length) return toast('CSV 沒有讀到資料');
    save(LS.roster, list); save(LS.rosterSrc, 'CSV 匯入：' + f.name); toast(`已匯入 ${list.length} 人`); viewRoster(); }; rd.readAsText(f, 'utf-8'); };
}

function qrImg(text, cell = 6) { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createDataURL(cell, 2); }
function memberUrl(id) { return baseUrl() + '?id=' + encodeURIComponent(id); }
function viewQR() {
  setTab('roster'); const r = roster();
  app.innerHTML = `<div class="card no-print"><h2>臂章 QR Code</h2><p class="muted small">掃描後開啟：${esc(baseUrl())}?id=臂章號碼。網址固定不變，之後系統更新不用重印。</p>
    <button class="btn btn-red btn-block" onclick="window.print()">🖨️ 列印 / 存成 PDF</button></div>
  <div class="qrgrid">${r.map(m => `<div class="qrcard"><img alt="QR ${esc(m.id)}" src="${qrImg(memberUrl(m.id))}"><div class="nm">${esc(m.name)}</div><div class="sub">${esc(m.unit)}｜${esc(m.title)}</div><div class="sub">臂章 ${esc(m.id)}</div></div>`).join('')}</div>`;
}

function viewRecords() {
  setTab('records'); const all = records(); const q = load(LS.queue, []);
  app.innerHTML = `<div class="card"><h2>全部紀錄（${all.length}）</h2>
    <div class="grid2"><button class="btn-blue" id="sync">立即同步</button><button id="exp">匯出 CSV</button></div>
    <p class="muted small">${apiUrl() ? `待同步 ${q.length} 筆` : '本機模式：資料只存在這支手機。請匯出 CSV 或在設定頁接上 Google 試算表。'}</p></div>
  <div class="card"><ul class="list">${all.map(r => { const s = recStatus(r); return `<li><a href="#/r/${esc(r.id)}"><b>${esc(r.name)}</b> <span class="muted small">${esc(r.date)}｜${esc(r.address || '未填地址')}｜${r.cylinders.length} 支｜生命徵象 ${r.vitals.length} 筆</span></a><span class="pill ${s.k}">${s.t}</span></li>`; }).join('') || '<li class="muted">尚無紀錄</li>'}</ul></div>`;
  $('#sync').onclick = async () => { if (!apiUrl()) return toast('尚未設定 Apps Script 網址'); records().forEach(r => { const qq = load(LS.queue, []); if (!qq.includes(r.id)) { qq.push(r.id); save(LS.queue, qq); } }); await flush(); toast(load(LS.queue, []).length ? '同步失敗，稍後自動重試' : '已同步'); viewRecords(); };
  $('#exp').onclick = () => { const csv = (head, rows) => [head, ...rows].map(r => r.map(x => `"${String(x == null ? '' : x).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const c = csv(['紀錄ID', '匯出時間', '日期', '案件地址', '臂章號碼', '分隊別', '職稱', '姓名', '氣瓶第幾支', '用氣量', '用氣單位', '開始時間', '結束時間', '使用分鐘', 'REHAB觸發', '備註'], all.flatMap(r => cylRows(r).map(x => x.row)));
    const v = csv(['紀錄ID', '匯出時間', '日期', '案件地址', '臂章號碼', '姓名', '量測時間', '收縮壓', '舒張壓', '脈搏', '血氧SpO2', '體溫', 'SpCO', '其他備註', '判定', '異常項目'], all.flatMap(r => vitRows(r).map(x => x.row)));
    const dl = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/csv' })); a.download = name; a.click(); };
    dl(`氣瓶紀錄_${todayStr()}.csv`, c); setTimeout(() => dl(`生命徵象_${todayStr()}.csv`, v), 400); };
}

function viewSettings() {
  setTab('settings'); const s = settings(); const T = th();
  app.innerHTML = `<div class="card"><h2>連線設定</h2>
    <label>Apps Script 網址（/exec 結尾）</label><input id="sUrl" value="${esc(s.apiUrl)}" placeholder="https://script.google.com/macros/s/…/exec">
    <label>隊碼（若 Apps Script 有設定 ACCESS_KEY 才需要）</label><input id="sKey" type="password" value="${esc(s.key)}" autocomplete="off">
    <label>QR Code 網址（留空 = 本頁網址）</label><input id="sBase" value="${esc(s.baseUrl)}" placeholder="${esc(location.origin + location.pathname)}">
    <button class="btn btn-blue btn-block" id="sSave">儲存</button></div>
  <div class="card"><h2>REHAB 判定標準</h2><p class="muted small"><span class="src">EMSer</span> 來自 EMSer 後勤照護簡報（消防月刊整理 NFPA 1584）與你指定的條件；<span class="src nfpa">預設</span> EMSer 沒給數值，採 NFPA 1584／到院前常用值。</p>
    ${Object.keys(DEFAULT_TH).map(k => `<label>${esc(DEFAULT_TH[k].label)} <span class="src ${DEFAULT_TH[k].src === 'NFPA' ? 'nfpa' : ''}">${DEFAULT_TH[k].src === 'NFPA' ? '預設' : 'EMSer'}</span></label><input inputmode="decimal" data-th="${k}" value="${T[k]}"><div class="muted small">${esc(DEFAULT_TH[k].note)}</div>`).join('')}
    <div class="grid2"><button class="btn-red" id="thSave">儲存標準</button><button id="thReset">恢復預設</button></div></div>
  <div class="card"><h3>資料</h3><button class="btn btn-block" id="wipe">清除這支手機的所有紀錄</button><p class="muted small">清除前請先同步或匯出 CSV。</p></div>${DISC}`;
  $('#sSave').onclick = () => { setSettings({ apiUrl: $('#sUrl').value.trim(), key: $('#sKey').value.trim(), baseUrl: $('#sBase').value.trim() }); updateBadge(); flush(); toast('已儲存'); };
  $('#thSave').onclick = () => { const o = {}; $$('[data-th]').forEach(i => o[i.dataset.th] = i.value); setSettings({ th: o }); toast('標準已儲存'); };
  $('#thReset').onclick = () => { setSettings({ th: {} }); viewSettings(); toast('已恢復預設'); };
  $('#wipe').onclick = () => { if (confirm('確定清除所有紀錄？此動作無法復原。')) { save(LS.records, []); save(LS.queue, []); toast('已清除'); } };
}

/* ---------- 啟動 ---------- */
(function boot() {
  const p = new URLSearchParams(location.search); const id = p.get('id');
  if (id) { history.replaceState(null, '', location.pathname + '#/m/' + encodeURIComponent(id)); }
  window.addEventListener('hashchange', route); route(); updateBadge();
  if (apiUrl() && load(LS.rosterSrc, '').startsWith('內建')) pullRoster();
  flush(); setInterval(flush, 60000);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
window.__rehab = { evalVital, rehabCheck, cylMinutes, th };
})();
