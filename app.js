/* REHAB 氣瓶管制系統 v2 — 雲端：Firebase Firestore（匿名登入＋隊碼，離線快取）；未加入隊伍時為本機模式。
   僅供現場管制參考，不取代醫療專業判斷。 */
(function () {
'use strict';
const CFG = window.REHAB_CONFIG || {};
const TEAM = localStorage.getItem('rehab.teamOverride') || CFG.TEAM || 'taichung';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const app = $('#app');
const LS = { roster: 'rehab.roster', rosterSrc: 'rehab.rosterSrc', records: 'rehab.records', vitals: 'rehab.vitals', settings: 'rehab.settings', incident: 'rehab.incident', joined: 'rehab.joined', snooze: 'rehab.snooze', device: 'rehab.device' };
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const localIso = (d = new Date()) => `${todayStr(d)}T${hhmm(d)}`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const num = v => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
const DEVICE = load(LS.device, null) || (() => { const d = 'D' + uid(); save(LS.device, d); return d; })();
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2400); }
const FACES = [['A', '第一面（A）'], ['B', '第二面（B）'], ['C', '第三面（C）'], ['D', '第四面（D）']];
const faceName = f => (FACES.find(x => x[0] === f) || [, ''])[1];
const GROUPS = ['1', '2', '3'];

/* ---------- 判定標準 ---------- */
const DEFAULT_TH = {
  cyl1Min:   { v: 45,  label: '第 1 支氣瓶工作時間 ≥（分鐘）→ REHAB', src: 'EMSer', note: 'Terry 指定；EMSer 資料：一支 45／60 分鐘氣瓶' },
  cyl2Min:   { v: 30,  label: '第 2 支（含以後）工作時間 ≥（分鐘）→ REHAB', src: 'EMSer', note: 'Terry 指定；EMSer：30 分鐘氣瓶用完 2 支' },
  workDefault:{ v: 30, label: '工作時間預設值（分鐘）', src: 'EMSer', note: 'Terry 指定預設 30 分鐘' },
  restMin:   { v: 10,  label: 'REHAB 倒數（分鐘）→ 時間到通知量測生命徵象', src: 'EMSer', note: 'Terry 指定 10 分鐘；EMSer：至少 10–20 分鐘強制休息' },
  sbpHigh:   { v: 160, label: '收縮壓 >（mmHg）', src: 'EMSer', note: 'EMSer：>160/100 不得離開 REHAB' },
  dbpHigh:   { v: 100, label: '舒張壓 >（mmHg）', src: 'EMSer', note: 'EMSer：>160/100 不得離開 REHAB' },
  sbpLow:    { v: 80,  label: '收縮壓 <（mmHg）→ 緊急救護', src: 'EMSer', note: 'EMSer：SBP <80 緊急救護' },
  hrHigh:    { v: 100, label: '脈搏 >（次/分）', src: 'EMSer', note: 'EMSer：休息 10 分鐘後仍 >100，持續 20 分鐘須持續照護' },
  hrRestMin: { v: 10,  label: '脈搏判定需休息滿（分鐘）', src: 'EMSer', note: '未滿此時間脈搏偏高只顯示黃色「請複測」' },
  spo2Low:   { v: 94,  label: '血氧 SpO2 <（%）', src: 'NFPA', note: 'EMSer 未提供；採一般到院前常用下限' },
  tempHigh:  { v: 38.0, label: '體溫 ≥（°C）', src: 'NFPA', note: 'EMSer 只寫「持續升高超過 20 分鐘須持續監測」；採 NFPA 1584 常用 38°C' },
  tempRiseMin:{ v: 20, label: '體溫持續上升超過（分鐘）', src: 'EMSer', note: 'EMSer：體溫持續升高超過 20 分鐘須持續監測' },
  spcoHigh:  { v: 5,   label: 'SpCO >（%）不得離開', src: 'EMSer', note: 'EMSer：>5% 不得離開；>15% 給高濃度氧氣' },
  spcoO2:    { v: 15,  label: 'SpCO >（%）給高濃度氧氣', src: 'EMSer', note: 'EMSer' }
};
function th() { const s = load(LS.settings, {}); const o = {}; for (const k in DEFAULT_TH) o[k] = (s.th && s.th[k] != null && s.th[k] !== '') ? Number(s.th[k]) : DEFAULT_TH[k].v; return o; }
function settings() { return Object.assign({ baseUrl: '' }, load(LS.settings, {})); }
function setSettings(p) { save(LS.settings, Object.assign(load(LS.settings, {}), p)); }
function baseUrl() { const b = (settings().baseUrl || '').trim(); return b || (location.origin + location.pathname); }

/* ---------- 資料層（雲端 / 本機） ---------- */
const S = { roster: load(LS.roster, []), records: {}, vitals: {}, cloud: false, uid: null, pending: false, online: navigator.onLine, viewDate: todayStr(), subs: [] };
let fb = null, db = null, auth = null;
const DEMO = [['T001', '大雅分隊', '小隊長', '範例甲'], ['T002', '大雅分隊', '隊員', '範例乙'], ['T003', '大雅分隊', '隊員', '範例丙'], ['T004', '清水分隊', '隊員', '範例丁'], ['T005', '神岡分隊', '替代役', '範例戊']].map(r => ({ id: r[0], unit: r[1], title: r[2], name: r[3] }));
function localLoad() { if (!S.roster.length && !load(LS.joined, null)) setRoster(DEMO, '內建範例（假資料，加入隊伍後改用雲端名冊）'); S.records = {}; load(LS.records, []).forEach(r => S.records[r.id] = r); S.vitals = {}; load(LS.vitals, []).forEach(v => S.vitals[v.id] = v); }
function localSave() { save(LS.records, Object.values(S.records)); save(LS.vitals, Object.values(S.vitals)); }
const clean = o => JSON.parse(JSON.stringify(o));
function putRecord(rec) { rec.updatedAt = new Date().toISOString(); rec.device = DEVICE; S.records[rec.id] = rec;
  if (S.cloud) fb.setDoc(fb.doc(db, `teams/${TEAM}/records/${rec.id}`), clean(rec)).catch(e => toast('上傳失敗：' + e.code)); else localSave(); }
function putVital(v) { v.updatedAt = new Date().toISOString(); S.vitals[v.id] = v;
  if (S.cloud) fb.setDoc(fb.doc(db, `teams/${TEAM}/vitals/${v.id}`), clean(v)).catch(e => toast('上傳失敗：' + e.code)); else localSave(); }
function delVital(id) { delete S.vitals[id]; if (S.cloud) fb.deleteDoc(fb.doc(db, `teams/${TEAM}/vitals/${id}`)); else localSave(); }
function setRoster(list, src) { S.roster = list; save(LS.roster, list); save(LS.rosterSrc, src); }
function vitalsOf(recId) { return Object.values(S.vitals).filter(v => v.recId === recId).sort((a, b) => a.time.localeCompare(b.time)); }
function getRecord(id) { return S.records[id]; }

function fbInit() { if (fb || !window.FB || !CFG.FIREBASE) return !!fb; fb = window.FB; const a = fb.initializeApp(CFG.FIREBASE);
  try { db = fb.initializeFirestore(a, { localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }) }); } catch (e) { db = fb.initializeFirestore(a, {}); }
  auth = fb.getAuth(a); return true; }
async function ensureAuth() { fbInit(); if (auth.currentUser) return auth.currentUser;
  await new Promise(ok => { const un = fb.onAuthStateChanged(auth, u => { un(); ok(u); }); });
  if (auth.currentUser) return auth.currentUser; return (await fb.signInAnonymously(auth)).user; }
async function joinTeam(code, firstTime) {
  code = String(code || '').trim(); if (code.length < 6) throw new Error('隊碼至少 6 個字');
  const u = await ensureAuth();
  if (firstTime) { await fb.setDoc(fb.doc(db, `teams/${TEAM}/private/config`), { code, createdBy: u.uid, createdAt: Date.now() }); }
  await fb.setDoc(fb.doc(db, `teams/${TEAM}/joins/${u.uid}`), { code, at: Date.now(), device: DEVICE });
  save(LS.joined, { team: TEAM, uid: u.uid, at: Date.now() }); await startCloud(); return true;
}
async function startCloud() {
  const j = load(LS.joined, null); if (!j || j.team !== TEAM) { S.cloud = false; localLoad(); badge(); return; }
  fbInit(); const u = await ensureAuth();
  if (u.uid !== j.uid) { localStorage.removeItem(LS.joined); S.cloud = false; localLoad(); badge(); toast('登入身分已變更，請重新輸入隊碼'); return; }
  // 本機模式留下的紀錄先上傳
  const localRecs = load(LS.records, []), localVit = load(LS.vitals, []);
  S.cloud = true; S.records = {}; S.vitals = {};
  if (localRecs.length || localVit.length) { localRecs.forEach(putRecord); localVit.forEach(putVital); save(LS.records, []); save(LS.vitals, []); toast(`已上傳本機紀錄 ${localRecs.length} 筆`); }
  subscribe(); badge();
}
function subscribe() {
  S.subs.forEach(f => f()); S.subs = []; if (!S.cloud) return;
  const dates = Array.from(new Set([todayStr(), S.viewDate, incident().date]));
  const meta = { includeMetadataChanges: true };
  const onErr = e => { console.warn(e); badge(e.code); if (e.code === 'permission-denied') { localStorage.removeItem(LS.joined); S.cloud = false; toast('隊碼已失效，請重新加入'); } };
  S.subs.push(fb.onSnapshot(fb.collection(db, `teams/${TEAM}/roster`), snap => {
    const list = snap.docs.map(d => d.data()).filter(m => m.id).sort((a, b) => String(a.id).localeCompare(String(b.id), 'zh-Hant', { numeric: true }));
    if (list.length || !snap.metadata.fromCache) setRoster(list, '雲端名冊（Google 試算表同步）'); rerender('roster'); }, onErr));
  S.subs.push(fb.onSnapshot(fb.query(fb.collection(db, `teams/${TEAM}/records`), fb.where('date', 'in', dates)), meta, snap => {
    const keep = {}; Object.values(S.records).forEach(r => { if (!dates.includes(r.date)) keep[r.id] = r; });
    snap.docs.forEach(d => { const r = d.data(); if (!r || !r.memberId) return; if (!Array.isArray(r.cylinders) || !r.cylinders.length) r.cylinders = [{ face: '', group: '', inAt: '', exit: '', work: th().workDefault, gas: '' }]; r.id = d.id; keep[d.id] = r; }); S.records = keep; S.pending = snap.metadata.hasPendingWrites; S.fromCache = snap.metadata.fromCache; badge(); rerender('data'); }, onErr));
  S.subs.push(fb.onSnapshot(fb.query(fb.collection(db, `teams/${TEAM}/vitals`), fb.where('date', 'in', dates)), meta, snap => {
    const keep = {}; Object.values(S.vitals).forEach(v => { if (!dates.includes(v.date)) keep[v.id] = v; });
    snap.docs.forEach(d => { const v = d.data(); if (!v || !v.recId || !v.time) return; v.id = d.id; keep[d.id] = v; }); S.vitals = keep; badge(); rerender('data'); }, onErr));
}
function badge(err) { const b = $('#syncBadge'); if (!b) return;
  if (!S.cloud) { b.textContent = '本機模式'; b.className = 'badge warn'; return; }
  if (err) { b.textContent = '連線錯誤'; b.className = 'badge warn'; return; }
  if (!navigator.onLine) { b.textContent = '離線（恢復後自動上傳）'; b.className = 'badge warn'; return; }
  if (S.pending) { b.textContent = '上傳中…'; b.className = 'badge warn'; return; }
  b.textContent = '雲端同步'; b.className = 'badge ok'; }
window.addEventListener('online', () => badge()); window.addEventListener('offline', () => badge());
let rrT = null; function rerender() { clearTimeout(rrT); rrT = setTimeout(() => { const a = document.activeElement; if (a && ['INPUT', 'SELECT', 'TEXTAREA'].includes(a.tagName) && a.id !== 'armId') { pendingRender = true; return; } route(true); }, 120); }
let pendingRender = false; document.addEventListener('focusout', () => setTimeout(() => { if (pendingRender) { pendingRender = false; const a = document.activeElement; if (!a || !['INPUT', 'SELECT', 'TEXTAREA'].includes(a.tagName)) route(true); } }, 200));

/* ---------- 名冊 ---------- */
function roster() { return S.roster; }
function findMember(id) { id = String(id || '').trim().toLowerCase(); if (!id) return null; return roster().find(m => String(m.id).trim().toLowerCase() === id); }
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
  if (!rows.length) return []; const h = rows[0].map(x => x.trim()); const idx = n => h.findIndex(x => x.includes(n));
  let iId = idx('臂章'), iU = idx('分隊'), iT = idx('職稱'), iN = idx('姓名'), start = 1;
  if (iId < 0) { iId = 0; iU = 1; iT = 2; iN = 3; start = 0; }
  return rows.slice(start).map(r => ({ id: (r[iId] || '').trim(), unit: (r[iU] || '').trim(), title: (r[iT] || '').trim(), name: (r[iN] || '').trim() })).filter(m => m.id);
}
async function uploadRosterToCloud(list) {
  if (!S.cloud) { setRoster(list, '本機 CSV'); return; }
  const b = fb.writeBatch(db); list.slice(0, 450).forEach(m => b.set(fb.doc(db, `teams/${TEAM}/roster/${encodeURIComponent(m.id)}`), { id: m.id, unit: m.unit, title: m.title, name: m.name, src: 'csv', at: Date.now() }));
  await b.commit();
}

/* ---------- 紀錄 ---------- */
function incident() { const i = load(LS.incident, null); if (i && i.date === todayStr()) return i; return { date: todayStr(), address: '' }; }
function openRecordFor(memberId) { const inc = incident(); return Object.values(S.records).find(r => r.memberId === memberId && r.date === inc.date && !r.closed); }
function newRecord(m) { const inc = incident(); const T = th();
  return { id: TEAM.slice(0, 2) + uid(), memberId: m.id, unit: m.unit || '', title: m.title || '', name: m.name || '', date: inc.date, address: inc.address || '',
    cylinders: [{ face: '', group: '', inAt: '', exit: '', work: T.workDefault, gas: '' }], rehabAt: null, alertAck: null, closed: false, createdAt: new Date().toISOString() }; }
function toMin(t) { if (!t || !/^\d{1,2}:\d{2}/.test(t)) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function fromMin(m) { m = ((m % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; }
function entryTime(c) { const e = toMin(c.exit), w = num(c.work); if (e == null || w == null) return ''; return fromMin(e - w); }
function cylState(c) { if (c.exit) return 'done'; if (c.inAt) return 'working'; return 'idle'; }
function rehabCheck(rec) { const T = th(); const hits = [];
  rec.cylinders.forEach((c, i) => { if (!c.exit) return; const w = num(c.work); if (w == null) return; const lim = i === 0 ? T.cyl1Min : T.cyl2Min; if (w >= lim) hits.push({ i, d: w, lim }); });
  return hits; }
function minsBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 60000); }
function evalVital(v, rec, prevList) {
  const T = th(); const bad = [], warn = [], cells = {}; let emergency = false, o2 = false;
  const sbp = num(v.sbp), dbp = num(v.dbp), hr = num(v.hr), spo2 = num(v.spo2), t = num(v.temp), co = num(v.spco);
  if (sbp != null && sbp > T.sbpHigh) { bad.push(`收縮壓 ${sbp} > ${T.sbpHigh}`); cells.sbp = 'bad'; }
  if (sbp != null && sbp < T.sbpLow) { bad.push(`收縮壓 ${sbp} < ${T.sbpLow}（緊急救護）`); cells.sbp = 'bad'; emergency = true; }
  if (dbp != null && dbp > T.dbpHigh) { bad.push(`舒張壓 ${dbp} > ${T.dbpHigh}`); cells.dbp = 'bad'; }
  if (hr != null && hr > T.hrHigh) { const rest = rec && rec.rehabAt ? minsBetween(rec.rehabAt, v.time) : null;
    if (rest != null && rest < T.hrRestMin) { warn.push(`脈搏 ${hr} > ${T.hrHigh}（休息未滿 ${T.hrRestMin} 分鐘，請複測）`); cells.hr = 'warn'; } else { bad.push(`脈搏 ${hr} > ${T.hrHigh}`); cells.hr = 'bad'; } }
  if (spo2 != null && spo2 < T.spo2Low) { bad.push(`血氧 ${spo2}% < ${T.spo2Low}%`); cells.spo2 = 'bad'; }
  if (t != null && t >= T.tempHigh) { bad.push(`體溫 ${t}°C ≥ ${T.tempHigh}°C`); cells.temp = 'bad'; }
  if (t != null && prevList && prevList.length) {
    const seq = prevList.filter(p => num(p.temp) != null && p.time < v.time).sort((a, b) => a.time.localeCompare(b.time));
    if (seq.length) { let k = seq.length - 1, last = t; while (k >= 0 && num(seq[k].temp) <= last) { last = num(seq[k].temp); k--; }
      const first = seq[k + 1]; if (first && num(first.temp) < t && minsBetween(first.time, v.time) >= T.tempRiseMin) { bad.push(`體溫持續上升 ${minsBetween(first.time, v.time)} 分鐘`); cells.temp = 'bad'; } } }
  if (co != null && co > T.spcoHigh) { bad.push(`SpCO ${co}% > ${T.spcoHigh}%`); cells.spco = 'bad'; }
  if (co != null && co > T.spcoO2) o2 = true;
  return { bad, warn, cells, emergency, o2, level: bad.length ? 'red' : warn.length ? 'amber' : 'green' };
}
function cdLeft(rec) { if (!rec.rehabAt) return null; const end = new Date(rec.rehabAt).getTime() + th().restMin * 60000; return Math.round((end - Date.now()) / 1000); }
function recStatus(rec) {
  if (rec.closed) return { k: 'gray', t: '已歸隊', code: 'closed' };
  const vs = vitalsOf(rec.id); const last = vs[vs.length - 1];
  if (last) { const e = evalVital(last, rec, vs.slice(0, -1)); if (e.level === 'red') return { k: 'red', t: '紅色警戒', code: 'alarm' }; }
  if (rec.rehabAt) { const left = cdLeft(rec); const after = vs.filter(v => v.time >= rec.rehabAt.slice(0, 16));
    if (left > 0) return { k: 'red', t: 'REHAB 倒數', code: 'countdown' };
    if (!after.length) return { k: 'red', t: 'REHAB 待量測', code: 'due' };
    return { k: 'amber', t: 'REHAB 監測中', code: 'rehab' }; }
  if (rec.cylinders.some(c => cylState(c) === 'working')) return { k: 'blue', t: '作業中', code: 'working' };
  return { k: 'green', t: '待命', code: 'standby' };
}
function fmtCd(s) { if (s == null) return ''; const neg = s < 0; s = Math.abs(s); return (neg ? '+' : '') + `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; }
function applyRehab(rec) { const hits = rehabCheck(rec);
  if (hits.length && !rec.rehabAt) { const c = rec.cylinders[hits[0].i]; let d = rec.date; if (c.exit && toMin(c.exit) > toMin(hhmm()) + 60 && rec.date === todayStr()) { const y = new Date(); y.setDate(y.getDate() - 1); d = todayStr(y); }
    rec.rehabAt = `${d}T${c.exit}`; rec.alertAck = null; askNotify(); return true; }
  if (!hits.length && rec.rehabAt && rec.rehabAuto !== false && !vitalsOf(rec.id).length) { rec.rehabAt = null; }
  return false; }

/* ---------- 通知：倒數結束 ---------- */
let audioCtx = null;
document.addEventListener('pointerdown', () => { try { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) {} }, { passive: true });
function beep() { try { if (!audioCtx) return; const t0 = audioCtx.currentTime; for (let i = 0; i < 3; i++) { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination); g.gain.setValueAtTime(0.0001, t0 + i * 0.45); g.gain.exponentialRampToValueAtTime(0.4, t0 + i * 0.45 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.45 + 0.35); o.start(t0 + i * 0.45); o.stop(t0 + i * 0.45 + 0.4); } } catch (e) {} }
function askNotify() { try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {} }
async function sysNotify(title, body, tag) { try { if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) reg.showNotification(title, { body, tag, renotify: true, requireInteraction: true, vibrate: [300, 150, 300] }); else new Notification(title, { body, tag }); } catch (e) {} }
const alerted = {};
function checkAlerts() {
  const snooze = load(LS.snooze, {}); const due = Object.values(S.records).filter(r => !r.closed && r.rehabAt && !r.alertAck && cdLeft(r) <= 0 && !vitalsOf(r.id).some(v => v.time >= r.rehabAt.slice(0, 16)) && !(snooze[r.id] > Date.now()));
  const layer = $('#alertLayer'); if (!due.length) { if (layer.dataset.rec) { layer.innerHTML = ''; layer.dataset.rec = ''; } return; }
  const r = due[0]; if (layer.dataset.rec === r.id) return;
  layer.dataset.rec = r.id;
  layer.innerHTML = `<div class="modal-bg" id="cdModal"><div class="modal"><h2>⏰ REHAB 10 分鐘到</h2><p style="font-size:18px"><b>${esc(r.name)}</b>（${esc(r.unit)}｜臂章 ${esc(r.memberId)}）</p><p>休息倒數結束，請量測生命徵象。</p>${due.length > 1 ? `<p class="muted small">另有 ${due.length - 1} 人也到時間</p>` : ''}
    <button class="btn btn-red btn-block" id="cdGo" style="font-size:18px">🩺 開始填寫生命徵象</button><button class="btn btn-block" id="cdLater">2 分鐘後再提醒</button></div></div>`;
  if (!alerted[r.id]) { alerted[r.id] = 1; beep(); if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]); sysNotify('REHAB 10 分鐘到：' + r.name, '請量測生命徵象（' + (r.unit || '') + '）', 'rehab-' + r.id); }
  // 正在編輯其他人時不硬切頁面，只跳通知；在看板頁時直接帶入生命徵象表單
  const hh = location.hash; if (!/^#\/(r\/|v\/|m\/|status|settings|qr)/.test(hh) || hh.startsWith('#/v/' + r.id)) { if (!hh.startsWith('#/v/' + r.id)) location.hash = '#/v/' + encodeURIComponent(r.id); }
  $('#cdGo').onclick = () => { r.alertAck = { by: DEVICE, at: new Date().toISOString() }; putRecord(r); layer.innerHTML = ''; layer.dataset.rec = ''; location.hash = '#/v/' + encodeURIComponent(r.id); setTimeout(() => { const f = $('#vSbp'); if (f) f.focus(); }, 300); };
  $('#cdLater').onclick = () => { const s = load(LS.snooze, {}); s[r.id] = Date.now() + 120000; save(LS.snooze, s); delete alerted[r.id]; layer.innerHTML = ''; layer.dataset.rec = ''; };
}
setInterval(() => { $$('[data-cd]').forEach(el => { const r = getRecord(el.dataset.cd); if (r) { const s = cdLeft(r); el.textContent = s > 0 ? fmtCd(s) : '時間到'; } }); }, 1000);
setInterval(checkAlerts, 3000);

/* ---------- 共用 ---------- */
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
function memberLine(m) { return m ? `${esc(m.unit || '—')}｜${esc(m.title || '—')}｜${esc(m.name || '—')}` : ''; }
let lastHash = '';
function route(soft) {
  const h = location.hash.replace(/^#\/?/, ''); if (!soft || h !== lastHash) { stopScan(); window.scrollTo(0, 0); } lastHash = h;
  const [p, a] = h.split('/').map(decodeURIComponent);
  if (p === 'm') return viewMember(a);
  if (p === 'r') return viewRecord(a);
  if (p === 'v') return viewVitals(a);
  if (p === 'status') return viewStatus();
  if (p === 'qr') return viewQR();
  if (p === 'settings') return viewSettings();
  return viewHome();
}

/* ---------- 人員管控（含掃描） ---------- */
async function geoFill(inputSel, after) {
  if (!navigator.geolocation) return toast('此裝置不支援定位');
  toast('定位中…');
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude: la, longitude: lo } = pos.coords; let addr = `${la.toFixed(5)}, ${lo.toFixed(5)}`;
    try { const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${la}&lon=${lo}&accept-language=zh-TW&zoom=18`); const j = await r.json(); const a = j.address || {};
      const s = [a.city || a.county, a.town || a.suburb || a.city_district, a.road, a.house_number ? a.house_number + '號' : ''].filter(Boolean).join(''); if (s) addr = s; else if (j.display_name) addr = j.display_name; } catch (e) {}
    const el = $(inputSel); if (el) { el.value = addr; el.dispatchEvent(new Event('change')); } if (after) after(addr); toast('已帶入定位地址');
  }, e => toast('定位失敗：' + e.message), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
}
function viewHome() {
  setTab('home'); const inc = incident();
  const recs = Object.values(S.records).filter(r => r.date === inc.date && !r.closed);
  const order = { alarm: 0, due: 1, countdown: 2, rehab: 3, working: 4, standby: 5, closed: 6 };
  recs.sort((a, b) => order[recStatus(a).code] - order[recStatus(b).code]);
  const keep = $('#armId') ? $('#armId').value : '';
  app.innerHTML = `
  <div class="card"><h2>🧑‍🚒 人員管控</h2>
    <div class="grid2"><div><label>案件日期</label><input type="date" id="incDate" value="${esc(inc.date)}"></div>
    <div><label>案件地點（可空白）</label><div class="row" style="gap:4px"><input id="incAddr" placeholder="可空白" value="${esc(inc.address)}"><button class="now" id="geo" title="定位">📍</button></div></div></div>
  </div>
  <div class="card"><h3>掃描臂章 QR Code 或輸入臂章號碼</h3>
    <div id="reader" class="hidden"></div>
    <button class="btn btn-red btn-block" id="scanBtn" style="font-size:18px">📷 開啟相機掃描</button>
    <div class="row" style="margin-top:10px"><div><input id="armId" placeholder="臂章號碼" autocapitalize="characters" autocomplete="off" value="${esc(keep)}"></div><button class="btn-blue now" id="goManual">登錄</button></div>
    <div id="autoFill" class="auto">輸入臂章號碼後自動帶入分隊別／職稱／姓名</div>
  </div>
  <div class="card"><h3>本案人員（${recs.length}）</h3>
    ${recs.length ? `<ul class="list">${recs.map(r => { const s = recStatus(r); const c = r.cylinders[r.cylinders.length - 1];
      return `<li><a href="#/r/${esc(r.id)}"><b>${esc(r.name)}</b> <span class="muted small">${esc(r.memberId)}｜${esc(r.unit)}｜第 ${r.cylinders.length} 支${c.face ? `｜${esc(c.face)}面第${esc(c.group)}組` : ''}</span></a>
      <span class="pill ${s.k}">${s.t}${s.code === 'countdown' ? ` <span class="cd" data-cd="${esc(r.id)}">${fmtCd(cdLeft(r))}</span>` : ''}</span></li>`; }).join('')}</ul>` : '<p class="muted">尚無人員。</p>'}
  </div>${DISC}`;
  const saveInc = () => { save(LS.incident, { date: $('#incDate').value || todayStr(), address: $('#incAddr').value.trim() }); if (S.cloud) subscribe(); };
  $('#incDate').onchange = saveInc; $('#incAddr').onchange = saveInc; $('#geo').onclick = () => geoFill('#incAddr');
  const af = () => { const v = $('#armId').value.trim(); const m = findMember(v); const el = $('#autoFill');
    if (!v) { el.className = 'auto'; el.textContent = '輸入臂章號碼後自動帶入分隊別／職稱／姓名'; }
    else if (m) { el.className = 'auto ok'; el.innerHTML = '✅ ' + memberLine(m); } else { el.className = 'auto miss'; el.textContent = '名冊查無此臂章（可臨時建檔）'; } };
  $('#armId').oninput = af; af();
  const go = () => { const v = $('#armId').value.trim(); if (v) location.hash = '#/m/' + encodeURIComponent(v); };
  $('#goManual').onclick = go; $('#armId').onkeydown = e => { if (e.key === 'Enter') go(); };
  $('#scanBtn').onclick = () => scanner ? stopScan(true) : startScan();
}
let scanner = null;
function stopScan(rerenderBtn) { if (scanner) { const s = scanner; scanner = null; s.stop().catch(() => {}).then(() => { try { s.clear(); } catch (e) {} }); }
  const r = $('#reader'); if (r) r.classList.add('hidden'); const b = $('#scanBtn'); if (b) b.textContent = '📷 開啟相機掃描'; }
function loadScript(src) { return new Promise((ok, no) => { if ($(`script[src="${src}"]`)) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); }
function idFromText(t) { t = String(t || '').trim(); try { const u = new URL(t); const id = u.searchParams.get('id'); if (id) return id; const m = u.hash.match(/#\/m\/([^/?]+)/); if (m) return decodeURIComponent(m[1]); } catch (e) {} return t; }
async function startScan() {
  $('#reader').classList.remove('hidden'); $('#scanBtn').textContent = '✖ 關閉相機';
  try { await loadScript('vendor/html5-qrcode.min.js'); scanner = new Html5Qrcode('reader');
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: 230 }, txt => { const id = idFromText(txt); if (navigator.vibrate) navigator.vibrate(80); stopScan(); location.hash = '#/m/' + encodeURIComponent(id); }, () => {});
  } catch (e) { scanner = null; $('#reader').innerHTML = `<p style="color:#fff;padding:14px">無法啟動相機：${esc(e.message || e)}（請允許相機權限，或改用臂章號碼輸入）</p>`; }
}

function viewMember(id) {
  setTab('home'); const m = findMember(id);
  if (!m) {
    app.innerHTML = `<div class="card"><h2>名冊查無：${esc(id)}</h2><p class="muted">請確認臂章號碼，或先臨時建檔（之後到 Google 試算表名冊補上）。</p>
    <label>臂章號碼</label><input id="tId" value="${esc(id || '')}"><label>分隊別</label><input id="tU"><label>職稱</label><input id="tT"><label>姓名</label><input id="tN">
    <button class="btn btn-red btn-block" id="tSave">臨時建檔並登錄</button><a class="btn btn-block" href="#/">← 返回</a></div>`;
    $('#tSave').onclick = () => { const nm = { id: $('#tId').value.trim(), unit: $('#tU').value.trim(), title: $('#tT').value.trim(), name: $('#tN').value.trim() || '(未填)' };
      if (!nm.id) return toast('請填臂章號碼'); let rec = openRecordFor(nm.id); if (!rec) { rec = newRecord(nm); rec.tempMember = true; putRecord(rec); } location.replace('#/r/' + encodeURIComponent(rec.id)); };
    return;
  }
  let rec = openRecordFor(m.id);
  if (!rec) { rec = newRecord(m); putRecord(rec); toast(`已登錄 ${m.name}（${m.unit}）`); }
  location.replace('#/r/' + encodeURIComponent(rec.id));
}

function viewRecord(rid) {
  setTab('home'); const rec = getRecord(rid); if (!rec) { app.innerHTML = '<div class="card">找不到紀錄（可能尚在同步）<a class="btn btn-block" href="#/">← 返回</a></div>'; return; }
  const T = th(); const hits = rehabCheck(rec); const st = recStatus(rec); const vs = vitalsOf(rec.id);
  const lastV = vs[vs.length - 1]; const lastE = lastV ? evalVital(lastV, rec, vs.slice(0, -1)) : null; const left = cdLeft(rec);
  const opt = (arr, val) => arr.map(([v, l]) => `<option value="${v}" ${val === v ? 'selected' : ''}>${l}</option>`).join('');
  app.innerHTML = `
  <div class="card"><div class="row" style="align-items:center"><div><h2 style="margin:0">${esc(rec.name)}</h2><div class="muted small">臂章 ${esc(rec.memberId)}｜${esc(rec.unit)}｜${esc(rec.title)}${rec.tempMember ? '｜臨時建檔' : ''}</div></div><span class="pill ${st.k}" style="flex:0 0 auto">${st.t}</span></div></div>
  ${rec.rehabAt ? `<div class="banner red">🟥 已達 REHAB 條件：撤出至休息區
    <div style="font-weight:400;margin-top:4px">${hits.map(h => `第 ${h.i + 1} 支工作 ${h.d} 分鐘（≥ ${h.lim}）`).join('；') || '手動啟動'}｜REHAB 開始 ${esc(rec.rehabAt.slice(11, 16))}</div>
    <div style="font-size:30px;margin:6px 0">⏱ <span class="cd" data-cd="${esc(rec.id)}">${left > 0 ? fmtCd(left) : '時間到'}</span></div>
    <div style="font-weight:400" class="small">倒數 ${T.restMin} 分鐘後自動通知並開啟生命徵象表單</div>
    <a href="#/v/${esc(rec.id)}" class="btn btn-block" style="background:#fff;color:#b91c1c;font-size:18px">🩺 生命徵象監測表單（${vs.length} 筆）</a></div>` : ''}
  ${lastE && lastE.level === 'red' ? `<div class="banner red">🚨 紅色警戒：建議進入低溫處置流程<div style="font-weight:400">${esc(lastE.bad.join('；'))}</div></div>` : ''}
  <div class="card"><h3>案件</h3><div class="grid2"><div><label>案件日期</label><input type="date" id="rDate" value="${esc(rec.date)}"></div>
    <div><label>案件地點</label><div class="row" style="gap:4px"><input id="rAddr" value="${esc(rec.address)}" placeholder="可空白"><button class="now" id="rGeo">📍</button></div></div></div></div>
  <div class="card"><h3>氣瓶使用情形</h3>
    <p class="muted small">填「氣瓶離場時間」＋「工作時間」（預設 ${T.workDefault} 分），系統自動算進入時間。REHAB：第 1 支 ≥ ${T.cyl1Min} 分或第 2 支起 ≥ ${T.cyl2Min} 分。</p>
    ${rec.cylinders.map((c, i) => { const hit = hits.some(h => h.i === i); const en = entryTime(c); const stc = cylState(c);
    return `<div class="cyl ${hit ? 'hit' : ''}" data-i="${i}"><div class="hd"><span>第 ${i + 1} 支氣瓶 ${stc === 'working' ? '<span class="pill blue">作業中</span>' : stc === 'done' ? '<span class="pill gray">已離場</span>' : ''}</span><span class="dur ${hit ? 'hit' : ''}">${num(c.work) != null ? esc(c.work) + ' 分' : '—'}</span></div>
      <div class="grid2"><div><label>火場面別</label><select data-f="face"><option value="">—</option>${opt(FACES, c.face)}</select></div><div><label>組別</label><select data-f="group"><option value="">—</option>${opt(GROUPS.map(g => [g, `第 ${g} 組`]), c.group)}</select></div></div>
      ${stc === 'idle' ? `<button class="btn btn-blue btn-block" data-in>▶ 進入作業（記錄面別／組別）</button>` : ''}
      <div class="row"><div><label>氣瓶離場時間</label><input type="time" data-f="exit" value="${esc(c.exit)}"></div><button class="now" data-now="exit">現在</button></div>
      <div class="row"><div><label>工作時間（分鐘）</label><input inputmode="numeric" data-f="work" value="${esc(c.work)}"></div><div><label>用氣量 bar（選填）</label><input inputmode="numeric" data-f="gas" value="${esc(c.gas)}"></div></div>
      <div class="auto ${en ? 'ok' : ''}">進入時間（自動）：<b>${en || '填離場時間後自動計算'}</b>${en ? `（${esc(c.exit)} − ${esc(c.work)} 分）` : ''}${c.inAt ? `｜按進入 ${esc(c.inAt.slice(11, 16))}` : ''}</div>
      ${rec.cylinders.length > 1 && i === rec.cylinders.length - 1 ? '<button class="btn-sm" data-del style="margin-top:8px">刪除這支</button>' : ''}</div>`; }).join('')}
    <button class="btn btn-blue btn-block" id="addCyl">＋ 換下一支氣瓶（第 ${rec.cylinders.length + 1} 支）</button>
    ${!rec.rehabAt ? `<button class="btn btn-block" id="manRehab">手動進入 REHAB（身體不適等）</button>` : ''}
  </div>
  <div class="card"><button class="btn btn-block" id="closeRec">${rec.closed ? '重新開啟紀錄' : '結束此人紀錄（歸隊／離場）'}</button><a class="btn btn-block" href="#/">← 回人員管控</a></div>${DISC}`;
  const upd = () => { applyRehab(rec); putRecord(rec); route(true); };
  $('#rDate').onchange = e => { rec.date = e.target.value; upd(); };
  $('#rAddr').onchange = e => { rec.address = e.target.value.trim(); upd(); };
  $('#rGeo').onclick = () => geoFill('#rAddr');
  $$('.cyl').forEach(el => { const i = +el.dataset.i; const c = rec.cylinders[i];
    $$('[data-f]', el).forEach(inp => inp.onchange = () => { c[inp.dataset.f] = inp.value.trim(); upd(); });
    $$('[data-now]', el).forEach(b => b.onclick = () => { c.exit = hhmm(); if (num(c.work) == null) c.work = T.workDefault; upd(); });
    const bi = $('[data-in]', el); if (bi) bi.onclick = () => { if (!c.face || !c.group) return toast('請先選火場面別與組別'); c.inAt = localIso(); upd(); };
    const del = $('[data-del]', el); if (del) del.onclick = () => { if (confirm('刪除第 ' + (i + 1) + ' 支？')) { rec.cylinders.splice(i, 1); upd(); } };
  });
  $('#addCyl').onclick = () => { const last = rec.cylinders[rec.cylinders.length - 1]; if (last.inAt && !last.exit) { last.exit = hhmm(); }
    rec.cylinders.push({ face: last.face || '', group: last.group || '', inAt: '', exit: '', work: T.workDefault, gas: '' }); upd(); };
  const mr = $('#manRehab'); if (mr) mr.onclick = () => { rec.rehabAt = localIso(); rec.rehabAuto = false; rec.alertAck = null; askNotify(); upd(); };
  $('#closeRec').onclick = () => { if (!rec.closed && rec.rehabAt) { if (!lastE) { if (!confirm('尚未量測生命徵象，確定結束？')) return; } else if (lastE.level === 'red') { if (!confirm('最後一次生命徵象為紅色警戒，確定結束？')) return; } }
    rec.closed = !rec.closed; putRecord(rec); route(true); };
}

function viewVitals(rid) {
  setTab('home'); const rec = getRecord(rid); if (!rec) { app.innerHTML = '<div class="card">找不到紀錄（可能尚在同步）</div>'; return; }
  const T = th(); const vs = vitalsOf(rec.id); const evs = vs.map((v, i) => evalVital(v, rec, vs.slice(0, i))); const last = evs[evs.length - 1];
  const keepVals = {}; $$('#vForm input, #vForm textarea').forEach(i => keepVals[i.id] = i.value);
  app.innerHTML = `
  <div class="card"><h2 style="margin:0">🩺 生命徵象監測</h2><div class="muted small"><b>${esc(rec.name)}</b>｜${esc(rec.unit)}｜${esc(rec.title)}｜臂章 ${esc(rec.memberId)}｜${esc(rec.address || '地點未填')}｜REHAB 開始 ${rec.rehabAt ? esc(rec.rehabAt.slice(11, 16)) : '—'}${rec.rehabAt ? `｜倒數 <span class="cd" data-cd="${esc(rec.id)}"></span>` : ''}</div></div>
  ${last && last.level === 'red' ? `<div class="banner red" id="redAlert">🚨 紅色警戒：建議進入低溫處置流程
    <div style="font-weight:400;margin-top:4px">超過 REHAB 數值：${esc(last.bad.join('；'))}</div>
    ${last.emergency ? '<div style="margin-top:6px">⛑️ 收縮壓過低：立即緊急救護／後送</div>' : ''}${last.o2 ? `<div style="margin-top:6px">🫁 SpCO > ${T.spcoO2}%：給予高濃度氧氣</div>` : ''}${COOLING}</div>`
    : last && last.level === 'amber' ? `<div class="banner amber">⚠️ 注意：${esc(last.warn.join('；'))}</div>` : last ? `<div class="banner green">✅ 最近一次量測在 REHAB 數值內（仍須由救護人員評估後歸隊）</div>` : ''}
  <div class="card" id="vForm"><h3>新增量測</h3>
    <label>量測時間</label><input type="datetime-local" id="vTime" value="${localIso()}">
    <div class="grid2"><div><label>收縮壓 SBP</label><input id="vSbp" inputmode="numeric" placeholder="mmHg"></div><div><label>舒張壓 DBP</label><input id="vDbp" inputmode="numeric" placeholder="mmHg"></div></div>
    <div class="grid2"><div><label>脈搏</label><input id="vHr" inputmode="numeric" placeholder="次/分"></div><div><label>血氧 SpO2</label><input id="vSpo2" inputmode="numeric" placeholder="%"></div></div>
    <div class="grid2"><div><label>體溫</label><input id="vTemp" inputmode="decimal" placeholder="°C"></div><div><label>SpCO（選填）</label><input id="vSpco" inputmode="decimal" placeholder="%"></div></div>
    <label>其他備註</label><textarea id="vNote" placeholder="症狀、意識、處置（例：前臂浸泡冷水）"></textarea>
    <button class="btn btn-red btn-block" id="vSave">儲存這次量測</button>
    <p class="muted small">標準：BP &gt;${T.sbpHigh}/${T.dbpHigh} 或 SBP &lt;${T.sbpLow}｜脈搏 &gt;${T.hrHigh}（休息 ${T.hrRestMin} 分後）｜SpO2 &lt;${T.spo2Low}%｜體溫 ≥${T.tempHigh}°C 或持續上升 ${T.tempRiseMin} 分｜SpCO &gt;${T.spcoHigh}%</p></div>
  <div class="card"><h3>量測紀錄（${vs.length}）</h3>
    ${vs.length ? `<div style="overflow-x:auto"><table class="vt"><tr><th>時間</th><th>血壓</th><th>脈搏</th><th>SpO2</th><th>體溫</th><th>SpCO</th><th></th></tr>
    ${vs.map((v, i) => { const e = evs[i]; const c = k => e.cells[k] || ''; const bpc = (c('sbp') === 'bad' || c('dbp') === 'bad') ? 'bad' : '';
      return `<tr><td>${esc(v.time.slice(11, 16))}</td><td class="${bpc}">${esc(v.sbp || '-')}/${esc(v.dbp || '-')}</td><td class="${c('hr')}">${esc(v.hr || '-')}</td><td class="${c('spo2')}">${esc(v.spo2 || '-')}</td><td class="${c('temp')}">${esc(v.temp || '-')}</td><td class="${c('spco')}">${esc(v.spco || '-')}</td><td><button class="btn-sm" data-dv="${esc(v.id)}">刪</button></td></tr>${v.note ? `<tr><td colspan="7" class="muted small" style="text-align:left">備註：${esc(v.note)}</td></tr>` : ''}`; }).join('')}</table></div>` : '<p class="muted">尚無量測。</p>'}
  </div><a class="btn btn-block" href="#/r/${esc(rec.id)}">← 回氣瓶紀錄</a>${DISC}`;
  for (const k in keepVals) { const el = $('#' + k); if (el && keepVals[k]) el.value = keepVals[k]; }
  $$('[data-cd]').forEach(el => { const s = cdLeft(rec); el.textContent = s > 0 ? fmtCd(s) : '時間到'; });
  const live = () => { const v = { time: $('#vTime').value, sbp: $('#vSbp').value, dbp: $('#vDbp').value, hr: $('#vHr').value, spo2: $('#vSpo2').value, temp: $('#vTemp').value, spco: $('#vSpco').value };
    const e = evalVital(v, rec, vs); const map = { sbp: '#vSbp', dbp: '#vDbp', hr: '#vHr', spo2: '#vSpo2', temp: '#vTemp', spco: '#vSpco' }; for (const k in map) $(map[k]).classList.toggle('bad', e.cells[k] === 'bad'); };
  $$('#vSbp,#vDbp,#vHr,#vSpo2,#vTemp,#vSpco').forEach(i => i.oninput = live); live();
  $('#vSave').onclick = () => { const v = { id: rec.id + '-V' + uid(), recId: rec.id, date: rec.date, memberId: rec.memberId, name: rec.name, address: rec.address, time: $('#vTime').value || localIso(), sbp: $('#vSbp').value.trim(), dbp: $('#vDbp').value.trim(), hr: $('#vHr').value.trim(), spo2: $('#vSpo2').value.trim(), temp: $('#vTemp').value.trim(), spco: $('#vSpco').value.trim(), note: $('#vNote').value.trim() };
    if (!v.sbp && !v.dbp && !v.hr && !v.spo2 && !v.temp && !v.spco && !v.note) return toast('請至少填一項');
    const e = evalVital(v, rec, vs); v.level = e.level; v.flags = e.bad.concat(e.warn).join('；');
    if (!rec.rehabAt) { rec.rehabAt = v.time; rec.rehabAuto = false; }
    if (!rec.alertAck) rec.alertAck = { by: DEVICE, at: new Date().toISOString() };
    putRecord(rec); $$('#vForm input:not(#vTime), #vForm textarea').forEach(i => i.value = ''); putVital(v); toast('已儲存'); route(true); };
  $$('[data-dv]').forEach(b => b.onclick = () => { if (confirm('刪除這筆量測？')) { delVital(b.dataset.dv); route(true); } });
}

/* ---------- 管制狀態 ---------- */
function faceBoard(recs) {
  // 每面：目前作業中的組、各組輪替過的人、輪替歷程
  return FACES.map(([f, fl]) => {
    const deps = []; recs.forEach(r => r.cylinders.forEach((c, i) => { if (c.face !== f) return;
      const st = c.exit ? (entryTime(c) || '') : (c.inAt ? c.inAt.slice(11, 16) : ''); deps.push({ name: r.name, group: c.group || '?', start: st, end: c.exit || '', working: cylState(c) === 'working', no: i + 1, recId: r.id }); }));
    if (!deps.length) return { f, fl, empty: true };
    deps.sort((a, b) => (a.start || '99').localeCompare(b.start || '99'));
    const working = {}; deps.filter(d => d.working).forEach(d => (working[d.group] = working[d.group] || []).push(d.name));
    const byGroup = {}; GROUPS.concat('?').forEach(g => { const n = Array.from(new Set(deps.filter(d => d.group === g).map(d => d.name))); if (n.length) byGroup[g] = n; });
    const segs = []; deps.forEach(d => { const s = segs[segs.length - 1]; if (s && s.group === d.group) { s.names.add(d.name); if (d.end > s.end) s.end = d.end; if (d.working) s.working = true; } else segs.push({ group: d.group, start: d.start, end: d.end, names: new Set([d.name]), working: d.working }); });
    return { f, fl, working, byGroup, segs, rounds: segs.length };
  });
}
function viewStatus() {
  setTab('status'); const date = S.viewDate;
  const recs = Object.values(S.records).filter(r => r.date === date);
  const cnt = { all: recs.length, working: 0, countdown: 0, due: 0, alarm: 0, rehab: 0, closed: 0, standby: 0 };
  recs.forEach(r => cnt[recStatus(r).code]++);
  const inRehab = cnt.countdown + cnt.due + cnt.rehab + cnt.alarm;
  const cyl = recs.reduce((a, r) => a + r.cylinders.filter(c => c.exit || c.inAt).length, 0); const vit = Object.values(S.vitals).filter(v => v.date === date).length;
  const groups = {}; recs.forEach(r => { const k = r.address || '（地點未填）'; (groups[k] = groups[k] || []).push(r); });
  const order = { alarm: 0, due: 1, countdown: 2, rehab: 3, working: 4, standby: 5, closed: 6 };
  const fb_ = faceBoard(recs.filter(r => !r.closed).concat(recs.filter(r => r.closed)));
  app.innerHTML = `
  <div class="card"><div class="row" style="align-items:flex-end"><div><h2 style="margin:0">管制狀態</h2><div class="muted small">${S.cloud ? '全隊即時同步' : '本機模式（只有這支手機）'}</div></div><div style="flex:0 0 160px"><label>案件日期</label><input type="date" id="vDate" value="${esc(date)}"></div></div></div>
  <div class="stats">
    <div class="stat"><b id="cAll">${cnt.all}</b><span>已登錄人數</span></div>
    <div class="stat"><b>${cnt.working}</b><span>作業中</span></div>
    <div class="stat red"><b id="cRehab">${inRehab}</b><span>在 REHAB</span></div>
    <div class="stat red"><b id="cCd">${cnt.countdown}</b><span>倒數中</span></div>
    <div class="stat red"><b id="cDue">${cnt.due}</b><span>待量測</span></div>
    <div class="stat red"><b id="cAlarm">${cnt.alarm}</b><span>紅色警戒</span></div>
    <div class="stat green"><b>${cnt.standby}</b><span>待命</span></div>
    <div class="stat"><b>${cnt.closed}</b><span>已歸隊</span></div>
    <div class="stat"><b id="cRows">${cyl}/${vit}</b><span>氣瓶／生命徵象筆數</span></div>
  </div>
  <div class="card"><h3>🔥 火場面別輪替</h3>
    ${fb_.map(b => b.empty ? `<div class="grp">${b.fl}</div><p class="muted small">尚無人員</p>` : `<div class="grp">${b.fl}｜輪替 ${b.rounds} 梯次</div>
      <div class="small">目前作業：${Object.keys(b.working).length ? Object.entries(b.working).map(([g, n]) => `<span class="pill blue">第${esc(g)}組</span> ${esc(n.join('、'))}`).join('　') : '<span class="muted">無</span>'}</div>
      <div class="small" style="margin-top:4px">${GROUPS.map(g => `<div>第 ${g} 組 ${b.byGroup[g] ? `✅ ${esc(b.byGroup[g].join('、'))}` : '<span class="muted">尚未進入</span>'}</div>`).join('')}${b.byGroup['?'] ? `<div>未填組別：${esc(b.byGroup['?'].join('、'))}</div>` : ''}</div>
      <div class="small muted" style="margin-top:4px">歷程：${b.segs.map(s => `${esc(s.start || '?')}–${s.working ? '作業中' : esc(s.end || '?')} 第${esc(s.group)}組（${esc(Array.from(s.names).join('、'))}）`).join(' → ')}</div>`).join('')}
  </div>
  ${Object.keys(groups).length ? Object.entries(groups).map(([addr, list]) => { list.sort((a, b) => order[recStatus(a).code] - order[recStatus(b).code]);
    return `<div class="card"><h3>📍 ${esc(addr)}（${list.length} 人）</h3><ul class="list">${list.map(r => { const s = recStatus(r); const vs = vitalsOf(r.id); const c = r.cylinders[r.cylinders.length - 1];
      return `<li><a href="#/r/${esc(r.id)}"><b>${esc(r.name)}</b> <span class="muted small">${esc(r.unit)}｜${esc(r.title)}｜氣瓶 ${r.cylinders.filter(x => x.exit || x.inAt).length} 支｜徵象 ${vs.length} 筆${c.face ? `｜${esc(c.face)}面${esc(c.group)}組` : ''}</span></a><span class="pill ${s.k}">${s.t}${s.code === 'countdown' ? ` <span class="cd" data-cd="${esc(r.id)}">${fmtCd(cdLeft(r))}</span>` : ''}</span></li>`; }).join('')}</ul></div>`; }).join('') : '<div class="card muted">此日期尚無紀錄</div>'}
  <div class="card"><button class="btn btn-block" id="exp">匯出 CSV（此日期）</button>${CFG.SHEET_URL ? `<a class="btn btn-block" href="${esc(CFG.SHEET_URL)}" target="_blank" rel="noopener">開啟 Google 試算表</a>` : ''}</div>${DISC}`;
  $('#vDate').onchange = e => { S.viewDate = e.target.value || todayStr(); if (S.cloud) subscribe(); route(true); };
  $('#exp').onclick = () => exportCSV(recs, date);
}
function exportCSV(recs, date) {
  const csv = (head, rows) => [head, ...rows].map(r => r.map(x => `"${String(x == null ? '' : x).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const c = csv(['紀錄ID', '日期', '案件地點', '臂章號碼', '分隊別', '職稱', '姓名', '第幾支', '火場面別', '組別', '進入時間(自動)', '離場時間', '工作分鐘', '用氣量bar', 'REHAB開始', '狀態'],
    recs.flatMap(r => r.cylinders.map((x, i) => [r.id + '-C' + (i + 1), r.date, r.address, r.memberId, r.unit, r.title, r.name, i + 1, x.face, x.group, entryTime(x), x.exit, x.work, x.gas, r.rehabAt || '', recStatus(r).t])));
  const v = csv(['紀錄ID', '日期', '案件地點', '臂章號碼', '姓名', '量測時間', '收縮壓', '舒張壓', '脈搏', '血氧SpO2', '體溫', 'SpCO', '其他備註', '判定', '異常項目'],
    recs.flatMap(r => vitalsOf(r.id).map(x => [x.id, x.date, x.address, x.memberId, x.name, x.time, x.sbp, x.dbp, x.hr, x.spo2, x.temp, x.spco, x.note, x.level === 'red' ? '紅色警戒' : x.level === 'amber' ? '注意' : '正常', x.flags])));
  const dl = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/csv' })); a.download = name; a.click(); };
  dl(`氣瓶紀錄_${date}.csv`, c); setTimeout(() => dl(`生命徵象_${date}.csv`, v), 400);
}

/* ---------- 設定（含名冊） ---------- */
function qrImg(text, cell = 6) { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createDataURL(cell, 2); }
function memberUrl(id) { return baseUrl() + '?id=' + encodeURIComponent(id); }
function viewQR() {
  setTab('settings'); const r = roster();
  app.innerHTML = `<div class="card no-print"><h2>臂章 QR Code</h2><p class="muted small">掃描開啟：${esc(baseUrl())}?id=臂章號碼（網址固定，系統更新不用重印）</p><button class="btn btn-red btn-block" onclick="window.print()">🖨️ 列印 / 存成 PDF</button><a class="btn btn-block" href="#/settings">← 回設定</a></div>
  <div class="qrgrid">${r.map(m => `<div class="qrcard"><img alt="QR ${esc(m.id)}" src="${qrImg(memberUrl(m.id))}"><div class="nm">${esc(m.name)}</div><div class="sub">${esc(m.unit)}｜${esc(m.title)}</div><div class="sub">臂章 ${esc(m.id)}</div></div>`).join('') || '<p class="muted">名冊是空的</p>'}</div>`;
}
function viewSettings() {
  setTab('settings'); const s = settings(); const T = th(); const r = roster(); const j = load(LS.joined, null);
  app.innerHTML = `
  <div class="card"><h2>雲端同步（全隊共用）</h2>
    ${S.cloud ? `<div class="banner green">✅ 已加入隊伍「${esc(TEAM)}」｜這支手機的紀錄會即時同步給全隊，離線時先存手機、恢復連線自動上傳。</div>
      <button class="btn btn-block" id="leave">退出隊伍（改回本機模式）</button>`
    : `<p class="muted small">輸入隊碼加入後，所有手機看到同一個管制看板。隊碼由小隊長保管，不要公開張貼。</p>
      <label>隊碼</label><input id="code" type="password" autocomplete="off" placeholder="隊碼（至少 6 字）">
      <button class="btn btn-red btn-block" id="join">加入隊伍</button>
      <details style="margin-top:10px"><summary class="small">第一次使用：設定全隊隊碼（只能設定一次）</summary>
      <p class="muted small">只有第一次可以設定，設定後無法從手機修改或讀取。請先自己記下來。</p>
      <label>新隊碼</label><input id="code1" type="password" autocomplete="off"><label>再輸入一次</label><input id="code2" type="password" autocomplete="off">
      <button class="btn btn-block" id="init">設定隊碼並加入</button></details>`}
    ${S.cloud ? `<button class="btn btn-block" id="share">分享加入連結（含隊碼，只傳給隊員）</button>` : ''}
  </div>
  <div class="card"><h2>人員名冊（${r.length}）</h2><p class="muted small">來源：${esc(load(LS.rosterSrc, '尚未載入'))}。正式名冊請填在 <a href="${esc(CFG.SHEET_URL)}" target="_blank" rel="noopener">Google 試算表「名冊」</a>（臂章號碼、分隊別、職稱、姓名），會自動同步到每支手機並離線保存。</p>
    <div class="grid2"><a class="btn btn-red" href="#/qr">🖨️ 列印 QR Code</a><label class="btn" style="margin:0;color:var(--ink)">CSV 匯入${S.cloud ? '到雲端' : ''}<input type="file" id="csv" accept=".csv,.tsv,.txt,text/csv" class="hidden"></label></div>
    <details style="margin-top:8px"><summary class="small">查看名冊</summary><ul class="list">${r.map(m => `<li><span><b>${esc(m.name)}</b> <span class="muted small">${esc(m.id)}｜${esc(m.unit)}｜${esc(m.title)}</span></span></li>`).join('') || '<li class="muted">名冊是空的</li>'}</ul></details>
    <a class="small" href="sample-roster.csv" download>下載 CSV 範本</a></div>
  <div class="card"><h2>通知</h2><p class="muted small">REHAB 倒數結束時會跳出畫面、響聲、震動${'Notification' in window ? `；系統通知目前：${({ granted: '已允許', denied: '已封鎖', default: '未設定' })[Notification.permission]}` : ''}。</p><button class="btn btn-block" id="notif">開啟系統通知＋測試聲音</button></div>
  <div class="card"><h2>REHAB 判定標準</h2><p class="muted small"><span class="src">EMSer</span> 來自 EMSer 後勤照護簡報（消防月刊整理 NFPA 1584）與你指定的條件；<span class="src nfpa">預設</span> EMSer 沒給數值，採 NFPA 1584／到院前常用值。（只影響這支手機）</p>
    ${Object.keys(DEFAULT_TH).map(k => `<label>${esc(DEFAULT_TH[k].label)} <span class="src ${DEFAULT_TH[k].src === 'NFPA' ? 'nfpa' : ''}">${DEFAULT_TH[k].src === 'NFPA' ? '預設' : 'EMSer'}</span></label><input inputmode="decimal" data-th="${k}" value="${T[k]}"><div class="muted small">${esc(DEFAULT_TH[k].note)}</div>`).join('')}
    <div class="grid2" style="margin-top:8px"><button class="btn-red" id="thSave">儲存標準</button><button id="thReset">恢復預設</button></div></div>
  <div class="card"><h2>其他</h2><label>QR Code 網址（留空 = 本頁網址）</label><input id="sBase" value="${esc(s.baseUrl)}" placeholder="${esc(location.origin + location.pathname)}"><button class="btn btn-block" id="sSave">儲存</button></div>${DISC}`;
  const jb = $('#join'); if (jb) jb.onclick = async () => { jb.disabled = true; try { await joinTeam($('#code').value, false); toast('已加入隊伍'); route(true); } catch (e) { toast(e.code === 'permission-denied' ? '隊碼錯誤（或尚未設定隊碼）' : '加入失敗：' + (e.message || e)); } jb.disabled = false; };
  const ib = $('#init'); if (ib) ib.onclick = async () => { const a = $('#code1').value.trim(); if (a !== $('#code2').value.trim()) return toast('兩次隊碼不一致'); if (a.length < 6) return toast('隊碼至少 6 個字');
    try { await joinTeam(a, true); toast('隊碼已設定並加入'); route(true); } catch (e) { toast(e.code === 'permission-denied' ? '隊碼已經設定過了，請用「加入隊伍」' : '失敗：' + (e.message || e)); } };
  const lv = $('#leave'); if (lv) lv.onclick = () => { if (!confirm('退出後這支手機看不到全隊資料，確定？')) return; localStorage.removeItem(LS.joined); S.subs.forEach(f => f()); S.subs = []; S.cloud = false; localLoad(); badge(); route(true); };
  const sh = $('#share'); if (sh) sh.onclick = async () => { const c = prompt('請輸入隊碼以產生加入連結（連結只傳給隊員）'); if (!c) return; const link = baseUrl() + '#join=' + encodeURIComponent(c.trim());
    try { if (navigator.share) await navigator.share({ title: 'REHAB 氣瓶管制 加入連結', url: link }); else { await navigator.clipboard.writeText(link); toast('已複製加入連結'); } } catch (e) {} };
  $('#csv').onchange = e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = async () => { const list = rowsToRoster(parseCSV(rd.result)); if (!list.length) return toast('CSV 沒有讀到資料');
    try { await uploadRosterToCloud(list); if (!S.cloud) setRoster(list, 'CSV 匯入：' + f.name); toast(`已匯入 ${list.length} 人`); route(true); } catch (err) { toast('匯入失敗：' + err.code); } }; rd.readAsText(f, 'utf-8'); };
  $('#notif').onclick = async () => { try { if ('Notification' in window) await Notification.requestPermission(); } catch (e) {} beep(); if (navigator.vibrate) navigator.vibrate(200); sysNotify('REHAB 測試通知', '通知正常', 'test'); route(true); };
  $('#thSave').onclick = () => { const o = {}; $$('[data-th]').forEach(i => o[i.dataset.th] = i.value); setSettings({ th: o }); toast('標準已儲存'); };
  $('#thReset').onclick = () => { setSettings({ th: {} }); route(true); toast('已恢復預設'); };
  $('#sSave').onclick = () => { setSettings({ baseUrl: $('#sBase').value.trim() }); toast('已儲存'); };
}

/* ---------- 啟動 ---------- */
(async function boot() {
  const p = new URLSearchParams(location.search); const id = p.get('id');
  const jm = location.hash.match(/^#join=(.+)$/); let joinCode = null;
  if (jm) { joinCode = decodeURIComponent(jm[1]); history.replaceState(null, '', location.pathname + '#/settings'); }
  if (id) history.replaceState(null, '', location.pathname + '#/m/' + encodeURIComponent(id));
  localLoad(); window.addEventListener('hashchange', () => route()); route(); badge();
  try { if (joinCode && !load(LS.joined, null)) { await joinTeam(joinCode, false); toast('已加入隊伍'); } else await startCloud(); } catch (e) { console.warn(e); toast('雲端連線失敗，暫用本機模式'); }
  route(true);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
window.__rehab = { TEAM, putRecord, db: () => db, evalVital, rehabCheck, entryTime, th, S, cdLeft, faceBoard };
})();
