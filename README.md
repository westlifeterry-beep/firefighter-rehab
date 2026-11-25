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

## 架構（v3）
- 前端：GitHub Pages 靜態網頁（手機優先，可加到主畫面，離線可開）。
- 即時同步：Firebase 專案 `taichung-fire-rehab`（免費 Spark 方案，Firestore 台灣 asia-east1），規則見 `firebase/firestore.rules.template`。
- **登入＝名冊身分**：輸入名冊內的「臂章號碼」或「義消證號」即可使用，沒有隊碼。
  - 雲端只存號碼的 SHA-256 雜湊（`rosterKeys`，任何人都讀不到）；手機登入時由 Firestore 規則比對雜湊是否存在才給權限。
  - 從名冊刪除某人 → 他的手機立即失去讀寫權限。
  - 防猜測：每支手機連續嘗試 5 次後鎖定 15 分鐘（規則強制）。
  - 每筆氣瓶／REHAB／生命徵象都記錄「填寫人（職稱＋姓名）」，規則禁止冒用他人身分。
- **系統開發者**：用開發者密碼登入（規則內只存密碼雜湊的雜湊）。只有開發者能改「設定」（REHAB 閾值、入室警示分鐘、網址）與刪除紀錄；名冊所有登入隊員都可編輯。
- Google 試算表：名冊來源；`gas/Code.gs` 每 5 分鐘把名冊（含義消證號）推到雲端，並把氣瓶紀錄／生命徵象（含入室、填寫人）鏡像回試算表（近 14 天）。

## 第一次啟用
1. 名冊工作表欄位：臂章號碼、分隊別、職稱、姓名、義消證號（義消證號可空白）。
2. 試算表 → 擴充功能 → Apps Script → 貼上 `gas/Code.gs` → 儲存。
3. 專案設定 → 指令碼屬性 → 新增 `DEV_PASSWORD` = 系統開發者密碼。
4. 函式選 `setup` → 執行 → 授權（「Google 尚未驗證」→ 進階 → 前往）。完成後名冊同步到雲端、每 5 分鐘自動同步。
5. 隊員手機開 App → 輸入自己的臂章號碼／義消證號 → 登入。

（不用 Apps Script 也可以：開發者在 App 設定頁登入後，用「匯入 CSV」或逐筆新增名冊。）

## 檔案
- `index.html` `app.js` `style.css` `config.js`：前端
- `gas/Code.gs`：試算表 ↔ 雲端同步（Apps Script）
- `firebase/`：Firestore 規則範本（開發者密碼雜湊部署時才填入，不放在公開 repo）
- `sample-roster.csv`：名冊 CSV 範本（假資料）
- `vendor/`：qrcode-generator（MIT）、html5-qrcode（Apache-2.0）、Firebase JS SDK 11（Apache-2.0，打包成單檔）
