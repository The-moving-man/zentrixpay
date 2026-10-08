/**
 * Cache-freshness evaluation for browse results.
 *
 * The ZentrixPay catalog can be served through a cache, so browse output may lag
 * the authoritative on-chain registry. This module turns standard HTTP cache
 * headers (Age, Date, Cache-Control) into an agent-facing notice: a cache age
 * line when the data is fresh, or a stale warning (with a pointer to verify
 * on-chain) when it is not. It is pure and deterministic — the caller passes the
 * response headers and, optionally, the current time — so it is easy to unit
 * test across fresh, stale, and missing-metadata cases.
 */

export type CacheFreshnessStatus = "fresh" | "stale" | "unknown";

export interface CacheFreshness {
  status: CacheFreshnessStatus;
  ageSeconds?: number;
  maxAgeSeconds?: number;
  /** Agent-facing message, or null when there is no cache metadata to report. */
  notice: string | null;
}

/** Parse `max-age`/`s-maxage` (seconds) from a Cache-Control header value. */
function parseMaxAge(cacheControl: string | undefined): number | undefined {
  if (!cacheControl) return undefined;
  const match = /(?:^|,)\s*(?:s-maxage|max-age)\s*=\s*(\d+)/i.exec(cacheControl);
  return match ? Number(match[1]) : undefined;
}

/** True when Cache-Control forbids serving without revalidation. */
function forbidsStaleReuse(cacheControl: string | undefined): boolean {
  if (!cacheControl) return false;
  return /\b(no-cache|no-store|must-revalidate)\b/i.test(cacheControl);
}

/** Derive cache age in seconds from the Age header, falling back to Date. */
function deriveAgeSeconds(headers: Record<string, string>, nowMs: number): number | undefined {
  const ageHeader = headers["age"];
  if (ageHeader !== undefined && /^\d+$/.test(ageHeader.trim())) {
    return Number(ageHeader.trim());
  }
  const dateHeader = headers["date"];
  if (dateHeader) {
    const dateMs = Date.parse(dateHeader);
    if (!Number.isNaN(dateMs)) {
      return Math.max(0, Math.round((nowMs - dateMs) / 1000));
    }
  }
  return undefined;
}

/**
 * Evaluate cache freshness from response headers. Header keys are matched
 * case-insensitively via a lower-cased lookup, so callers should pass headers
 * with lower-cased keys (jsonFetch already does this).
 */
export function evaluateCacheFreshness(
  headers: Record<string, string>,
  nowMs: number = Date.now(),
): CacheFreshness {
  const cacheControl = headers["cache-control"];
  const ageSeconds = deriveAgeSeconds(headers, nowMs);
  const maxAgeSeconds = parseMaxAge(cacheControl);

  // No usable cache metadata at all — say nothing.
  if (ageSeconds === undefined && maxAgeSeconds === undefined && !forbidsStaleReuse(cacheControl)) {
    return { status: "unknown", notice: null };
  }

  if (ageSeconds !== undefined && maxAgeSeconds !== undefined) {
    if (ageSeconds > maxAgeSeconds) {
      return {
        status: "stale",
        ageSeconds,
        maxAgeSeconds,
        notice:
          `⚠ Catalog may be stale: cache age ${ageSeconds}s exceeds max-age ${maxAgeSeconds}s. ` +
          `Re-run zentrixpay_browse to refresh, or confirm a specific resource on-chain with zentrixpay_registry_lookup.`,
      };
    }
    return {
      status: "fresh",
      ageSeconds,
      maxAgeSeconds,
      notice: `Catalog cache age: ${ageSeconds}s (max-age ${maxAgeSeconds}s) — fresh.`,
    };
  }

  // A cache that forbids stale reuse but we cannot measure age against: warn.
  if (forbidsStaleReuse(cacheControl)) {
    return {
      status: "stale",
      ageSeconds,
      maxAgeSeconds,
      notice:
        "⚠ Catalog served with a no-cache/no-store policy; results may be stale. " +
        "Confirm a specific resource on-chain with zentrixpay_registry_lookup if freshness matters.",
    };
  }

  // We have one of age or max-age but not both — report what we know.
  if (ageSeconds !== undefined) {
    return { status: "unknown", ageSeconds, notice: `Catalog cache age: ${ageSeconds}s.` };
  }
  return { status: "unknown", maxAgeSeconds, notice: null };
}

/** Convenience wrapper: the notice string for a set of headers, or null. */
export function cacheStalenessNotice(
  headers: Record<string, string>,
  nowMs?: number,
): string | null {
  return evaluateCacheFreshness(headers, nowMs).notice;
}
