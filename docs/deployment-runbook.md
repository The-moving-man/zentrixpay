# ZentrixPay Deployment Runbook

This runbook walks through deploying a complete **testnet** instance of ZentrixPay from scratch:

1. A **Postgres** database
2. The **ZentrixPay server** (gateway) on Render or Fly.io
3. The **web app** as a static site

By the end you will have a working gateway that can register providers, proxy paid requests, and settle payments through an x402 facilitator on testnet.

---

## 0. Prerequisites

- A GitHub account with access to the ZentrixPay repository.
- A Postgres provider account (Render Postgres, Neon, Supabase Postgres, etc.).
- A hosting account on **Render** *or* **Fly.io**.
- A static-site host (Render Static Site, Netlify, Vercel, Cloudflare Pages, GitHub Pages).
- A testnet wallet with a small amount of testnet funds for the facilitator/payee address.
- `git`, `node` (>= 20), and `pnpm` (or `npm`) installed locally for migrations and builds.

> **Testnet only.** Never point this runbook at mainnet. All example values below are testnet values.

---

## 1. Provision Postgres

Create a managed Postgres instance on your provider of choice. Note the connection string; it will look like:

```
postgres://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require
```

For testnet, the smallest tier is fine. Enable SSL (most providers do by default).

Save this as `DATABASE_URL`.

---

## 2. Required Environment Variables

The server reads the following variables. All are required unless marked optional.

### Core

| Variable | Description | Testnet example |
| --- | --- | --- |
| `NODE_ENV` | Runtime mode. | `production` |
| `PORT` | Port the server listens on. Most hosts inject this. | `8080` |
| `DATABASE_URL` | Postgres connection string from step 1. | `postgres://...` |
| `JWT_SECRET` | Secret used to sign session/API tokens. Generate with `openssl rand -hex 32`. | *(random 64 hex chars)* |
| `LOG_LEVEL` | Log verbosity (`debug`, `info`, `warn`, `error`). | `info` |

### Chain / Network

| Variable | Description | Testnet example |
| --- | --- | --- |
| `CHAIN_ID` | EVM chain ID of the target network. | `84532` (Base Sepolia) |
| `RPC_URL` | JSON-RPC endpoint for the target chain. | `https://sepolia.base.org` |
| `USDC_ADDRESS` | Address of the testnet USDC (or equivalent) token contract. | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

### x402 Facilitator

| Variable | Description | Testnet example |
| --- | --- | --- |
| `X402_FACILITATOR_URL` | Base URL of the x402 facilitator used to verify/settle payments. | `https://x402.org/facilitator` |
| `X402_NETWORK` | Network identifier passed to the facilitator. | `base-sepolia` |
| `X402_PAYEE_ADDRESS` | Address that receives settled payments. | `0xYourTestnetPayee...` |
| `X402_FACILITATOR_API_KEY` | *(optional)* API key if your facilitator requires one. | *(empty for public testnet facilitator)* |

### Provider Registration / Paid Proxy

| Variable | Description | Testnet example |
| --- | --- | --- |
| `PROVIDER_REGISTRY_ENABLED` | Enable provider registration endpoints. | `true` |
| `PROVIDER_REGISTRATION_TOKEN` | Shared secret required to register a provider. | *(random 32 hex chars)* |
| `PROXY_TIMEOUT_MS` | Upstream request timeout for the paid proxy. | `30000` |
| `PROXY_MAX_BODY_BYTES` | Max request body size accepted by the proxy. | `1048576` |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins for the web app. | `https://your-web-app.example.com` |

### Web App (build-time)

These are consumed by the static web app at build time, not by the server:

| Variable | Description | Testnet example |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Public URL of the deployed server. | `https://zentrixpay-server.onrender.com` |
| `VITE_CHAIN_ID` | Chain ID shown in the UI. | `84532` |
| `VITE_X402_NETWORK` | Network label shown in the UI. | `base-sepolia` |

> Generate secrets with `openssl rand -hex 32`. Never commit them.

---

## 3. Run Migrations

Migrations must be applied before the server starts serving traffic.

### Locally (against the managed DB)

```bash
git clone https://github.com/<your-org>/zentrixpay.git
cd zentrixpay
pnpm install

export DATABASE_URL="postgres://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require"
pnpm run migrate
```

If your repo uses a different script name, check `package.json` for `migrate`, `db:migrate`, or `prisma migrate deploy`.

### On the host

Add the migration command as a **release/pre-deploy command** so it runs on every deploy:

- **Render:** set the *Pre-Deploy Command* to `pnpm run migrate`.
- **Fly.io:** add a `release_command` to `fly.toml` (see step 4).

---

## 4. Deploy the Server

### Option A — Render

1. **New → Web Service**, connect the repo.
2. Settings:
   - **Environment:** Node
   - **Build Command:** `pnpm install && pnpm run build`
   - **Start Command:** `pnpm run start`
   - **Pre-Deploy Command:** `pnpm run migrate`
   - **Health Check Path:** `/health`
3. Add every variable from **Section 2** under *Environment*.
4. Deploy. Render injects `PORT` automatically.

### Option B — Fly.io

1. Install `flyctl` and run `fly launch` in the repo root. Accept the generated `Dockerfile` or point it at your existing one.
2. Edit `fly.toml`:

   ```toml
   app = "zentrixpay-server"
   primary_region = "iad"

   [build]

   [deploy]
     release_command = "pnpm run migrate"

   [env]
     NODE_ENV = "production"
     PORT = "8080"
     CHAIN_ID = "84532"
     RPC_URL = "https://sepolia.base.org"
     X402_NETWORK = "base-sepolia"
     X402_FACILITATOR_URL = "https://x402.org/facilitator"
     PROVIDER_REGISTRY_ENABLED = "true"

   [[services]]
     internal_port = 8080
     protocol = "tcp"

     [[services.ports]]
       handlers = ["http"]
       port = 80

     [[services.ports]]
       handlers = ["tls"]
       port = 443

     [[services.http_checks]]
       interval = "10s"
       timeout = "2s"
       grace_period = "10s"
       method = "get"
       path = "/health"
   ```

3. Set secrets (do **not** put these in `fly.toml`):

   ```bash
   fly secrets set \
     DATABASE_URL="postgres://..." \
     JWT_SECRET="$(openssl rand -hex 32)" \
     PROVIDER_REGISTRATION_TOKEN="$(openssl rand -hex 32)" \
     X402_PAYEE_ADDRESS="0xYourTestnetPayee..." \
     ALLOWED_ORIGINS="https://your-web-app.example.com"
   ```

4. Deploy:

   ```bash
   fly deploy
   ```

---

## 5. Verify the Server

Replace `$BASE` with your server URL (e.g. `https://zentrixpay-server.onrender.com`).

```bash
# 1. Health check
curl -fsS "$BASE/health"

# 2. Register a test provider
curl -fsS -X POST "$BASE/providers" \
  -H "Authorization: Bearer $PROVIDER_REGISTRATION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "name": "echo-testnet",
        "upstreamUrl": "https://httpbin.org",
        "pricePerRequest": "1000"
      }'

# 3. List providers
curl -fsS "$BASE/providers"

# 4. Hit the paid proxy (expect a 402 with payment requirements)
curl -i "$BASE/proxy/echo-testnet/get"
```

A `402 Payment Required` response containing x402 payment instructions confirms the paid proxy and facilitator wiring are correct.

---

## 6. Deploy the Web App (Static Site)

The web app is a static build. Set the `VITE_*` variables from Section 2 at build time.

### Build locally

```bash
cd web
VITE_API_BASE_URL="https://zentrixpay-server.onrender.com" \
VITE_CHAIN_ID="84532" \
VITE_X402_NETWORK="base-sepolia" \
pnpm install && pnpm run build
# output in web/dist
```

### Render Static Site

1. **New → Static Site**, connect the repo.
2. Settings:
   - **Root Directory:** `web`
   - **Build Command:** `pnpm install && pnpm run build`
   - **Publish Directory:** `dist`
3. Add `VITE_API_BASE_URL`, `VITE_CHAIN_ID`, `VITE_X402_NETWORK` under *Environment*.
4. Deploy, then copy the resulting URL into the server's `ALLOWED_ORIGINS` and redeploy the server.

### Netlify / Vercel / Cloudflare Pages

- **Build command:** `pnpm install && pnpm run build`
- **Publish directory:** `web/dist` (or `dist` if root is `web`)
- **Environment variables:** the three `VITE_*` values above.

---

## 7. End-to-End Verification Checklist

Run through this list against the deployed testnet instance:

- [ ] `GET $BASE/health` returns `200`.
- [ ] `POST $BASE/providers` with the registration token succeeds.
- [ ] `GET $BASE/providers` lists the registered provider.
- [ ] `GET $BASE/proxy/<provider>/<path>` returns `402` with x402 payment requirements.
- [ ] A client that pays via the facilitator receives a `200` and the proxied upstream response.
- [ ] The web app loads at its public URL and can reach `VITE_API_BASE_URL` (no CORS errors in the browser console).
- [ ] The web app lists providers and shows the correct chain/network labels.
- [ ] Server logs show no migration errors on deploy.
- [ ] `ALLOWED_ORIGINS` on the server matches the deployed web app origin exactly.

If every box is checked, your testnet instance is live.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `500` on `/health` | DB unreachable | Check `DATABASE_URL` and SSL mode. |
| Migrations fail on deploy | Pre-deploy/release command missing | Add `pnpm run migrate` as pre-deploy (Render) or `release_command` (Fly). |
| `402` never returned | Proxy or facilitator misconfigured | Verify `X402_FACILITATOR_URL`, `X402_NETWORK`, `X402_PAYEE_ADDRESS`. |
| CORS errors in browser | `ALLOWED_ORIGINS` mismatch | Set it to the exact web app origin and redeploy the server. |
| Provider registration `401` | Wrong/missing token | Send `Authorization: Bearer $PROVIDER_REGISTRATION_TOKEN`. |
| Web app shows wrong network | `VITE_*` not set at build time | Set them and rebuild the static site. |

---

## 9. Rotating Secrets

To rotate `JWT_SECRET` or `PROVIDER_REGISTRATION_TOKEN`:

1. Generate a new value: `openssl rand -hex 32`.
2. Update it in the host's secret store (Render env vars / `fly secrets set`).
3. Redeploy. Existing sessions signed with the old `JWT_SECRET` will be invalidated.