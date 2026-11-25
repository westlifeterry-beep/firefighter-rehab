# REHAB 氣瓶管制系統（原型）

手機優先的網頁系統：掃描臂章 QR Code 建檔 → 填氣瓶使用情形 → 達條件自動進入 REHAB → 生命徵象監測，超標顯示紅色警戒「建議進入低溫處置流程」。

- 網址：https://westlifeterry-beep.github.io/firefighter-rehab/
- 個人 QR：`https://westlifeterry-beep.github.io/firefighter-rehab/?id=臂章號碼`
- 資料表：「REHAB 氣瓶管制系統 資料表」（名冊／氣瓶紀錄／生命徵象）

## REHAB 判定（設定頁可改）
| 項目 | 預設 | 來源 |
|---|---|---|
| 第 1 支氣瓶 | ≥ 45 分鐘 → REHAB | Terry 指定（EMSer 資料：一支 45／60 分鐘氣瓶） |
| 第 2 支（含以後） | ≥ 30 分鐘 → REHAB | Terry 指定（EMSer：30 分鐘氣瓶用完 2 支） |
| 血壓 | > 160/100 不得離開；SBP < 80 緊急救護 | EMSer 後勤照護簡報 p.4 |
| 脈搏 | 休息 10 分鐘後仍 > 100（未滿 10 分只提示複測） | EMSer 簡報 p.4 |
| SpCO（選填） | > 5% 不得離開；> 15% 高濃度氧氣 | EMSer 簡報 p.4 |
| 體溫 | 持續上升超過 20 分鐘 | EMSer 簡報 p.4 |
| 體溫 | ≥ 38.0°C | 系統預設（NFPA 1584 常用值，EMSer 未給數值） |
| 血氧 SpO2 | < 94% | 系統預設（到院前常用下限，EMSer 未給數值） |
| REHAB 倒數 | 10 分鐘後通知量測 | Terry 指定（EMSer：至少 10–20 分鐘休息） |
| 工作時間預設 | 30 分鐘；進入時間 = 離場 − 工作時間 | Terry 指定 |

低溫處置（降溫）建議：卸裝＋初級除污、前臂與雙手浸泡 10–17°C 冷水、濕毛巾／水冷扇／冰敷、補水電解質、每 5–10 分鐘複測、未恢復不得歸隊，異常立即後送。

> 僅供現場管制參考，不取代救護人員與醫師之專業判斷。

## 架構（v2）
- 前端：GitHub Pages 靜態網頁（手機優先，可加到主畫面，離線可開）。
- 即時同步：Firebase 專案 `taichung-fire-rehab`（免費 Spark 方案，Firestore 台灣 asia-east1）。
  - 匿名登入＋**隊碼**：隊碼存在 `teams/taichung/private/config`，前端永遠讀不到；只有輸入正確隊碼的手機能讀寫（`firebase/firestore.rules`）。
  - 離線：Firestore 離線快取，斷線時照常操作，恢復連線自動上傳。
- Google 試算表：名冊的唯一來源；`gas/Code.gs` 每 5 分鐘把名冊推到雲端，並把氣瓶紀錄／生命徵象鏡像回試算表（近 14 天）。

## 第一次啟用（隊長做一次）
1. 決定全隊隊碼（至少 6 字，不要公開張貼）。
2. 試算表 → 擴充功能 → Apps Script → 貼上 `gas/Code.gs` → 儲存。
3. 專案設定 → 指令碼屬性 → 新增 `TEAM_CODE` = 隊碼。
4. 函式選 `setup` → 執行 → 授權（「Google 尚未驗證」→ 進階 → 前往）。完成後會設定雲端隊碼、同步名冊、每 5 分鐘自動同步。
5. 手機開 App → 設定 → 輸入隊碼 → 加入隊伍；再用「分享加入連結」傳給隊員。

（也可以先在 App 設定頁「第一次使用：設定全隊隊碼」，再把同一組隊碼填進 Apps Script。隊碼設定後無法從手機修改。）

## 檔案
- `index.html` `app.js` `style.css` `config.js`：前端
- `gas/Code.gs`：試算表 ↔ 雲端同步（Apps Script）
- `firebase/`：Firestore 安全規則與設定
- `sample-roster.csv`：名冊 CSV 範本（假資料）
- `vendor/`：qrcode-generator（MIT）、html5-qrcode（Apache-2.0）、Firebase JS SDK 11（Apache-2.0，打包成單檔）
