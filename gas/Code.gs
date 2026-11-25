/**
 * REHAB 氣瓶管制系統 — Google Apps Script 後端
 * 用法：在「REHAB 氣瓶管制系統 資料表」試算表 → 擴充功能 → Apps Script，貼上本檔全部內容。
 * 部署：部署 → 新增部署作業 → 類型「網頁應用程式」→ 執行身分「我」→ 存取權「所有人」→ 部署，複製 /exec 網址。
 * （選用）隊碼：專案設定 → 指令碼屬性 → 新增 ACCESS_KEY = 你自訂的隊碼；App 設定頁填同一組隊碼。本檔不含任何密碼。
 */
var TABS = {
  '名冊': ['臂章號碼', '分隊別', '職稱', '姓名'],
  '氣瓶紀錄': ['紀錄ID', '上傳時間', '日期', '案件地址', '臂章號碼', '分隊別', '職稱', '姓名', '氣瓶第幾支', '用氣量', '用氣單位', '開始時間', '結束時間', '使用分鐘', 'REHAB觸發', '備註'],
  '生命徵象': ['紀錄ID', '上傳時間', '日期', '案件地址', '臂章號碼', '姓名', '量測時間', '收縮壓', '舒張壓', '脈搏', '血氧SpO2', '體溫', 'SpCO', '其他備註', '判定', '異常項目']
};

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function checkKey_(k) {
  var need = PropertiesService.getScriptProperties().getProperty('ACCESS_KEY');
  return !need || String(k || '') === need;
}
function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); }
  if (sh.getLastRow() === 0) { sh.appendRow(TABS[name]); sh.setFrozenRows(1); }
  return sh;
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!checkKey_(p.key)) return json_({ ok: false, error: '隊碼錯誤' });
  if (p.action === 'roster') {
    var v = sheet_('名冊').getDataRange().getDisplayValues();
    return json_({ ok: true, rows: v });
  }
  return json_({ ok: true, msg: 'REHAB API 運作中' });
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'JSON 格式錯誤' }); }
  if (!checkKey_(body.key)) return json_({ ok: false, error: '隊碼錯誤' });
  if (body.action !== 'upsert') return json_({ ok: false, error: '未知動作' });
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var rows = body.rows || [], n = 0, cache = {};
    rows.forEach(function (r) {
      if (!TABS[r.sheet] || r.sheet === '名冊') return;
      var sh = sheet_(r.sheet);
      if (!cache[r.sheet]) {
        var last = sh.getLastRow();
        var ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getDisplayValues().map(function (x) { return x[0]; }) : [];
        cache[r.sheet] = { sh: sh, ids: ids };
      }
      var c = cache[r.sheet];
      var row = r.row.slice(0, TABS[r.sheet].length).map(function (x) { return x == null ? '' : String(x); });
      while (row.length < TABS[r.sheet].length) row.push('');
      var i = c.ids.indexOf(String(r.id));
      if (i >= 0) { c.sh.getRange(i + 2, 1, 1, row.length).setNumberFormat('@').setValues([row]); }
      else { var at = c.sh.getLastRow() + 1; c.sh.getRange(at, 1, 1, row.length).setNumberFormat('@').setValues([row]); c.ids.push(String(r.id)); }
      n++;
    });
    return json_({ ok: true, saved: n });
  } finally { lock.releaseLock(); }
}
