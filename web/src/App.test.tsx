import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.js";
import {
  fetchApis,
  fetchMyApis,
  registerPublisher,
  type OwnerApi,
  type PublicApi,
} from "./api/apis.js";

vi.mock("./api/apis.js", async () => {
  const actual = await vi.importActual<typeof import("./api/apis.js")>("./api/apis.js");
  return {
    ...actual,
    fetchApis: vi.fn(),
    fetchMyApis: vi.fn(),
    registerPublisher: vi.fn(),
    createApi: vi.fn(),
    updateApi: vi.fn(),
    verifyApiOwnership: vi.fn(),
    fetchApiStats: vi.fn(),
  };
});

const weather: PublicApi = {
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

const owned: OwnerApi = {
  ...weather,
  upstreamUrl: "https://api.example.com/v1",
  upstreamHeaderName: null,
  hasUpstreamSecret: false,
  timeoutMs: null,
  listed: false,
  ownershipVerified: false,
  ownershipVerification: {
    url: "https://api.example.com/.well-known/zentrixpay.txt",
    expectedContent: "zentrixpay-verification=abc",
  },
};

beforeEach(() => {
  vi.mocked(fetchApis).mockReset().mockResolvedValue([weather]);
  vi.mocked(fetchMyApis).mockReset().mockResolvedValue([owned]);
  vi.mocked(registerPublisher).mockReset();
  localStorage.clear();
});

describe("App", () => {
  it("lists APIs with price and methods", async () => {
    render(<App />);
    expect(await screen.findByText("Weather API")).toBeInTheDocument();
    expect(screen.getByText(/0\.01 USDC/)).toBeInTheDocument();
    expect(screen.getByText("POST")).toBeInTheDocument();
  });

  it("searches the catalog", async () => {
    render(<App />);
    await screen.findByText("Weather API");
    await userEvent.type(screen.getByLabelText("Search APIs"), "geo");
    await waitFor(() => expect(fetchApis).toHaveBeenLastCalledWith("geo", expect.anything()));
  });

  it("opens the try-it console with the call preview", async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Try it" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Path"), "forecast/lagos");
    expect(screen.getByText("GET http://gw.test/api/api1/forecast/lagos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connect Freighter/ })).toBeInTheDocument();
  });

  it("registers a provider and shows the API key once", async () => {
    vi.mocked(registerPublisher).mockResolvedValue({
      id: "p1",
      name: "Ada",
      email: "ada@example.com",
      walletAddress: "GADA",
      apiKey: "mv_secret",
    });
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Sell your API" }));
    await userEvent.type(screen.getByLabelText("Name"), "Ada");
    await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
    await userEvent.type(screen.getByLabelText("Payout wallet"), "GADA");
    await userEvent.click(screen.getByRole("button", { name: "Register" }));
    expect(await screen.findByText("mv_secret")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /I saved it/ }));
    expect(await screen.findByText("Ownership not verified")).toBeInTheDocument();
    expect(screen.getByText("zentrixpay-verification=abc")).toBeInTheDocument();
    expect(fetchMyApis).toHaveBeenCalledWith("mv_secret");
  });
});
