# 📘 AI Account Router — Hướng dẫn Kết nối, Triển khai & Sử dụng

> **AI Account Router** là một local proxy server thông minh, quản lý và xoay vòng nhiều API key (tài khoản) AI từ các provider khác nhau (Google Gemini, OpenAI, DeepSeek, Groq, Mistral, và bất kỳ endpoint OpenAI-compatible nào). Router tự động failover, retry, cooldown, và cân bằng tải giữa các credential — giúp tối đa hoá throughput và giảm thiểu lỗi rate-limit.

---

## Mục lục

1. [Tổng quan kiến trúc](#1-tổng-quan-kiến-trúc)
2. [Yêu cầu hệ thống](#2-yêu-cầu-hệ-thống)
3. [Cài đặt](#3-cài-đặt)
4. [Cấu hình](#4-cấu-hình)
5. [Chạy ứng dụng](#5-chạy-ứng-dụng)
6. [Triển khai Production](#6-triển-khai-production)
7. [Kết nối với các AI Client](#7-kết-nối-với-các-ai-client)
8. [Sử dụng Dashboard](#8-sử-dụng-dashboard)
9. [Management API Reference](#9-management-api-reference)
10. [Gateway API Reference](#10-gateway-api-reference)
11. [Chiến lược xoay vòng (Selection Strategies)](#11-chiến-lược-xoay-vòng-selection-strategies)
12. [Hệ thống Cooldown & Retry](#12-hệ-thống-cooldown--retry)
13. [Bảo mật](#13-bảo-mật)
14. [Khắc phục sự cố](#14-khắc-phục-sự-cố)

---

## 1. Tổng quan kiến trúc

```
┌─────────────────────────────────────────────────────────┐
│                    AI Account Router                     │
│                                                          │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────┐ │
│  │   Gateway    │    │  Router Core │    │  Management  │ │
│  │  /v1  (OAI)  │───▶│  Selection   │    │   API /api   │ │
│  │  /v1beta(Gem)│    │  Retry       │    │  (Dashboard) │ │
│  └─────────────┘    │  Failover    │    └─────────────┘ │
│                     │  Cooldown    │                     │
│                     └──────┬───────┘                     │
│                            │                             │
│                   ┌────────┴────────┐                    │
│                   │  Account Pool   │                    │
│                   │  (SQLite + RAM) │                    │
│                   └────────┬────────┘                    │
│                            │                             │
└────────────────────────────┼─────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │  OpenAI  │  │  Gemini  │  │ DeepSeek │  ...
        └──────────┘  └──────────┘  └──────────┘
```

### Thành phần chính

| Thành phần | Mô tả |
|---|---|
| **Gateway** | Endpoint cho CLI/client, tương thích OpenAI (`/v1`) và Gemini (`/v1beta`) |
| **Router Core** | Logic chọn credential, retry, failover, stream commit boundary |
| **Account Pool** | Quản lý credential trong memory, persist qua SQLite. Mã hoá API key AES-256-GCM |
| **Management API** | REST API cho Dashboard: CRUD accounts, settings, logs, metrics |
| **Dashboard** | Giao diện web React + TailwindCSS để quản trị |
| **SQLite DB** | Lưu trữ accounts, cooldowns, request logs, settings |

### Providers được hỗ trợ

| Provider | Protocol | Default Base URL |
|---|---|---|
| **OpenAI** | `openai` | `https://api.openai.com/v1` |
| **Google Gemini** | `gemini` | `https://generativelanguage.googleapis.com/v1beta` |
| **DeepSeek** | `openai` | `https://api.deepseek.com/v1` |
| **Groq** | `openai` | `https://api.groq.com/openai/v1` |
| **Mistral AI** | `openai` | `https://api.mistral.ai/v1` |
| **OpenAI-compatible** | `openai` | *(do user cung cấp)* |

---

## 2. Yêu cầu hệ thống

- **Node.js** ≥ 18.x (khuyến nghị 20+)
- **npm** ≥ 9.x hoặc **bun** (đã có `bun.lock`)
- **Hệ điều hành**: Windows, macOS, Linux
- **RAM**: ~50MB (nhẹ, SQLite in-process)
- **Ổ đĩa**: ~100MB (bao gồm `node_modules`)

---

## 3. Cài đặt

### 3.1. Clone repository

```bash
git clone <repository-url> router_ai
cd router_ai
```

### 3.2. Cài đặt dependencies

```bash
# Dùng npm
npm install

# Hoặc dùng bun (nhanh hơn)
bun install
```

### 3.3. Tạo file cấu hình

```bash
cp .env.example .env
```

> **Lưu ý**: Lần chạy đầu tiên, router tự động tạo:
> - `secret.key` — encryption key cho API keys
> - `local-token` — token xác thực cho client
> - `router.db` — SQLite database
>
> Tất cả nằm trong thư mục `.router-data/` (đã có trong `.gitignore`).

---

## 4. Cấu hình

### 4.1. Biến môi trường (`.env`)

| Biến | Mặc định | Mô tả |
|---|---|---|
| `ROUTER_HOST` | `127.0.0.1` | Địa chỉ IP bind. Đặt `0.0.0.0` để listen trên mọi interface |
| `ROUTER_PORT` | `8787` | Port của router server |
| `ROUTER_PUBLIC_URL` | `http://{host}:{port}` | URL public, override khi dùng tunnel/reverse proxy |
| `ROUTER_LOCAL_TOKEN` | *(tự sinh)* | Token xác thực cho inbound request. Format: `rtr-...` |
| `ROUTER_SECRET` | *(tự sinh)* | Key mã hoá API keys lưu trong DB (AES-256-GCM) |
| `ROUTER_DATA_DIR` | `.router-data` | Thư mục chứa DB, secret key, token |
| `ROUTER_LOG_LEVEL` | `info` | Mức log: `debug`, `info`, `warn`, `error` |
| `ROUTER_LOG_JSON` | *(unset)* | Đặt `true` để log JSON trên TTY |
| `ROUTER_DEV_ORIGIN` | `http://localhost:3000` | CORS origin cho dashboard dev server |

### 4.2. Runtime Settings (thay đổi qua Dashboard hoặc API)

| Setting | Mặc định | Mô tả |
|---|---|---|
| `strategy` | `round_robin` | Thuật toán chọn credential |
| `maxRetryCredentials` | `3` | Số credential thử trước khi fail |
| `requestRetryRounds` | `1` | Số vòng retry qua toàn bộ pool |
| `maxRetryIntervalMs` | `5000` | Thời gian chờ tối đa giữa các round (ms) |
| `cooldownBaseMs` | `1000` | Base cho exponential backoff cooldown (ms) |
| `cooldownMaxMs` | `1800000` | Ceiling cooldown (30 phút) |
| `transientCooldownMs` | `60000` | Cooldown cho lỗi 5xx / network (1 phút) |
| `disableAfterAuthFailures` | `3` | Số lỗi auth liên tiếp trước khi disable credential |
| `maxGlobalConcurrency` | `32` | Giới hạn request đồng thời toàn cục |
| `upstreamTimeoutMs` | `120000` | Timeout connect + first byte (2 phút) |
| `logRetentionDays` | `7` | Số ngày giữ request log |

---

## 5. Chạy ứng dụng

### 5.1. Chế độ Development (khuyến nghị để dev/test)

```bash
npm run dev
```

Lệnh này khởi chạy **đồng thời** 2 process:

| Process | Lệnh | Port | Mô tả |
|---|---|---|---|
| **Router Server** | `tsx watch server/index.ts` | `8787` | API Gateway + Management API, hot-reload |
| **Dashboard (Vite)** | `vite --port=3000` | `3000` | React dashboard, HMR, proxy `/api` → `:8787` |

Truy cập Dashboard: **http://localhost:3000**

### 5.2. Chế độ Production

```bash
# 1. Build dashboard
npm run build

# 2. Chạy server (serve cả API + static dashboard)
npm start
```

Truy cập Dashboard: **http://127.0.0.1:8787** (cùng port với API)

### 5.3. Kiểm tra sức khoẻ

```bash
curl http://127.0.0.1:8787/healthz
# => { "ok": true, "uptimeMs": 12345 }
```

---

## 6. Triển khai Production

### 6.1. Triển khai trực tiếp trên VPS/Server

```bash
# 1. Clone và cài đặt
git clone <repo-url> /opt/router_ai
cd /opt/router_ai
npm ci --production=false
npm run build

# 2. Cấu hình .env
cat > .env << 'EOF'
ROUTER_HOST=0.0.0.0
ROUTER_PORT=8787
ROUTER_PUBLIC_URL=https://router.your-domain.com
ROUTER_LOG_LEVEL=info
EOF

# 3. Chạy bằng systemd
sudo tee /etc/systemd/system/ai-router.service > /dev/null << 'EOF'
[Unit]
Description=AI Account Router
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/router_ai
ExecStart=/usr/bin/node --import tsx server/index.ts
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now ai-router
```

### 6.2. Triển khai bằng Docker

```dockerfile
# Dockerfile
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

ENV ROUTER_HOST=0.0.0.0
ENV ROUTER_PORT=8787
EXPOSE 8787

CMD ["npx", "tsx", "server/index.ts"]
```

```yaml
# docker-compose.yml
services:
  router:
    build: .
    ports:
      - "8787:8787"
    volumes:
      - router-data:/app/.router-data
    environment:
      - ROUTER_PUBLIC_URL=http://your-server:8787
    restart: unless-stopped

volumes:
  router-data:
```

```bash
docker compose up -d
```

### 6.3. Đặt sau Nginx Reverse Proxy

```nginx
server {
    listen 443 ssl http2;
    server_name router.your-domain.com;

    ssl_certificate     /etc/ssl/certs/router.pem;
    ssl_certificate_key /etc/ssl/private/router.key;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # SSE streaming — KHÔNG buffer
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 0;
    }
}
```

> ⚠️ **Quan trọng**: Phải tắt `proxy_buffering` và đặt `proxy_read_timeout 0` để streaming SSE hoạt động đúng.

---

## 7. Kết nối với các AI Client

Sau khi router chạy, terminal sẽ in ra **Local Token** và hướng dẫn kết nối. Dưới đây là cách cấu hình cho từng client:

### 7.1. Antigravity CLI

**File**: `~/.gemini/antigravity-cli/settings.json`
```json
{
  "modelProvider": "gemini"
}
```

**Biến môi trường**:
```bash
export GOOGLE_GEMINI_BASE_URL=http://127.0.0.1:8787
export GEMINI_API_KEY=rtr-<your-local-token>
```

### 7.2. OpenAI SDK (Python)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8787/v1",
    api_key="rtr-<your-local-token>",
)

response = client.chat.completions.create(
    model="gpt-4o",          # hoặc bất kỳ model nào trong pool
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True,
)

for chunk in response:
    print(chunk.choices[0].delta.content or "", end="")
```

### 7.3. OpenAI SDK (Node.js)

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://127.0.0.1:8787/v1",
  apiKey: "rtr-<your-local-token>",
});

const stream = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || "");
}
```

### 7.4. Google Gemini SDK (Python)

```python
import google.generativeai as genai
import os

os.environ["GOOGLE_GEMINI_BASE_URL"] = "http://127.0.0.1:8787"
genai.configure(api_key="rtr-<your-local-token>")

model = genai.GenerativeModel("gemini-2.5-pro")
response = model.generate_content("Xin chào!")
print(response.text)
```

### 7.5. Cline / Roo Code / Continue / Aider

Các tool OpenAI-compatible chỉ cần 2 thông số:

| Trường | Giá trị |
|---|---|
| **Base URL** | `http://127.0.0.1:8787/v1` |
| **API Key** | `rtr-<your-local-token>` |

### 7.6. cURL

```bash
# OpenAI-compatible
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer rtr-<your-local-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# Gemini-compatible
curl "http://127.0.0.1:8787/v1beta/models/gemini-2.5-pro:generateContent?key=rtr-<your-local-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"parts":[{"text":"Hello"}]}]
  }'
```

---

## 8. Sử dụng Dashboard

Dashboard có 4 tab chính:

### 8.1. Tab Accounts — Quản lý tài khoản

- **Thêm Account**: Click nút "Add Account", chọn Provider, nhập API Key
- **Bật/Tắt**: Toggle switch trên mỗi dòng
- **Chỉnh sửa**: Click vào account để mở detail modal
  - Đổi tên, API key, base URL
  - Cấu hình danh sách Models (bỏ trống = accept mọi model)
  - Priority (1 = cao nhất), Weight, Max Concurrent
  - Daily Token Budget (0 = không giới hạn)
  - Tags, Notes
- **Cooldown thủ công**: Đưa credential ra khỏi rotation tạm thời
- **Xoá**: Xoá vĩnh viễn credential

### 8.2. Tab Quota & Metrics — Thống kê

- **Biểu đồ Timeline**: Requests/thời gian, tokens/thời gian
- **Tổng quan**: Total requests, success rate, avg latency, P95 latency
- **Provider Usage**: Phân bổ request theo provider
- **Token Usage**: Prompt tokens vs Completion tokens

### 8.3. Tab Rotation — Xoay vòng

- **Trạng thái realtime** của từng credential: ACTIVE / COOLDOWN / TEMP_ERROR / DISABLED
- **Chọn Strategy**: Round Robin, Least Used, Weighted Priority, Failover Cascade
- **Thông tin serving**: Credential nào đang phục vụ

### 8.4. Tab Logs — Nhật ký request

- **Lịch sử request**: Thời gian, model, outcome, latency, account
- **Chi tiết attempt**: Xem từng lần thử (failover, retry)
- **Filter**: Theo outcome, account
- **Outcome badges**: `success`, `failed`, `cancelled`, `partial_failure`

---

## 9. Management API Reference

> Base: `http://127.0.0.1:8787/api`

### Status & Config

| Method | Path | Mô tả |
|---|---|---|
| `GET` | `/api/status` | Trạng thái pool: active/cooldown/disabled accounts, in-flight, strategy |
| `GET` | `/api/providers` | Danh sách providers hỗ trợ |
| `GET` | `/api/connection` | Thông tin kết nối: base URL + token (dùng cho dashboard) |

### Accounts CRUD

| Method | Path | Mô tả |
|---|---|---|
| `GET` | `/api/accounts` | Liệt kê tất cả accounts |
| `GET` | `/api/accounts/:id` | Chi tiết 1 account |
| `POST` | `/api/accounts` | Tạo account mới |
| `PATCH` | `/api/accounts/:id` | Cập nhật account |
| `DELETE` | `/api/accounts/:id` | Xoá account |

**Tạo account** — `POST /api/accounts`

```json
{
  "name": "Gemini Key #1",
  "provider": "gemini",
  "apiKey": "AIza...",
  "models": ["gemini-2.5-pro", "gemini-2.5-flash"],
  "priority": 1,
  "weight": 50,
  "maxConcurrent": 4,
  "dailyTokenBudget": 0,
  "tags": ["team-a"],
  "notes": "Free-tier key"
}
```

**Cập nhật account** — `PATCH /api/accounts/:id`

```json
{
  "name": "Gemini Key #1 (Updated)",
  "enabled": true,
  "weight": 80,
  "models": ["gemini-2.5-pro"]
}
```

### Cooldown Controls

| Method | Path | Mô tả |
|---|---|---|
| `POST` | `/api/accounts/:id/cooldown` | Đưa credential vào cooldown thủ công |
| `POST` | `/api/accounts/:id/clear-cooldown` | Xoá cooldown cho credential |
| `POST` | `/api/cooldowns/clear` | Xoá mọi cooldown trong pool |

**Cooldown thủ công**:
```json
{
  "durationMs": 120000,
  "reason": "maintenance"
}
```

### Settings

| Method | Path | Mô tả |
|---|---|---|
| `GET` | `/api/settings` | Đọc settings hiện tại |
| `PUT` | `/api/settings` | Cập nhật settings (partial merge) |

### Logs & Metrics

| Method | Path | Query Params | Mô tả |
|---|---|---|---|
| `GET` | `/api/logs` | `limit`, `before`, `outcome`, `accountId` | Lịch sử request |
| `GET` | `/api/metrics` | `window` (ms, mặc định 24h) | Tổng quan metrics |
| `GET` | `/api/metrics/timeline` | `window`, `buckets` (4–168) | Timeline chart data |
| `GET` | `/api/metrics/providers` | `window` | Usage theo provider |

---

## 10. Gateway API Reference

> Base: `http://127.0.0.1:8787`

Gateway chấp nhận token qua **bất kỳ** cách nào sau:

| Cách | Ví dụ |
|---|---|
| `Authorization` header | `Bearer rtr-...` |
| `x-goog-api-key` header | `rtr-...` |
| `x-api-key` header | `rtr-...` |
| Query parameter `key` | `?key=rtr-...` |

### OpenAI-compatible Endpoints

| Method | Path | Mô tả |
|---|---|---|
| `POST` | `/v1/chat/completions` | Chat completion (stream & non-stream) |
| `GET` | `/v1/models` | Liệt kê models từ pool |

### Gemini-compatible Endpoints

| Method | Path | Mô tả |
|---|---|---|
| `POST` | `/v1beta/models/{model}:generateContent` | Non-streaming generation |
| `POST` | `/v1beta/models/{model}:streamGenerateContent` | Streaming generation |
| `GET` | `/v1beta/models` | Liệt kê models từ pool |

> **Lưu ý**: Gateway forward request body **byte-for-byte** — không rewrite payload, tool-call IDs, hay response IDs. Failover chỉ xảy ra giữa các credential **cùng protocol và cùng model**.

---

## 11. Chiến lược xoay vòng (Selection Strategies)

Credential được nhóm theo **priority tier** — tier cao nhất (số nhỏ nhất) được ưu tiên. Trong cùng tier, strategy quyết định:

### `round_robin` (Mặc định)

Lần lượt xoay qua từng credential. Cursor resume theo sorted ID, nên credential tạm offline không làm lệch rotation.

**Phù hợp**: Phân bổ đều tải, mọi key dùng như nhau.

### `least_used`

Chọn credential có ít request in-flight nhất, tiebreak bằng tổng request thấp nhất.

**Phù hợp**: Pool không đồng đều (có key mạnh, key yếu), muốn spread load.

### `weighted_priority`

Smooth weighted round-robin dựa trên `weight` của mỗi credential. Weight 80 nhận gấp đôi traffic so với weight 40.

**Phù hợp**: Key có quota khác nhau, muốn phân bổ tỷ lệ.

### `failover_cascade`

Luôn dùng 1 credential (weight cao nhất), chỉ chuyển khi nó không available.

**Phù hợp**: Primary/backup setup, tối thiểu credential sử dụng.

---

## 12. Hệ thống Cooldown & Retry

### Luồng xử lý request

```
1. Client gửi request → Gateway nhận
2. Router chọn credential (theo strategy)
3. Gửi đến upstream provider
4. Nếu thành công → trả về client
5. Nếu thất bại:
   a. scope = "request" (400/404) → trả lỗi về client, không retry
   b. scope = "client" (disconnect) → dừng, không phạt credential
   c. scope = "credential" (429/5xx) → cooldown credential, thử credential tiếp
6. Hết credential trong round → chờ → round tiếp theo
7. Hết tất cả round → trả lỗi cuối cùng về client
```

### Commit Boundary

Khi stream đã bắt đầu gửi bytes cho client (committed), **không thể failover** nữa — response đã gắn với credential đó. Nếu upstream lỗi giữa stream, router gửi SSE error event và đóng stream.

### Cooldown phân loại

| Error Class | Scope | Cooldown |
|---|---|---|
| `rate_limit` | Per-model | Exponential backoff, respect `Retry-After` header |
| `quota_exhausted` | Per-model | Exponential backoff |
| `auth` | Per-credential | Disable sau N lần liên tiếp |
| `server` (5xx) | Per-credential | Transient cooldown (60s mặc định) |
| `timeout` | Per-credential | Transient cooldown |
| `network` | Per-credential | Transient cooldown |

### Daily Token Budget

Mỗi credential có thể đặt `dailyTokenBudget`. Khi đạt giới hạn, credential bị hold cho đến đầu ngày UTC tiếp theo. Budget reset tự động dựa trên UTC boundary.

---

## 13. Bảo mật

### API Key Encryption

- API keys lưu trong SQLite được **mã hoá AES-256-GCM**
- Encryption key (`ROUTER_SECRET`) tự sinh và lưu tại `.router-data/secret.key` (mode `0600`)
- Nếu đổi `ROUTER_SECRET`, các key cũ không giải mã được → credential hiển thị là disabled

### Local Token

- Mọi inbound request (từ CLI/client) **phải** có token
- Token tự sinh lần đầu, lưu tại `.router-data/local-token`
- So sánh token dùng **timing-safe comparison** (`crypto.timingSafeEqual`)
- Dashboard (Management API) không yêu cầu token (chạy trên loopback)

### Gateway vs Management API

| Aspect | Gateway (`/v1`, `/v1beta`) | Management (`/api`) |
|---|---|---|
| Xác thực | ✅ Bắt buộc local token | ❌ Không yêu cầu |
| Chức năng | Forward request tới provider | CRUD accounts, settings, logs |
| Phạm vi | CLI/AI client | Dashboard only |

> ⚠️ **Khuyến nghị**: Trong production, hạn chế Management API chỉ truy cập từ internal network. Dùng firewall hoặc nginx `allow/deny`.

---

## 14. Khắc phục sự cố

### Router không khởi động

```
Error: Could not find module 'better-sqlite3'
```
→ Chạy lại `npm install` hoặc `npm rebuild better-sqlite3`

### Dashboard trắng (dev mode)

→ Kiểm tra cả 2 process đang chạy: Vite (`:3000`) và Server (`:8787`)
→ Kiểm tra proxy config trong `vite.config.ts`

### Tất cả credential vào cooldown

→ Truy cập Dashboard → Tab Rotation → Click "Clear All Cooldowns"
→ Hoặc: `POST /api/cooldowns/clear`

### Lỗi "no configured credential serves model X"

→ Credential đang cấu hình không khai báo model đó. Thêm model vào danh sách hoặc để trống (accept mọi model).

### Lỗi "stored credential could not be decrypted"

→ `ROUTER_SECRET` đã thay đổi. Nhập lại API key cho credential bị ảnh hưởng qua Dashboard.

### Streaming bị cắt khi dùng reverse proxy

→ Tắt buffering: `proxy_buffering off;`
→ Đặt timeout: `proxy_read_timeout 0;`

### Log quá nhiều / ổ đĩa đầy

→ Giảm `logRetentionDays` trong Settings (mặc định 7 ngày)
→ Logs tự prune mỗi giờ

---

## Phụ lục: Cấu trúc thư mục

```
router_ai/
├── server/                    # Backend
│   ├── index.ts              # Entry point — Express app
│   ├── config.ts             # Boot config từ env
│   ├── core/
│   │   ├── router.ts         # Request routing, retry, failover
│   │   ├── pool.ts           # Credential pool + SQLite persistence
│   │   ├── selector.ts       # Selection strategies
│   │   ├── backoff.ts        # Exponential backoff logic
│   │   ├── concurrency.ts    # Semaphore, sleep
│   │   ├── crypto.ts         # AES-256-GCM encrypt/decrypt
│   │   ├── errors.ts         # Error classification
│   │   ├── stream.ts         # SSE stream handling
│   │   ├── usage.ts          # Token usage extraction
│   │   └── logger.ts         # Structured logging
│   ├── db/
│   │   ├── index.ts          # SQLite schema + connection
│   │   ├── logs.ts           # Request log queries
│   │   └── settings.ts       # Runtime settings store
│   ├── gateway/
│   │   └── index.ts          # OpenAI & Gemini endpoint handlers
│   ├── management/
│   │   └── routes.ts         # Dashboard REST API
│   └── providers/
│       └── registry.ts       # Provider adapters & URL builders
├── src/                       # Frontend (React + Vite)
│   ├── App.tsx               # Main app component
│   ├── main.tsx              # React entry
│   ├── types.ts              # View models
│   ├── api/                  # API client
│   ├── hooks/                # Data hooks (polling)
│   └── components/           # UI components
│       ├── AccountTable.tsx   # Account list
│       ├── AddAccountModal.tsx
│       ├── AccountDetailModal.tsx
│       ├── QuotaCharts.tsx    # Metrics charts
│       ├── RotationView.tsx   # Rotation strategy view
│       ├── LogsView.tsx       # Request logs
│       ├── Navbar.tsx
│       └── Sidebar.tsx
├── shared/
│   └── types.ts              # Shared DTOs (server ↔ client)
├── tests/                     # Vitest test files
├── .router-data/              # Runtime data (gitignored)
│   ├── router.db             # SQLite database
│   ├── secret.key            # Encryption key
│   └── local-token           # Auth token
├── .env.example              # Template cấu hình
├── package.json
├── vite.config.ts
├── tsconfig.json
└── tsconfig.server.json
```

---

## Quick Start (TL;DR)

```bash
# 1. Cài đặt
npm install

# 2. Chạy
npm run dev

# 3. Mở Dashboard → Thêm API key
#    http://localhost:3000

# 4. Copy token từ terminal output, cấu hình client:
#    Base URL: http://127.0.0.1:8787/v1
#    API Key:  rtr-<token-in-terminal>

# 5. Sử dụng như bình thường — router tự xoay vòng!
```
