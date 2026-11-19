# 生活APP 專案說明（給 Claude）

> 最後更新：2026-11-19。舊版說明改名為 `CLAUDE_舊.md`（規劃階段寫的，已過時，只留紀錄）。
> 2026-11-19 起主要改用 Codex 開發，Codex 讀 `AGENTS.md`；兩份規則相同，改規則時**兩份一起改**。
> **開工前先讀 `docs/交接清單.md`**（目前狀況、待辦、系統怎麼運作、開發注意事項）。

一系列生活小 APP（網頁版），都已上線：🏠 綜合首頁、💧 喝水、🩺 健康、🚽 排便、💰 記帳（<https://jennychengelf.github.io/life-app/>）。專案位置 `D:\Project\life-app`。資料存在使用者自己的 Google 試算表；程式碼放**公開** GitHub，推送到 main 自動部署到 GitHub Pages。

## 絕對不可以

- **不可把個人資料放進儲存庫**：匯入資料、試算表內容、帳號密碼、`.env.local`。`規劃.md`、`docs/` 含個人生活資訊，已在 `.gitignore`，**不要 commit、不要改 .gitignore 把它們加回來**。
- 不要自己 commit / push，使用者說「commit 並推上去」才做（推上去 = 直接上線）。

## 和使用者討論的方式（使用者要求）

- 使用**繁體中文**；用一般人看得懂的話，少用術語
- **一次只討論一個 APP / 一個功能**，不要分散到其他主題；相關但不屬於目前主題的問題記為「⏸ 待討論」
- 使用者的想法若有問題或衝突，**先提出來一起討論，不要直接寫進文件或程式**；有選項時給建議和具體例子（實際金額、店家）
- 使用者說「可以先討論」「不一定要改程式」時，只討論、不改程式
- 文件中清楚區分：✅ 已確認（使用者決定）、💡 暫定（AI 建議）、⏸ 待討論、⏳ 之後包成手機 APP 時才處理（網頁版不適用）
- 每輪確認後就更新對應文件（`規劃.md`、`docs/*.md`），決定寫上日期
- 程式裡重要的規則旁邊用註解寫「（YYYY-MM-DD 使用者決定：…）」

## 文件

- `規劃.md`：總覽、決策狀態、各 APP 功能；第 0 節是進度
- `docs/交接清單.md`：現況整理（從這裡開始）
- `docs/架構.md`、`docs/資料庫.md`（資料表欄位）、`docs/連動.md`（APP 之間的連動）
- `docs/參考_APP_SPEC_v0.3.md`：參考用，不是正式決定

## 開發

- pnpm monorepo：`apps/{hub,water,health,bowel,money}`、`packages/db`（資料、規則、測試）、`packages/ui`（共用樣式、圖示、時間軸）
- `pnpm test`、`pnpm typecheck`、`pnpm build`；改完三個都要過（部署前也會跑測試）
- 本機：`pnpm dev:hub|dev|dev:health|dev:bowel|dev:money`（port 5172 / 5173 / 5174 / 5175 / 5176），網址加 `?local` = 本機測試模式
- Windows 環境：Python 用 `py -X utf8 <檔案>`（`python` 是商店空殼）；沒有 `gh`
- commit 訊息用中文，一行說清楚改了什麼
