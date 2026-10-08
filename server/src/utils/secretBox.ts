import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for small secrets stored at rest (providers' upstream API keys).
// Encoded as "v1:<iv>:<tag>:<ciphertext>", each part base64.

const VERSION = "v1";

function keyFromHex(hexKey: string): Buffer {
  const key = Buffer.from(hexKey, "hex");
  if (key.length !== 32) throw new Error("secret key must be 32 bytes (64 hex chars)");
  return key;
}

export function encryptSecret(plaintext: string, hexKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromHex(hexKey), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((p) => (typeof p === "string" ? p : p.toString("base64")))
    .join(":");
}

export function decryptSecret(encoded: string, hexKey: string): string {
  const [version, iv, tag, ciphertext] = encoded.split(":");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
    throw new Error("unrecognised secret encoding");
  }
  const decipher = createDecipheriv("aes-256-gcm", keyFromHex(hexKey), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
