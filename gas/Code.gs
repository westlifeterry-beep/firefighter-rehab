/**
 * REHAB 氣瓶管制系統 — 試算表 ↔ Firebase 同步（Google Apps Script）
 * 作用：
 *  1) 每 5 分鐘把「名冊」分頁同步到雲端（App 掃 QR／輸入臂章就會自動帶入分隊別、職稱、姓名）
 *  2) 每 5 分鐘把雲端的氣瓶紀錄、生命徵象鏡像回「氣瓶紀錄」「生命徵象」分頁（近 14 天）
 * 安裝（只要一次）：
 *  A. 試算表 → 擴充功能 → Apps Script → 貼上本檔全部內容 → 儲存
 *  B. 左側齒輪「專案設定」→ 指令碼屬性 → 新增屬性 TEAM_CODE = 全隊隊碼（至少 6 字，只存在你的 Google 帳號）
 *  C. 上方函式選 setup → 執行 → 依畫面授權（「Google 尚未驗證」→ 進階 → 前往）
 * 本檔不含任何密碼；FIREBASE_API_KEY 是公開的網頁識別碼，安全性由 Firestore 規則＋隊碼控管。
 */
var PROJECT = 'taichung-fire-rehab';
var FIREBASE_API_KEY = 'AIzaSyCNIdDfPxRyTN4Su4b-Sl54dYif-vdNlLA';
var TEAM = 'taichung';
var DAYS = 14;
var BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
var HEAD_C = ['紀錄ID', '上傳時間', '日期', '案件地點', '臂章號碼', '分隊別', '職稱', '姓名', '第幾支', '火場面別', '組別', '進入時間(自動)', '離場時間', '工作分鐘', '用氣量bar', 'REHAB開始', '狀態'];
var HEAD_V = ['紀錄ID', '上傳時間', '日期', '案件地點', '臂章號碼', '姓名', '量測時間', '收縮壓', '舒張壓', '脈搏', '血氧SpO2', '體溫', 'SpCO', '其他備註', '判定', '異常項目'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('REHAB').addItem('立即同步', 'syncAll').addItem('初次安裝 / 重新安裝', 'setup').addToUi();
}

function setup() {
  var code = prop_('TEAM_CODE');
  if (!code || code.length < 6) throw new Error('請先在「專案設定 → 指令碼屬性」新增 TEAM_CODE（至少 6 字）');
  var t = token_();
  // 第一次：建立隊碼（已存在就略過，雲端隊碼一旦建立無法被修改）
  var r = UrlFetchApp.fetch(BASE + '/teams/' + TEAM + '/private/config?currentDocument.exists=false', {
    method: 'patch', contentType: 'application/json', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + t.idToken },
    payload: JSON.stringify({ fields: { code: { stringValue: code }, createdBy: { stringValue: t.uid }, createdAt: { integerValue: String(Date.now()) } } })
  });
  join_(t);
  ScriptApp.getProjectTriggers().forEach(function (tr) { if (tr.getHandlerFunction() === 'syncAll') ScriptApp.deleteTrigger(tr); });
  ScriptApp.newTrigger('syncAll').timeBased().everyMinutes(5).create();
  syncAll();
  SpreadsheetApp.getActive().toast('REHAB 同步已安裝，每 5 分鐘自動同步', 'REHAB', 8);
}

function syncAll() { var t = token_(); join_(t); syncRoster_(t); mirror_(t); }

/* ---- 驗證：匿名帳號＋隊碼 ---- */
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function setProp_(k, v) { PropertiesService.getScriptProperties().setProperty(k, v); }
function token_() {
  var rt = prop_('FB_REFRESH'), j;
  if (rt) {
    j = JSON.parse(UrlFetchApp.fetch('https://securetoken.googleapis.com/v1/token?key=' + FIREBASE_API_KEY, { method: 'post', payload: { grant_type: 'refresh_token', refresh_token: rt }, muteHttpExceptions: true }).getContentText());
    if (j.id_token) return { idToken: j.id_token, uid: j.user_id };
  }
  j = JSON.parse(UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + FIREBASE_API_KEY, { method: 'post', contentType: 'application/json', payload: JSON.stringify({ returnSecureToken: true }) }).getContentText());
  setProp_('FB_REFRESH', j.refreshToken); setProp_('FB_JOINED', '');
  return { idToken: j.idToken, uid: j.localId };
}
function join_(t) {
  if (prop_('FB_JOINED') === t.uid) return;
  var r = UrlFetchApp.fetch(BASE + '/teams/' + TEAM + '/joins/' + t.uid, {
    method: 'patch', contentType: 'application/json', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + t.idToken },
    payload: JSON.stringify({ fields: { code: { stringValue: prop_('TEAM_CODE') || '' }, at: { integerValue: String(Date.now()) }, device: { stringValue: 'apps-script' } } })
  });
  if (r.getResponseCode() !== 200) throw new Error('加入隊伍失敗（隊碼錯誤？）：' + r.getContentText().slice(0, 200));
  setProp_('FB_JOINED', t.uid);
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
  var iI = col('臂章'), iU = col('分隊'), iT = col('職稱'), iN = col('姓名'); if (iI < 0) throw new Error('名冊第一列需要「臂章號碼」');
  var want = {}, writes = [];
  for (var r = 1; r < v.length; r++) {
    var id = String(v[r][iI]).trim(); if (!id) continue;
    var docId = encodeURIComponent(id); want[docId] = 1;
    writes.push({ update: { name: 'projects/' + PROJECT + '/databases/(default)/documents/teams/' + TEAM + '/roster/' + docId,
      fields: { id: { stringValue: id }, unit: { stringValue: iU >= 0 ? String(v[r][iU]).trim() : '' }, title: { stringValue: iT >= 0 ? String(v[r][iT]).trim() : '' }, name: { stringValue: iN >= 0 ? String(v[r][iN]).trim() : '' }, src: { stringValue: 'sheet' }, at: { integerValue: String(Date.now()) } } } });
  }
  var existing = [], pageToken = '';
  do { var res = api_(t, 'get', '/teams/' + TEAM + '/roster?pageSize=300' + (pageToken ? '&pageToken=' + pageToken : '')); (res.documents || []).forEach(function (d) { existing.push(d.name); }); pageToken = res.nextPageToken || ''; } while (pageToken);
  existing.forEach(function (n) { var docId = n.split('/').pop(); if (!want[docId]) writes.push({ delete: n }); });
  for (var i = 0; i < writes.length; i += 400) api_(t, 'post', 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents:commit', { writes: writes.slice(i, i + 400) });
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
function mirror_(t) {
  var d = new Date(); d.setDate(d.getDate() - DAYS); var cutoff = Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd');
  var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm');
  var recs = query_(t, 'records', cutoff), vit = query_(t, 'vitals', cutoff);
  var rowsC = [], rowsV = [];
  recs.forEach(function (r) { (r.cylinders || []).forEach(function (c, i) {
    rowsC.push([r.id + '-C' + (i + 1), now, r.date, r.address, r.memberId, r.unit, r.title, r.name, i + 1, c.face, c.group, entry_(c), c.exit, c.work, c.gas, r.rehabAt || '', r.closed ? '已歸隊' : (r.rehabAt ? 'REHAB' : '作業/待命')]); }); });
  vit.forEach(function (v) { rowsV.push([v.id, now, v.date, v.address, v.memberId, v.name, String(v.time || '').replace('T', ' '), v.sbp, v.dbp, v.hr, v.spo2, v.temp, v.spco, v.note, v.level === 'red' ? '紅色警戒' : v.level === 'amber' ? '注意' : '正常', v.flags]); });
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
