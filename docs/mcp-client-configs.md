# MCP Client Configs

Copy-ready configuration for connecting an agent client to the ZentrixPay MCP
server. Every block below is complete — paste it, fix the path, restart the
client.

The server speaks MCP over **stdio**: the client launches `node
/path/to/zentrixpay/mcp/dist/index.js` and talks to it over stdin/stdout. There
is no port, no HTTP endpoint, and no daemon to keep running.

**Build it first** — the configs point at `dist/`, not `src/`:

```bash
cd zentrixpay/mcp
pnpm install
pnpm build          # produces mcp/dist/index.js
```

Use an **absolute path** everywhere below. Most clients launch the server with
an unpredictable working directory, so a relative path silently fails to start.

Already connected to the server through one client and want to add it to
another? Call the `zentrixpay_client_config` tool (pass `client`, e.g.
`"cursor"`, or omit it for every client) — it emits the same blocks as this
page, but pre-filled with this running process's actual entrypoint path and
detected network profile instead of the placeholder path and testnet
defaults shown here.

---

## Claude Code

CLI (recommended — writes the config for you):

```bash
claude mcp add zentrixpay node /absolute/path/to/zentrixpay/mcp/dist/index.js
```

With environment variables, and scoped to a single project:

```bash
claude mcp add zentrixpay \
  --scope project \
  --env STELLAR_NETWORK=testnet \
  --env ZENTRIXPAY_URL=https://mindvault-hyr3.onrender.com \
  -- node /absolute/path/to/zentrixpay/mcp/dist/index.js
```

Project scope writes `.mcp.json` in the repo root, which you can also create by
hand and commit:

```json
{
  "mcpServers": {
    "zentrixpay": {
      "command": "node",
      "args": ["/absolute/path/to/zentrixpay/mcp/dist/index.js"],
      "env": {
        "STELLAR_NETWORK": "testnet",
        "ZENTRIXPAY_URL": "https://mindvault-hyr3.onrender.com"
      }
    }
  }
}
```

Verify with `claude mcp list`, then ask the agent to run `zentrixpay_browse`.

## Claude Desktop

Edit `claude_desktop_config.json`:

- macOS — `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows — `%APPDATA%\Claude\claude_desktop_config.json`
- Linux — `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "zentrixpay": {
      "command": "node",
      "args": ["/absolute/path/to/zentrixpay/mcp/dist/index.js"],
      "env": {
        "STELLAR_NETWORK": "testnet"
      }
    }
  }
}
```

Restart Claude Desktop after saving — it reads the file only at launch.

## Codex

```bash
codex mcp add zentrixpay -- node /absolute/path/to/zentrixpay/mcp/dist/index.js
```

Or by hand in `~/.codex/config.toml`:

```toml
[mcp_servers.zentrixpay]
command = "node"
args = ["/absolute/path/to/zentrixpay/mcp/dist/index.js"]

[mcp_servers.zentrixpay.env]
STELLAR_NETWORK = "testnet"
```

## Cursor

`.cursor/mcp.json` in the project (or `~/.cursor/mcp.json` for every project):

```json
{
  "mcpServers": {
    "zentrixpay": {
      "command": "node",
      "args": ["/absolute/path/to/zentrixpay/mcp/dist/index.js"],
      "env": {
        "STELLAR_NETWORK": "testnet"
      }
    }
  }
}
```

## VS Code (GitHub Copilot agent mode)

`.vscode/mcp.json` in the workspace:

```json
{
  "servers": {
    "zentrixpay": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/zentrixpay/mcp/dist/index.js"],
      "env": {
        "STELLAR_NETWORK": "testnet"
      }
    }
  }
}
```

## Windsurf

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "zentrixpay": {
      "command": "node",
      "args": ["/absolute/path/to/zentrixpay/mcp/dist/index.js"],
      "env": {
        "STELLAR_NETWORK": "testnet"
      }
    }
  }
}
```

## Any other MCP client

Anything that can launch a stdio MCP server works with:

| Setting     | Value                                           |
| ----------- | ----------------------------------------------- |
| Transport   | stdio                                           |
| Command     | `node`                                          |
| Arguments   | `/absolute/path/to/zentrixpay/mcp/dist/index.js` |
| Environment | see below (all optional on testnet)             |

---

## Environment variables

Every variable is optional: with none set, the server targets Stellar **testnet**
and the hosted ZentrixPay backend.

| Variable                          | Default                                                | Description                                                                                                      |
| --------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `ZENTRIXPAY_URL`                   | `https://mindvault-hyr3.onrender.com`                  | ZentrixPay API base URL                                                                                           |
| `SPONSORED_ACCOUNT_URL`           | `https://stellar-sponsored-agent-account.onrender.com` | Sponsored wallet creation service                                                                                |
| `STELLAR_NETWORK`                 | `testnet`                                              | Deployment target: `testnet` or `mainnet` (`pubnet`/`public` also accepted)                                      |
| `NETWORK`                         | from `STELLAR_NETWORK`                                 | x402 network id (`stellar:testnet` / `stellar:pubnet`)                                                           |
| `SOROBAN_RPC_URL`                 | preset for the network                                 | Soroban RPC (tx status, contract reads)                                                                          |
| `HORIZON_URL`                     | preset for the network                                 | Horizon (balance checks)                                                                                         |
| `USDC_CONTRACT_ID`                | preset for the network                                 | USDC Stellar Asset Contract used by x402                                                                         |
| `VAULT_REGISTRY_CONTRACT_ID`      | testnet default; **required on mainnet**               | Deployed vault-registry contract                                                                                 |
| `ZENTRIXPAY_ALLOW_MAINNET`         | unset                                                  | Allows mainnet mutations without per-call confirmation. See [security notes](#security-notes)                    |
| `ZENTRIXPAY_METRICS`               | unset                                                  | Set `1` to collect opt-in tool metrics ([docs](mcp-metrics.md))                                                  |
| `ZENTRIXPAY_MOCK`                  | unset                                                  | Set `1` for offline mock mode — no network, no funds, deterministic fixtures                                     |
| `ZENTRIXPAY_AUDIT_LOG`             | unset                                                  | Set `1` to log mutating tool calls to stderr (arguments and payloads are redacted)                               |
| `ZENTRIXPAY_AGENT_SECRET`          | unset                                                  | Stellar secret key `zentrixpay_import_wallet` reads when none is passed. See [security notes](#security-notes)    |
| `ZENTRIXPAY_PURCHASES_FILE`        | `~/.zentrixpay/purchases.json`                          | Where purchase receipts are stored, read by `zentrixpay_purchase_history` and `zentrixpay_export_receipts`         |
| `ZENTRIXPAY_RESOURCE_HISTORY_FILE` | `~/.zentrixpay/resource-history.jsonl`                  | Append-only audit path used by the resource provenance and change-log tools                                      |
| `ZENTRIXPAY_MAX_AUTO_PAY_USDC`     | `10`                                                   | Ceiling on an x402 payment `zentrixpay_buy` will make without `maxAutoPayUsdc` ([docs](environment-variables.md)) |

Overriding a network value without changing `STELLAR_NETWORK` is a common
mistake, so the server cross-checks them at startup and refuses to launch on a
genuine mismatch (for example a mainnet RPC with `STELLAR_NETWORK=testnet`).
`zentrixpay_network_profile` reports the resolved configuration and warns about
any override that diverges from the preset.

Resource history defaults to `~/.zentrixpay/resource-history.jsonl`; set
`ZENTRIXPAY_RESOURCE_HISTORY_FILE` to use a different append-only audit path.

There is no `.env` file for the MCP server — variables come from the client
config or the shell that launches it. `mcp/.env.example` documents the same
variables for reference.

---

## State path

Wallets and publisher API keys are persisted so a restart does not lose the
agent's identity:

|             |                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| Path        | `~/.zentrixpay/state.json`                                                                               |
| Permissions | `0600` (owner read/write only), directory created on first write                                        |
| Contents    | Named wallet profiles: `{ publicKey, secretKey }` and the publisher API key per profile                 |
| Written by  | `zentrixpay_setup_wallet`, `zentrixpay_register`, `zentrixpay_use_profile`, `zentrixpay_restore_state`      |
| Cleared by  | `zentrixpay_reset` (active profile) or `zentrixpay_reset {"all": true}` (every profile, deletes the file) |

The path is fixed — it is the launching user's home directory, so each OS user
has an isolated store. Two clients pointed at the same build share that state.
Keep separate identities in separate **profiles** rather than separate files
(see [wallet profiles](mcp-wallet-profiles.md)).

To move an agent between machines, use `zentrixpay_backup_state` /
`zentrixpay_restore_state`: the blob is encrypted with a passphrase you supply
and contains no plaintext secrets. Copying `state.json` directly copies raw
secret keys and is not recommended.

---

## Network profile

|                   | Testnet (default)                      | Mainnet                                                     |
| ----------------- | -------------------------------------- | ----------------------------------------------------------- |
| `STELLAR_NETWORK` | `testnet`                              | `mainnet`                                                   |
| x402 network      | `stellar:testnet`                      | `stellar:pubnet`                                            |
| Soroban RPC       | `https://soroban-testnet.stellar.org`  | `https://soroban.stellar.org`                               |
| Horizon           | `https://horizon-testnet.stellar.org`  | `https://horizon.stellar.org`                               |
| USDC SAC          | `CBIELTK6…HMXQDAMA`                    | `CCW67TSZ…EO7SJMI75`                                        |
| Vault registry    | `CDQKUIAD…A72FJ3OD4` (shipped default) | none — deploy your own and set `VAULT_REGISTRY_CONTRACT_ID` |
| Funds at risk     | none (test USDC)                       | **real USDC**                                               |

Mainnet config, with the guardrail left on:

```json
{
  "mcpServers": {
    "zentrixpay-mainnet": {
      "command": "node",
      "args": ["/absolute/path/to/zentrixpay/mcp/dist/index.js"],
      "env": {
        "STELLAR_NETWORK": "mainnet",
        "VAULT_REGISTRY_CONTRACT_ID": "C...your deployed registry...",
        "ZENTRIXPAY_URL": "https://your-zentrixpay-api.example.com"
      }
    }
  }
}
```

Offline development, no backend or funded wallet required:

```json
{
  "mcpServers": {
    "zentrixpay-mock": {
      "command": "node",
      "args": ["/absolute/path/to/zentrixpay/mcp/dist/index.js"],
      "env": { "ZENTRIXPAY_MOCK": "1" }
    }
  }
}
```

Register both testnet and mainnet entries under different server names if you
need them side by side, and keep their wallets in separate profiles.

---

## Security notes

**The server holds spendable keys.** `~/.zentrixpay/state.json` contains Stellar
secret keys and publisher API keys in plaintext at mode `0600`. Anyone who can
read that file can spend the agent's USDC. Do not commit it, sync it to shared
storage, or copy it between machines unencrypted — use
`zentrixpay_backup_state` instead.

**Mainnet spends real money.** Tools that mutate state or spend funds
(`setup_wallet`, `register`, `publish`, `buy`, `register_onchain`, `reset`) are
blocked on mainnet unless the call passes `confirmMainnet: true`.
`ZENTRIXPAY_ALLOW_MAINNET=1` disables that prompt for the whole process — set it
only for unattended runs you have deliberately reviewed. Read-only tools are
never gated.

**Fund with what you intend to spend.** An agent's wallet can spend its entire
USDC balance across `buy` and verification fees. Keep only the working budget in
the agent's profile.

**Env values are not secrets, but paths are.** Nothing in the table above is a
credential, so an MCP config file is safe to commit — as long as it does not
point at a state file or wallet you would not share.

**Errors are redacted.** Tool output and diagnostics pass through a redactor
that masks Stellar secret keys, API keys, and bearer tokens, so a failure
transcript is safe to paste into an issue. Invalid arguments are rejected
without echoing the value back (see [tool argument
validation](mcp-tool-arguments.md)).

**Verify what you connect to.** `zentrixpay_network_profile` reports the live
network, RPC/Horizon URLs, and registry contract, and flags overrides that
diverge from the preset; `zentrixpay_registry_info` reports the contract the
server will read from. Run both after changing a config.

---

## Troubleshooting

| Symptom                                             | Cause / fix                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Client shows the server as failed                   | Path is wrong or `dist/` is not built. Run `pnpm build` in `mcp/`, use an absolute path.                      |
| `Cannot find module …/dist/index.js`                | Same — the config points at `src/` or a stale path.                                                           |
| Server exits at startup with a config error list    | A genuine env mismatch. The report names each variable and the expected value.                                |
| Tools appear but every call errors with `No wallet` | Run `zentrixpay_setup_wallet` first; state lives per OS user.                                                  |
| Mainnet calls rejected with a guardrail message     | Expected — pass `confirmMainnet: true`, or set `ZENTRIXPAY_ALLOW_MAINNET=1`.                                   |
| Node not found                                      | The client may not inherit your shell `PATH`. Use an absolute node path (`/usr/local/bin/node`).              |
| Not sure if the install is correct                  | Call `zentrixpay_verify_install` — it checks Node.js version, env vars, and config locally (no network calls). |

---

## Related

- [MCP quickstart](mcp-quickstart.md) — full agent session, wallet through purchase
- [Tool reference](mcp-tool-reference.md) — every tool with its description, grouped by function
- [Tool argument validation](mcp-tool-arguments.md)
- [Wallet profiles](mcp-wallet-profiles.md)
- [Metrics](mcp-metrics.md)
- [Smoke test](mcp-smoke-test.md)
- [Install verification](mcp-verify-install.md)
