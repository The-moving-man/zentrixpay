I need to see the current content of `ProviderDashboard.tsx` to write accurate tests. However, the file content provided is empty. Let me check the pointers and infer the component structure.

Since the file content is empty, I cannot create a test file that accurately matches the component. Let me reconsider — the task says "Change type: create" and "Step: Add a test file for ProviderDashboard." The file to return is the test file, not the component.

Let me create the test file based on the described API surface and component behavior.

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ProviderDashboard from "./ProviderDashboard";
import * as apis from "../api/apis.js";

vi.mock("../api/apis.js", () => ({
  registerPublisher: vi.fn(),
  createApi: vi.fn(),
  fetchMyApis: vi.fn(),
  updateApi: vi.fn(),
  verifyApiOwnership: vi.fn(),
  fetchApiStats: vi.fn(),
}));

const mockedApis = vi.mocked(apis);

const fakeWallet = {
  address: "0x1234567890abcdef1234567890abcdef12345678",
  signMessage: vi.fn().mockResolvedValue("0xsigned"),
};

const onCopy = vi.fn();

const baseApi = {
  id: "api-1",
  name: "Test API",
  description: "A test API",
  price: 100,
  listed: false,
  ownershipVerified: false,
  endpoint: "https://example.com/api",
};

function renderDashboard() {
  return render(
    <ProviderDashboard wallet={fakeWallet as any} onCopy={onCopy} />
  );
}

describe("ProviderDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApis.fetchMyApis.mockResolvedValue([{ ...baseApi }]);
  });

  describe("verify ownership", () => {
    it("clears the ownershipVerified badge on success", async () => {
      mockedApis.fetchMyApis.mockResolvedValue([
        { ...baseApi, ownershipVerified: false },
      ]);
      mockedApis.verifyApiOwnership.mockResolvedValue({
        ...baseApi,
        ownershipVerified: true,
      });

      renderDashboard();

      const verifyButton = await screen.findByRole("button", {
        name: /verify/i,
      });
      fireEvent.click(verifyButton);

      await waitFor(() => {
        expect(mockedApis.verifyApiOwnership).toHaveBeenCalledWith(
          baseApi.id,
          fakeWallet.address
        );
      });

      await waitFor(() => {
        expect(screen.queryByText(/not verified/i)).not.toBeInTheDocument();
      });
    });

    it("shows an error alert when verification rejects", async () => {
      mockedApis.verifyApiOwnership.mockRejectedValue(
        new Error("verification failed")
      );

      renderDashboard();

      const verifyButton = await screen.findByRole("button", {
        name: /verify/i,
      });
      fireEvent.click(verifyButton);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/verification failed/i);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /verify/i })
        ).not.toBeDisabled();
      });
    });
  });

  describe("list / unlist", () => {
    it("toggles listed and updates the badge on success", async () => {
      mockedApis.fetchMyApis.mockResolvedValue([
        { ...baseApi, listed: false },
      ]);
      mockedApis.updateApi.mockResolvedValue({ ...baseApi, listed: true });

      renderDashboard();

      expect(await screen.findByText(/not listed/i)).toBeInTheDocument();

      const listButton = screen.getByRole("button", { name: /list/i });
      fireEvent.click(listButton);

      await waitFor(() => {
        expect(mockedApis.updateApi).toHaveBeenCalledWith(baseApi.id, {
          listed: true,
        });
      });

      await waitFor(() => {
        expect(screen.getByText(/listed/i)).toBeInTheDocument();
      });
    });

    it("shows an error alert when listing rejects", async () => {
      mockedApis.updateApi.mockRejectedValue(new Error("list failed"));

      renderDashboard();

      const listButton = await screen.findByRole("button", { name: /list/i });
      fireEvent.click(listButton);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/list failed/i);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /list/i })
        ).not.toBeDisabled();
      });
    });
  });

  describe("price change", () => {
    it("calls updateApi with the new price on success", async () => {
      mockedApis.updateApi.mockResolvedValue({ ...baseApi, price: 250 });

      renderDashboard();

      const priceInput = await screen.findByLabelText(/price/i);
      fireEvent.change(priceInput, { target: { value: "250" } });

      const saveButton = screen.getByRole("button", { name: /save|update/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockedApis.updateApi).toHaveBeenCalledWith(baseApi.id, {
          price: 250,
        });
      });
    });

    it("shows an error alert when price update rejects", async () => {
      mockedApis.updateApi.mockRejectedValue(new Error("price failed"));

      renderDashboard();

      const priceInput = await screen.findByLabelText(/price/i);
      fireEvent.change(priceInput, { target: { value: "250" } });

      const saveButton = screen.getByRole("button", { name: /save|update/i });
      fireEvent.click(saveButton);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/price failed/i);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /save|update/i })
        ).not.toBeDisabled();
      });
    });
  });

  describe("stats", () => {
    it("renders StatsPanel tiles when fetchApiStats resolves", async () => {
      mockedApis.fetchApiStats.mockResolvedValue({
        calls: 42,
        revenue: 1000,
        uptime: 99.9,
      });

      renderDashboard();

      const statsButton = await screen.findByRole("button", {
        name: /stats/i,
      });
      fireEvent.click(statsButton);

      await waitFor(() => {
        expect(mockedApis.fetchApiStats).toHaveBeenCalledWith(baseApi.id);
      });

      expect(await screen.findByText(/42/)).toBeInTheDocument();
      expect(await screen.findByText(/1000/)).toBeInTheDocument();
    });

    it("shows an error alert when stats fetch rejects", async () => {
      mockedApis.fetchApiStats.mockRejectedValue(new Error("stats failed"));

      renderDashboard();

      const statsButton = await screen.findByRole("button", {
        name: /stats/i,
      });
      fireEvent.click(statsButton);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/stats failed/i);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /stats/i })
        ).not.toBeDisabled();
      });
    });
  });
});
