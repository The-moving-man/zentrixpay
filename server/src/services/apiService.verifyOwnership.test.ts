import http from 'http';
import { AddressInfo } from 'net';
import { ApiService, ApiServiceError } from './apiService';

const TOKEN = 'correct-token';

interface ServerHandle {
  server: http.Server;
  url: string;
  close: () => Promise<void>;
}

function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<ServerHandle> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((res, rej) =>
            server.close((err) => (err ? rej(err) : res())),
          ),
      });
    });
  });
}

async function expectApiError(
  promise: Promise<unknown>,
  status: number,
  messageIncludes?: string,
): Promise<ApiServiceError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ApiServiceError);
    const apiErr = err as ApiServiceError;
    expect(apiErr.status).toBe(status);
    if (messageIncludes) {
      expect(apiErr.message).toContain(messageIncludes);
    }
    return apiErr;
  }
  throw new Error('Expected ApiServiceError to be thrown');
}

describe('ApiService.verifyOwnership', () => {
  const originalAllowPrivate = process.env.PROXY_ALLOW_PRIVATE_UPSTREAMS;

  afterEach(() => {
    if (originalAllowPrivate === undefined) {
      delete process.env.PROXY_ALLOW_PRIVATE_UPSTREAMS;
    } else {
      process.env.PROXY_ALLOW_PRIVATE_UPSTREAMS = originalAllowPrivate;
    }
  });

  it('marks verified and listed when the token matches', async () => {
    const handle = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`ownership token: ${TOKEN}`);
    });

    try {
      const service = new ApiService();
      const result = await service.verifyOwnership(handle.url, TOKEN);

      expect(result).toBeDefined();
      expect(result.verified).toBe(true);
      expect(result.listed).toBe(true);
    } finally {
      await handle.close();
    }
  });

  it('rejects with 422 when the token does not match', async () => {
    const handle = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ownership token: some-other-token');
    });

    try {
      const service = new ApiService();
      await expectApiError(
        service.verifyOwnership(handle.url, TOKEN),
        422,
      );
    } finally {
      await handle.close();
    }
  });

  it('rejects with 422 when the server responds 404', async () => {
    const handle = await startServer((req, res) => {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    });

    try {
      const service = new ApiService();
      await expectApiError(
        service.verifyOwnership(handle.url, TOKEN),
        422,
      );
    } finally {
      await handle.close();
    }
  });

  it('rejects with 422 on a non-200 status', async () => {
    const handle = await startServer((req, res) => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('server error');
    });

    try {
      const service = new ApiService();
      await expectApiError(
        service.verifyOwnership(handle.url, TOKEN),
        422,
      );
    } finally {
      await handle.close();
    }
  });

  it('rejects with 422 when the file exceeds the 64KB limit', async () => {
    const oversized = Buffer.alloc(64 * 1024 + 1, 'a');
    const handle = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(oversized);
    });

    try {
      const service = new ApiService();
      await expectApiError(
        service.verifyOwnership(handle.url, TOKEN),
        422,
      );
    } finally {
      await handle.close();
    }
  });

  it('does not follow redirects and rejects with 422', async () => {
    let followed = false;
    const target = await startServer((req, res) => {
      followed = true;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`ownership token: ${TOKEN}`);
    });

    const redirector = await startServer((req, res) => {
      res.writeHead(302, { Location: target.url });
      res.end();
    });

    try {
      const service = new ApiService();
      await expectApiError(
        service.verifyOwnership(redirector.url, TOKEN),
        422,
      );
      expect(followed).toBe(false);
    } finally {
      await redirector.close();
      await target.close();
    }
  });

  it('rejects private addresses unless PROXY_ALLOW_PRIVATE_UPSTREAMS is set', async () => {
    delete process.env.PROXY_ALLOW_PRIVATE_UPSTREAMS;

    const handle = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`ownership token: ${TOKEN}`);
    });

    try {
      const service = new ApiService();
      await expectApiError(
        service.verifyOwnership(handle.url, TOKEN),
        422,
      );
    } finally {
      await handle.close();
    }
  });

  it('allows private addresses when PROXY_ALLOW_PRIVATE_UPSTREAMS is set', async () => {
    process.env.PROXY_ALLOW_PRIVATE_UPSTREAMS = '1';

    const handle = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`ownership token: ${TOKEN}`);
    });

    try {
      const service = new ApiService();
      const result = await service.verifyOwnership(handle.url, TOKEN);
      expect(result.verified).toBe(true);
      expect(result.listed).toBe(true);
    } finally {
      await handle.close();
    }
  });
});