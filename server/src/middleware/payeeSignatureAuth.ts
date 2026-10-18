import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";
import { verifyPayeeSignature } from "../utils/payeeSignature.js";
import type { ApiRow } from "../services/apiService.js";

/**
 * Enforces a payee-wallet signature when a PATCH /apis/:id request includes a
 * `walletAddress` change.
 *
 * If the request does not touch `walletAddress`, or the new address is
 * identical to the current one, this middleware is a no-op.
 *
 * When a change IS requested the caller must supply two extra headers:
 *   X-Payee-Timestamp  — unix timestamp in seconds (string)
 *   X-Payee-Signature  — base64 Ed25519 signature of the challenge message:
 *                        "zentrixpay:change-payee:<apiId>:<newAddress>:<timestamp>"
 *
 * The signature must be produced by the *current* payee wallet — i.e. the key
 * whose address is stored in api.walletAddress right now. This proves the
 * person requesting the change controls that wallet and prevents an API-key
 * holder from silently redirecting revenue.
 *
 * The api row must be attached to res.locals.api before this middleware runs.
 */
export function payeeSignatureAuth(req: Request, res: Response, next: NextFunction): void {
  const body = req.body as Record<string, unknown>;
  const api = res.locals.api as ApiRow | undefined;

  // Only relevant for PATCH requests that include walletAddress
  if (!body || typeof body.walletAddress !== "string") {
    next();
    return;
  }

  // If the address hasn't changed, no signature needed
  if (!api || body.walletAddress === api.walletAddress) {
    next();
    return;
  }

  const newWalletAddress = body.walletAddress;
  const timestampHeader = req.headers["x-payee-timestamp"];
  const signatureHeader = req.headers["x-payee-signature"];

  if (!timestampHeader || typeof timestampHeader !== "string") {
    res.status(401).json({
      error: "Missing X-Payee-Timestamp header",
      hint: "Changing walletAddress requires a signature from the current payee wallet.",
    });
    return;
  }

  if (!signatureHeader || typeof signatureHeader !== "string") {
    res.status(401).json({
      error: "Missing X-Payee-Signature header",
      hint: "Changing walletAddress requires a signature from the current payee wallet.",
    });
    return;
  }

  const result = verifyPayeeSignature({
    currentPayeeAddress: api.walletAddress,
    apiId: api.id,
    newWalletAddress,
    timestampHeader,
    signatureHeader,
    nowMs: Date.now(),
    maxSkewMs: config.SIGNATURE_MAX_SKEW_MS,
  });

  if (!result.ok) {
    const messages: Record<string, string> = {
      invalid_timestamp: "X-Payee-Timestamp is not a valid unix timestamp",
      timestamp_expired: "X-Payee-Timestamp is outside the allowed clock-skew window",
      invalid_signature_encoding: "X-Payee-Signature must be base64-encoded (64 bytes when decoded)",
      invalid_public_key: "Current payee address is not a valid Stellar public key",
      signature_mismatch: "X-Payee-Signature is invalid for the current payee wallet",
    };
    res.status(403).json({
      error: messages[result.error!] ?? "Payee signature verification failed",
    });
    return;
  }

  next();
}
