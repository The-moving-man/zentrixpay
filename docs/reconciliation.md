# Reconciliation

Detects and reports discrepancies between the ZentrixPay database and the
on-chain Stellar registry.

## What reconciliation checks

The reconciliation script walks every resource in the Postgres database that is
marked as `onchain_status = "registered"`, fetches the matching entry from the
`vault-registry` Soroban contract on Stellar testnet, and compares the two
sources of truth. For each registered DB resource it detects one of three
outcomes:

- **In sync** — the on-chain entry exists and its price matches the DB price
  (after converting the DB string price to stroops).
- **Price mismatch** — the on-chain entry exists but its price differs from the
  DB price. This usually means a `set_price` transaction succeeded on-chain but
  the DB was not updated (or vice versa).
- **Missing on-chain** — the DB row says `registered`, but the contract has no
  entry for that resource ID. This typically points to a confirmed-then-rolled-back
  registration, or a bug in the registration flow that flipped the DB status
  without the transaction actually landing.

The script also calls the contract's `count()` and compares it against the
number of DB rows with `onchain_status = "registered"`. If the chain has more
entries than the DB, the script flags this as a "missing in DB" delta. The
`vault-registry` contract does not expose an enumeration method, so the script
cannot list the specific IDs that exist on-chain but not in the DB — only the
count gap is reported. Operators must investigate orphan on-chain entries
manually (e.g. via the Stellar Explorer or by replaying registration events).

**Reconciliation is read-only.** The script never writes to the database or
submits a transaction. Any discrepancy must be resolved manually — see
[Fixing discrepancies](#fixing-discrepancies) below.

## When to run it

- After any batch publish operation, to confirm every new resource landed on-chain.
- After a suspected sync failure, a server restart mid-registration, or a
  deployment that touched the publish or registry code paths.
- Periodically in production (recommended: daily via a scheduled GitHub Actions
  job or a cron container) so drift is caught within 24 hours rather than
  weeks.
- Before opening a PR that touches publish or registry logic, so reviewers can
  see the baseline state of DB ↔ chain alignment.

## Prerequisites

- Node.js 20 or later (the repo root targets the same Node version as the rest
  of the workspace).
- `pnpm` installed globally.
- `server/.env` populated with the environment variables the reconciliation
  script reads transitively through `server/src/config.ts`:
  - `DATABASE_URL` — Supabase Postgres connection string.
  - `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — required by the shared server
    config even though reconcile itself only needs the Postgres connection.
  - `SOROBAN_RPC_URL` — defaults to `https://soroban-testnet.stellar.org`.
  - `REGISTRY_CONTRACT_ID` and `VAULT_REGISTRY_CONTRACT_ID` — the deployed
    vault-registry contract ID.
  - `REGISTRY_SECRET_KEY` — read-only calls use the public key derived from
    this secret; it is never used to sign anything during reconciliation.
  - `PAY_TO`, `AGENT_SECRET_KEY`, `OPENROUTER_API_KEY` — required by the
    shared config schema; reconcile does not use them directly.
- Network access to the Soroban RPC endpoint (default
  `https://soroban-testnet.stellar.org`) and to your Supabase Postgres host.

## How to run

```bash
# From the repo root
cd server
pnpm reconcile

# Or directly
pnpm tsx scripts/reconcile.ts

# Machine-readable JSON output for CI / dashboards
pnpm reconcile -- --json
```

| Flag     | Description                                            |
|----------|--------------------------------------------------------|
| `--json` | Print the typed summary as a single JSON object on     |
|          | stdout instead of the formatted text report.           |

## Understanding the output

Each registered DB resource produces a single per-row log line as it is
checked, then a summary block prints at the end of the run. A typical run with
two price mismatches and one missing-on-chain looks like this:

```
Checking abc123def456 ... PRICE MISMATCH (db=0.50, chain=0.25)
Checking xyz789uvw012 ... PRICE MISMATCH (db=1.00, chain=2.00)
Checking missing001 ... MISSING ON-CHAIN
Checking clx5n8z00aaaabbbbcccc ... OK
...
========================================
ZentrixPay Reconciliation Summary
Run at: 2026-05-28T10:32:00.000Z
Resources checked:      42
In sync:                39
Price mismatches:       2
Missing on-chain:       1
Missing in DB:          0

MISMATCHES (2)
----------------------------------------
Resource ID: abc123def456
DB price:    0.50 USDC
Chain price: 0.25 USDC
Publisher:   GBXXX...

Resource ID: xyz789uvw012
DB price:    1.00 USDC
Chain price: 2.00 USDC
Publisher:   GCYYY...

MISSING ON-CHAIN (1)
----------------------------------------
Resource ID: missing001
DB price:    0.10 USDC
Publisher:   GAZZZ...

========================================
Result: NEEDS ATTENTION (3 issues found)
```

What each line means:

- **Run at** — ISO 8601 timestamp captured at the start of the reconciliation
  run.
- **Resources checked** — total number of DB rows with
  `onchain_status = "registered"` that were inspected.
- **In sync** — count of rows whose on-chain price matches the DB price after
  the USDC→stroops conversion.
- **Price mismatches** — count of rows where both the DB and the chain have an
  entry but the prices differ.
- **Missing on-chain** — count of rows that claim `registered` in the DB but
  for which the contract returns no entry.
- **Missing in DB** — count delta between `count()` on-chain and the DB's
  registered count, when the chain has more entries than the DB. The contract
  has no enumeration method, so this section reports a single placeholder
  entry stating how many orphans exist rather than listing their IDs.
- **MISMATCHES / MISSING ON-CHAIN / MISSING IN DB** sections — only printed
  when their respective count is greater than zero. Each entry lists the
  resource ID, the relevant prices, and the publisher wallet so an operator
  can identify the offending row quickly.
- **Result** — final verdict. `ALL CLEAR` when there are zero issues,
  `NEEDS ATTENTION (<n> issues found)` otherwise.

If there are zero discrepancies, the summary collapses to just the counts
followed by `Result: ALL CLEAR`:

```
========================================
ZentrixPay Reconciliation Summary
Run at: 2026-05-28T10:32:00.000Z
Resources checked:      42
In sync:                42
Price mismatches:       0
Missing on-chain:       0
Missing in DB:          0
========================================
Result: ALL CLEAR
```

## Exit codes

| Code | Meaning                                          |
|------|--------------------------------------------------|
| `0`  | All registered resources are in sync             |
| `1`  | One or more discrepancies were found             |
| `2`  | Script failed to run (config or network error)   |

The non-zero exit on discrepancy makes the script safe to wire into a CI job
or a scheduled health check — see [Running in CI](#running-in-ci).

## Fixing discrepancies

The reconciliation script is reporting-only. It will never call `set_price`,
flip an `onchain_status` field, or otherwise mutate state. Each finding must
be resolved by hand:

- **Price mismatch** — decide which side is canonical. If the chain price is
  the intended one, update the DB row's `price` column to match. If the DB
  price is the intended one, have the publisher submit a `set_price`
  transaction via `POST /resources/:id/price/prepare` and
  `POST /resources/:id/price` (see
  [creator-signed-registration-flow.md](creator-signed-registration-flow.md)
  for the prepare/submit pattern).
- **Missing on-chain** — the DB believes the resource is registered but the
  contract has no entry. Re-trigger registration by calling
  `POST /resources/:id/register/prepare` and
  `POST /resources/:id/register`. Confirm by re-running `pnpm reconcile`.
- **Missing in DB** — an on-chain entry has no DB counterpart. Because the
  contract does not expose enumeration, you will need to identify the orphan
  ID(s) from another source — the Stellar Explorer, a saved transaction
  receipt, or an audit log — then either insert the matching DB row manually
  or, if the entry is truly garbage, leave it on-chain and document the gap.

## Running in CI

The exit codes make the script trivial to schedule. The following GitHub
Actions workflow runs reconciliation daily and fails the job on any
discrepancy, which pages whoever has the repo's failure notifications turned
on.

```yaml
name: Reconciliation check
on:
  schedule:
    - cron: '0 6 * * *'   # daily at 06:00 UTC
  workflow_dispatch:
jobs:
  reconcile:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: cd server && pnpm install --frozen-lockfile
      - run: cd server && pnpm reconcile
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          SOROBAN_RPC_URL: ${{ secrets.SOROBAN_RPC_URL }}
          REGISTRY_CONTRACT_ID: ${{ secrets.REGISTRY_CONTRACT_ID }}
          VAULT_REGISTRY_CONTRACT_ID: ${{ secrets.VAULT_REGISTRY_CONTRACT_ID }}
          REGISTRY_SECRET_KEY: ${{ secrets.REGISTRY_SECRET_KEY }}
          PAY_TO: ${{ secrets.PAY_TO }}
          AGENT_SECRET_KEY: ${{ secrets.AGENT_SECRET_KEY }}
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
```

Add `-- --json` to the `pnpm reconcile` line and pipe the output to a log
collector or dashboard if you want machine-readable history.
