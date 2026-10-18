import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.MOCK_UPSTREAM_PORT ?? 8787);
const HOST = process.env.MOCK_UPSTREAM_HOST ?? '127.0.0.1';
const TOKEN = process.env.ZENTRIXPAY_TOKEN ?? 'local-dev-token';

const LARGE_BYTES = Number(process.env.MOCK_UPSTREAM_LARGE_BYTES ?? 1024 * 1024);

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${HOST}:${PORT}`}`);
  const path = url.pathname;

  try {
    if (path === '/.well-known/zentrixpay.txt') {
      const body = `${TOKEN}\n`;
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'content-length': Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }

    if (path === '/echo') {
      const raw = await readBody(req);
      let parsed: unknown = null;
      if (raw.length > 0) {
        try {
          parsed = JSON.parse(raw.toString('utf8'));
        } catch {
          parsed = raw.toString('utf8');
        }
      }
      sendJson(res, 200, {
        method: req.method,
        path,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: req.headers,
        body: parsed,
      });
      return;
    }

    if (path === '/slow') {
      const delayMs = Number(url.searchParams.get('ms') ?? 2000);
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(delayMs) ? delayMs : 2000));
      sendJson(res, 200, { ok: true, delayedMs: delayMs });
      return;
    }

    if (path === '/error') {
      const status = Number(url.searchParams.get('status') ?? 500);
      sendJson(res, Number.isFinite(status) ? status : 500, {
        error: 'mock upstream error',
        status: Number.isFinite(status) ? status : 500,
      });
      return;
    }

    if (path === '/large') {
      const size = Number(url.searchParams.get('bytes') ?? LARGE_BYTES);
      const total = Number.isFinite(size) && size > 0 ? size : LARGE_BYTES;
      const chunk = Buffer.alloc(1024, 'x');
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': total,
      });
      let written = 0;
      while (written < total) {
        const remaining = total - written;
        const slice = remaining >= chunk.length ? chunk : chunk.subarray(0, remaining);
        res.write(slice);
        written += slice.length;
      }
      res.end();
      return;
    }

    if (path === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { error: 'not found', path });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`mock upstream listening on http://${HOST}:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`ownership file: http://${HOST}:${PORT}/.well-known/zentrixpay.txt`);
});

export { server };
</｜｜DSML｜｜ parameter>
</｜｜DSML｜｜ invoke>
</｜｜DSML｜｜ calls>