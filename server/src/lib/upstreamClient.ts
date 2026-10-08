import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import { isPublicAddress } from "./upstreamGuard.js";

export type UpstreamErrorKind = "blocked" | "timeout" | "too_large" | "network";

export class UpstreamError extends Error {
  constructor(
    public readonly kind: UpstreamErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface UpstreamRequest {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
  timeoutMs: number;
  maxResponseBytes: number;
  allowPrivate: boolean;
}

export interface UpstreamResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/**
 * DNS lookup that refuses non-public addresses. Used as the socket's lookup
 * function so the check applies to the address actually connected to — a
 * hostname that re-resolves to a private address (DNS rebinding) is refused
 * at call time, not only at registration.
 */
function guardedLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
      if (err) return callback(err, "", 0);
      const list = addresses as LookupAddress[];
      if (!allowPrivate && list.some((a) => !isPublicAddress(a.address))) {
        const error = new UpstreamError(
          "blocked",
          `upstream host ${hostname} resolves to a non-public address`,
        );
        return callback(error as NodeJS.ErrnoException, "", 0);
      }
      if (options.all) {
        (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
      } else {
        callback(null, list[0].address, list[0].family);
      }
    });
  };
}

/** Send one request upstream. Redirects are not followed; they are returned as-is. */
export function sendUpstream(req: UpstreamRequest): Promise<UpstreamResponse> {
  const host = req.url.hostname.replace(/^\[|\]$/g, "");
  // Literal IPs skip DNS lookup entirely, so check them here.
  if (!req.allowPrivate && isIP(host) && !isPublicAddress(host)) {
    return Promise.reject(new UpstreamError("blocked", "upstream address is not public"));
  }

  const transport = req.url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err: UpstreamError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      outgoing.destroy();
      reject(err);
    };

    const outgoing = transport.request(
      req.url,
      {
        method: req.method,
        headers: req.body
          ? { ...req.headers, "content-length": String(req.body.length) }
          : req.headers,
        lookup: guardedLookup(req.allowPrivate),
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        let size = 0;
        incoming.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > req.maxResponseBytes) {
            incoming.destroy();
            fail(
              new UpstreamError(
                "too_large",
                `upstream response exceeded ${req.maxResponseBytes} bytes`,
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        incoming.on("end", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            status: incoming.statusCode ?? 502,
            headers: incoming.headers,
            body: Buffer.concat(chunks),
          });
        });
        incoming.on("error", (err) => fail(new UpstreamError("network", err.message)));
      },
    );

    const timer = setTimeout(
      () =>
        fail(new UpstreamError("timeout", `upstream did not respond within ${req.timeoutMs}ms`)),
      req.timeoutMs,
    );

    outgoing.on("error", (err) => {
      fail(err instanceof UpstreamError ? err : new UpstreamError("network", err.message));
    });

    if (req.body) outgoing.write(req.body);
    outgoing.end();
  });
}
