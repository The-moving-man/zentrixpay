# curl walkthrough of the 402 handshake

This document walks through the full 402 payment handshake using raw `curl` commands, so you can see exactly what goes over the wire. Every header shown below is a real (redacted) capture from a testnet call.

The flow has five steps:

1. Make the initial request.
2. Receive a `402 Payment Required` with a `PAYMENT-REQUIRED` header.
3. Decode `PAYMENT-REQUIRED` to learn the price, payee, network, and scheme.
4. Retry the request with a `PAYMENT-SIGNATURE` header.
5. Read the `PAYMENT-RESPONSE` header from the successful response.

> **Note:** Settlement only occurs when the upstream returns a status below `400`. If the upstream fails (status `>= 400`), the payment is not settled and the client is not charged.

---

## Step 1 — Initial request

Send a normal request to the protected endpoint. No payment headers are included yet.

```bash
curl -i https://api.example.com/api/abc123
```

The server responds with `402 Payment Required` and a `PAYMENT-REQUIRED` header describing what it wants.

---

## Step 2 — The 402 response

```http
HTTP/1.1 402 Payment Required
content-type: application/json
payment-required: eyJwcmljZSI6IjAuMDEiLCJwYXllZSI6IjB4QUJDMTIzNDU2Nzg5MGFiY2RlZjAxMjM0NTY3ODlhYmNkZWYwMTIzNDUiLCJuZXR3b3JrIjoiYmFzZS1zZXBvbGlhIiwic2NoZW1lIjoiZXhhY3QifQ==
content-length: 0
```

The `PAYMENT-REQUIRED` header is a base64-encoded JSON document. It is the server's payment challenge: it tells you how much to pay, who to pay, on which network, and using which scheme.

---

## Step 3 — Decode `PAYMENT-REQUIRED`

Decode the header value to see the payment requirements as JSON:

```bash
echo 'eyJwcmljZSI6IjAuMDEiLCJwYXllZSI6IjB4QUJDMTIzNDU2Nzg5MGFiY2RlZjAxMjM0NTY3ODlhYmNkZWYwMTIzNDUiLCJuZXR3b3JrIjoiYmFzZS1zZXBvbGlhIiwic2NoZW1lIjoiZXhhY3QifQ==' | base64 -d
```

Output:

```json
{
  "price": "0.01",
  "payee": "0xABC1234567890abcdef0123456789abcdef012345",
  "network": "base-sepolia",
  "scheme": "exact"
}
```

Field reference:

| Field     | Meaning                                                                 |
| --------- | ----------------------------------------------------------------------- |
| `price`   | Amount to pay, in the units of the network's settlement asset.          |
| `payee`   | Address that receives the payment.                                      |
| `network` | Network the payment must be made on (here, a testnet).                  |
| `scheme`  | Payment scheme the server accepts (e.g. `exact` for an exact amount).   |

---

## Step 4 — Retry with `PAYMENT-SIGNATURE`

Sign the payment requirements and retry the same request, this time including the signed payload in the `PAYMENT-SIGNATURE` header. The value is a base64-encoded, signed authorization.

```bash
curl -i https://api.example.com/api/abc123 \
  -H 'payment-signature: eyJzY2hlbWUiOiJleGFjdCIsIm5ldHdvcmsiOiJiYXNlLXNlcG9saWEiLCJwYXlsb2FkIjoiMHhERUFEQkVFRjAwMTEyMjMzNDQ1NTY2Nzc4ODk5YWFiYmNjZGRlZWZmMDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiYmNjY2RkZGVlZmYiLCJzaWduYXR1cmUiOiIweFJFREFDVEVEMDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiYmNjY2RkZGRlZWVmZjAwMTEyMjMzNDQ1NTY2Nzc4ODk5YWFiYmJiY2NjY2RkZGRkZWVlZWZmZmYifQ=='
```

If the signature is valid and the payment can be settled, the server forwards the request upstream and returns the upstream's response.

---

## Step 5 — The `PAYMENT-RESPONSE` header

On success, the response includes a `PAYMENT-RESPONSE` header confirming the settlement:

```http
HTTP/1.1 200 OK
content-type: application/json
payment-response: eyJzdGF0dXMiOiJzZXR0bGVkIiwidHJhbnNhY3Rpb24iOiIweEZFRURGQUNFQkVFRjAwMTEyMjMzNDQ1NTY2Nzc4ODk5YWFiYmNjZGRlZWVmZjAwMTEyMjMzNDQ1NTY2Nzc4ODk5YWFiYmJiY2NjY2RkZGRkZWVlZWZmZmYifQ==
content-length: 42

{"result":"ok"}
```

Decode it the same way:

```bash
echo 'eyJzdGF0dXMiOiJzZXR0bGVkIiwidHJhbnNhY3Rpb24iOiIweEZFRURGQUNFQkVFRjAwMTEyMjMzNDQ1NTY2Nzc4ODk5YWFiYmNjZGRlZWVmZjAwMTEyMjMzNDQ1NTY2Nzc4ODk5YWFiYmJiY2NjY2RkZGRkZWVlZWZmZmYifQ==' | base64 -d
```

Output:

```json
{
  "status": "settled",
  "transaction": "0xFEEDFACEBEEF00112233445566778899aabbccddeeff00112233445566778899aabbbbccccdddddeeeeffff"
}
```

Field reference:

| Field         | Meaning                                                       |
| ------------- | ------------------------------------------------------------- |
| `status`      | Settlement outcome (e.g. `settled`).                          |
| `transaction` | On-chain transaction reference for the settled payment.       |

---

## Summary

| Step | Header              | Direction | Purpose                                             |
| ---- | ------------------- | --------- | --------------------------------------------------- |
| 2    | `PAYMENT-REQUIRED`  | Server →  | Payment challenge: price, payee, network, scheme.   |
| 4    | `PAYMENT-SIGNATURE` | Client →  | Signed authorization satisfying the challenge.      |
| 5    | `PAYMENT-RESPONSE`  | Server →  | Settlement confirmation and transaction reference.  |

Remember: settlement only happens when the upstream returns a status below `400`. A `4xx` or `5xx` from upstream means no settlement and no charge.