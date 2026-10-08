import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import request from "supertest";

const { state } = vi.hoisted(() => ({
  state: { api: null as any, recorded: [] as any[] },
}));

vi.mock("../config.js", () => ({
  config: {
    BASE_URL: "http://gateway.test",
    UPSTREAM_SECRET_KEY: "11".repeat(32),
    PROXY_MAX_REQUEST_BODY: "1mb",
    PROXY_MAX_RESPONSE_BYTES: 1024,
    PROXY_DEFAULT_TIMEOUT_MS: 500,
    PROXY_MAX_TIMEOUT_MS: 1000,
    PROXY_ALLOW_PRIVATE_UPSTREAMS: true,
  },
}));
vi.mock("../db/client.js", () => ({ db: {} }));
vi.mock("../middleware/rateLimiters.js", () => ({
  publishIpRateLimit: (_q: unknown, _s: unknown, n: () => void) => n(),
  publishWalletRateLimit: (_q: unknown, _s: unknown, n: () => void) => n(),
}));
// The real x402 paywall needs a facilitator; here every call counts as paid.
vi.mock("../middleware/apiPaywall.js", async () => {
  const actual = await vi.importActual<typeof import("../middleware/apiPaywall.js")>(
    "../middleware/apiPaywall.js",
  );
  return { ...actual, apiPaywall: (_q: unknown, _s: unknown, n: () => void) => n() };
});
vi.mock("../services/apiService.js", async () => {
  const actual = await vi.importActual<typeof import("../services/apiService.js")>(
    "../services/apiService.js",
  );
  return {
    ...actual,
    getApiById: async (id: string) => (state.api?.id === id ? state.api : null),
    recordApiCall: async (call: unknown) => {
      state.recorded.push(call);
    },
  };
});

import router, { buildUpstreamUrl } from "./apis.js";
import { isPublicAddress, validateUpstreamUrl } from "../lib/upstreamGuard.js";
import { sendUpstream } from "../lib/upstreamClient.js";
import { encryptSecret, decryptSecret } from "../utils/secretBox.js";

describe("upstream guard", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "192.168.0.1",
    "::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
  ])("blocks %s", (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("allows %s", (ip) =>
    expect(isPublicAddress(ip)).toBe(true),
  );

  it("rejects private, credentialed and non-http upstream URLs", () => {
    const strict = { allowPrivate: false };
    expect(() => validateUpstreamUrl("http://localhost:3000", strict)).toThrow(/public/);
    expect(() => validateUpstreamUrl("http://[::1]/x", strict)).toThrow(/public/);
    expect(() => validateUpstreamUrl("https://u:p@api.example.com", strict)).toThrow(/credentials/);
    expect(() => validateUpstreamUrl("ftp://api.example.com", strict)).toThrow(/http/);
    expect(validateUpstreamUrl("https://api.example.com/v1", strict).hostname).toBe(
      "api.example.com",
    );
  });

  it("refuses to connect when a hostname resolves to a private address", async () => {
    await expect(
      sendUpstream({
        url: new URL("http://localhost:9/"),
        method: "GET",
        headers: {},
        timeoutMs: 1000,
        maxResponseBytes: 1024,
        allowPrivate: false,
      }),
    ).rejects.toMatchObject({ kind: "blocked" });
  });
});

describe("buildUpstreamUrl", () => {
  it("joins base path, sub path and both query strings", () => {
    const url = buildUpstreamUrl(
      "https://api.example.com/v1/?key=a",
      ["weather", "lagos city"],
      "/api/x/weather/lagos%20city?units=c",
    );
    expect(url?.toString()).toBe("https://api.example.com/v1/weather/lagos%20city?key=a&units=c");
  });

  it("refuses traversal and smuggled separators", () => {
    expect(buildUpstreamUrl("https://api.example.com/v1", [".."], "/api/x/..")).toBeNull();
    expect(buildUpstreamUrl("https://api.example.com/v1", ["a/b"], "/api/x/a%2Fb")).toBeNull();
    expect(buildUpstreamUrl("https://api.example.com/v1", ["a\\b"], "/api/x/a%5Cb")).toBeNull();
  });
});

describe("secretBox", () => {
  it("round-trips and detects tampering", () => {
    const key = "22".repeat(32);
    const enc = encryptSecret("sk_live_123", key);
    expect(enc).not.toContain("sk_live_123");
    expect(decryptSecret(enc, key)).toBe("sk_live_123");
    const parts = enc.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join(":"), key)).toThrow();
  });
});

describe("proxy route", () => {
  let upstream: http.Server;
  let seen: { url?: string; headers?: http.IncomingHttpHeaders; body?: string };
  const app = express();
  app.use(router);

  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen = { url: req.url, headers: req.headers, body };
        if (req.url?.startsWith("/v1/big")) return res.end("x".repeat(4096));
        if (req.url?.startsWith("/v1/slow")) return setTimeout(() => res.end("late"), 2000);
        if (req.url?.startsWith("/v1/fail")) return res.writeHead(500).end("boom");
        res.writeHead(200, { "content-type": "application/json", "set-cookie": "a=b" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", () => r()));
    const { port } = upstream.address() as AddressInfo;
    state.api = {
      id: "api1",
      listed: true,
      price: "0.01",
      walletAddress: "G".padEnd(56, "A"),
      allowedMethods: ["GET", "POST"],
      upstreamUrl: `http://127.0.0.1:${port}/v1`,
      upstreamHeaderName: "x-provider-key",
      upstreamHeaderValueEnc: encryptSecret("provider-secret", "11".repeat(32)),
      timeoutMs: null,
    };
  });

  afterAll(() => new Promise<void>((r) => upstream.close(() => r())));

  it("forwards method, path, query and body, injects the secret, strips caller headers", async () => {
    const res = await request(app)
      .post("/api/api1/items/42?expand=1")
      .set("content-type", "application/json")
      .set("x-payment", "abc")
      .set("cookie", "session=1")
      .send('{"a":1}');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(seen.url).toBe("/v1/items/42?expand=1");
    expect(seen.body).toBe('{"a":1}');
    expect(seen.headers?.["x-provider-key"]).toBe("provider-secret");
    expect(seen.headers?.["x-payment"]).toBeUndefined();
    expect(seen.headers?.cookie).toBeUndefined();
    expect(state.recorded.at(-1)).toMatchObject({
      apiId: "api1",
      charged: true,
      path: "/items/42",
      method: "POST",
    });
  });

  it("rejects methods the provider does not allow before any payment", async () => {
    const res = await request(app).delete("/api/api1/items/1");
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe("GET, POST");
  });

  it("returns 404 for unknown APIs", async () => {
    expect((await request(app).get("/api/nope")).status).toBe(404);
  });

  it("passes upstream errors through as uncharged calls", async () => {
    const res = await request(app).get("/api/api1/fail");
    expect(res.status).toBe(500);
    expect(state.recorded.at(-1)).toMatchObject({ charged: false, responseStatus: 500 });
  });

  it("maps oversize and slow upstream responses to 502/504", async () => {
    expect((await request(app).get("/api/api1/big")).status).toBe(502);
    expect((await request(app).get("/api/api1/slow")).status).toBe(504);
  });
});
