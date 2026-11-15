# 英雄聯盟賓果（多人連線版）

手機優先的多人連線賓果遊戲，全部使用繁體中文介面。

- 前端：Vue 3、Vite、TypeScript。
- 即時連線：Socket.IO，跑在 Vercel Functions 的原生 WebSocket 上。
- 共享狀態：存在 Upstash Redis；跨 instance 廣播用 `@socket.io/redis-adapter`。

英雄資料只有一個來源：`shared/champions.json`。它和上一層資料夾的 `champions.json` 是同一份檔案，內容沒有改動。

---

## 本機開發

需要 Node.js 22 以上。

```bash
npm install
npm run dev
```

- 前端：http://localhost:5173
- `npm run dev` 會同時啟動兩個服務：
  - Vite（前端）
  - `server/dev.ts`（Socket.IO 伺服器，port 3001；Vite 會把 `/api/socket-io` 轉給它）
- 沒有設定 `REDIS_URL` 時，伺服器改用記憶體存房間，適合單機測試。
- 想在本機連真的 Redis：把 `.env.example` 複製成 `.env.local`，填入 `REDIS_URL`。

**用兩個分頁測試連線**：同一個瀏覽器的分頁會共用 localStorage，兩個分頁會被當成同一位玩家。所以請用以下其中一種方式開第二位玩家：
- 一般視窗加一個無痕視窗
- 兩個不同的瀏覽器
- 同一個 Wi-Fi 的手機：打開終端機顯示的 `Network:` 網址

### 其他指令

| 指令 | 用途 |
|---|---|
| `npm test` | Vitest 單元測試與整合測試 |
| `npm run typecheck` | 前後端型別檢查 |
| `npm run build` | 建置前端到 `dist/` |
| `npm run images` | 重新下載英雄圖片到 `public/champions/`（加 `-- --force` 會全部重抓） |

---

## 建立 Upstash Redis（透過 Vercel Marketplace）

1. 打開 Vercel Dashboard，進入你的專案，點 **Storage** 分頁，再點 **Create Database**。
2. 選 **Upstash** 的 **Redis**，選一個離玩家近的區域（例如 `ap-northeast-1` 東京），方案選 Free。
3. 把資料庫連結（Connect）到這個專案，Development、Preview、Production 三個環境都要勾。
4. 連結後，Vercel 會自動加入環境變數。這個專案會讀 `REDIS_URL`，沒有的話改讀 `KV_URL`，兩者都要是 `rediss://` 開頭的 **TCP 連線字串**。
   - 如果環境變數裡只有 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`（REST 版本），請到 Upstash Console 的資料庫頁面複製 **Redis URL（`rediss://default:密碼@xxx.upstash.io:6379`）**，然後在 Vercel 的 **Settings → Environment Variables** 手動新增 `REDIS_URL`。
   - 需要 TCP 連線的原因：Socket.IO 的 Redis adapter 要用 pub/sub，REST API 做不到。

> 金鑰只放在 Vercel 環境變數裡，前端程式碼不會讀到任何 Redis 資訊。

### Redis key 設計

`{房號}` 是 Redis hash tag，同一房間的 key 會落在同一個 slot。

| Key | 型別 | 內容 |
|---|---|---|
| `bingo:room:{房號}` | hash | `v`（版本）、`hostId`、`target`、`freeCenter`、`round`、`seq`… |
| `bingo:room:{房號}:players` | hash | playerId → 暱稱、張數、加入順序、密鑰雜湊 |
| `bingo:room:{房號}:boards` | hash | playerId → 盤面 JSON |
| `bingo:room:{房號}:calls` | zset | 英雄名（score＝喊叫順序） |
| `bingo:room:{房號}:callers` | hash | 英雄名 → 誰喊的 |
| `bingo:room:{房號}:bingo` | hash | 已 BINGO 的玩家 |
| `bingo:room:{房號}:seen` | hash | 在線心跳時間 |
| `bingo:sio*` | pub/sub | Socket.IO 跨 instance 廣播頻道 |

- 每次寫入，所有 key 的 TTL 都會重設為 6 小時，所以 6 小時沒動靜的房間會自動消失。
- 寫入用 Lua 腳本比對版本號，衝突時會自動重試，多人同時喊也不會互相蓋掉。

---

## 部署到 Vercel

```bash
npm i -g vercel        # 第一次才需要
vercel login
vercel link            # 連結或建立 Vercel 專案
vercel env pull .env.local   # （選擇性）把 REDIS_URL 拉到本機
vercel                 # 部署 Preview
vercel --prod          # 部署 Production
```

- `vercel.json` 已經設定好：
  - 框架：Vite
  - 函式 `api/socket-io.ts` 的 `maxDuration: 300`（免費方案的上限）
  - 把 `/api/socket-io/*` 改寫到這支函式
- 前端連線路徑是 `/api/socket-io/socket.io`，只使用 `websocket` transport（Vercel 不支援 long-polling 長連線）。
- 需要開啟 **Fluid Compute**。2025-04-23 之後建立的專案預設已開；舊專案請到 Settings → Functions 打開後重新部署。

### 免費方案的連線行為

- 每條 WebSocket 連線最多活 300 秒，到時間會被切斷。前端會自動重連，並用 localStorage 裡的 `playerId`、`secret` 和房號回到原房間，恢復盤面與已喊清單。畫面上只會短暫出現「重新連線中…」。
- 重連後可能連到另一台 instance。房間狀態都在 Redis，所以沒有影響。
- 在線判定：每台 instance 每 15 秒幫自己身上的連線寫一次心跳；45 秒內有心跳就算在線。
- 房主離線超過 60 秒，房主會交給下一位在線玩家（依加入順序）。檢查每 15 秒做一次，所以實際交接會發生在離線後 60–75 秒之間。

---

## 事件一覽（`shared/protocol.ts`）

**玩家 → 伺服器**：每個事件都會收到回覆 `{ ok: true, ... }` 或 `{ ok: false, code, message }`。

| 事件 | 資料 |
|---|---|
| `room:create` | `{ nick }` → 回傳 `{ roomCode, playerId, secret, state, boards }` |
| `room:join` | `{ roomCode, nick, playerId?, secret? }` |
| `room:resume` | `{ roomCode, playerId, secret }` |
| `room:leave` | `{}` |
| `boards:setCount` | `{ count: 1 \| 2 \| 4 \| 6 }` |
| `call:add` / `call:remove` | `{ champion }` |
| `settings:update` | `{ target?: 1–10, freeCenter?: boolean }`（只有房主能用） |
| `round:new` | `{}`（只有房主能用） |

**伺服器 → 玩家**

| 事件 | 資料 |
|---|---|
| `room:state` | 全房共用狀態：設定、已喊清單、玩家（條數、BINGO、在線、房主） |
| `me:boards` | 只傳給自己的盤面 |
| `bingo:announce` | 有人剛達成 BINGO |

### 伺服器端驗證

- 英雄必須在 champions.json 內。
- 暱稱 1–12 字，不可含控制字元或零寬字元。
- 房號必須是 6 碼，只用 `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`。
- 只有房主能改設定。
- 每條連線限制連發 10 次，之後每秒回補 5 次。
- 一個房間最多 20 人。
- 盤面、連線數、BINGO 一律由伺服器產生與計算。前端只用同一支函式決定格子要顯示成哪種樣式。

---

## 檔案結構

```
api/socket-io.ts        Vercel Function（default export http.Server）
server/
  io.ts                 Socket.IO 事件處理、心跳、房主交接
  game.ts               房間純邏輯（喊叫、BINGO 判定、交接）
  store/                Redis 與記憶體兩種實作
  runtime.ts            依環境變數選擇 store 與 adapter
  dev.ts                本機開發伺服器
shared/                 前後端共用：英雄資料、盤面與連線計算、驗證、事件型別
src/                    Vue 前端
public/champions/       173 張英雄頭像（webp，共約 1MB）
scripts/                下載英雄圖片的腳本
tests/                  Vitest
```

## 英雄圖片

- 圖片來自 Riot Data Dragon，和官網英雄頁用的是同一個來源，使用的是方形 tile 圖。
- 用 `npm run images` 下載並縮成 200×200 的 webp，跟網站一起部署，執行時不會連到外部 CDN。
- 遊戲改版新增英雄時，請先更新 `champions.json`，再跑一次 `npm run images`。
- 本站是依 Riot Games 粉絲作品政策製作的非官方、非營利作品，頁尾附有聲明。
