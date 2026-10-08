/**
 * Metadata hash (digest) validation for the ZentrixPay MCP server.
 *
 * Resources anchor their off-chain content in the vault registry through a
 * digest: the server writes `{ title, description, contentHash }` into the
 * on-chain `metadata` pointer, and clients compare that digest against the
 * bytes they actually received. For that comparison to be meaningful every
 * participant has to agree on one spelling of a digest — otherwise
 * `SHA256:AB…`, `sha256-ab…` and `ab…` all describe the same bytes but
 * compare unequal.
 *
 * This module fixes that format:
 *
 *   - `sha256` — 64 hex characters
 *   - `sha512` — 128 hex characters
 *
 * Each may be written bare (`ab12…`) or algorithm-prefixed with `:` or `-`
 * (`sha256:ab12…`, `sha256-ab12…`), in either case. The canonical form
 * returned by this module is always lowercase `"<algorithm>:<hex>"`, so two
 * accepted spellings of the same digest always canonicalize to the same
 * string.
 *
 * Errors are deterministic and safe for agent-facing output: they name the
 * field, the reason, and the expected shape, and never echo secrets. The
 * module is pure (no I/O, no globals) so it is unit-testable in isolation.
 */

/** Digest algorithms accepted for metadata anchors, keyed by hex length. */
export const METADATA_HASH_ALGORITHMS = {
  sha256: 64,
  sha512: 128,
} as const;

export type MetadataHashAlgorithm = keyof typeof METADATA_HASH_ALGORITHMS;

/** Algorithm names in a stable order — used in docs and error messages. */
export const METADATA_HASH_ALGORITHM_NAMES = Object.keys(
  METADATA_HASH_ALGORITHMS,
) as MetadataHashAlgorithm[];

/** Human-readable summary of every accepted spelling. */
export const METADATA_HASH_FORMAT_HINT =
  "sha256 (64 hex chars) or sha512 (128 hex chars), optionally prefixed " +
  'with "sha256:"/"sha512:" (or "-"); case-insensitive';

/** A digest that passed validation, in both parsed and canonical form. */
export interface ParsedMetadataHash {
  algorithm: MetadataHashAlgorithm;
  /** Lowercase hex digits, without an algorithm prefix. */
  hex: string;
  /** Canonical `"<algorithm>:<hex>"` spelling — compare digests on this. */
  canonical: string;
}

/** Why a value was rejected. Stable identifiers, safe to branch on. */
export type MetadataHashErrorCode =
  | "not_a_string"
  | "empty"
  | "unknown_algorithm"
  | "invalid_characters"
  | "invalid_length";

export class MetadataHashError extends Error {
  readonly code: MetadataHashErrorCode;
  /** The field the digest came from, e.g. "txHash" — used in the message. */
  readonly field: string;

  constructor(code: MetadataHashErrorCode, field: string, message: string) {
    super(message);
    this.name = "MetadataHashError";
    this.code = code;
    this.field = field;
  }
}

const HEX_ONLY = /^[0-9a-f]+$/;
const PREFIXED = /^([A-Za-z0-9]+)[:-](.*)$/;

/** Lengths accepted for a bare (unprefixed) digest, longest first. */
const LENGTH_TO_ALGORITHM = new Map<number, MetadataHashAlgorithm>(
  METADATA_HASH_ALGORITHM_NAMES.map((name) => [METADATA_HASH_ALGORITHMS[name], name]),
);

function acceptedLengths(): string {
  return METADATA_HASH_ALGORITHM_NAMES.map(
    (name) => `${name}=${METADATA_HASH_ALGORITHMS[name]}`,
  ).join(", ");
}

/**
 * Parse a metadata digest into its canonical form.
 *
 * Accepts a bare hex digest whose length identifies the algorithm, or an
 * explicitly prefixed digest. Throws {@link MetadataHashError} with a
 * deterministic message on anything else.
 *
 * @param value  the raw value supplied by the caller
 * @param field  field name used in error messages (default: "metadataHash")
 */
export function parseMetadataHash(value: unknown, field = "metadataHash"): ParsedMetadataHash {
  if (typeof value !== "string") {
    throw new MetadataHashError(
      "not_a_string",
      field,
      `${field} must be a string containing a ${METADATA_HASH_FORMAT_HINT}.`,
    );
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new MetadataHashError(
      "empty",
      field,
      `${field} must not be empty. Expected ${METADATA_HASH_FORMAT_HINT}.`,
    );
  }

  const prefixMatch = PREFIXED.exec(trimmed);
  let declared: MetadataHashAlgorithm | null = null;
  let digest = trimmed;

  if (prefixMatch) {
    const [, rawAlgorithm, rest] = prefixMatch;
    const algorithm = rawAlgorithm.toLowerCase();
    if (!(algorithm in METADATA_HASH_ALGORITHMS)) {
      throw new MetadataHashError(
        "unknown_algorithm",
        field,
        `${field} uses unsupported hash algorithm "${rawAlgorithm}". ` +
          `Supported algorithms: ${METADATA_HASH_ALGORITHM_NAMES.join(", ")}.`,
      );
    }
    declared = algorithm as MetadataHashAlgorithm;
    digest = rest;
  }

  const hex = digest.toLowerCase();
  if (!HEX_ONLY.test(hex)) {
    throw new MetadataHashError(
      "invalid_characters",
      field,
      `${field} must contain hexadecimal characters only (0-9, a-f). Expected ${METADATA_HASH_FORMAT_HINT}.`,
    );
  }

  if (declared) {
    const expected = METADATA_HASH_ALGORITHMS[declared];
    if (hex.length !== expected) {
      throw new MetadataHashError(
        "invalid_length",
        field,
        `${field} is ${hex.length} hex characters; ${declared} digests are ${expected}.`,
      );
    }
    return { algorithm: declared, hex, canonical: `${declared}:${hex}` };
  }

  const inferred = LENGTH_TO_ALGORITHM.get(hex.length);
  if (!inferred) {
    throw new MetadataHashError(
      "invalid_length",
      field,
      `${field} is ${hex.length} hex characters, which matches no supported digest ` +
        `(${acceptedLengths()}). Expected ${METADATA_HASH_FORMAT_HINT}.`,
    );
  }
  return { algorithm: inferred, hex, canonical: `${inferred}:${hex}` };
}

/** True when `value` is a well-formed metadata digest. Never throws. */
export function isValidMetadataHash(value: unknown): boolean {
  try {
    parseMetadataHash(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Canonicalize a digest to `"<algorithm>:<hex>"`, or return null when the
 * value is not a valid digest. Use this before comparing two digests.
 */
export function canonicalizeMetadataHash(value: unknown): string | null {
  try {
    return parseMetadataHash(value).canonical;
  } catch {
    return null;
  }
}

/** Report shape describing a digest found in (or missing from) a metadata pointer. */
export interface MetadataHashReport {
  present: boolean;
  valid: boolean;
  /** Canonical `"<algorithm>:<hex>"` when valid, else null. */
  canonical: string | null;
  algorithm: MetadataHashAlgorithm | null;
  /** Deterministic explanation when the digest is missing or malformed. */
  reason: string | null;
}

/**
 * Describe the content digest anchored in an on-chain metadata pointer.
 *
 * The server writes the pointer as compact JSON (`{ title, description,
 * contentHash }`). Anything else — a bare IPFS URI, a plain string, invalid
 * JSON — is reported as "no digest" rather than treated as an error, so this
 * is always safe to include in agent-facing output.
 */
export function describeMetadataPointerHash(pointer: unknown): MetadataHashReport {
  const absent = (reason: string): MetadataHashReport => ({
    present: false,
    valid: false,
    canonical: null,
    algorithm: null,
    reason,
  });

  if (typeof pointer !== "string" || pointer.trim() === "") {
    return absent("No metadata pointer recorded on-chain.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(pointer);
  } catch {
    return absent(
      "Metadata pointer is not JSON, so it carries no contentHash anchor " +
        "(bare URI/CID pointers are not digest-anchored).",
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return absent("Metadata pointer JSON is not an object, so it carries no contentHash anchor.");
  }

  const raw = (parsed as Record<string, unknown>).contentHash;
  if (raw === undefined || raw === null || raw === "") {
    return absent("Metadata pointer has no contentHash field.");
  }

  try {
    const hash = parseMetadataHash(raw, "contentHash");
    return {
      present: true,
      valid: true,
      canonical: hash.canonical,
      algorithm: hash.algorithm,
      reason: null,
    };
  } catch (err) {
    return {
      present: true,
      valid: false,
      canonical: null,
      algorithm: null,
      reason: err instanceof MetadataHashError ? err.message : "contentHash is not a valid digest.",
    };
  }
}
