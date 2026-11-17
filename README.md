# life-app

一系列生活小 APP（網頁版），資料存在使用者自己的 Google 試算表。目前有：💧 喝水。

## 開發

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test
```

- 沒有設定 `apps/water/.env.local` 的 `VITE_GOOGLE_CLIENT_ID` 時，是**本機測試模式**（資料只存在瀏覽器）
- 設定後改用 Google 試算表；權限只要求 `drive.file`（只能存取 APP 自己建立的檔案）

## 結構

- `packages/db`：資料存取（Google 試算表 / 本機測試）、資料表定義、喝水規則
- `apps/water`：喝水 APP
