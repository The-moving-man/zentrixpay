import { Keypair } from "@stellar/stellar-sdk";
import { isTimestampWithinSkew } from "./requestSignature.js";

/**
 * SEP-53-style payee-change challenge.
 *
 * The current payee wallet must sign this exact UTF-8 string with its Ed25519
 * secret key to authorise redirecting revenue to a new address.
 *
 *   zentrixpay:change-payee:<apiId>:<newWalletAddress>:<timestampSeconds>
 *
 * - apiId prevents a valid sig from one API being replayed on another.
 * - newWalletAddress binds the sig to one specific destination.
 * - timestampSeconds (unix, seconds) provides replay protection within the
 *   clock-skew window (same SIGNATURE_MAX_SKEW_MS used for HMAC signatures).
 */
export function buildPayeeChangeMessage(
  apiId: string,
  newWalletAddress: string,
  timestampSeconds: number,
): string {
  return `zentrixpay:change-payee:${apiId}:${newWalletAddress}:${timestampSeconds}`;
}

export interface VerifyPayeeSignatureParams {
  /** The wallet address that currently receives payment (must sign). */
  currentPayeeAddress: string;
  apiId: string;
  newWalletAddress: string;
  /** Value of the X-Payee-Timestamp header (unix seconds as a string). */
  timestampHeader: string;
  /** Value of the X-Payee-Signature header (base64-encoded Ed25519 signature). */
  signatureHeader: string;
  nowMs: number;
  maxSkewMs: number;
}

export type PayeeSignatureError =
  | "missing_timestamp"
  | "invalid_timestamp"
  | "timestamp_expired"
  | "missing_signature"
  | "invalid_signature_encoding"
  | "invalid_public_key"
  | "signature_mismatch";

export function verifyPayeeSignature(params: VerifyPayeeSignatureParams): {
  ok: boolean;
  error?: PayeeSignatureError;
} {
  const { currentPayeeAddress, apiId, newWalletAddress, timestampHeader, signatureHeader, nowMs, maxSkewMs } = params;

  // 1. Parse and validate timestamp
  const timestampSeconds = Number(timestampHeader);
  if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) {
    return { ok: false, error: "invalid_timestamp" };
  }
  if (!isTimestampWithinSkew(timestampSeconds, nowMs, maxSkewMs)) {
    return { ok: false, error: "timestamp_expired" };
  }

  // 2. Decode the base64 signature
  let sigBytes: Buffer;
  try {
    sigBytes = Buffer.from(signatureHeader, "base64");
    if (sigBytes.length !== 64) throw new Error("wrong length");
  } catch {
    return { ok: false, error: "invalid_signature_encoding" };
  }

  // 3. Load the current payee's public key (must be a valid Stellar G... address)
  let keypair: Keypair;
  try {
    keypair = Keypair.fromPublicKey(currentPayeeAddress);
  } catch {
    return { ok: false, error: "invalid_public_key" };
  }

  // 4. Reconstruct the challenge and verify
  const message = buildPayeeChangeMessage(apiId, newWalletAddress, timestampSeconds);
  const msgBytes = Buffer.from(message, "utf8");

  const valid = keypair.verify(msgBytes, sigBytes);
  if (!valid) {
    return { ok: false, error: "signature_mismatch" };
  }

  return { ok: true };
}
