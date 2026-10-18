# ZentrixPay Gateway FAQ

This FAQ covers the ZentrixPay gateway: how providers register and get paid, how callers (agents) pay for calls, how secrets are stored, and what happens when things go wrong. It replaces the older vault-oriented FAQ.

If you're looking for deployment steps, see the [Deployment Runbook](./deployment.md). For the protocol-level details, see the [Architecture Overview](./architecture.md) and the [API Reference](./api.md).

---

## Fees

### 1. What fees does the gateway charge?

The gateway charges a small protocol fee on each successful call, taken from the amount the caller pays. The fee is a percentage of the call price and is deducted before the provider's payout is credited. The current fee schedule is published in the [Deployment Runbook](./deployment.md) and is configurable per deployment.

### 2. Who pays the fee — the caller or the provider?

The caller pays the listed call price. The protocol fee is deducted from that price, so the provider receives `price - fee`. Callers never see a separate line item; the price they see is the price they pay.

### 3. Are fees charged on failed calls?

No. Fees are only assessed on calls that complete successfully and produce a billable response. If a call fails before the provider returns a result, no fee is charged and no funds move. See [Failed calls](#failed-calls) below.

### 4. Are there fees for registering as a provider?

No. Provider registration and ownership verification are free. You only pay normal network gas costs for any on-chain transactions you choose to make (for example, claiming payouts).

---

## Failed calls

### 5. What counts as a "failed call"?

A call is considered failed if the gateway cannot obtain a valid response from the provider — for example, the provider times out, returns a 5xx error, or the response fails validation. A call that returns a well-formed error response *from the provider's own application logic* is still a successful gateway call and is billed normally.

### 6. Am I charged if the provider is down?

No. If the provider is unreachable or times out, the call is marked failed and the caller is not charged. The gateway records the failure so providers can see their reliability metrics.

### 7. What happens to my request when a call fails?

The gateway returns an error to the caller describing the failure (timeout, upstream error, validation failure). No payment is settled. You can safely retry; retries are independent calls and are billed only if they succeed.

### 8. Can a provider be penalized for repeated failures?

Yes. The gateway tracks per-provider success rates. Providers with sustained failures may be deprioritized in routing or temporarily suspended. See the [Deployment Runbook](./deployment.md) for the current thresholds.

---

## Refunds

### 9. How do refunds work?

Because failed calls are never charged, most "refunds" happen automatically: if a call fails, no payment is taken. For the rare case where a charge is settled but the result is later found to be invalid, the gateway issues a refund to the caller's balance. Refunds are credited to the caller's gateway balance, not sent on-chain directly.

### 10. How long do refunds take?

Automatic non-charges are immediate. Manual refunds for disputed calls are processed during the next settlement cycle, typically within one business day. On-chain withdrawal of a refunded balance follows the normal payout schedule.

### 11. Can I dispute a charge?

Yes. If you believe a call was billed incorrectly, open a dispute with the call ID. The gateway will review the recorded request/response and either uphold the charge or refund it. Disputes must be filed within the window documented in the [Deployment Runbook](./deployment.md).

---

## Secret storage (encrypted upstream headers)

### 12. How does the gateway store my upstream API keys and headers?

Upstream credentials (API keys, auth headers, and other secrets a provider needs to reach its backend) are stored **encrypted at rest**. They are encrypted with a key managed by the gateway's secret store and are only decrypted in memory at the moment a call is proxied to the provider's upstream. They are never written to logs or returned in API responses.

### 13. Who can see my encrypted headers?

Only the gateway process handling the call, and only transiently in memory. Operators with database access see ciphertext, not plaintext. Access to the encryption key is restricted and audited. See the [Architecture Overview](./architecture.md) for the key-management model.

### 14. Can I rotate a secret without re-registering?

Yes. Update the provider's upstream headers via the provider API; the new value is re-encrypted and stored, and subsequent calls use it immediately. Old ciphertext is discarded. There is no need to re-register or re-verify ownership to rotate a secret.

### 15. Are secrets ever sent to the caller?

No. Upstream headers are injected by the gateway on the outbound request to the provider's backend. Callers only ever see the provider's response, never the credentials used to produce it.

---

## Testnet USDC

### 16. What currency does the gateway use?

The gateway settles in USDC. On testnet deployments it uses **testnet USDC**, which has no real value and is used purely for testing.

### 17. How do I get testnet USDC?

Testnet USDC is available from the faucet linked in the [Deployment Runbook](./deployment.md). You can also mint it directly if you control the test token contract on your local deployment.

### 18. Is testnet USDC the same as mainnet USDC?

No. Testnet USDC is a separate token on a test network and cannot be bridged or exchanged for mainnet USDC. Never send mainnet funds to a testnet address.

### 19. Do testnet balances carry over to mainnet?

No. Testnet balances, provider registrations, and call history are isolated to the testnet deployment. You must register and fund separately on mainnet.

---

## Provider registration

### 20. How do I register as a provider?

Register through the provider API by submitting your endpoint, pricing, and the upstream headers the gateway should use. Registration is free. Once registered and verified, your endpoint becomes eligible for routing. Full steps are in the [Deployment Runbook](./deployment.md).

### 21. What do I need before registering?

You need: a reachable HTTPS endpoint, a defined price per call, and any upstream credentials the gateway should inject. You also need to complete ownership verification (see below) before you can receive payouts.

### 22. Can I register multiple endpoints?

Yes. Each endpoint is registered as its own provider entry with its own pricing, secrets, and reliability metrics. You can manage them independently.

### 23. How do I update my pricing or endpoint?

Update the provider entry via the provider API. Changes take effect for subsequent calls. Existing in-flight calls use the configuration captured at call time.

---

## Ownership verification

### 24. What is ownership verification?

Ownership verification proves that you control the endpoint (or the on-chain identity) you registered. It prevents someone from registering an endpoint they don't own and redirecting payouts.

### 25. How does verification work?

The gateway issues a challenge — typically a token to serve at a well-known path on your endpoint, or a signed message from your payout address. You complete the challenge, and the gateway marks the provider as verified. Details are in the [Deployment Runbook](./deployment.md).

### 26. What happens if I'm not verified?

Unverified providers can be registered but are not eligible for routing or payouts. Complete verification to go live.

### 27. Do I need to re-verify if I change my endpoint or payout address?

Yes. Changing the endpoint URL or the payout address invalidates the prior verification and requires re-verification. Rotating upstream secrets does **not** require re-verification.

---

## Caller / agent payment flows

### 28. How does an agent pay for a call?

The caller (or agent) funds a gateway balance in USDC. When a call is made, the gateway checks the balance, proxies the call, and on success debits the call price from the balance. No per-call on-chain transaction is required, which keeps agent flows fast and cheap.

### 29. Do I need to sign every call?

No. Calls are authenticated with your gateway API key/credentials, and payment is settled against your prepaid balance. You sign only when funding the balance or withdrawing funds.

### 30. What happens if my balance runs out mid-call?

The gateway rejects calls when the balance is insufficient to cover the price, returning a payment-required error before the upstream is contacted. Top up your balance to resume. In-flight calls that were already authorized are settled normally.

### 31. How do providers get paid?

Provider earnings accrue to their gateway balance as calls succeed. Providers withdraw on the normal payout schedule (see the [Deployment Runbook](./deployment.md)), which settles on-chain in USDC. Payouts require completed ownership verification.

### 32. Can an agent set a spending limit?

Yes. Callers can configure per-call and per-period spending limits on their gateway account. Calls exceeding a limit are rejected before the upstream is contacted, protecting agents from runaway spend.

---

## Still have questions?

- Deployment, configuration, and operational thresholds: [Deployment Runbook](./deployment.md)
- Protocol and key-management details: [Architecture Overview](./architecture.md)
- Endpoint and field-level details: [API Reference](./api.md)