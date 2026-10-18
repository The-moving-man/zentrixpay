import { useEffect, useRef, useState } from "react";
import { networks } from "@zentrixpay/registry-client";

type BalanceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; balance: string }
  | { status: "error"; message: string };

function resolvePreset() {
  const raw = (import.meta.env.VITE_STELLAR_NETWORK as string | undefined)?.trim().toLowerCase();
  return raw === "public" || raw === "mainnet" || raw === "pubnet"
    ? networks.mainnet
    : networks.testnet;
}

/**
 * Fetches the connected wallet's USDC balance from Horizon.
 * Returns "0" when the trustline is missing.
 * Re-fetches every time `address` changes.
 */
export function useUsdcBalance(address: string | null): BalanceState {
  const [state, setState] = useState<BalanceState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!address) {
      setState({ status: "idle" });
      return;
    }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setState({ status: "loading" });

    const { horizonUrl, usdcClassicIssuer } = resolvePreset();

    fetch(`${horizonUrl}/accounts/${address}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 404) {
            // Account doesn't exist on network yet
            setState({ status: "ready", balance: "0" });
            return;
          }
          throw new Error(`Horizon error: ${res.status}`);
        }
        const data = await res.json();
        const usdcLine = (
          data.balances as Array<{ asset_code?: string; asset_issuer?: string; balance: string }>
        ).find((b) => b.asset_code === "USDC" && b.asset_issuer === usdcClassicIssuer);
        setState({ status: "ready", balance: usdcLine?.balance ?? "0" });
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Could not fetch balance",
        });
      });

    return () => ctrl.abort();
  }, [address]);

  return state;
}
