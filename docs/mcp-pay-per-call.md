# Pay-per-call MCP tools: agent and operator guide

This guide walks you through the full lifecycle of the Zentrix pay-per-call MCP tools:

1. **Wallet setup** — create and inspect the agent's wallet.
2. **Listing** — discover APIs and inspect their schemas.
3. **Calling** — invoke a paid endpoint with automatic payment.
4. **History** — review what was purchased.
5. **Provider tools** — register as a provider, publish APIs, and track stats.

The examples below show prompts you can give to an MCP-capable agent (Claude Code, Codex, etc.) and the tool outputs you should expect. Tool names, parameters, and output shapes match the definitions in `mcp/src/apiTools.ts`.

> **Note on amounts:** all monetary values are in the smallest unit of the configured asset (for example, USDC base units). `pricePerCall`, `maxPricePerCall`, and `spent` are integers in that unit. `0.05 USDC` is written as `50000` when the asset has 6 decimals.

---

## 1. Wallet setup

The agent needs a wallet before it can pay for anything. The wallet is created and stored locally by the MCP server; the private key never leaves the machine.

### 1.1 Create a wallet — `zentrixpay_setup_wallet`

Creates (or returns) the agent's wallet. Optionally accepts a `label` for the wallet and a `network` (`"testnet"` or `"mainnet"`).

**Prompt (Claude Code):**

```
Use the zentrixpay_setup_wallet tool to create a wallet labelled "research-agent"
on testnet.
```

**Prompt (Codex):**

```
Call zentrixpay_setup_wallet with {"label": "research-agent", "network": "testnet"}.
```

**Expected output:**

```json
{
  "address": "0x8f3c1a2b4d5e6f708192a3b4c5d6e7f8091a2b3c",
  "network": "testnet",
  "label": "research-agent",
  "created": true,
  "fundingHint": "Send testnet USDC to this address to enable paid calls."
}
```

If a wallet already exists for the requested network, `created` is `false` and the existing address is returned.

### 1.2 Inspect the wallet — `zentrixpay_wallet_info`

Returns the address, network, and current balance so the agent can confirm it can afford a call.

**Prompt (Claude Code):**

```
Show me my Zentrix wallet info.
```

**Prompt (Codex):**

```
Call zentrixpay_wallet_info with {}.
```

**Expected output:**

```json
{
  "address": "0x8f3c1a2b4d5e6f708192a3b4c5d6e7f8091a2b3c",
  "network": "testnet",
  "asset": "USDC",
  "decimals": 6,
  "balance": 25000000,
  "balanceFormatted": "25.0 USDC"
}
```

**Operator tip:** if `balance` is `0`, fund the address before attempting paid calls. On testnet, use the faucet linked from the Zentrix dashboard; on mainnet, send USDC directly to the address.

---

## 2. Listing APIs

### 2.1 Browse the catalogue — `zentrixpay_list_apis`

Lists published APIs. Supports optional `query` (free-text search), `category`, and `limit`/`offset` for pagination.

**Prompt (Claude Code):**

```
List the Zentrix APIs related to "weather", limit 5.
```

**Prompt (Codex):**

```
Call zentrixpay_list_apis with {"query": "weather", "limit": 5}.
```

**Expected output:**

```json
{
  "total": 2,
  "offset": 0,
  "limit": 5,
  "apis": [
    {
      "id": "api_weather_current",
      "name": "Current Weather",
      "description": "Real-time conditions for any city.",
      "category": "weather",
      "pricePerCall": 50000,
      "priceFormatted": "0.05 USDC",
      "network": "testnet",
      "methods": ["GET"],
      "verified": true
    },
    {
      "id": "api_weather_forecast",
      "name": "7-Day Forecast",
      "description": "Daily forecast for any city.",
      "category": "weather",
      "pricePerCall": 100000,
      "priceFormatted": "0.1 USDC",
      "network": "testnet",
      "methods": ["GET"],
      "verified": true
    }
  ]
}
```

### 2.2 Inspect one API — `zentrixpay_api_info`

Returns the full schema for a single API: base URL, supported methods, parameter definitions, and pricing. Always call this before `zentrixpay_call` so you know the required `path`, `query`, and `body` shape.

**Prompt (Claude Code):**

```
Get the details for api_weather_current.
```

**Prompt (Codex):**

```
Call zentrixpay_api_info with {"id": "api_weather_current"}.
```

**Expected output:**

```json
{
  "id": "api_weather_current",
  "name": "Current Weather",
  "description": "Real-time conditions for any city.",
  "baseUrl": "https://api.example-weather.com",
  "methods": ["GET"],
  "pricePerCall": 50000,
  "priceFormatted": "0.05 USDC",
  "network": "testnet",
  "verified": true,
  "parameters": {
    "query": {
      "city": { "type": "string", "required": true, "description": "City name." },
      "units": { "type": "string", "required": false, "enum": ["metric", "imperial"] }
    }
  },
  "example": {
    "method": "GET",
    "path": "/v1/current",
    "query": { "city": "Lisbon", "units": "metric" }
  }
}
```

---

## 3. Calling a paid API — `zentrixpay_call`

`zentrixpay_call` performs the HTTP request and settles payment in the same step. Parameters:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes | API id from `zentrixpay_list_apis`. |
| `method` | string | no | HTTP method; defaults to the API's first supported method. |
| `path` | string | no | Path appended to the API's `baseUrl`. |
| `query` | object | no | Query-string parameters. |
| `body` | object | no | JSON request body (for `POST`/`PUT`/`PATCH`). |
| `headers` | object | no | Extra request headers. |
| `maxPricePerCall` | integer | no | Safety ceiling. The call is refused if the API's price exceeds this value. |
| `confirmMainnet` | boolean | no | Must be `true` to spend real funds on mainnet. |

### 3.1 A simple GET

**Prompt (Claude Code):**

```
Call api_weather_current for Lisbon in metric units, with a max price of 0.1 USDC.
```

**Prompt (Codex):**

```
Call zentrixpay_call with {"id": "api_weather_current", "method": "GET",
"path": "/v1/current", "query": {"city": "Lisbon", "units": "metric"},
"maxPricePerCall": 100000}.
```

**Expected output:**

```json
{
  "apiId": "api_weather_current",
  "status": 200,
  "data": {
    "city": "Lisbon",
    "temperatureC": 21.4,
    "conditions": "Partly cloudy",
    "observedAt": "2025-01-14T10:32:00Z"
  },
  "payment": {
    "amount": 50000,
    "amountFormatted": "0.05 USDC",
    "asset": "USDC",
    "network": "testnet",
    "txHash": "0x9a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcd",
    "status": "settled"
  }
}
```

### 3.2 A POST with a body

**Prompt (Claude Code):**

```
POST to api_sentiment_analyze with body {"text": "The new release is great."}.
```

**Prompt (Codex):**

```
Call zentrixpay_call with {"id": "api_sentiment_analyze", "method": "POST",
"path": "/v1/analyze", "body": {"text": "The new release is great."},
"headers": {"Content-Type": "application/json"}, "maxPricePerCall": 200000}.
```

**Expected output:**

```json
{
  "apiId": "api_sentiment_analyze",
  "status": 200,
  "data": { "sentiment": "positive", "score": 0.87 },
  "payment": {
    "amount": 150000,
    "amountFormatted": "0.15 USDC",
    "asset": "USDC",
    "network": "testnet",
    "txHash": "0x11223344556677889900aabbccddeeff00112233445566778899aabbccddeeff",
    "status": "settled"
  }
}
```

### 3.3 The auto-pay ceiling

`maxPricePerCall` is the agent's guardrail. If the API's current price is higher than the ceiling, the call is **not** made and no payment is taken:

```json
{
  "error": "price_exceeds_ceiling",
  "message": "API price 200000 exceeds maxPricePerCall 100000.",
  "apiId": "api_weather_forecast",
  "pricePerCall": 200000,
  "maxPricePerCall": 100000
}
```

Operators should set a sensible default ceiling in the agent's system prompt or configuration so an agent cannot accidentally spend more than intended.

### 3.4 Mainnet confirmation

On mainnet, real funds are spent. `zentrixpay_call` refuses to proceed unless `confirmMainnet` is `true`:

**Prompt (Claude Code):**

```
Call api_weather_current on mainnet for Lisbon. Yes, I confirm the mainnet spend.
```

**Prompt (Codex):**

```
Call zentrixpay_call with {"id": "api_weather_current", "method": "GET",
"path": "/v1/current", "query": {"city": "Lisbon"}, "maxPricePerCall": 100000,
"confirmMainnet": true}.
```

If `confirmMainnet` is omitted or `false` on a mainnet API, the tool returns:

```json
{
  "error": "mainnet_confirmation_required",
  "message": "This API settles on mainnet. Re-issue the call with confirmMainnet: true to spend real funds.",
  "apiId": "api_weather_current",
  "network": "mainnet"
}
```

**Operator tip:** keep agents on testnet until you have reviewed their prompts and ceilings. Only enable mainnet confirmation for agents you trust to spend real funds.

---

## 4. Purchase history — `zentrixpay_purchase_history`

Returns the agent's past paid calls, newest first. Supports optional `apiId`, `limit`, and `offset`.

**Prompt (Claude Code):**

```
Show my last 10 Zentrix purchases.
```

**Prompt (Codex):**

```
Call zentrixpay_purchase_history with {"limit": 10}.
```

**Expected output:**

```json
{
  "total": 3,
  "offset": 0,
  "limit": 10,
  "purchases": [
    {
      "apiId": "api_weather_current",
      "apiName": "Current Weather",
      "amount": 50000,
      "amountFormatted": "0.05 USDC",
      "network": "testnet",
      "txHash": "0x9a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcd",
      "status": "settled",
      "createdAt": "2025-01-14T10:32:01Z"
    },
    {
      "apiId": "api_sentiment_analyze",
      "apiName": "Sentiment Analysis",
      "amount": 150000,
      "amountFormatted": "0.15 USDC",
      "network": "testnet",
      "txHash": "0x11223344556677889900aabbccddeeff00112233445566778899aabbccddeeff",
      "status": "settled",
      "createdAt": "2025-01-14T10:20:44Z"
    },
    {
      "apiId": "api_weather_forecast",
      "apiName": "7-Day Forecast",
      "amount": 100000,
      "amountFormatted": "0.1 USDC",
      "network": "testnet",
      "txHash": "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      "status": "settled",
      "createdAt": "2025-01-13T18:05:12Z"
    }
  ]
}
```

Use this to reconcile spend, debug failed calls, or feed a budget report back to the operator.

---

## 5. Provider tools

If you are publishing APIs rather than consuming them, the following tools let you register as a provider, publish and update APIs, prove ownership, and track usage.

### 5.1 Register as a provider — `zentrixpay_register`

Registers the wallet as a provider. Optionally accepts `name`, `email`, and `description`.

**Prompt (Claude Code):**

```
Register me as a Zentrix provider named "Acme Data".
```

**Prompt (Codex):**

```
Call zentrixpay_register with {"name": "Acme Data", "email": "ops@acme.example"}.
```

**Expected output:**

```json
{
  "providerId": "prov_acme_data",
  "address": "0x8f3c1a2b4d5e6f708192a3b4c5d6e7f8091a2b3c",
  "name": "Acme Data",
  "status": "active",
  "createdAt": "2025-01-14T09:00:00Z"
}
```

### 5.2 Publish an API — `zentrixpay_register_api`

Publishes a new API under your provider account. Requires `name`, `description`, `baseUrl`, `methods`, and `pricePerCall`. Optional `category`, `parameters`, and `network`.

**Prompt (Claude Code):**

```
Publish an API called "Current Weather" at https://api.example-weather.com,
GET only, 0.05 USDC per call, category weather.
```

**Prompt (Codex):**

```
Call zentrixpay_register_api with {"name": "Current Weather",
"description": "Real-time conditions for any city.",
"baseUrl": "https://api.example-weather.com", "methods": ["GET"],
"pricePerCall": 50000, "category": "weather",
"parameters": {"query": {"city": {"type": "string", "required": true}}},
"network": "testnet"}.
```

**Expected output:**

```json
{
  "id": "api_weather_current",
  "name": "Current Weather",
  "status": "pending_verification",
  "pricePerCall": 50000,
  "priceFormatted": "0.05 USDC",
  "network": "testnet",
  "verificationToken": "zentrix-verify-7f3a9c21",
  "createdAt": "2025-01-14T09:05:00Z"
}
```

### 5.3 Prove ownership — `zentrixpay_verify_api_ownership`

Confirms you control the API's `baseUrl` by serving the `verificationToken` returned by `zentrixpay_register_api` at a well-known path.

**Prompt (Claude Code):**

```
Verify ownership of api_weather_current using token zentrix-verify-7f3a9c21.
```

**Prompt (Codex):**

```
Call zentrixpay_verify_api_ownership with {"id": "api_weather_current",
"token": "zentrix-verify-7f3a9c21"}.
```

**Expected output:**

```json
{
  "id": "api_weather_current",
  "verified": true,
  "status": "active",
  "verifiedAt": "2025-01-14T09:12:00Z"
}
```

### 5.4 Update an API — `zentrixpay_update_api`

Updates fields on an API you own. Only the fields you pass are changed.

**Prompt (Claude Code):**

```
Change the price of api_weather_current to 0.08 USDC.
```

**Prompt (Codex):**

```
Call zentrixpay_update_api with {"id": "api_weather_current",
"pricePerCall": 80000}.
```

**Expected output:**

```json
{
  "id": "api_weather_current",
  "pricePerCall": 80000,
  "priceFormatted": "0.08 USDC",
  "updatedAt": "2025-01-14T09:20:00Z"
}
```

### 5.5 List your APIs — `zentrixpay_my_apis`

Lists every API published under your provider account.

**Prompt (Claude Code):**

```
List all the APIs I've published.
```

**Prompt (Codex):**

```
Call zentrixpay_my_apis with {}.
```

**Expected output:**

```json
{
  "total": 1,
  "apis": [
    {
      "id": "api_weather_current",
      "name": "Current Weather",
      "status": "active",
      "verified": true,
      "pricePerCall": 80000,
      "priceFormatted": "0.08 USDC",
      "network": "testnet",
      "calls": 128,
      "revenue": 10240000,
      "revenueFormatted": "10.24 USDC"
    }
  ]
}
```

### 5.6 Usage stats — `zentrixpay_api_stats`

Returns call counts and revenue for one API over an optional time window.

**Prompt (Claude Code):**

```
Show stats for api_weather_current over the last 7 days.
```

**Prompt (Codex):**

```
Call zentrixpay_api_stats with {"id": "api_weather_current", "range": "7d"}.
```

**Expected output:**

```json
{
  "id": "api_weather_current",
  "range": "7d",
  "calls": 128,
  "uniqueCallers": 14,
  "revenue": 10240000,
  "revenueFormatted": "10.24 USDC",
  "byDay": [
    { "date": "2025-01-08", "calls": 12, "revenue": 960000 },
    { "date": "2025-01-09", "calls": 19, "revenue": 1520000 },
    { "date": "2025-01-10", "calls": 22, "revenue": 1760000 },
    { "date": "2025-01-11", "calls": 17, "revenue": 1360000 },
    { "date": "2025-01-12", "calls": 21, "revenue": 1680000 },
    { "date": "2025-01-13", "calls": 24, "revenue": 1920000 },
    { "date": "2025-01-14", "calls": 13, "revenue": 1040000 }
  ]
}
```

---

## 6. End-to-end walkthrough

A complete consumer flow, as you would give it to an agent:

**Prompt (Claude Code):**

```
Set up a Zentrix wallet on testnet, then find a weather API under 0.1 USDC per
call, call it for Lisbon, and show me the purchase history.
```

**Prompt (Codex):**

```
1. Call zentrixpay_setup_wallet with {"network": "testnet"}.
2. Call zentrixpay_list_apis with {"query": "weather"}.
3. Call zentrixpay_api_info with {"id": "api_weather_current"}.
4. Call zentrixpay_call with {"id": "api_weather_current", "method": "GET",
   "path": "/v1/current", "query": {"city": "Lisbon"},
   "maxPricePerCall": 100000}.
5. Call zentrixpay_purchase_history with {"limit": 5}.
```

The agent should produce, in order: a wallet address, a list of matching APIs, the API schema, the weather payload with a settled payment receipt, and a purchase history containing that call.

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `insufficient_balance` | Wallet balance below the API price. | Fund the address shown by `zentrixpay_wallet_info`. |
| `price_exceeds_ceiling` | `maxPricePerCall` below the API price. | Raise the ceiling or pick a cheaper API. |
| `mainnet_confirmation_required` | Mainnet call without `confirmMainnet: true`. | Re-issue with `confirmMainnet: true` if you intend to spend real funds. |
| `api_not_verified` | Provider has not completed ownership verification. | Provider must call `zentrixpay_verify_api_ownership`. |
| `payment_failed` | On-chain settlement reverted. | Check the wallet balance and network; retry the call. |

---

## See also

- [`mcp/src/apiTools.ts`](../mcp/src/apiTools.ts) — tool definitions and handlers.
- [README](../README.md) — installation and MCP client configuration.