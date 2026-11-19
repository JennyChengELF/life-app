# 生活APP 專案說明（給 Codex）

> 2026-11-19 從 Claude Code 改用 Codex 開發。**開工前先讀 `docs/交接清單.md`**（目前狀況、待辦、開發注意事項）。
> `CLAUDE.md` 是給 Claude 的說明，規則和這份相同；改規則時兩份一起改（`CLAUDE_舊.md` 是規劃階段的舊版，已過時）。

一系列生活小 APP（網頁版）：🏠 綜合首頁、💧 喝水、🩺 健康、🚽 排便、💰 記帳。資料存在使用者自己的 Google 試算表；程式碼放**公開** GitHub，推送到 main 自動部署到 GitHub Pages。

## 絕對不可以

- **不可把個人資料放進儲存庫**：匯入資料、試算表內容、帳號密碼、`.env.local`。`規劃.md`、`docs/` 含個人生活資訊，已在 `.gitignore`，**不要 commit、不要改 .gitignore 把它們加回來**。
- 不要自己 commit / push，使用者說「commit 並推上去」才做（推上去 = 直接上線）。

## 和使用者討論的方式（使用者要求）

- 使用**繁體中文**；用一般人看得懂的話，少用術語（使用者不是工程師）
- **一次只討論一個 APP / 一個功能**，不要分散到其他主題；相關但不屬於目前主題的問題記為「⏸ 待討論」
- 使用者的想法若有問題或衝突，**先提出來一起討論，不要直接寫進文件或程式**；有選項時給建議和例子
- 使用者說「可以先討論」「不一定要改程式」時，只討論、不改程式
- 文件中清楚區分：✅ 已確認（使用者決定）、💡 暫定（AI 建議）、⏸ 待討論、⏳ 之後包成手機 APP 時才處理
- 每輪確認後就更新對應文件（`規劃.md`、`docs/*.md`），決定寫上日期
- 程式裡重要的規則旁邊用註解寫「（YYYY-MM-DD 使用者決定：…）」，之後才知道為什麼這樣做

## 文件

- `規劃.md`：總覽、決策狀態、各 APP 功能；第 0 節是進度
- `docs/交接清單.md`：交接時的現況整理（從這裡開始）
- `docs/架構.md`、`docs/資料庫.md`（資料表欄位）、`docs/連動.md`（APP 之間的連動）
- `docs/參考_APP_SPEC_v0.3.md`：參考用，不是正式決定

## 開發

- pnpm monorepo：`apps/{hub,water,health,bowel,money}`、`packages/db`（資料、規則、測試）、`packages/ui`（共用樣式、圖示、時間軸）
- `pnpm install`、`pnpm test`（vitest）、`pnpm typecheck`、`pnpm build`；改完三個都要過
- 本機開發：`pnpm dev:hub|dev|dev:health|dev:bowel|dev:money`（port 5172 / 5173 / 5174 / 5175 / 5176），網址加 `?local` = 本機測試模式（資料存在瀏覽器）
- Windows 環境；commit 訊息用中文，一行說清楚改了什麼
