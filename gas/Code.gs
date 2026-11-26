/**
 * REHAB 氣瓶管制系統 — 試算表 ↔ Firebase 同步（Google Apps Script）
 * 作用：
 *  1) 每 5 分鐘把「名冊」分頁同步到雲端（App 掃 QR／輸入臂章就會自動帶入分隊別、職稱、姓名）
 *  2) 每 5 分鐘把雲端的氣瓶紀錄、生命徵象鏡像回「氣瓶紀錄」「生命徵象」分頁（近 14 天）
 * 安裝（只要一次）：
 *  A. 試算表 → 擴充功能 → Apps Script → 貼上本檔全部內容 → 儲存
 *  B. 左側齒輪「專案設定」→ 指令碼屬性 → 新增屬性 DEV_PASSWORD = 系統開發者密碼（只存在你的 Google 帳號）
 *  C. 上方函式選 setup → 執行 → 依畫面授權（「Google 尚未驗證」→ 進階 → 前往）
 * 本檔不含任何密碼；FIREBASE_API_KEY 是公開的網頁識別碼，安全性由 Firestore 規則控管。
 * 名冊欄位：臂章號碼、分隊別、職稱、姓名、義消證號（只有名冊內的號碼能登入 App）。
 */
var PROJECT = 'taichung-fire-rehab';
var FIREBASE_API_KEY = 'AIzaSyCNIdDfPxRyTN4Su4b-Sl54dYif-vdNlLA';
var TEAM = 'taichung';
var DAYS = 14;
var BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
var HEAD_C = ['紀錄ID', '上傳時間', '日期', '案件地點', '臂章號碼', '分隊別', '職稱', '姓名', '第幾支', '火場面別', '組別', '入室', '進入時間(自動)', '離場時間', '工作分鐘', '用氣量bar', 'REHAB開始', '狀態', '填寫人'];
var HEAD_V = ['紀錄ID', '上傳時間', '日期', '案件地點', '臂章號碼', '姓名', '量測時間', '收縮壓', '舒張壓', '脈搏', '血氧SpO2', '體溫', 'SpCO', '其他備註', '判定', '異常項目', '填寫人'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('REHAB').addItem('立即同步', 'syncAll').addItem('初次安裝 / 重新安裝', 'setup').addToUi();
}

function setup() {
  if (!prop_('DEV_PASSWORD')) throw new Error('請先在「專案設定 → 指令碼屬性」新增 DEV_PASSWORD（系統開發者密碼）');
  var t = token_(); devLogin_(t);
  ScriptApp.getProjectTriggers().forEach(function (tr) { if (tr.getHandlerFunction() === 'syncAll') ScriptApp.deleteTrigger(tr); });
  ScriptApp.newTrigger('syncAll').timeBased().everyMinutes(5).create();
  syncAll();
  SpreadsheetApp.getActive().toast('REHAB 同步已安裝，每 5 分鐘自動同步', 'REHAB', 8);
}

function syncAll() { var t = token_(); devLogin_(t); syncRoster_(t); mirror_(t); }

/* ---- 驗證：匿名帳號＋開發者密碼（雜湊比對在 Firestore 規則內） ---- */
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function setProp_(k, v) { PropertiesService.getScriptProperties().setProperty(k, v); }
function hex_(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8).map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }
function normId_(s) { return String(s || '').replace(/\s+/g, '').toUpperCase(); }
function idKey_(id) { return hex_('rehab-id-v1:' + TEAM + ':' + normId_(id)); }
function token_() {
  var rt = prop_('FB_REFRESH'), j;
  if (rt) {
    j = JSON.parse(UrlFetchApp.fetch('https://securetoken.googleapis.com/v1/token?key=' + FIREBASE_API_KEY, { method: 'post', payload: { grant_type: 'refresh_token', refresh_token: rt }, muteHttpExceptions: true }).getContentText());
    if (j.id_token) return { idToken: j.id_token, uid: j.user_id };
  }
  j = JSON.parse(UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + FIREBASE_API_KEY, { method: 'post', contentType: 'application/json', payload: JSON.stringify({ returnSecureToken: true }) }).getContentText());
  setProp_('FB_REFRESH', j.refreshToken); setProp_('FB_DEV', '');
  return { idToken: j.idToken, uid: j.localId };
}
function docName_(path) { return 'projects/' + PROJECT + '/databases/(default)/documents/teams/' + TEAM + '/' + path; }
function commit_(t, writes) { return api_(t, 'post', 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents:commit', { writes: writes }); }
function devLogin_(t) {
  if (prop_('FB_DEV') === t.uid) return;
  var proof = hex_('rehab-dev-v1:' + prop_('DEV_PASSWORD'));
  var g = UrlFetchApp.fetch(BASE + '/teams/' + TEAM + '/guard/' + t.uid, { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + t.idToken } });
  var n = 1; if (g.getResponseCode() === 200) { var gd = JSON.parse(g.getContentText()).fields || {}; var old = Number((gd.n || {}).integerValue || 0); n = old < 5 ? old + 1 : 1; }
  commit_(t, [{ update: { name: docName_('guard/' + t.uid), fields: { n: { integerValue: String(n) }, k: { stringValue: proof } } }, updateTransforms: [{ fieldPath: 't', setToServerValue: 'REQUEST_TIME' }] }]);
  var r = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents:commit', { method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + t.idToken },
    payload: JSON.stringify({ writes: [{ update: { name: docName_('devs/' + t.uid), fields: { proof: { stringValue: proof } } }, updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }], currentDocument: { exists: false } }] }) });
  if (r.getResponseCode() !== 200 && r.getContentText().indexOf('ALREADY_EXISTS') < 0) throw new Error('開發者登入失敗（密碼錯誤或嘗試太多次）：' + r.getContentText().slice(0, 200));
  setProp_('FB_DEV', t.uid);
}
function api_(t, method, path, body) {
  var r = UrlFetchApp.fetch(path.indexOf('http') === 0 ? path : BASE + path, { method: method, contentType: 'application/json', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + t.idToken }, payload: body ? JSON.stringify(body) : null });
  if (r.getResponseCode() >= 300) throw new Error(method + ' ' + path + ' → ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 300));
  return JSON.parse(r.getContentText() || '{}');
}

/* ---- 名冊 → 雲端 ---- */
function syncRoster_(t) {
  var sh = SpreadsheetApp.getActive().getSheetByName('名冊'); if (!sh) return;
  var v = sh.getDataRange().getDisplayValues(); var h = v[0];
  var col = function (n) { for (var i = 0; i < h.length; i++) if (String(h[i]).indexOf(n) >= 0) return i; return -1; };
  var iI = col('臂章'), iU = col('分隊'), iT = col('職稱'), iN = col('姓名'), iV = col('義消'); if (iI < 0) throw new Error('名冊第一列需要「臂章號碼」');
  var want = {}, keysWant = {}, writes = [], seen = {};
  for (var r = 1; r < v.length; r++) {
    var vid = iV >= 0 ? String(v[r][iV]).trim() : '';
    var id = String(v[r][iI]).trim() || vid; if (!id) continue; // 義消沒有臂章號碼時，用義消證號當識別
    var docId = encodeURIComponent(normId_(id)); if (want[docId]) continue; want[docId] = 1;
    writes.push({ update: { name: docName_('roster/' + docId), fields: { id: { stringValue: id }, vid: { stringValue: vid }, unit: { stringValue: iU >= 0 ? String(v[r][iU]).trim() : '' }, title: { stringValue: iT >= 0 ? String(v[r][iT]).trim() : '' }, name: { stringValue: iN >= 0 ? String(v[r][iN]).trim() : '' }, src: { stringValue: 'sheet' }, at: { integerValue: String(Date.now()) } } } });
    [id].concat(vid ? [vid] : []).forEach(function (x) { var k = idKey_(x); if (seen[k]) return; seen[k] = 1; keysWant[k] = 1; writes.push({ update: { name: docName_('rosterKeys/' + k), fields: { r: { stringValue: docId }, src: { stringValue: 'sheet' } } } }); });
  }
  // 試算表刪掉的人（只處理來源是試算表的，App 內新增的保留）
  var pageToken = '';
  do { var res = api_(t, 'get', '/teams/' + TEAM + '/roster?pageSize=300' + (pageToken ? '&pageToken=' + pageToken : ''));
    (res.documents || []).forEach(function (d) { var docId = d.name.split('/').pop(); var f = d.fields || {};
      if (want[docId] || ((f.src || {}).stringValue !== 'sheet')) return;
      writes.push({ delete: d.name });
      [(f.id || {}).stringValue, (f.vid || {}).stringValue].forEach(function (x) { if (!x) return; var k = idKey_(x); if (!keysWant[k] && !seen['d' + k]) { seen['d' + k] = 1; writes.push({ delete: docName_('rosterKeys/' + k) }); } }); });
    pageToken = res.nextPageToken || ''; } while (pageToken);
  for (var i = 0; i < writes.length; i += 400) commit_(t, writes.slice(i, i + 400));
}

/* ---- 雲端 → 試算表（鏡像，近 DAYS 天） ---- */
function val_(x) {
  if (!x) return null; if ('stringValue' in x) return x.stringValue; if ('integerValue' in x) return Number(x.integerValue); if ('doubleValue' in x) return x.doubleValue;
  if ('booleanValue' in x) return x.booleanValue; if ('nullValue' in x) return null;
  if ('arrayValue' in x) return (x.arrayValue.values || []).map(val_);
  if ('mapValue' in x) { var o = {}, f = x.mapValue.fields || {}; for (var k in f) o[k] = val_(f[k]); return o; } return null;
}
function query_(t, coll, cutoff) {
  var res = api_(t, 'post', '/teams/' + TEAM + ':runQuery', { structuredQuery: { from: [{ collectionId: coll }], where: { fieldFilter: { field: { fieldPath: 'date' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: cutoff } } } } });
  return res.filter(function (r) { return r.document; }).map(function (r) { var o = {}, f = r.document.fields || {}; for (var k in f) o[k] = val_(f[k]); return o; });
}
function entry_(c) { var m = /^(\d{1,2}):(\d{2})/.exec(c.exit || ''); var w = Number(c.work); if (!m || isNaN(w)) return ''; var x = ((Number(m[1]) * 60 + Number(m[2]) - w) % 1440 + 1440) % 1440; return ('0' + Math.floor(x / 60)).slice(-2) + ':' + ('0' + (x % 60)).slice(-2); }
function by_(b) { return b ? ((b.title || '') + ' ' + (b.name || b.id || '')).trim() : ''; }
function mirror_(t) {
  var d = new Date(); d.setDate(d.getDate() - DAYS); var cutoff = Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd');
  var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm');
  var recs = query_(t, 'records', cutoff), vit = query_(t, 'vitals', cutoff);
  var rowsC = [], rowsV = [];
  recs.forEach(function (r) { (r.cylinders || []).forEach(function (c, i) {
    rowsC.push([r.id + '-C' + (i + 1), now, r.date, r.address, r.memberId, r.unit, r.title, r.name, i + 1, c.face, c.group, String(c.inAt || '').slice(11, 19), entry_(c), c.exit, c.work, c.gas, r.rehabAt || '', r.closed ? '已歸隊' : (r.rehabAt ? 'REHAB' : (c.inAt && !c.exit ? '入室中' : '待命')), by_(c.by)]); }); });
  vit.forEach(function (v) { rowsV.push([v.id, now, v.date, v.address, v.memberId, v.name, String(v.time || '').replace('T', ' '), v.sbp, v.dbp, v.hr, v.spo2, v.temp, v.spco, v.note, v.level === 'red' ? '紅色警戒' : v.level === 'amber' ? '注意' : '正常', v.flags, by_(v.by)]); });
  upsert_('氣瓶紀錄', HEAD_C, rowsC); upsert_('生命徵象', HEAD_V, rowsV);
}
function upsert_(name, head, rows) {
  var ss = SpreadsheetApp.getActive(); var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.getRange(1, 1, 1, head.length).setValues([head]); sh.setFrozenRows(1);
  var last = sh.getLastRow(); var ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getDisplayValues().map(function (x) { return x[0]; }) : [];
  var appendRows = [];
  rows.forEach(function (r) { r = r.map(function (x) { return x == null ? '' : String(x); }); var i = ids.indexOf(r[0]);
    if (i >= 0) sh.getRange(i + 2, 1, 1, r.length).setNumberFormat('@').setValues([r]); else appendRows.push(r); });
  if (appendRows.length) sh.getRange(sh.getLastRow() + 1, 1, appendRows.length, head.length).setNumberFormat('@').setValues(appendRows);
}
