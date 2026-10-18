#!/usr/bin/env node
/**
 * Load test for the proxy route (server/src/routes/apis.ts).
 *
 * Starts a local mock upstream HTTP server, runs autocannon directly against
 * the upstream (baseline) and then through the proxy with the paywall
 * disabled, and reports p50/p95 latency overhead plus requests/sec.
 *
 * Usage:
 *   node scripts/loadtest-proxy.mjs
 *   npm run loadtest:proxy
 *
 * Env overrides:
 *   LOADTEST_CONNECTIONS   (default 10)
 *   LOADTEST_DURATION      (default 5)   seconds
 *   LOADTEST_AMOUNT        (default 0)   if > 0, fixed request count instead of duration
 *   LOADTEST_PIPELINING    (default 1)
 *   LOADTEST_MAX_P95_OVERHEAD_MS (default 250) fail threshold
 *   LOADTEST_MIN_RPS       (default 50)  fail threshold
 */

import http from 'node:http';
import { once } from 'node:events';
import process from 'node:process';
import autocannon from 'autocannon';

const CONNECTIONS = Number(process.env.LOADTEST_CONNECTIONS ?? 10);
const DURATION = Number(process.env.LOADTEST_DURATION ?? 5);
const AMOUNT = Number(process.env.LOADTEST_AMOUNT ?? 0);
const PIPELINING = Number(process.env.LOADTEST_PIPELINING ?? 1);
const MAX_P95_OVERHEAD_MS = Number(process.env.LOADTEST_MAX_P95_OVERHEAD_MS ?? 250);
const MIN_RPS = Number(process.env.LOADTEST_MIN_RPS ?? 50);

const UPSTREAM_PATH = '/mock-upstream';
const PROXY_PATH = '/apis/proxy';

function log(...args) {
  // eslint-disable-next-line no-console
  console.log('[loadtest-proxy]', ...args);
}

function startMockUpstream() {
  const server = http.createServer((req, res) => {
    // Small deterministic body so the proxy has something to stream back.
    const body = JSON.stringify({
      ok: true,
      path: req.url,
      method: req.method,
      ts: Date.now(),
    });
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
  });
  return server;
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return port;
}

function runAutocannon(url) {
  return new Promise((resolve, reject) => {
    const opts = {
      url,
      connections: CONNECTIONS,
      pipelining: PIPELINING,
      // autocannon requires either duration or amount
      duration: AMOUNT > 0 ? undefined : DURATION,
      amount: AMOUNT > 0 ? AMOUNT : undefined,
    };
    const instance = autocannon(opts, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
    instance.on('error', reject);
  });
}

function summarize(label, result) {
  const rps = result.requests.average;
  const p50 = result.latency.p50;
  const p95 = result.latency.p95;
  const p99 = result.latency.p99;
  log(
    `${label}: rps=${rps.toFixed(1)} p50=${p50}ms p95=${p95}ms p99=${p99}ms ` +
      `errors=${result.errors} non2xx=${result.non2xx} total=${result.requests.total}`,
  );
  return { rps, p50, p95, p99, errors: result.errors, non2xx: result.non2xx };
}

async function main() {
  const upstream = startMockUpstream();
  const upstreamPort = await listen(upstream);
  const upstreamUrl = `http://127.0.0.1:${upstreamPort}${UPSTREAM_PATH}`;
  log(`mock upstream listening on ${upstreamUrl}`);

  // Configure the proxy to point at the mock upstream with the paywall disabled.
  process.env.PAYWALL_DISABLED = 'true';
  process.env.PROXY_UPSTREAM_URL = `http://127.0.0.1:${upstreamPort}`;
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';

  let proxyServer;
  let proxyPort;
  try {
    const { createApp } = await import('../server/src/app.js');
    const app = await createApp({
      paywallDisabled: true,
      upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}`,
    });
    proxyServer = http.createServer(app);
    proxyPort = await listen(proxyServer);
  } catch (err) {
    log('failed to start proxy app:', err && err.message ? err.message : err);
    upstream.close();
    process.exit(1);
  }

  const proxyUrl = `http://127.0.0.1:${proxyPort}${PROXY_PATH}`;
  log(`proxy listening on ${proxyUrl}`);

  let baseline;
  let proxied;
  try {
    log('running baseline (direct to upstream)...');
    baseline = summarize('baseline', await runAutocannon(upstreamUrl));

    log('running proxied...');
    proxied = summarize('proxied ', await runAutocannon(proxyUrl));
  } finally {
    proxyServer.close();
    upstream.close();
  }

  const p50Overhead = proxied.p50 - baseline.p50;
  const p95Overhead = proxied.p95 - baseline.p95;
  const p99Overhead = proxied.p99 - baseline.p99;

  log('--- results ---');
  log(`baseline rps: ${baseline.rps.toFixed(1)}`);
  log(`proxied  rps: ${proxied.rps.toFixed(1)}`);
  log(`p50 overhead: ${p50Overhead.toFixed(2)} ms`);
  log(`p95 overhead: ${p95Overhead.toFixed(2)} ms`);
  log(`p99 overhead: ${p99Overhead.toFixed(2)} ms`);

  const failures = [];
  if (proxied.errors > 0) failures.push(`proxied run had ${proxied.errors} errors`);
  if (proxied.non2xx > 0) failures.push(`proxied run had ${proxied.non2xx} non-2xx responses`);
  if (p95Overhead > MAX_P95_OVERHEAD_MS) {
    failures.push(
      `p95 overhead ${p95Overhead.toFixed(2)}ms exceeds threshold ${MAX_P95_OVERHEAD_MS}ms`,
    );
  }
  if (proxied.rps < MIN_RPS) {
    failures.push(`proxied rps ${proxied.rps.toFixed(1)} below threshold ${MIN_RPS}`);
  }

  if (failures.length > 0) {
    log('FAILED:');
    for (const f of failures) log(`  - ${f}`);
    process.exit(1);
  }

  log('OK');
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[loadtest-proxy] unexpected error:', err);
  process.exit(1);
});