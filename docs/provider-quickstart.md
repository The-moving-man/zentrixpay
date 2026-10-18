# ZentrixPay Provider Quickstart (Testnet)

Go from zero to your first paid API call on Stellar testnet in about 15 minutes.

This guide is **testnet only**. Do not use mainnet keys, real funds, or production secrets while following it.

---

## 0. Prerequisites

Before you start, make sure you have:

1. **A Stellar testnet wallet** — e.g. [Freighter](https://www.freighter.app/) switched to *Testnet*, or any keypair you control.
2. **Testnet USDC** — get some from the Circle testnet faucet: <https://faucet.circle.com/> (select *Stellar Testnet* and paste your wallet address).
3. **Testnet XLM** — fund your wallet with Friendbot:
   ```bash
   curl "https://friendbot.stellar.org?addr=<YOUR_TESTNET_WALLET_ADDRESS>"
   ```
   You should get a JSON response containing a `hash` and a `ledger`. XLM pays the network fees for your payouts.
4. **The ZentrixPay base URL** — for testnet this is:
   ```
   https://testnet.zentrixpay.io
   ```
   All examples below use `$ZENTRIXPAY` for this value. Set it once:
   ```bash
   export ZENTRIXPAY="https://testnet.zentrixpay.io"
   ```

> **Tip:** Keep your wallet's **public address** handy. You'll paste it as your payout wallet in the next step. Never share the secret key.

---

## 1. Register as a provider

Register with `POST /publishers`. You need a name, an email, and the **payout wallet** where you want to receive USDC.

```bash
curl -X POST "$ZENTRIXPAY/publishers" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acme Data Co",
    "email": "you@example.com",
    "payoutWallet": "<YOUR_TESTNET_WALLET_ADDRESS>"
  }'
```

**Expected response** (`201 Created`):

```json
{
  "id": "pub_01H8Z...",
  "name": "Acme Data Co",
  "email": "you@example.com",
  "payoutWallet": "G...",
  "apiKey": "zp_live_9f3c...e21a"
}
```

> ⚠️ **The `apiKey` is shown only once.** Copy it now and store it somewhere safe (a password manager or your shell env). If you lose it, you'll need to rotate it.

Save it for the rest of this guide:

```bash
export ZENTRIXPAY_API_KEY="zp_live_9f3c...e21a"
```

Every provider-authenticated request below sends this key in the **`x-api-key`** header.

---

## 2. Register your API

Now tell ZentrixPay about the API you want to sell. Use `POST /apis` with your `x-api-key`.

```bash
curl -X POST "$ZENTRIXPAY/apis" \
  -H "x-api-key: $ZENTRIXPAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acme Weather API",
    "description": "Current conditions and 7-day forecast for any city.",
    "price": "0.01",
    "upstreamUrl": "https://api.acme.example.com/v1/weather",
    "allowedMethods": ["GET"],
    "upstreamHeader": "X-Acme-Secret"
  }'
```

Field reference:

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | Human-readable name shown to buyers. |
| `description` | yes | Short description shown on the listing. |
| `price` | yes | Price **per call, in USDC** (e.g. `"0.01"` = 1 cent). |
| `upstreamUrl` | yes | The real endpoint ZentrixPay proxies to. |
| `allowedMethods` | yes | HTTP methods buyers may use, e.g. `["GET"]` or `["GET","POST"]`. |
| `upstreamHeader` | optional | Name of the secret header your upstream requires (see §3). |

**Expected response** (`201 Created`):

```json
{
  "id": "api_01H8Z...",
  "name": "Acme Weather API",
  "price": "0.01",
  "upstreamUrl": "https://api.acme.example.com/v1/weather",
  "allowedMethods": ["GET"],
  "upstreamHeader": "X-Acme-Secret",
  "verified": false
}
```

Save the API id:

```bash
export ZENTRIXPAY_API_ID="api_01H8Z..."
```

Note `"verified": false` — you'll fix that in §5.

---

## 3. The secret header (`upstreamHeader`)

`upstreamHeader` is the name of a header that **ZentrixPay injects** into every request it forwards to your `upstreamUrl`. It lets your upstream tell the difference between:

- a request that came through ZentrixPay **after the buyer paid**, and
- a request that hit your upstream **directly** (i.e. someone trying to skip payment).

How it works:

- You choose the header name (e.g. `X-Acme-Secret`).
- ZentrixPay generates a secret value for it and **stores that value AES-256-GCM encrypted at rest**.
- On every proxied call, ZentrixPay decrypts the value and adds the header to the upstream request.
- Your upstream **must require this header** and reject requests that are missing it or carry the wrong value.

> 🔒 **Important:** If your upstream serves data without checking the secret header, buyers can bypass ZentrixPay and call your API for free. Always validate the header on your side.

Example upstream check (Node/Express):

```js
app.use((req, res, next) => {
  if (req.get("X-Acme-Secret") !== process.env.ACME_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
});
```

You'll retrieve the secret value from the dashboard (see §7) and set it as `ACME_SECRET` on your upstream.

---

## 4. Create the ownership file

To prove you control the domain behind `upstreamUrl`, serve a small text file at a well-known path:

```
https://<your-api-domain>/.well-known/zentrixpay.txt
```

The file must contain exactly one line:

```
zentrixpay-verification=<token>
```

Get your `<token>` from the dashboard: **Sell your API → your API → Verify ownership**. Copy the token it shows you.

Example file contents:

```
zentrixpay-verification=zpv_7d2a91c4e8b3f0a6
```

Requirements:

- Served over **HTTPS**.
- Reachable at `/.well-known/zentrixpay.txt` on the **same domain** as your `upstreamUrl`.
- `Content-Type: text/plain` is recommended.
- No extra lines, no HTML, no redirects.

Quick check from your machine:

```bash
curl "https://api.acme.example.com/.well-known/zentrixpay.txt"
# expected:
# zentrixpay-verification=zpv_7d2a91c4e8b3f0a6
```

---

## 5. Verify ownership

Once the file is live, ask ZentrixPay to verify it:

```bash
curl -X POST "$ZENTRIXPAY/apis/$ZENTRIXPAY_API_ID/verify-ownership" \
  -H "x-api-key: $ZENTRIXPAY_API_KEY"
```

**Expected response** (`200 OK`):

```json
{
  "id": "api_01H8Z...",
  "verified": true,
  "verifiedAt": "2025-01-15T12:34:56Z"
}
```

Confirm the API now shows as verified in your listing:

```bash
curl "$ZENTRIXPAY/apis/$ZENTRIXPAY_API_ID" \
  -H "x-api-key: $ZENTRIXPAY_API_KEY"
```

Look for `"verified": true`. If it's still `false`, see **Troubleshooting** below.

---

## 6. Share your proxy URL

Your API is now live. Buyers call it through ZentrixPay at:

```
https://<zentrixpay>/api/<id>
```

For testnet and the API you just created:

```
https://testnet.zentrixpay.io/api/api_01H8Z...
```

Share this URL — not your `upstreamUrl` — with buyers. Every call to it is metered and paid in USDC; ZentrixPay forwards the request to your upstream with the secret header attached.

---

## 7. Check your stats

### Via the API

```bash
curl "$ZENTRIXPAY/apis/$ZENTRIXPAY_API_ID/stats" \
  -H "x-api-key: $ZENTRIXPAY_API_KEY"
```

**Expected response** (`200 OK`):

```json
{
  "apiId": "api_01H8Z...",
  "calls": 42,
  "paidCalls": 40,
  "revenue": "0.40",
  "currency": "USDC",
  "period": "all-time"
}
```

### Via the dashboard

1. Log in at <https://testnet.zentrixpay.io>.
2. Open the **Sell your API** tab.
3. Select your API. You'll see:
   - **Calls** and **Paid calls** counters,
   - **Revenue** in USDC,
   - the **secret header value** (reveal/copy — set this on your upstream),
   - the **ownership token** (if you ever need to re-verify),
   - the **proxy URL** to share.

---

## 8. First paid call walkthrough

Let's make a real paid call as a buyer would.

### 8a. Call without payment → `402 Payment Required`

```bash
curl -i "https://testnet.zentrixpay.io/api/api_01H8Z..."
```

**Expected response:**

```
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "error": "payment_required",
  "price": "0.01",
  "currency": "USDC",
  "payTo": "G...",
  "network": "testnet"
}
```

The `402` tells the buyer what to pay, in what currency, and to which wallet.

### 8b. Pay and retry → `200 OK`

Using a Stellar testnet wallet funded with USDC (from §0), send `0.01` USDC to the `payTo` address, then retry the call with the payment proof header:

```bash
curl -i "https://testnet.zentrixpay.io/api/api_01H8Z..." \
  -H "x-payment: <PAYMENT_PROOF>"
```

**Expected response:**

```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "city": "Berlin",
  "tempC": 7,
  "forecast": [ ... ]
}
```

That JSON is your upstream's response, forwarded by ZentrixPay with the secret header attached. Check §7 again — `calls` and `revenue` should have incremented.

🎉 You've completed your first paid call.

---

## Troubleshooting

**`401 Unauthorized` on provider endpoints**
Your `x-api-key` is missing or wrong. Confirm `$ZENTRIXPAY_API_KEY` is set and matches the key from §1. Remember it's shown only once.

**`verify-ownership` returns `verified: false`**
- The file isn't reachable at `https://<your-api-domain>/.well-known/zentrixpay.txt` — check with `curl` from outside your network.
- The domain in the file's URL doesn't match the domain of `upstreamUrl`.
- The file has extra whitespace, HTML, or multiple lines. It must be exactly `zentrixpay-verification=<token>`.
- Your server redirects `http` → `https` or adds a trailing slash. Serve the file directly at the exact path.

**Buyers get `502` / `504` from the proxy**
Your `upstreamUrl` is unreachable or slow. Test it directly:
```bash
curl -i "https://api.acme.example.com/v1/weather"
```
Make sure it responds within the proxy timeout.

**Upstream returns `401` for proxied calls**
Your upstream is rejecting the secret header. Confirm the header name in your API config matches what your upstream checks, and that the secret value on your upstream matches the one shown in the dashboard (§7).

**Buyers can call my upstream directly without paying**
Your upstream isn't enforcing the secret header. Add the check from §3 and reject any request missing it.

**`402` even after paying**
- Wrong amount or currency (must be `0.01` USDC on testnet).
- Payment sent to the wrong `payTo` address.
- Payment not yet confirmed on testnet — wait a few seconds and retry.
- Missing or malformed `x-payment` header.

**Stats show `0` calls**
Stats update shortly after each call. If you just made a call, wait a few seconds and refresh. Confirm you're querying the right `apiId`.

---

## Next steps

- Rotate your API key if it ever leaks (dashboard → **Sell your API** → **Rotate key**).
- Add more APIs with `POST /apis` — each gets its own id, price, and proxy URL.
- Point buyers at your proxy URL, not your upstream URL.

For the full API reference, see the [README](../README.md).