import { isIP, BlockList } from "node:net";

// SSRF protection for the API proxy. Providers choose the upstream URL, so
// without these checks anyone could register an "API" that points at the
// server's own network (localhost, cloud metadata, private ranges) and have
// ZentrixPay fetch it for them.

const blocked = new BlockList();
// IPv4
blocked.addSubnet("0.0.0.0", 8, "ipv4"); // "this" network
blocked.addSubnet("10.0.0.0", 8, "ipv4"); // private
blocked.addSubnet("100.64.0.0", 10, "ipv4"); // carrier-grade NAT
blocked.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
blocked.addSubnet("169.254.0.0", 16, "ipv4"); // link-local, cloud metadata
blocked.addSubnet("172.16.0.0", 12, "ipv4"); // private
blocked.addSubnet("192.0.0.0", 24, "ipv4"); // IETF protocol assignments
blocked.addSubnet("192.0.2.0", 24, "ipv4"); // TEST-NET-1
blocked.addSubnet("192.168.0.0", 16, "ipv4"); // private
blocked.addSubnet("198.18.0.0", 15, "ipv4"); // benchmarking
blocked.addSubnet("198.51.100.0", 24, "ipv4"); // TEST-NET-2
blocked.addSubnet("203.0.113.0", 24, "ipv4"); // TEST-NET-3
blocked.addSubnet("224.0.0.0", 4, "ipv4"); // multicast
blocked.addSubnet("240.0.0.0", 4, "ipv4"); // reserved + broadcast
// IPv6
blocked.addAddress("::", "ipv6"); // unspecified
blocked.addAddress("::1", "ipv6"); // loopback
blocked.addSubnet("64:ff9b::", 96, "ipv6"); // NAT64 (embeds IPv4)
blocked.addSubnet("100::", 64, "ipv6"); // discard
blocked.addSubnet("2001:db8::", 32, "ipv6"); // documentation
blocked.addSubnet("fc00::", 7, "ipv6"); // unique local
blocked.addSubnet("fe80::", 10, "ipv6"); // link-local
blocked.addSubnet("ff00::", 8, "ipv6"); // multicast

/** IPv4-mapped / -compatible IPv6 forms are judged by the embedded IPv4 address. */
function embeddedIpv4(address: string): string | null {
  const match = /^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (match) return match[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  if (family === 6) {
    const v4 = embeddedIpv4(address);
    if (v4) return !blocked.check(v4, "ipv4");
    return !blocked.check(address, "ipv6");
  }
  return !blocked.check(address, "ipv4");
}

export class UpstreamUrlError extends Error {}

/**
 * Static checks on a provider-supplied upstream URL. Address checks on the
 * resolved host happen at connect time (see upstreamClient.ts), so a hostname
 * that later re-resolves to a private address is still refused.
 */
export function validateUpstreamUrl(raw: string, opts: { allowPrivate: boolean }): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UpstreamUrlError("upstreamUrl is not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UpstreamUrlError("upstreamUrl must use http or https");
  }
  if (url.username || url.password) {
    throw new UpstreamUrlError("upstreamUrl must not contain credentials; use upstreamHeader");
  }
  if (url.hash) {
    throw new UpstreamUrlError("upstreamUrl must not contain a fragment");
  }
  if (!opts.allowPrivate) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && !isPublicAddress(host)) {
      throw new UpstreamUrlError("upstreamUrl must point at a public address");
    }
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
      throw new UpstreamUrlError("upstreamUrl must point at a public address");
    }
  }
  return url;
}
