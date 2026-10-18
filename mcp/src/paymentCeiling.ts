/**
 * Guardrail for automatic x402 payments.
 *
 * Prices are converted to Stellar's 7-decimal stroop precision before
 * comparison so a ceiling never depends on floating-point rounding.
 *
 * Session spend cap (#99): ZENTRIXPAY_SESSION_SPEND_LIMIT_USDC tracks the total
 * USDC spent across all paid calls in this process lifetime and refuses further
 * calls once the limit is reached.
 */

import { usdcToStroops } from "./usdcAmount.js";

export const DEFAULT_MAX_AUTO_PAY_USDC = "10";
export const DEFAULT_MAX_AUTO_FEE_STROOPS = "100000";

// ---------------------------------------------------------------------------
// Session spend tracking (#99)
// ---------------------------------------------------------------------------

/** In-memory total USDC paid this session, in stroops for exact arithmetic. */
let sessionSpentStroops: bigint = 0n;

/** Reset the session counter — used by tests and zentrixpay_reset. */
export function _resetSessionSpend(): void {
  sessionSpentStroops = 0n;
}

/** Current session spend in stroops (for diagnostics / tests). */
export function sessionSpentUsdc(): string {
  // Convert stroops back to a human-readable USDC string (7 decimals).
  const whole = sessionSpentStroops / 10_000_000n;
  const frac = sessionSpentStroops % 10_000_000n;
  if (frac === 0n) return String(whole);
  return `${whole}.${String(frac).padStart(7, "0").replace(/0+$/, "")}`;
}

/**
 * Record that a payment of `amountUsdc` was successfully made this session.
 * Called after a charged API call to keep the running total up to date.
 */
export function recordSessionSpend(amountUsdc: string): void {
  const stroops = usdcToStroops(amountUsdc);
  if (stroops === null) return; // defensive; amount was already validated upstream
  sessionSpentStroops += stroops;
}

/**
 * Throw if making a payment of `price` USDC would push the session total past
 * `ZENTRIXPAY_SESSION_SPEND_LIMIT_USDC`. No-ops when the env var is not set.
 */
export function assertWithinSessionSpendLimit(input: {
  price: string;
  env?: NodeJS.ProcessEnv;
}): void {
  const env = input.env ?? process.env;
  const limitRaw = env.ZENTRIXPAY_SESSION_SPEND_LIMIT_USDC;
  if (!limitRaw) return; // feature opt-in: no limit unless the env var is set

  const limitStroops = usdcToStroops(limitRaw);
  if (limitStroops === null) {
    throw new Error(
      "ZENTRIXPAY_SESSION_SPEND_LIMIT_USDC must be a non-negative USDC decimal with at most 7 decimal places.",
    );
  }

  const priceStroops = usdcToStroops(input.price);
  if (priceStroops === null) {
    throw new Error(
      "Automatic payment blocked because the resource price is missing or invalid; no x402 payment was submitted.",
    );
  }

  const projectedStroops = sessionSpentStroops + priceStroops;
  if (projectedStroops > limitStroops) {
    throw new Error(
      `Session spend limit reached. This call costs ${input.price} USDC but the session has already spent ${sessionSpentUsdc()} USDC of the ${limitRaw} USDC limit (ZENTRIXPAY_SESSION_SPEND_LIMIT_USDC). ` +
        `No payment was submitted. Restart the agent or increase the limit to continue making paid calls.`,
    );
  }
}

/**
 * Amounts are compared in stroops through the shared converter (#838) rather
 * than a local copy of the 10^7 factor, so a ceiling and the price it guards
 * can never be measured on two different scales.
 */
const toStroops = (value: string): bigint | null => usdcToStroops(value);

function configuredCeiling(env: NodeJS.ProcessEnv): { value: string; stroops: bigint } {
  const value = env.ZENTRIXPAY_MAX_AUTO_PAY_USDC ?? DEFAULT_MAX_AUTO_PAY_USDC;
  const stroops = toStroops(value);
  if (stroops === null) {
    throw new Error(
      "ZENTRIXPAY_MAX_AUTO_PAY_USDC must be a non-negative USDC decimal with at most 7 decimal places.",
    );
  }
  return { value, stroops };
}

/**
 * Prevent an automatic x402 payment above the configured ceiling unless the
 * caller explicitly authorizes a limit that covers the advertised price.
 */
export function assertAutoPaymentWithinCeiling(input: {
  price: unknown;
  maxAutoPayUsdc?: string;
  env?: NodeJS.ProcessEnv;
}): void {
  const requiredAmount = typeof input.price === "string" ? input.price : String(input.price ?? "");
  const requiredStroops = toStroops(requiredAmount);
  if (requiredStroops === null) {
    throw new Error(
      "Automatic payment blocked because the resource price is missing or invalid; no x402 payment was submitted.",
    );
  }

  const ceiling = configuredCeiling(input.env ?? process.env);
  if (requiredStroops <= ceiling.stroops) return;

  const overrideStroops =
    input.maxAutoPayUsdc === undefined ? null : toStroops(input.maxAutoPayUsdc);
  if (input.maxAutoPayUsdc !== undefined && overrideStroops === null) {
    throw new Error(
      "maxAutoPayUsdc must be a non-negative USDC decimal with at most 7 decimal places.",
    );
  }
  if (overrideStroops !== null && overrideStroops >= requiredStroops) return;

  throw new Error(
    `Purchase requires ${requiredAmount} USDC, which exceeds the automatic payment ceiling of ${ceiling.value} USDC. ` +
      `To authorize this purchase, call zentrixpay_buy with maxAutoPayUsdc: "${requiredAmount}" (or a higher amount).`,
  );
}

/** Bound sponsored Stellar transaction fees for registry mutations. */
export function assertTransactionFeeWithinCeiling(input: {
  feeStroops: string | number | bigint;
  env?: NodeJS.ProcessEnv;
}): void {
  const raw =
    input.env?.ZENTRIXPAY_MAX_AUTO_FEE_STROOPS ??
    process.env.ZENTRIXPAY_MAX_AUTO_FEE_STROOPS ??
    DEFAULT_MAX_AUTO_FEE_STROOPS;
  if (!/^\d+$/.test(raw))
    throw new Error("ZENTRIXPAY_MAX_AUTO_FEE_STROOPS must be a non-negative integer.");
  const fee = BigInt(String(input.feeStroops));
  const ceiling = BigInt(raw);
  if (fee > ceiling) {
    throw new Error(
      `On-chain mutation fee ${fee} stroops exceeds the automatic fee ceiling of ${ceiling} stroops.`,
    );
  }
}
