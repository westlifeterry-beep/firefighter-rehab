/* REHAB 氣瓶管制系統 v3 — Firebase Firestore（以名冊臂章號碼／義消證號登入、嘗試鎖定、系統開發者權限、離線快取）
   僅供現場管制參考，不取代醫療專業判斷。 */
(function () {
'use strict';
const CFG = window.REHAB_CONFIG || {};
const TEAM = localStorage.getItem('rehab.teamOverride') || CFG.TEAM || 'taichung';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const app = $('#app');
const LS = { roster: 'rehab.roster.' + TEAM, me: 'rehab.me.' + TEAM, dev: 'rehab.dev.' + TEAM, cloudTh: 'rehab.cloudTh.' + TEAM, settings: 'rehab.settings', incident: 'rehab.incident', snooze: 'rehab.snooze', device: 'rehab.device', pending: 'rehab.pendingRoute' };
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const localIso = (d = new Date()) => `${todayStr(d)}T${hhmm(d)}`;
const localIsoS = (d = new Date()) => `${localIso(d)}:${pad(d.getSeconds())}`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const num = v => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
const DEVICE = load(LS.device, null) || (() => { const d = 'D' + uid(); save(LS.device, d); return d; })();
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600); }
const FACES = [['A', '第一面（A）'], ['B', '第二面（B）'], ['C', '第三面（C）'], ['D', '第四面（D）']];
const GROUPS = ['1', '2', '3'];
const normId = s => String(s || '').replace(/\s+/g, '').toUpperCase();
async function sha256hex(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''); }
const idKey = id => sha256hex('rehab-id-v1:' + TEAM + ':' + normId(id));
const devProof = pw => sha256hex('rehab-dev-v1:' + pw);

/* ---------- 判定標準（雲端 config/settings，只有系統開發者可改） ---------- */
const DEFAULT_TH = {
  cyl1Min:   { v: 45,  label: '第 1 支氣瓶工作時間 ≥（分鐘）→ REHAB', src: 'EMSer', note: 'Terry 指定；EMSer 資料：一支 45／60 分鐘氣瓶' },
  cyl2Min:   { v: 30,  label: '第 2 支（含以後）工作時間 ≥（分鐘）→ REHAB', src: 'EMSer', note: 'Terry 指定；EMSer：30 分鐘氣瓶用完 2 支' },
  workDefault:{ v: 30, label: '工作時間預設值（分鐘）', src: 'EMSer', note: 'Terry 指定預設 30 分鐘' },
  restMin:   { v: 10,  label: 'REHAB 倒數（分鐘）→ 時間到通知量測生命徵象', src: 'EMSer', note: 'Terry 指定 10 分鐘；EMSer：至少 10–20 分鐘強制休息' },
  roomWarn:  { v: 10,  label: '入室計時 ≥（分鐘）→ 黃色閃爍', src: 'EMSer', note: 'Terry 指定' },
  roomAlarm: { v: 20,  label: '入室計時 >（分鐘）→ 紅色閃爍', src: 'EMSer', note: 'Terry 指定' },
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
function th() { const c = load(LS.cloudTh, {}) || {}; const o = {}; for (const k in DEFAULT_TH) o[k] = (c[k] != null && c[k] !== '' && !isNaN(Number(c[k]))) ? Number(c[k]) : DEFAULT_TH[k].v; return o; }
function settings() { return Object.assign({ baseUrl: '' }, load(LS.settings, {})); }
function baseUrl() { let b = (settings().baseUrl || '').trim(); if (/github\.io/.test(b)) b = ''; return b || CFG.BASE_URL || (location.origin + location.pathname); }

/* ---------- 資料層 ---------- */
const S = { roster: load(LS.roster, []), records: {}, vitals: {}, me: load(LS.me, null), dev: !!load(LS.dev, false), ready: false, pending: false, viewDate: todayStr(), subs: [], uid: null };
let fb = null, db = null, auth = null;
const clean = o => JSON.parse(JSON.stringify(o));
const tdoc = path => fb.doc(db, `teams/${TEAM}/${path}`);
function byMe() { if (S.me) return { key: S.me.key, id: S.me.id, title: S.me.title || '', name: S.me.name || '' }; if (S.dev) return { key: 'dev', id: 'DEV', title: '系統開發者', name: '' }; return null; }
const byText = b => b ? `${esc(b.title || '')} ${esc(b.name || b.id || '')}`.trim() : '—';
function putRecord(rec) { rec.updatedAt = new Date().toISOString(); rec.device = DEVICE; rec.lastBy = byMe(); S.records[rec.id] = rec;
  fb.setDoc(tdoc(`records/${rec.id}`), clean(rec)).catch(e => toast('上傳失敗：' + e.code)); }
function putVital(v) { v.updatedAt = new Date().toISOString(); S.vitals[v.id] = v; fb.setDoc(tdoc(`vitals/${v.id}`), clean(v)).catch(e => toast('上傳失敗：' + e.code)); }
function delVital(id) { delete S.vitals[id]; fb.deleteDoc(tdoc(`vitals/${id}`)).catch(e => toast('只能刪除自己填的紀錄（' + e.code + '）')); }
function setRoster(list) { S.roster = list; save(LS.roster, list); }
function vitalsOf(recId) { return Object.values(S.vitals).filter(v => v.recId === recId).sort((a, b) => a.time.localeCompare(b.time)); }
function getRecord(id) { return S.records[id]; }

function fbInit() { if (fb) return true; if (!window.FB || !CFG.FIREBASE) return false; fb = window.FB; const a = fb.initializeApp(CFG.FIREBASE);
  try { db = fb.initializeFirestore(a, { localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }) }); } catch (e) { db = fb.initializeFirestore(a, {}); }
  auth = fb.getAuth(a); return true; }
async function ensureAuth() { fbInit(); if (auth.currentUser) return auth.currentUser;
  await new Promise(ok => { const un = fb.onAuthStateChanged(auth, u => { un(); ok(u); }); });
  if (auth.currentUser) return auth.currentUser; return (await fb.signInAnonymously(auth)).user; }
// 每次嘗試先在 guard 記一次（規則限制 5 次／15 分鐘）
async function bumpGuard(k) {
  const u = await ensureAuth(); const ref = tdoc(`guard/${u.uid}`); let g = null;
  try { const s = await fb.getDoc(ref); g = s.exists() ? s.data() : null; } catch (e) {}
  let n = 1; if (g) { const last = g.t && g.t.toMillis ? g.t.toMillis() : 0; if (g.n < 5) n = g.n + 1; else if (Date.now() > last + 15 * 60000 + 5000) n = 1; else { const m = Math.ceil((last + 15 * 60000 - Date.now()) / 60000); const err = new Error(`嘗試太多次，請 ${Math.max(1, m)} 分鐘後再試`); err.locked = true; throw err; } }
  try { await fb.setDoc(ref, { n, t: fb.serverTimestamp(), k }); } catch (e) { const err = new Error('嘗試太多次，請 15 分鐘後再試'); err.locked = true; throw err; }
  return u;
}
async function login(input) {
  const v = normId(input); if (!v) throw new Error('請輸入臂章號碼或義消證號');
  const key = await idKey(v); const u = await bumpGuard(key);
  try { await fb.setDoc(tdoc(`members/${u.uid}`), { key, at: fb.serverTimestamp() }); }
  catch (e) { if (e.code === 'permission-denied') throw new Error('名冊查無此臂章號碼／義消證號'); throw e; }
  S.me = { key, id: v, title: '', name: '' }; save(LS.me, S.me); await startCloud(); resolveMe(); return true;
}
async function devLogin(pw) {
  if (!pw) throw new Error('請輸入開發者密碼'); const proof = await devProof(pw); const u = await bumpGuard(proof);
  try { await fb.setDoc(tdoc(`devs/${u.uid}`), { proof, at: fb.serverTimestamp() }); }
  catch (e) { if (e.code === 'permission-denied') throw new Error('開發者密碼錯誤'); throw e; }
  S.dev = true; save(LS.dev, true); await startCloud(); return true;
}
async function logout() { const u = auth && auth.currentUser; try { if (u) { await fb.deleteDoc(tdoc(`members/${u.uid}`)).catch(() => {}); await fb.deleteDoc(tdoc(`devs/${u.uid}`)).catch(() => {}); } } catch (e) {}
  S.subs.forEach(f => f()); S.subs = []; S.me = null; S.dev = false; localStorage.removeItem(LS.me); localStorage.removeItem(LS.dev); S.records = {}; S.vitals = {}; route(true); }
function resolveMe() { if (!S.me) return; const m = S.roster.find(r => normId(r.id) === S.me.id || (r.vid && normId(r.vid) === S.me.id));
  if (m) { S.me = Object.assign(S.me, { rid: m.id, title: m.title, name: m.name, unit: m.unit }); save(LS.me, S.me); } }
async function checkSession() {
  const u = await ensureAuth(); S.uid = u.uid;
  if (S.me) { try { const s = await fb.getDoc(tdoc(`members/${u.uid}`)); if (!s.exists() || s.data().key !== S.me.key) { S.me = null; localStorage.removeItem(LS.me); } } catch (e) { /* 離線：沿用本機登入 */ } }
  if (S.dev) { try { const s = await fb.getDoc(tdoc(`devs/${u.uid}`)); if (!s.exists()) { S.dev = false; localStorage.removeItem(LS.dev); } } catch (e) {} }
}
function loggedIn() { return !!(S.me || S.dev); }
async function startCloud() {
  if (!loggedIn()) { badge(); return; }
  subscribe(); badge();
}
function subscribe() {
  S.subs.forEach(f => f()); S.subs = []; if (!loggedIn()) return;
  const dates = Array.from(new Set([todayStr(), S.viewDate, incident().date]));
  const meta = { includeMetadataChanges: true };
  const onErr = e => { console.warn(e); badge(e.code); if (e.code === 'permission-denied') { toast('登入已失效（可能已從名冊移除），請重新登入'); S.me = null; S.dev = false; localStorage.removeItem(LS.me); localStorage.removeItem(LS.dev); S.subs.forEach(f => f()); S.subs = []; route(true); } };
  S.subs.push(fb.onSnapshot(tdoc('config/settings'), snap => { save(LS.cloudTh, (snap.exists() && snap.data().th) || {}); rerender(); }, onErr));
  S.subs.push(fb.onSnapshot(fb.collection(db, `teams/${TEAM}/roster`), snap => {
    const list = snap.docs.map(d => Object.assign({ docId: d.id }, d.data())).filter(m => m.id).sort((a, b) => String(a.id).localeCompare(String(b.id), 'zh-Hant', { numeric: true }));
    if (list.length || !snap.metadata.fromCache) { setRoster(list); resolveMe(); } rerender(); }, onErr));
  S.subs.push(fb.onSnapshot(fb.query(fb.collection(db, `teams/${TEAM}/records`), fb.where('date', 'in', dates)), meta, snap => {
    const keep = {}; Object.values(S.records).forEach(r => { if (!dates.includes(r.date)) keep[r.id] = r; });
    snap.docs.forEach(d => { const r = d.data(); if (!r || !r.memberId) return; if (!Array.isArray(r.cylinders) || !r.cylinders.length) r.cylinders = [newCyl()]; r.id = d.id; keep[d.id] = r; });
    S.records = keep; S.pending = snap.metadata.hasPendingWrites; badge(); rerender(); }, onErr));
  S.subs.push(fb.onSnapshot(fb.query(fb.collection(db, `teams/${TEAM}/vitals`), fb.where('date', 'in', dates)), meta, snap => {
    const keep = {}; Object.values(S.vitals).forEach(v => { if (!dates.includes(v.date)) keep[v.id] = v; });
    snap.docs.forEach(d => { const v = d.data(); if (!v || !v.recId || !v.time) return; v.id = d.id; keep[d.id] = v; }); S.vitals = keep; badge(); rerender(); }, onErr));
}
function badge(err) { const b = $('#syncBadge'); if (!b) return;
  if (!loggedIn()) { b.textContent = '未登入'; b.className = 'badge warn'; return; }
  if (err) { b.textContent = '連線錯誤'; b.className = 'badge warn'; return; }
  if (!navigator.onLine) { b.textContent = '離線（恢復後自動上傳）'; b.className = 'badge warn'; return; }
  if (S.pending) { b.textContent = '上傳中…'; b.className = 'badge warn'; return; }
  b.textContent = (S.dev ? '開發者｜' : '') + '雲端同步'; b.className = 'badge ok'; }
window.addEventListener('online', () => badge()); window.addEventListener('offline', () => badge());
let rrT = null, pendingRender = false;
function rerender() { clearTimeout(rrT); rrT = setTimeout(() => { const a = document.activeElement; if (a && ['INPUT', 'SELECT', 'TEXTAREA'].includes(a.tagName) && a.id !== 'armId') { pendingRender = true; return; } route(true); }, 120); }
document.addEventListener('focusout', () => setTimeout(() => { if (pendingRender) { const a = document.activeElement; if (!a || !['INPUT', 'SELECT', 'TEXTAREA'].includes(a.tagName)) { pendingRender = false; route(true); } } }, 200));

/* ---------- 名冊 ---------- */
function roster() { return S.roster; }
function findMember(id) { const v = normId(id); if (!v) return null; return roster().find(m => normId(m.id) === v || (m.vid && normId(m.vid) === v)); }
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
  let iId = idx('臂章'), iU = idx('分隊'), iT = idx('職稱'), iN = idx('姓名'), iV = idx('義消'), start = 1;
  if (iId < 0) { iId = 0; iU = 1; iT = 2; iN = 3; iV = 4; start = 0; }
  return rows.slice(start).map(r => ({ id: (r[iId] || '').trim(), unit: (r[iU] || '').trim(), title: (r[iT] || '').trim(), name: (r[iN] || '').trim(), vid: iV >= 0 ? (r[iV] || '').trim() : '' })).filter(m => m.id);
}
// 名冊寫入：roster 文件＋登入用雜湊鍵（臂章號碼、義消證號各一）
async function rosterOps(batch, m, old) {
  const docId = encodeURIComponent(normId(m.id));
  const newKeys = [await idKey(m.id)].concat(m.vid ? [await idKey(m.vid)] : []);
  if (old) { const oldDoc = old.docId || encodeURIComponent(normId(old.id));
    const oldKeys = [await idKey(old.id)].concat(old.vid ? [await idKey(old.vid)] : []);
    oldKeys.filter(k => !newKeys.includes(k)).forEach(k => batch.delete(tdoc(`rosterKeys/${k}`))); if (oldDoc !== docId) batch.delete(tdoc(`roster/${oldDoc}`)); }
  batch.set(tdoc(`roster/${docId}`), { id: m.id.trim(), vid: (m.vid || '').trim(), unit: (m.unit || '').trim(), title: (m.title || '').trim(), name: (m.name || '').trim(), src: m.src || 'app', at: Date.now(), by: byMe() ? `${byMe().title} ${byMe().name}`.trim() : '' });
  newKeys.forEach(k => batch.set(tdoc(`rosterKeys/${k}`), { r: docId, src: m.src || 'app' }));
}
async function saveMember(m, old) { const b = fb.writeBatch(db); await rosterOps(b, m, old); await b.commit(); }
async function deleteMember(m) { const b = fb.writeBatch(db); const docId = m.docId || encodeURIComponent(normId(m.id));
  b.delete(tdoc(`rosterKeys/${await idKey(m.id)}`)); if (m.vid) b.delete(tdoc(`rosterKeys/${await idKey(m.vid)}`)); b.delete(tdoc(`roster/${docId}`)); await b.commit(); }
async function importRoster(list) { for (let i = 0; i < list.length; i += 120) { const b = fb.writeBatch(db); for (const m of list.slice(i, i + 120)) { const old = roster().find(x => normId(x.id) === normId(m.id)); await rosterOps(b, Object.assign({ src: 'csv' }, m), old || null); } await b.commit(); } }

/* ---------- 紀錄 ---------- */
function incident() { const i = load(LS.incident, null); if (i && i.date === todayStr()) return i; return { date: todayStr(), address: '' }; }
function openRecordFor(memberId) { const inc = incident(); return Object.values(S.records).find(r => normId(r.memberId) === normId(memberId) && r.date === inc.date && !r.closed); }
function newCyl(prev) { return { face: prev ? prev.face || '' : '', group: prev ? prev.group || '' : '', inAt: '', exit: '', work: th().workDefault, gas: '', by: null }; }
function newRecord(m) { const inc = incident();
  return { id: TEAM.slice(0, 2) + uid(), memberId: m.id, vid: m.vid || '', unit: m.unit || '', title: m.title || '', name: m.name || '', date: inc.date, address: inc.address || '',
    cylinders: [newCyl()], rehabAt: null, rehabBy: null, alertAck: null, closed: false, createdAt: new Date().toISOString(), createdBy: byMe() }; }
function toMin(t) { if (!t || !/^\d{1,2}:\d{2}/.test(t)) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function fromMin(m) { m = ((m % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; }
function entryTime(c) { const e = toMin(c.exit), w = num(c.work); if (e == null || w == null) return ''; return fromMin(e - w); }
function cylState(c) { if (c.exit) return 'done'; if (c.inAt) return 'working'; return 'idle'; }
function roomSec(c) { if (!c || !c.inAt || c.exit) return null; return Math.max(0, Math.round((Date.now() - new Date(c.inAt).getTime()) / 1000)); }
function roomCls(sec) { const T = th(); if (sec == null) return ''; const m = sec / 60; return m > T.roomAlarm ? 'flash-red' : m >= T.roomWarn ? 'flash-amber' : 'room-ok'; }
function activeCyl(rec) { return rec.cylinders.find(c => cylState(c) === 'working'); }
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
  if (activeCyl(rec)) return { k: 'blue', t: '入室中', code: 'working' };
  return { k: 'green', t: '待命', code: 'standby' };
}
const ORDER = { alarm: 0, due: 1, countdown: 2, rehab: 3, working: 4, standby: 5, closed: 6 };
function fmtCd(s) { if (s == null) return ''; s = Math.abs(s); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; }
function applyRehab(rec) { const hits = rehabCheck(rec);
  if (hits.length && !rec.rehabAt) { const c = rec.cylinders[hits[0].i]; let d = rec.date; if (c.exit && toMin(c.exit) > toMin(hhmm()) + 60 && rec.date === todayStr()) { const y = new Date(); y.setDate(y.getDate() - 1); d = todayStr(y); }
    rec.rehabAt = `${d}T${c.exit}`; rec.rehabBy = byMe(); rec.alertAck = null; askNotify(); return true; }
  if (!hits.length && rec.rehabAt && rec.rehabAuto !== false && !vitalsOf(rec.id).length) { rec.rehabAt = null; rec.rehabBy = null; }
  return false; }
function pill(rec) { const s = recStatus(rec); const c = activeCyl(rec); const rs = roomSec(c);
  return `<span class="pill ${s.k}">${s.t}${s.code === 'countdown' ? ` <span class="cd" data-cd="${esc(rec.id)}">${fmtCd(cdLeft(rec))}</span>` : ''}</span>${rs != null ? ` <span class="pill room ${roomCls(rs)}" data-room="${esc(rec.id)}">入室 ${fmtCd(rs)}</span>` : ''}`; }

/* ---------- 通知：REHAB 倒數結束（不擋畫面的底部提示） ---------- */
let audioCtx = null;
document.addEventListener('pointerdown', () => { try { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) {} }, { passive: true });
function beep() { try { if (!audioCtx) return; const t0 = audioCtx.currentTime; for (let i = 0; i < 3; i++) { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination); g.gain.setValueAtTime(0.0001, t0 + i * 0.45); g.gain.exponentialRampToValueAtTime(0.4, t0 + i * 0.45 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.45 + 0.35); o.start(t0 + i * 0.45); o.stop(t0 + i * 0.45 + 0.4); } } catch (e) {} }
function askNotify() { try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {} }
async function sysNotify(title, body, tag) { try { if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) reg.showNotification(title, { body, tag, renotify: true, requireInteraction: true, vibrate: [300, 150, 300] }); else new Notification(title, { body, tag }); } catch (e) {} }
const alerted = {};
function dueAlerts() { const snooze = load(LS.snooze, {}); return Object.values(S.records).filter(r => !r.closed && r.rehabAt && !r.alertAck && cdLeft(r) <= 0 && !vitalsOf(r.id).some(v => v.time >= r.rehabAt.slice(0, 16)) && !(snooze[r.id] > Date.now())); }
function checkAlerts() {
  if (!loggedIn()) return; const due = dueAlerts(); const layer = $('#alertLayer');
  if (!due.length) { if (layer.dataset.rec) { layer.innerHTML = ''; layer.dataset.rec = ''; } return; }
  const r = due[0]; if (layer.dataset.rec === r.id) return; layer.dataset.rec = r.id;
  layer.innerHTML = `<div class="sheet" id="cdModal"><div class="row" style="align-items:center"><div><b style="color:#b91c1c">⏰ REHAB ${th().restMin} 分鐘到</b><div><b>${esc(r.title)} ${esc(r.name)}</b>（${esc(r.unit)}）請量測生命徵象${due.length > 1 ? `｜另有 ${due.length - 1} 人` : ''}</div></div></div>
    <div class="grid2" style="margin-top:8px"><button class="btn-red" id="cdGo">🩺 填寫生命徵象</button><button id="cdLater">2 分鐘後提醒</button></div></div>`;
  if (!alerted[r.id]) { alerted[r.id] = 1; beep(); if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]); sysNotify('REHAB 時間到：' + r.name, '請量測生命徵象（' + (r.unit || '') + '）', 'rehab-' + r.id); }
  const hh = location.hash; if (!/^#\/(r\/|v\/|m\/|status|settings|qr|login)/.test(hh)) location.hash = '#/v/' + encodeURIComponent(r.id);
  $('#cdGo').onclick = () => { r.alertAck = { by: DEVICE, at: new Date().toISOString(), who: byMe() }; putRecord(r); layer.innerHTML = ''; layer.dataset.rec = ''; location.hash = '#/v/' + encodeURIComponent(r.id); };
  $('#cdLater').onclick = () => { const s = load(LS.snooze, {}); s[r.id] = Date.now() + 120000; save(LS.snooze, s); delete alerted[r.id]; layer.innerHTML = ''; layer.dataset.rec = ''; };
}
setInterval(() => {
  $$('[data-cd]').forEach(el => { const r = getRecord(el.dataset.cd); if (r) { const s = cdLeft(r); el.textContent = s > 0 ? fmtCd(s) : '時間到'; } });
  $$('[data-room]').forEach(el => { const [rid, ci] = el.dataset.room.split(':'); const r = getRecord(rid); if (!r) return; const c = ci != null ? r.cylinders[+ci] : activeCyl(r); const s = roomSec(c);
    if (s == null) { el.textContent = '已出室'; el.className = el.className.replace(/flash-\w+|room-ok/g, ''); return; }
    el.textContent = (el.dataset.big ? '' : '入室 ') + fmtCd(s); el.classList.remove('flash-red', 'flash-amber', 'room-ok'); el.classList.add(roomCls(s)); });
}, 1000);
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
const memberLine = m => m ? `${esc(m.unit || '—')}｜${esc(m.title || '—')}｜${esc(m.name || '—')}` : '';
let lastHash = '';
function route(soft) {
  const h = location.hash.replace(/^#\/?/, ''); if (!soft || h !== lastHash) { stopScan(); window.scrollTo(0, 0); } lastHash = h;
  const [p, a] = h.split('/').map(decodeURIComponent);
  if (!S.ready) { app.innerHTML = '<div class="card muted">載入中…</div>'; return; }
  if (!loggedIn()) { if (p && p !== 'login') save(LS.pending, location.hash); return viewLogin(); }
  if (p === 'login') { location.replace('#/'); return; }
  if (p === 'm') return viewMember(a);
  if (p === 'r') return viewRecord(a);
  if (p === 'v') return viewVitals(a);
  if (p === 'status') return viewStatus(a);
  if (p === 'qr') return viewQR();
  if (p === 'settings') return viewSettings();
  return viewHome();
}

/* ---------- 登入 ---------- */
function viewLogin() {
  setTab('');
  app.innerHTML = `<div class="card" style="margin-top:24px"><h2>🧑‍🚒 身分確認</h2>
    <p class="muted">請輸入你的<b>臂章號碼</b>或<b>義消證號</b>（需在人員名冊內）才能使用。</p>
    <input id="loginId" placeholder="臂章號碼／義消證號" autocapitalize="characters" autocomplete="off">
    <button class="btn btn-red btn-block" id="loginBtn" style="font-size:18px">登入</button>
    <p class="muted small">連續輸入錯誤 5 次會鎖定 15 分鐘。登入後這支手機會記住身分，離線也能用。</p>
    <details style="margin-top:10px"><summary class="small">系統開發者登入</summary><input id="devPw" type="password" autocomplete="off" placeholder="開發者密碼"><button class="btn btn-block" id="devBtn">開發者登入</button></details></div>${DISC}`;
  const go = async () => { const b = $('#loginBtn'); b.disabled = true; b.textContent = '確認中…';
    try { await login($('#loginId').value); toast(`登入成功：${S.me.title || ''} ${S.me.name || S.me.id}`); const p = load(LS.pending, ''); localStorage.removeItem(LS.pending); location.replace(p || '#/'); route(true); }
    catch (e) { toast(e.message || String(e)); b.disabled = false; b.textContent = '登入'; } };
  $('#loginBtn').onclick = go; $('#loginId').onkeydown = e => { if (e.key === 'Enter') go(); };
  $('#devBtn').onclick = async () => { try { await devLogin($('#devPw').value); $('#devPw').value = ''; toast('已以系統開發者登入'); location.replace('#/settings'); route(true); } catch (e) { toast(e.message || String(e)); } };
}

/* ---------- 人員管控（含掃描） ---------- */
async function geoFill(inputSel) {
  if (!navigator.geolocation) return toast('此裝置不支援定位'); toast('定位中…');
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude: la, longitude: lo } = pos.coords; let addr = `${la.toFixed(5)}, ${lo.toFixed(5)}`;
    try { const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${la}&lon=${lo}&accept-language=zh-TW&zoom=18`); const j = await r.json(); const a = j.address || {};
      const s = [a.city || a.county, a.town || a.suburb || a.city_district, a.road, a.house_number ? a.house_number + '號' : ''].filter(Boolean).join(''); if (s) addr = s; else if (j.display_name) addr = j.display_name; } catch (e) {}
    const el = $(inputSel); if (el) { el.value = addr; el.dispatchEvent(new Event('change')); } toast('已帶入定位地址');
  }, e => toast('定位失敗：' + e.message), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
}
function meBar() { const b = byMe(); return `<div class="muted small" style="margin:-2px 2px 6px">目前填寫人：<b>${b ? byText(b) : '—'}</b>${S.dev ? ' <span class="pill amber">系統開發者</span>' : ''}</div>`; }
function viewHome() {
  setTab('home'); const inc = incident();
  const recs = Object.values(S.records).filter(r => r.date === inc.date && !r.closed).sort((a, b) => ORDER[recStatus(a).code] - ORDER[recStatus(b).code]);
  const keep = $('#armId') ? $('#armId').value : '';
  app.innerHTML = `${meBar()}
  <div class="card"><h2>🧑‍🚒 人員管控</h2>
    <div class="grid2"><div><label>案件日期</label><input type="date" id="incDate" value="${esc(inc.date)}"></div>
    <div><label>案件地點（可空白）</label><div class="row" style="gap:4px"><input id="incAddr" placeholder="可空白" value="${esc(inc.address)}"><button class="now" id="geo" title="定位">📍</button></div></div></div></div>
  <div class="card"><h3>掃描臂章 QR Code 或輸入臂章號碼／義消證號</h3>
    <div id="reader" class="hidden"></div>
    <button class="btn btn-red btn-block" id="scanBtn" style="font-size:18px">📷 開啟相機掃描</button>
    <div class="row" style="margin-top:10px"><div><input id="armId" placeholder="臂章號碼／義消證號" autocapitalize="characters" autocomplete="off" value="${esc(keep)}"></div><button class="btn-blue now" id="goManual">登錄</button></div>
    <div id="autoFill" class="auto">輸入後自動帶入分隊別／職稱／姓名</div></div>
  <div class="card"><h3>本案人員（${recs.length}）</h3>
    ${recs.length ? `<ul class="list">${recs.map(r => { const c = r.cylinders[r.cylinders.length - 1];
      return `<li><a href="#/r/${esc(r.id)}"><b>${esc(r.title)} ${esc(r.name)}</b> <span class="muted small">${esc(r.memberId)}｜${esc(r.unit)}｜第 ${r.cylinders.length} 支${c.face ? `｜${esc(c.face)}面第${esc(c.group)}組` : ''}</span></a><span>${pill(r)}</span></li>`; }).join('')}</ul>` : '<p class="muted">尚無人員。</p>'}
  </div>${DISC}`;
  const saveInc = () => { save(LS.incident, { date: $('#incDate').value || todayStr(), address: $('#incAddr').value.trim() }); subscribe(); };
  $('#incDate').onchange = saveInc; $('#incAddr').onchange = saveInc; $('#geo').onclick = () => geoFill('#incAddr');
  const af = () => { const v = $('#armId').value.trim(); const m = findMember(v); const el = $('#autoFill');
    if (!v) { el.className = 'auto'; el.textContent = '輸入後自動帶入分隊別／職稱／姓名'; }
    else if (m) { el.className = 'auto ok'; el.innerHTML = '✅ ' + memberLine(m); } else { el.className = 'auto miss'; el.textContent = '名冊查無此號碼（請先到設定→人員名單新增）'; } };
  $('#armId').oninput = af; af();
  const go = () => { const v = $('#armId').value.trim(); if (v) location.hash = '#/m/' + encodeURIComponent(v); };
  $('#goManual').onclick = go; $('#armId').onkeydown = e => { if (e.key === 'Enter') go(); };
  $('#scanBtn').onclick = () => scanner ? stopScan() : startScan();
}
let scanner = null;
function stopScan() { if (scanner) { const s = scanner; scanner = null; s.stop().catch(() => {}).then(() => { try { s.clear(); } catch (e) {} }); }
  const r = $('#reader'); if (r) r.classList.add('hidden'); const b = $('#scanBtn'); if (b) b.textContent = '📷 開啟相機掃描'; }
function loadScript(src) { return new Promise((ok, no) => { if ($(`script[src="${src}"]`)) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); }
function idFromText(t) { t = String(t || '').trim(); try { const u = new URL(t); const id = u.searchParams.get('id'); if (id) return id; const m = u.hash.match(/#\/m\/([^/?]+)/); if (m) return decodeURIComponent(m[1]); } catch (e) {} return t; }
async function startScan() {
  $('#reader').classList.remove('hidden'); $('#scanBtn').textContent = '✖ 關閉相機';
  try { await loadScript('vendor/html5-qrcode.min.js'); scanner = new Html5Qrcode('reader');
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: 230 }, txt => { const id = idFromText(txt); if (navigator.vibrate) navigator.vibrate(80); stopScan(); location.hash = '#/m/' + encodeURIComponent(id); }, () => {});
  } catch (e) { scanner = null; $('#reader').innerHTML = `<p style="color:#fff;padding:14px">無法啟動相機：${esc(e.message || e)}（請允許相機權限，或改用號碼輸入）</p>`; }
}
function viewMember(id) {
  setTab('home'); const m = findMember(id);
  if (!m) { app.innerHTML = `<div class="card"><h2>名冊查無：${esc(id)}</h2><p class="muted">只有名冊內的人員可以登錄。請到「設定 → 人員名單」新增（或在 Google 試算表名冊補上）後再登錄。</p><a class="btn btn-red btn-block" href="#/settings">前往人員名單</a><a class="btn btn-block" href="#/">← 返回</a></div>`; return; }
  let rec = openRecordFor(m.id);
  if (!rec) { rec = newRecord(m); putRecord(rec); toast(`已登錄 ${m.title} ${m.name}（${m.unit}）`); }
  location.replace('#/r/' + encodeURIComponent(rec.id));
}

function viewRecord(rid) {
  setTab('home'); const rec = getRecord(rid); if (!rec) { app.innerHTML = '<div class="card">找不到紀錄（可能尚在同步）<a class="btn btn-block" href="#/">← 返回</a></div>'; return; }
  const T = th(); const hits = rehabCheck(rec); const st = recStatus(rec); const vs = vitalsOf(rec.id);
  const lastV = vs[vs.length - 1]; const lastE = lastV ? evalVital(lastV, rec, vs.slice(0, -1)) : null; const left = cdLeft(rec);
  const opt = (arr, val) => arr.map(([v, l]) => `<option value="${v}" ${val === v ? 'selected' : ''}>${l}</option>`).join('');
  app.innerHTML = `${meBar()}
  <div class="card"><div class="row" style="align-items:center"><div><h2 style="margin:0">${esc(rec.title)} ${esc(rec.name)}</h2><div class="muted small">臂章 ${esc(rec.memberId)}${rec.vid ? `｜義消證 ${esc(rec.vid)}` : ''}｜${esc(rec.unit)}｜建檔：${byText(rec.createdBy)}</div></div><span style="flex:0 0 auto;text-align:right">${pill(rec)}</span></div></div>
  ${rec.rehabAt && !rec.closed ? `<div class="banner red">🟥 已達 REHAB 條件：撤出至休息區
    <div style="font-weight:400;margin-top:4px">${hits.map(h => `第 ${h.i + 1} 支工作 ${h.d} 分鐘（≥ ${h.lim}）`).join('；') || '手動啟動'}｜REHAB 開始 ${esc(rec.rehabAt.slice(11, 16))}｜填寫人：${byText(rec.rehabBy)}</div>
    <div style="font-size:30px;margin:6px 0">⏱ <span class="cd" data-cd="${esc(rec.id)}">${left > 0 ? fmtCd(left) : '時間到'}</span></div>
    <a href="#/v/${esc(rec.id)}" class="btn btn-block" style="background:#fff;color:#b91c1c;font-size:18px">🩺 生命徵象監測表單（${vs.length} 筆）</a>
    <button class="btn btn-block" id="closeTop" style="background:#7f1d1d;color:#fff">✔ 結束／離場（歸隊）</button></div>` : ''}
  ${lastE && lastE.level === 'red' && !rec.closed ? `<div class="banner red">🚨 紅色警戒：建議進入低溫處置流程<div style="font-weight:400">${esc(lastE.bad.join('；'))}</div></div>` : ''}
  ${rec.closed ? `<div class="banner green">此人已歸隊／離場（${byText(rec.closedBy)}）</div>` : ''}
  <div class="card"><h3>案件</h3><div class="grid2"><div><label>案件日期</label><input type="date" id="rDate" value="${esc(rec.date)}"></div>
    <div><label>案件地點</label><div class="row" style="gap:4px"><input id="rAddr" value="${esc(rec.address)}" placeholder="可空白"><button class="now" id="rGeo">📍</button></div></div></div></div>
  <div class="card"><h3>氣瓶使用情形</h3>
    <p class="muted small">按「入室」開始計時（≥${T.roomWarn} 分黃色閃爍、>${T.roomAlarm} 分紅色閃爍）。出來後填「氣瓶離場時間」＋「工作時間」（預設 ${T.workDefault} 分），系統自動算進入時間。REHAB：第 1 支 ≥ ${T.cyl1Min} 分或第 2 支起 ≥ ${T.cyl2Min} 分。</p>
    ${rec.cylinders.map((c, i) => { const hit = hits.some(h => h.i === i); const en = entryTime(c); const stc = cylState(c); const rs = roomSec(c);
    return `<div class="cyl ${hit ? 'hit' : ''}" data-i="${i}"><div class="hd"><span>第 ${i + 1} 支氣瓶 ${stc === 'working' ? '<span class="pill blue">入室中</span>' : stc === 'done' ? '<span class="pill gray">已離場</span>' : ''}</span><span class="dur ${hit ? 'hit' : ''}">${num(c.work) != null ? esc(c.work) + ' 分' : '—'}</span></div>
      <div class="grid2"><div><label>火場面別</label><select data-f="face"><option value="">—</option>${opt(FACES, c.face)}</select></div><div><label>組別</label><select data-f="group"><option value="">—</option>${opt(GROUPS.map(g => [g, `第 ${g} 組`]), c.group)}</select></div></div>
      ${stc === 'idle' ? `<button class="btn btn-blue btn-block" data-in style="font-size:18px">🚪 入室（開始計時）</button>` : ''}
      ${stc === 'working' ? `<div class="roombox ${roomCls(rs)}" data-room="${esc(rec.id)}:${i}" data-big="1">${fmtCd(rs)}</div><div class="muted small" style="text-align:center">入室 ${esc(c.inAt.slice(11, 16))}｜≥${T.roomWarn} 分黃色、>${T.roomAlarm} 分紅色</div><button class="btn btn-block" data-out>🚪 出室（填入離場時間＝現在）</button>` : ''}
      <div class="row"><div><label>氣瓶離場時間</label><input type="time" data-f="exit" value="${esc(c.exit)}"></div><button class="now" data-now="exit">現在</button></div>
      <div class="row"><div><label>工作時間（分鐘）</label><input inputmode="numeric" data-f="work" value="${esc(c.work)}"></div><div><label>用氣量 bar（選填）</label><input inputmode="numeric" data-f="gas" value="${esc(c.gas)}"></div></div>
      <div class="auto ${en ? 'ok' : ''}">進入時間（自動）：<b>${en || '填離場時間後自動計算'}</b>${en ? `（${esc(c.exit)} − ${esc(c.work)} 分）` : ''}</div>
      <div class="muted small" style="margin-top:4px">填寫人：${byText(c.by)}</div>
      ${rec.cylinders.length > 1 && i === rec.cylinders.length - 1 ? '<button class="btn-sm" data-del style="margin-top:8px">刪除這支</button>' : ''}</div>`; }).join('')}
    <button class="btn btn-blue btn-block" id="addCyl">＋ 換下一支氣瓶（第 ${rec.cylinders.length + 1} 支）</button>
    ${!rec.rehabAt ? `<button class="btn btn-block" id="manRehab">手動進入 REHAB（身體不適等）</button>` : ''}
  </div>
  <div class="card"><button class="btn btn-block ${rec.closed ? '' : 'btn-green'}" id="closeRec">${rec.closed ? '重新開啟紀錄' : '✔ 結束此人紀錄（歸隊／離場）'}</button><a class="btn btn-block" href="#/">← 回人員管控</a></div>${DISC}`;
  const upd = () => { applyRehab(rec); putRecord(rec); route(true); };
  $('#rDate').onchange = e => { rec.date = e.target.value; upd(); };
  $('#rAddr').onchange = e => { rec.address = e.target.value.trim(); upd(); };
  $('#rGeo').onclick = () => geoFill('#rAddr');
  $$('.cyl').forEach(el => { const i = +el.dataset.i; const c = rec.cylinders[i];
    $$('[data-f]', el).forEach(inp => inp.onchange = () => { c[inp.dataset.f] = inp.value.trim(); c.by = byMe(); upd(); });
    $$('[data-now]', el).forEach(b => b.onclick = () => { c.exit = hhmm(); if (num(c.work) == null) c.work = T.workDefault; c.by = byMe(); upd(); });
    const bi = $('[data-in]', el); if (bi) bi.onclick = () => { c.inAt = localIsoS(); c.by = byMe(); upd(); };
    const bo = $('[data-out]', el); if (bo) bo.onclick = () => { c.exit = hhmm(); const mins = Math.max(1, Math.round((roomSec(c) || 0) / 60)); if (num(c.work) == null || c.work == T.workDefault) c.work = Math.max(mins, 1); c.by = byMe(); upd(); };
    const del = $('[data-del]', el); if (del) del.onclick = () => { if (confirm('刪除第 ' + (i + 1) + ' 支？')) { rec.cylinders.splice(i, 1); upd(); } };
  });
  $('#addCyl').onclick = () => { const last = rec.cylinders[rec.cylinders.length - 1]; if (last.inAt && !last.exit) last.exit = hhmm(); rec.cylinders.push(newCyl(last)); upd(); };
  const mr = $('#manRehab'); if (mr) mr.onclick = () => { setStatus(rec, 'rehab'); route(true); };
  const doClose = () => { if (!rec.closed && rec.rehabAt && lastE && lastE.level === 'red' && !confirm('最後一次生命徵象為紅色警戒，確定讓他歸隊／離場？')) return; setStatus(rec, rec.closed ? 'reopen' : 'close'); route(true); };
  $('#closeRec').onclick = doClose; const ct = $('#closeTop'); if (ct) ct.onclick = doClose;
}
// 狀態變更（紀錄頁與管制狀態共用）
function setStatus(rec, action) {
  const now = hhmm(); const ac = activeCyl(rec);
  if (action === 'rehab') { if (ac) { ac.exit = now; ac.by = byMe(); } rec.rehabAt = localIso(); rec.rehabAuto = false; rec.rehabBy = byMe(); rec.alertAck = null; rec.closed = false; askNotify(); }
  if (action === 'unrehab') { rec.rehabAt = null; rec.rehabBy = null; rec.rehabAuto = false; rec.alertAck = null; }
  if (action === 'out') { if (ac) { ac.exit = now; const mins = Math.max(1, Math.round((roomSec(ac) || 0) / 60)); if (ac.work == th().workDefault) ac.work = mins; ac.by = byMe(); } applyRehab(rec); }
  if (action === 'in') { const last = rec.cylinders[rec.cylinders.length - 1]; let c = last; if (cylState(last) !== 'idle') { c = newCyl(last); rec.cylinders.push(c); } c.inAt = localIsoS(); c.by = byMe(); rec.closed = false; }
  if (action === 'close') { if (ac) { ac.exit = now; ac.by = byMe(); } rec.closed = true; rec.closedBy = byMe(); rec.closedAt = localIso(); }
  if (action === 'reopen') { rec.closed = false; rec.closedBy = null; }
  if (action === 'ack') { rec.alertAck = { by: DEVICE, at: new Date().toISOString(), who: byMe() }; }
  putRecord(rec);
}

function viewVitals(rid) {
  setTab('home'); const rec = getRecord(rid); if (!rec) { app.innerHTML = '<div class="card">找不到紀錄（可能尚在同步）</div>'; return; }
  const T = th(); const vs = vitalsOf(rec.id); const evs = vs.map((v, i) => evalVital(v, rec, vs.slice(0, i))); const last = evs[evs.length - 1];
  const keepVals = {}; $$('#vForm input, #vForm textarea').forEach(i => keepVals[i.id] = i.value);
  app.innerHTML = `${meBar()}
  <div class="card"><h2 style="margin:0">🩺 生命徵象監測</h2><div class="muted small"><b>${esc(rec.title)} ${esc(rec.name)}</b>｜${esc(rec.unit)}｜臂章 ${esc(rec.memberId)}｜${esc(rec.address || '地點未填')}｜REHAB 開始 ${rec.rehabAt ? esc(rec.rehabAt.slice(11, 16)) : '—'}${rec.rehabAt ? `｜倒數 <span class="cd" data-cd="${esc(rec.id)}"></span>` : ''}</div></div>
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
    <div class="muted small">填寫人：<b>${byText(byMe())}</b></div>
    <button class="btn btn-red btn-block" id="vSave">儲存這次量測</button>
    <p class="muted small">標準：BP &gt;${T.sbpHigh}/${T.dbpHigh} 或 SBP &lt;${T.sbpLow}｜脈搏 &gt;${T.hrHigh}（休息 ${T.hrRestMin} 分後）｜SpO2 &lt;${T.spo2Low}%｜體溫 ≥${T.tempHigh}°C 或持續上升 ${T.tempRiseMin} 分｜SpCO &gt;${T.spcoHigh}%</p></div>
  <div class="card"><h3>量測紀錄（${vs.length}）</h3>
    ${vs.length ? `<div style="overflow-x:auto"><table class="vt"><tr><th>時間</th><th>血壓</th><th>脈搏</th><th>SpO2</th><th>體溫</th><th>SpCO</th><th></th></tr>
    ${vs.map((v, i) => { const e = evs[i]; const c = k => e.cells[k] || ''; const bpc = (c('sbp') === 'bad' || c('dbp') === 'bad') ? 'bad' : '';
      return `<tr><td>${esc(v.time.slice(11, 16))}</td><td class="${bpc}">${esc(v.sbp || '-')}/${esc(v.dbp || '-')}</td><td class="${c('hr')}">${esc(v.hr || '-')}</td><td class="${c('spo2')}">${esc(v.spo2 || '-')}</td><td class="${c('temp')}">${esc(v.temp || '-')}</td><td class="${c('spco')}">${esc(v.spco || '-')}</td><td><button class="btn-sm" data-dv="${esc(v.id)}">刪</button></td></tr><tr><td colspan="7" class="muted small" style="text-align:left">填寫人：${byText(v.by)}${v.note ? `｜備註：${esc(v.note)}` : ''}</td></tr>`; }).join('')}</table></div>` : '<p class="muted">尚無量測。</p>'}
  </div><div class="grid2"><a class="btn" href="#/r/${esc(rec.id)}">← 回氣瓶紀錄</a><button class="btn-green" id="vClose">✔ 歸隊／離場</button></div>${DISC}`;
  for (const k in keepVals) { const el = $('#' + k); if (el && keepVals[k]) el.value = keepVals[k]; }
  $$('[data-cd]').forEach(el => { const s = cdLeft(rec); el.textContent = s > 0 ? fmtCd(s) : '時間到'; });
  const live = () => { const v = { time: $('#vTime').value, sbp: $('#vSbp').value, dbp: $('#vDbp').value, hr: $('#vHr').value, spo2: $('#vSpo2').value, temp: $('#vTemp').value, spco: $('#vSpco').value };
    const e = evalVital(v, rec, vs); const map = { sbp: '#vSbp', dbp: '#vDbp', hr: '#vHr', spo2: '#vSpo2', temp: '#vTemp', spco: '#vSpco' }; for (const k in map) $(map[k]).classList.toggle('bad', e.cells[k] === 'bad'); };
  $$('#vSbp,#vDbp,#vHr,#vSpo2,#vTemp,#vSpco').forEach(i => i.oninput = live); live();
  $('#vSave').onclick = () => { const v = { id: rec.id + '-V' + uid(), recId: rec.id, date: rec.date, memberId: rec.memberId, name: rec.name, title: rec.title, address: rec.address, time: $('#vTime').value || localIso(), sbp: $('#vSbp').value.trim(), dbp: $('#vDbp').value.trim(), hr: $('#vHr').value.trim(), spo2: $('#vSpo2').value.trim(), temp: $('#vTemp').value.trim(), spco: $('#vSpco').value.trim(), note: $('#vNote').value.trim(), by: byMe() };
    if (!v.sbp && !v.dbp && !v.hr && !v.spo2 && !v.temp && !v.spco && !v.note) return toast('請至少填一項');
    const e = evalVital(v, rec, vs); v.level = e.level; v.flags = e.bad.concat(e.warn).join('；');
    if (!rec.rehabAt) { rec.rehabAt = v.time; rec.rehabAuto = false; rec.rehabBy = byMe(); }
    if (!rec.alertAck) rec.alertAck = { by: DEVICE, at: new Date().toISOString(), who: byMe() };
    putRecord(rec); $$('#vForm input:not(#vTime), #vForm textarea').forEach(i => i.value = ''); putVital(v); toast('已儲存'); route(true); };
  $$('[data-dv]').forEach(b => b.onclick = () => { if (confirm('刪除這筆量測？')) { delVital(b.dataset.dv); route(true); } });
  $('#vClose').onclick = () => { if (last && last.level === 'red' && !confirm('最後一次生命徵象為紅色警戒，確定讓他歸隊／離場？')) return; setStatus(rec, 'close'); location.hash = '#/status'; };
}

/* ---------- 管制狀態 ---------- */
function faceBoard(recs) {
  return FACES.map(([f, fl]) => {
    const deps = []; recs.forEach(r => r.cylinders.forEach((c, i) => { if (c.face !== f) return;
      const st = c.exit ? (entryTime(c) || '') : (c.inAt ? c.inAt.slice(11, 16) : ''); deps.push({ who: `${r.title || ''} ${r.name}`.trim(), group: c.group || '?', start: st, end: c.exit || '', working: cylState(c) === 'working', recId: r.id, ci: i }); }));
    if (!deps.length) return { f, fl, empty: true };
    deps.sort((a, b) => (a.start || '99').localeCompare(b.start || '99'));
    const working = {}; deps.filter(d => d.working).forEach(d => (working[d.group] = working[d.group] || []).push(d));
    const byGroup = {}; GROUPS.concat('?').forEach(g => { const n = Array.from(new Set(deps.filter(d => d.group === g).map(d => d.who))); if (n.length) byGroup[g] = n; });
    const segs = []; deps.forEach(d => { const s = segs[segs.length - 1]; if (s && s.group === d.group) { s.names.add(d.who); if (d.end > s.end) s.end = d.end; if (d.working) s.working = true; } else segs.push({ group: d.group, start: d.start, end: d.end, names: new Set([d.who]), working: d.working }); });
    return { f, fl, working, byGroup, segs, rounds: segs.length };
  });
}
const CATS = [['all', '已登錄人數', ''], ['working', '入室中', ''], ['inRehab', '在 REHAB', 'red'], ['countdown', '倒數中', 'red'], ['due', '待量測', 'red'], ['alarm', '紅色警戒', 'red'], ['standby', '待命', 'green'], ['closed', '已歸隊', ''], ['room', '入室逾時', 'amber']];
function inCat(r, cat) { const c = recStatus(r).code; if (cat === 'all') return true; if (cat === 'inRehab') return ['countdown', 'due', 'rehab', 'alarm'].includes(c);
  if (cat === 'room') { const s = roomSec(activeCyl(r)); return s != null && s / 60 >= th().roomWarn; } return c === cat; }
function viewStatus(cat) {
  setTab('status'); const date = S.viewDate;
  const recs = Object.values(S.records).filter(r => r.date === date);
  const cyl = recs.reduce((a, r) => a + r.cylinders.filter(c => c.exit || c.inAt).length, 0); const vit = Object.values(S.vitals).filter(v => v.date === date).length;
  const groups = {}; recs.forEach(r => { const k = r.address || '（地點未填）'; (groups[k] = groups[k] || []).push(r); });
  const boards = faceBoard(recs);
  const sel = cat && CATS.find(c => c[0] === cat);
  const selList = sel ? recs.filter(r => inCat(r, cat)).sort((a, b) => ORDER[recStatus(a).code] - ORDER[recStatus(b).code]) : [];
  const personLi = r => `<li><a href="#" data-act="${esc(r.id)}"><b>${esc(r.title)} ${esc(r.name)}</b> <span class="muted small">${esc(r.unit)}｜氣瓶 ${r.cylinders.filter(x => x.exit || x.inAt).length} 支｜徵象 ${vitalsOf(r.id).length} 筆${r.cylinders[r.cylinders.length - 1].face ? `｜${esc(r.cylinders[r.cylinders.length - 1].face)}面${esc(r.cylinders[r.cylinders.length - 1].group)}組` : ''}</span></a><span>${pill(r)}</span></li>`;
  app.innerHTML = `${meBar()}
  <div class="card"><div class="row" style="align-items:flex-end"><div><h2 style="margin:0">管制狀態</h2><div class="muted small">全隊即時同步｜點數字可看名單、點人員可改狀態</div></div><div style="flex:0 0 160px"><label>案件日期</label><input type="date" id="vDate" value="${esc(date)}"></div></div></div>
  <div class="stats">${CATS.map(([k, l, cls]) => `<a class="stat ${cls} ${cat === k ? 'sel' : ''}" href="#/status/${k}" id="c_${k}"><b>${recs.filter(r => inCat(r, k)).length}</b><span>${l}</span></a>`).join('')}</div>
  <div class="muted small" style="text-align:center;margin:6px">氣瓶 ${cyl} 筆｜生命徵象 <span id="cVit">${vit}</span> 筆</div>
  ${sel ? `<div class="card" id="catList"><div class="row" style="align-items:center"><h3 style="margin:0">${sel[1]}（${selList.length}）</h3><a class="btn btn-sm" style="flex:0 0 auto" href="#/status">收合</a></div><ul class="list">${selList.map(personLi).join('') || '<li class="muted">無</li>'}</ul></div>` : ''}
  <div class="card"><h3>🔥 火場面別輪替</h3>
    ${boards.map(b => b.empty ? `<div class="grp">${b.fl}</div><p class="muted small">尚無人員</p>` : `<div class="grp">${b.fl}｜輪替 ${b.rounds} 梯次</div>
      <div class="small">目前入室：${Object.keys(b.working).length ? Object.entries(b.working).map(([g, ds]) => `<span class="pill blue">第${esc(g)}組</span> ${ds.map(d => `${esc(d.who)} <span class="pill room" data-room="${esc(d.recId)}:${d.ci}"></span>`).join('、')}`).join('　') : '<span class="muted">無</span>'}</div>
      <div class="small" style="margin-top:4px">${GROUPS.map(g => `<div>第 ${g} 組 ${b.byGroup[g] ? `✅ ${esc(b.byGroup[g].join('、'))}` : '<span class="muted">尚未進入</span>'}</div>`).join('')}${b.byGroup['?'] ? `<div>未填組別：${esc(b.byGroup['?'].join('、'))}</div>` : ''}</div>
      <div class="small muted" style="margin-top:4px">歷程：${b.segs.map(s => `${esc(s.start || '?')}–${s.working ? '入室中' : esc(s.end || '?')} 第${esc(s.group)}組（${esc(Array.from(s.names).join('、'))}）`).join(' → ')}</div>`).join('')}
  </div>
  ${Object.keys(groups).length ? Object.entries(groups).map(([addr, list]) => { list.sort((a, b) => ORDER[recStatus(a).code] - ORDER[recStatus(b).code]);
    return `<div class="card"><h3>📍 ${esc(addr)}（${list.length} 人）</h3><ul class="list">${list.map(personLi).join('')}</ul></div>`; }).join('') : '<div class="card muted">此日期尚無紀錄</div>'}
  <div class="card"><button class="btn btn-block" id="exp">匯出 CSV（此日期）</button>${CFG.SHEET_URL ? `<a class="btn btn-block" href="${esc(CFG.SHEET_URL)}" target="_blank" rel="noopener">開啟 Google 試算表</a>` : ''}</div>${DISC}`;
  $('#vDate').onchange = e => { S.viewDate = e.target.value || todayStr(); subscribe(); route(true); };
  $('#exp').onclick = () => exportCSV(recs, date);
  $$('[data-act]').forEach(a => a.onclick = e => { e.preventDefault(); actionSheet(getRecord(a.dataset.act)); });
  $$('[data-room]').forEach(el => { const [rid, ci] = el.dataset.room.split(':'); const r = getRecord(rid); const s = r && roomSec(ci != null ? r.cylinders[+ci] : activeCyl(r)); if (s != null) { el.textContent = '入室 ' + fmtCd(s); el.classList.add(roomCls(s)); } });
}
function actionSheet(r) {
  if (!r) return; const s = recStatus(r); const layer = $('#sheetLayer');
  const btn = (k, l, cls = '') => `<button class="btn btn-block ${cls}" data-st="${k}">${l}</button>`;
  layer.innerHTML = `<div class="modal-bg" id="actBg"><div class="modal" style="border-top-color:#1d4ed8"><h3 style="margin:0 0 4px">${esc(r.title)} ${esc(r.name)}</h3><div class="muted small">${esc(r.unit)}｜目前：${s.t}</div>
    ${btn('open', '📄 開啟氣瓶紀錄')}${r.rehabAt ? btn('vitals', '🩺 生命徵象表單', 'btn-red') : ''}
    ${s.code === 'working' ? btn('out', '🚪 出室（離場時間＝現在）') : btn('in', '🚪 入室（開始計時）', 'btn-blue')}
    ${!r.rehabAt ? btn('rehab', '🟥 改為 REHAB（現在開始倒數）', 'btn-red') : btn('unrehab', '取消 REHAB')}
    ${r.rehabAt && !r.alertAck ? btn('ack', '已通知量測（停止提醒）') : ''}
    ${r.closed ? btn('reopen', '↩ 重新開啟') : btn('close', '✔ 歸隊／離場', 'btn-green')}
    <button class="btn btn-block" id="actX">取消</button></div></div>`;
  const close = () => { layer.innerHTML = ''; };
  $('#actX').onclick = close; $('#actBg').onclick = e => { if (e.target.id === 'actBg') close(); };
  $$('[data-st]', layer).forEach(b => b.onclick = () => { const k = b.dataset.st; close();
    if (k === 'open') { location.hash = '#/r/' + encodeURIComponent(r.id); return; } if (k === 'vitals') { location.hash = '#/v/' + encodeURIComponent(r.id); return; }
    if (k === 'close' && r.rehabAt) { const vs = vitalsOf(r.id); const l = vs[vs.length - 1]; if (l && evalVital(l, r, vs.slice(0, -1)).level === 'red' && !confirm('最後一次生命徵象為紅色警戒，確定歸隊？')) return; }
    setStatus(r, k); toast(`已更新：${r.name}`); route(true); });
}
function exportCSV(recs, date) {
  const csv = (head, rows) => [head, ...rows].map(r => r.map(x => `"${String(x == null ? '' : x).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const bt = b => b ? `${b.title || ''} ${b.name || b.id || ''}`.trim() : '';
  const c = csv(['紀錄ID', '日期', '案件地點', '臂章號碼', '分隊別', '職稱', '姓名', '第幾支', '火場面別', '組別', '入室', '進入時間(自動)', '離場時間', '工作分鐘', '用氣量bar', 'REHAB開始', '狀態', '填寫人'],
    recs.flatMap(r => r.cylinders.map((x, i) => [r.id + '-C' + (i + 1), r.date, r.address, r.memberId, r.unit, r.title, r.name, i + 1, x.face, x.group, (x.inAt || '').slice(11, 19), entryTime(x), x.exit, x.work, x.gas, r.rehabAt || '', recStatus(r).t, bt(x.by)])));
  const v = csv(['紀錄ID', '日期', '案件地點', '臂章號碼', '姓名', '量測時間', '收縮壓', '舒張壓', '脈搏', '血氧SpO2', '體溫', 'SpCO', '其他備註', '判定', '異常項目', '填寫人'],
    recs.flatMap(r => vitalsOf(r.id).map(x => [x.id, x.date, x.address, x.memberId, x.name, x.time, x.sbp, x.dbp, x.hr, x.spo2, x.temp, x.spco, x.note, x.level === 'red' ? '紅色警戒' : x.level === 'amber' ? '注意' : '正常', x.flags, bt(x.by)])));
  const dl = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/csv' })); a.download = name; a.click(); };
  dl(`氣瓶紀錄_${date}.csv`, c); setTimeout(() => dl(`生命徵象_${date}.csv`, v), 400);
}

/* ---------- 設定 ---------- */
function qrImg(text, cell = 6) { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createDataURL(cell, 2); }
function memberUrl(id) { return baseUrl() + '?id=' + encodeURIComponent(id); }
function viewQR() {
  setTab('settings'); const r = roster();
  app.innerHTML = `<div class="card no-print"><h2>臂章 QR Code</h2><p class="muted small">掃描開啟：${esc(baseUrl())}?id=臂章號碼（網址固定，系統更新不用重印）</p><button class="btn btn-red btn-block" onclick="window.print()">🖨️ 列印 / 存成 PDF</button><a class="btn btn-block" href="#/settings">← 回設定</a></div>
  <div class="qrgrid">${r.map(m => `<div class="qrcard"><img alt="QR ${esc(m.id)}" src="${qrImg(memberUrl(m.id))}"><div class="nm">${esc(m.title)} ${esc(m.name)}</div><div class="sub">${esc(m.unit)}</div><div class="sub">臂章 ${esc(m.id)}${m.vid ? `｜義消 ${esc(m.vid)}` : ''}</div></div>`).join('') || '<p class="muted">名冊是空的</p>'}</div>`;
}
function memberForm(m) {
  return `<div class="grid2"><div><label>臂章號碼 *</label><input id="mId" value="${esc(m ? m.id : '')}"></div><div><label>義消證號</label><input id="mVid" value="${esc(m ? m.vid || '' : '')}"></div></div>
  <div class="grid3"><div><label>分隊別</label><input id="mU" value="${esc(m ? m.unit : '')}"></div><div><label>職稱</label><input id="mT" value="${esc(m ? m.title : '')}"></div><div><label>姓名 *</label><input id="mN" value="${esc(m ? m.name : '')}"></div></div>`;
}
function viewSettings() {
  setTab('settings'); const s = settings(); const T = th(); const r = roster(); const dev = S.dev;
  app.innerHTML = `${meBar()}
  <div class="card"><h2>我的身分</h2>
    <p>${S.me ? `<b>${esc(S.me.title || '')} ${esc(S.me.name || '')}</b>（${esc(S.me.unit || '')}｜${esc(S.me.id)}）` : '—'}${dev ? ' <span class="pill amber">系統開發者</span>' : ''}</p>
    <button class="btn btn-block" id="logout">登出這支手機</button>
    ${!dev ? `<details style="margin-top:8px"><summary class="small">系統開發者登入（修改設定）</summary><input id="devPw" type="password" autocomplete="off" placeholder="開發者密碼"><button class="btn btn-block" id="devBtn">開發者登入</button></details>` : ''}</div>
  <div class="card"><h2>人員名單（${r.length}）</h2>
    <p class="muted small">已登入的隊員都可以新增／修改。正式名冊也可填在 <a href="${esc(CFG.SHEET_URL)}" target="_blank" rel="noopener">Google 試算表「名冊」</a>（臂章號碼、分隊別、職稱、姓名、義消證號），會自動同步。只有名冊內的人能登入。</p>
    <details id="addBox"><summary class="btn btn-blue" style="display:block">＋ 新增人員</summary>${memberForm(null)}<button class="btn btn-red btn-block" id="mAdd">儲存</button></details>
    <div class="grid2" style="margin-top:8px"><a class="btn" href="#/qr">🖨️ 列印 QR Code</a><label class="btn" style="margin:0;color:var(--ink)">CSV 匯入<input type="file" id="csv" accept=".csv,.tsv,.txt,text/csv" class="hidden"></label></div>
    <ul class="list" style="margin-top:8px">${r.map(m => `<li><span><b>${esc(m.title)} ${esc(m.name)}</b> <span class="muted small">${esc(m.id)}${m.vid ? `｜義消 ${esc(m.vid)}` : ''}｜${esc(m.unit)}${m.src === 'sheet' ? '｜試算表' : ''}</span></span><button class="btn-sm" data-edit="${esc(m.docId || m.id)}">修改</button></li>`).join('') || '<li class="muted">名冊是空的</li>'}</ul>
    <a class="small" href="sample-roster.csv" download>下載 CSV 範本</a></div>
  <div class="card"><h2>通知</h2><p class="muted small">REHAB 倒數結束時：畫面下方提示、響聲、震動${'Notification' in window ? `；系統通知：${({ granted: '已允許', denied: '已封鎖', default: '未設定' })[Notification.permission]}` : ''}。</p><button class="btn btn-block" id="notif">開啟系統通知＋測試聲音</button></div>
  <div class="card"><h2>REHAB 判定標準 ${dev ? '' : '<span class="pill gray">唯讀</span>'}</h2><p class="muted small">${dev ? '你是系統開發者，修改後全隊同步。' : '只有系統開發者可以修改（雲端規則強制）。'}<span class="src">EMSer</span> 來自 EMSer 後勤照護簡報與你指定的條件；<span class="src nfpa">預設</span> EMSer 沒給數值，採 NFPA 1584／到院前常用值。</p>
    ${Object.keys(DEFAULT_TH).map(k => `<label>${esc(DEFAULT_TH[k].label)} <span class="src ${DEFAULT_TH[k].src === 'NFPA' ? 'nfpa' : ''}">${DEFAULT_TH[k].src === 'NFPA' ? '預設' : 'EMSer'}</span></label><input inputmode="decimal" data-th="${k}" value="${T[k]}" ${dev ? '' : 'disabled'}><div class="muted small">${esc(DEFAULT_TH[k].note)}</div>`).join('')}
    ${dev ? `<div class="grid2" style="margin-top:8px"><button class="btn-red" id="thSave">儲存標準（全隊）</button><button id="thReset">恢復預設</button></div>` : ''}</div>
  ${dev ? `<div class="card"><h2>系統（開發者）</h2><p class="muted small">專案：${esc(CFG.FIREBASE && CFG.FIREBASE.projectId)}｜隊伍：${esc(TEAM)}</p><label>QR Code 網址（留空 = ${esc(CFG.BASE_URL || '本頁網址')}）</label><input id="sBase" value="${esc(s.baseUrl)}" placeholder="${esc(location.origin + location.pathname)}"><button class="btn btn-block" id="sSave">儲存</button></div>` : ''}${DISC}`;
  $('#logout').onclick = () => { if (confirm('登出後需重新輸入臂章號碼／義消證號，確定？')) logout(); };
  const db_ = $('#devBtn'); if (db_) db_.onclick = async () => { try { await devLogin($('#devPw').value); $('#devPw').value = ''; toast('已以系統開發者登入'); route(true); } catch (e) { toast(e.message || String(e)); } };
  const getForm = () => ({ id: $('#mId').value.trim(), vid: $('#mVid').value.trim(), unit: $('#mU').value.trim(), title: $('#mT').value.trim(), name: $('#mN').value.trim() });
  const valid = m => { if (!m.id || !m.name) { toast('臂章號碼與姓名必填'); return false; } const dup = roster().find(x => x !== editing && (normId(x.id) === normId(m.vid || '#') || (x.vid && (normId(x.vid) === normId(m.id) || normId(x.vid) === normId(m.vid || '#'))))); if (dup) { toast('號碼與 ' + dup.name + ' 重複'); return false; } return true; };
  let editing = null;
  $('#mAdd').onclick = async () => { const m = getForm(); if (!valid(m)) return; const old = roster().find(x => normId(x.id) === normId(m.id)); try { await saveMember(m, old || null); toast('已儲存 ' + m.name); route(true); } catch (e) { toast('儲存失敗：' + (e.code || e.message)); } };
  $$('[data-edit]').forEach(b => b.onclick = () => { const m = roster().find(x => (x.docId || x.id) === b.dataset.edit); if (!m) return; editing = m; const layer = $('#sheetLayer');
    layer.innerHTML = `<div class="modal-bg"><div class="modal" style="border-top-color:#1d4ed8"><h3>修改人員</h3>${memberForm(m)}<button class="btn btn-red btn-block" id="eSave">儲存</button><button class="btn btn-block" id="eDel">刪除此人</button><button class="btn btn-block" id="eX">取消</button></div></div>`;
    $('#eX').onclick = () => layer.innerHTML = '';
    $('#eSave').onclick = async () => { const nm = getForm(); if (!valid(nm)) return; try { await saveMember(nm, m); layer.innerHTML = ''; toast('已更新'); route(true); } catch (e) { toast('失敗：' + (e.code || e.message)); } };
    $('#eDel').onclick = async () => { if (!confirm(`刪除 ${m.name}？刪除後他無法再登入。`)) return; try { await deleteMember(m); layer.innerHTML = ''; toast('已刪除'); route(true); } catch (e) { toast('失敗：' + (e.code || e.message)); } }; });
  $('#csv').onchange = e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = async () => { const list = rowsToRoster(parseCSV(rd.result)); if (!list.length) return toast('CSV 沒有讀到資料');
    try { await importRoster(list); toast(`已匯入 ${list.length} 人`); route(true); } catch (err) { toast('匯入失敗：' + (err.code || err.message)); } }; rd.readAsText(f, 'utf-8'); };
  $('#notif').onclick = async () => { try { if ('Notification' in window) await Notification.requestPermission(); } catch (e) {} beep(); if (navigator.vibrate) navigator.vibrate(200); sysNotify('REHAB 測試通知', '通知正常', 'test'); route(true); };
  const ts = $('#thSave'); if (ts) ts.onclick = async () => { const o = {}; $$('[data-th]').forEach(i => { if (i.value !== '' && !isNaN(Number(i.value))) o[i.dataset.th] = Number(i.value); });
    try { await fb.setDoc(tdoc('config/settings'), { th: o, by: '系統開發者', at: Date.now() }); toast('標準已儲存，全隊同步'); } catch (e) { toast('儲存失敗：' + e.code); } };
  const tr = $('#thReset'); if (tr) tr.onclick = async () => { try { await fb.setDoc(tdoc('config/settings'), { th: {}, by: '系統開發者', at: Date.now() }); toast('已恢復預設'); } catch (e) { toast('失敗：' + e.code); } };
  const ss = $('#sSave'); if (ss) ss.onclick = () => { save(LS.settings, Object.assign(load(LS.settings, {}), { baseUrl: $('#sBase').value.trim() })); toast('已儲存'); };
}

/* ---------- 啟動 ---------- */
(async function boot() {
  const p = new URLSearchParams(location.search); const id = p.get('id');
  if (id) history.replaceState(null, '', location.pathname + '#/m/' + encodeURIComponent(id));
  if (/^#join=/.test(location.hash)) history.replaceState(null, '', location.pathname + '#/');
  window.addEventListener('hashchange', () => route()); route(); badge();
  try { fbInit(); await checkSession(); } catch (e) { console.warn(e); }
  S.ready = true; await startCloud(); resolveMe(); route(true);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
window.__rehab = { TEAM, S, putRecord, setStatus, db: () => db, fb: () => fb, tdoc, saveMember, deleteMember, recStatus, roomCls, evalVital, rehabCheck, entryTime, th, cdLeft, faceBoard, idKey, normId };
})();
