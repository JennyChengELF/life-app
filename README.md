# life-app

一系列生活小 APP（網頁版），資料存在使用者自己的 Google 試算表。目前有：🏠 綜合首頁、💧 喝水、🩺 健康（身體量測、血壓、血糖、體溫、健檢、偶爾量測）、💩 廁所大事。

## 開發

```bash
pnpm install
pnpm dev:hub    # 綜合首頁 http://localhost:5172
pnpm dev        # 喝水 http://localhost:5173
pnpm dev:health # 健康 http://localhost:5174
pnpm dev:bowel  # 廁所大事 http://localhost:5175
pnpm test
```

- 網址加 `?local` 可強制用本機測試模式
- 沒有設定 `apps/*/.env.local` 的 `VITE_GOOGLE_CLIENT_ID` 時，是**本機測試模式**（資料只存在瀏覽器）
- 設定後改用 Google 試算表；權限只要求 `drive.file`（只能存取 APP 自己建立的檔案）

## 結構

- `packages/db`：資料存取（Google 試算表 / 本機測試）、資料表定義、喝水 / 健康 / 廁所大事規則
- `packages/ui`：共用樣式
- `apps/hub`：綜合首頁（目前只有進入各 APP 的按鈕）
- `apps/water`：喝水 APP
- `apps/health`：健康 APP
- `apps/bowel`：廁所大事 APP
