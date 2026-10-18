/**
 * #88 – Accessibility audit tests using jest-axe.
 *
 * Covers ApiCatalog, TryItModal and ProviderDashboard in both
 * light (default) and dark mode. Each test uses axe-core to detect
 * serious accessibility violations (serious + critical).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { ApiCatalog } from "./ApiCatalog.js";
import { TryItModal } from "./TryItModal.js";
import { ProviderDashboard } from "./ProviderDashboard.js";
import type { PublicApi, OwnerApi } from "../api/apis.js";
import type { WalletState } from "../hooks/useWalletConnection.js";

expect.extend(toHaveNoViolations);

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../api/apis.js", async () => {
  const actual = await vi.importActual<typeof import("../api/apis.js")>("../api/apis.js");
  return {
    ...actual,
    fetchApis: vi.fn().mockResolvedValue([]),
    fetchMyApis: vi.fn().mockResolvedValue([]),
    registerPublisher: vi.fn(),
    createApi: vi.fn(),
    updateApi: vi.fn(),
    verifyApiOwnership: vi.fn(),
    fetchApiStats: vi.fn(),
  };
});

vi.mock("../lib/x402Call.js", () => ({
  callUrl: (_base: string, path: string, query: string) =>
    `http://gw.test/api/api1${path}${query ? `?${query}` : ""}`,
  callPaidApi: vi.fn(),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const sampleApi: PublicApi = {
  id: "api1",
  name: "Weather API",
  description: "Forecasts for any city",
  price: "0.01",
  currency: "USDC",
  walletAddress: "GPROVIDER",
  allowedMethods: ["GET", "POST"],
  tags: ["weather"],
  proxyUrl: "http://gw.test/api/api1",
  createdAt: "2026-10-01T00:00:00Z",
};

const ownedApi: OwnerApi = {
  ...sampleApi,
  upstreamUrl: "https://api.example.com/v1",
  upstreamHeaderName: null,
  hasUpstreamSecret: false,
  timeoutMs: null,
  listed: true,
  ownershipVerified: true,
  ownershipVerification: {
    url: "https://api.example.com/.well-known/zentrixpay.txt",
    expectedContent: "zentrixpay-verification=abc",
  },
};

const disconnectedWallet: WalletState = {
  status: "disconnected",
  address: null,
  connect: vi.fn(),
  disconnect: vi.fn(),
  network: null,
};

/** Apply or remove the dark class on the document root. */
function setDarkMode(enabled: boolean) {
  if (enabled) {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * axe is configured to flag only serious+ violations so minor contrast issues
 * from Tailwind utility classes that rely on CSS variables (which jsdom doesn't
 * evaluate) do not produce false positives.
 */
const axeOptions = {
  runOnly: { type: "tag" as const, values: ["wcag2a", "wcag2aa"] },
  rules: {
    // Tailwind dark-mode classes rely on CSS variables that jsdom cannot resolve;
    // skip color-contrast to avoid false positives in the test environment.
    "color-contrast": { enabled: false },
  },
};

// ── ApiCatalog ────────────────────────────────────────────────────────────────

describe("ApiCatalog – axe (light mode)", () => {
  beforeEach(() => setDarkMode(false));

  it("has no violations when empty", async () => {
    const { container } = render(<ApiCatalog onTry={vi.fn()} onCopy={vi.fn()} />);
    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});

describe("ApiCatalog – axe (dark mode)", () => {
  beforeEach(() => setDarkMode(true));

  it("has no violations when empty", async () => {
    const { container } = render(<ApiCatalog onTry={vi.fn()} onCopy={vi.fn()} />);
    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});

// ── TryItModal ────────────────────────────────────────────────────────────────

describe("TryItModal – axe (light mode)", () => {
  beforeEach(() => setDarkMode(false));

  it("has no violations in disconnected state", async () => {
    const { container } = render(
      <TryItModal api={sampleApi} wallet={disconnectedWallet} onClose={vi.fn()} />,
    );
    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});

describe("TryItModal – axe (dark mode)", () => {
  beforeEach(() => setDarkMode(true));

  it("has no violations in disconnected state", async () => {
    const { container } = render(
      <TryItModal api={sampleApi} wallet={disconnectedWallet} onClose={vi.fn()} />,
    );
    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});

// ── ProviderDashboard ─────────────────────────────────────────────────────────

describe("ProviderDashboard – axe (light mode, no key)", () => {
  beforeEach(() => {
    setDarkMode(false);
    localStorage.clear();
  });

  it("has no violations on the registration screen", async () => {
    const { container } = render(
      <ProviderDashboard wallet={disconnectedWallet} onCopy={vi.fn()} />,
    );
    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});

describe("ProviderDashboard – axe (dark mode, no key)", () => {
  beforeEach(() => {
    setDarkMode(true);
    localStorage.clear();
  });

  it("has no violations on the registration screen", async () => {
    const { container } = render(
      <ProviderDashboard wallet={disconnectedWallet} onCopy={vi.fn()} />,
    );
    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});

describe("ProviderDashboard – axe (light mode, with API key)", () => {
  beforeEach(async () => {
    setDarkMode(false);
    localStorage.setItem("zentrixpay-provider-api-key", "test-key");
    // Override per-describe so the dashboard shows API cards
    const { fetchMyApis } = await import("../api/apis.js");
    vi.mocked(fetchMyApis).mockResolvedValue([ownedApi]);
  });

  it("has no violations when APIs are listed", async () => {
    const { container } = render(
      <ProviderDashboard wallet={disconnectedWallet} onCopy={vi.fn()} />,
    );
    // Give async data fetching a tick to settle
    await new Promise((r) => setTimeout(r, 0));
    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
