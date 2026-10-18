import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiDetailPage } from "./ApiDetailPage.js";
import { fetchApiById } from "../api/apis.js";
import type { PublicApi } from "../api/apis.js";

vi.mock("../api/apis.js", async () => {
  const actual = await vi.importActual<typeof import("../api/apis.js")>("../api/apis.js");
  return {
    ...actual,
    fetchApiById: vi.fn(),
  };
});

vi.mock("../lib/x402Call.js", () => ({
  callUrl: (_base: string, path: string, query: string) =>
    `http://gw.test/api/api1${path}${query ? `?${query}` : ""}`,
  callPaidApi: vi.fn(),
}));

const weather: PublicApi = {
  id: "api1",
  name: "Weather API",
  description: "Forecasts for any city",
  price: "0.01",
  currency: "USDC",
  walletAddress: "GPROVIDER",
  allowedMethods: ["GET", "POST"],
  tags: ["weather", "geo"],
  proxyUrl: "http://gw.test/api/api1",
  createdAt: "2026-10-01T00:00:00Z",
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/apis/:id" element={<ApiDetailPage />} />
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(fetchApiById).mockReset();
});

describe("ApiDetailPage", () => {
  it("renders the API name, price and methods on success", async () => {
    vi.mocked(fetchApiById).mockResolvedValue(weather);
    renderAt("/apis/api1");

    expect(await screen.findByText("Weather API")).toBeInTheDocument();
    expect(screen.getByText(/0\.01.*USDC/)).toBeInTheDocument();
    expect(screen.getByText("GET")).toBeInTheDocument();
    expect(screen.getByText("POST")).toBeInTheDocument();
  });

  it("renders the description and tags", async () => {
    vi.mocked(fetchApiById).mockResolvedValue(weather);
    renderAt("/apis/api1");

    expect(await screen.findByText("Forecasts for any city")).toBeInTheDocument();
    expect(screen.getByText("#weather")).toBeInTheDocument();
    expect(screen.getByText("#geo")).toBeInTheDocument();
  });

  it("shows the proxy URL", async () => {
    vi.mocked(fetchApiById).mockResolvedValue(weather);
    renderAt("/apis/api1");

    expect(await screen.findByText("http://gw.test/api/api1")).toBeInTheDocument();
  });

  it("shows a not-found message when the API does not exist", async () => {
    vi.mocked(fetchApiById).mockRejectedValue(new Error("Not Found"));
    renderAt("/apis/unknown-id");

    expect(await screen.findByText(/API not found/i)).toBeInTheDocument();
  });

  it("opens the try-it modal when Try it is clicked", async () => {
    vi.mocked(fetchApiById).mockResolvedValue(weather);
    renderAt("/apis/api1");

    await userEvent.click(await screen.findByRole("button", { name: /try it/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("has a back link to the catalog", async () => {
    vi.mocked(fetchApiById).mockResolvedValue(weather);
    renderAt("/apis/api1");

    await screen.findByText("Weather API");
    const backLink = screen.getByRole("link", { name: /back to catalog/i });
    expect(backLink).toHaveAttribute("href", "/");
  });

  it("calls fetchApiById with the id from the URL", async () => {
    vi.mocked(fetchApiById).mockResolvedValue(weather);
    renderAt("/apis/api1");

    await screen.findByText("Weather API");
    expect(fetchApiById).toHaveBeenCalledWith("api1", expect.anything());
  });
});
