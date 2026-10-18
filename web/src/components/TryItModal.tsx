import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TryItModal from './TryItModal';

vi.mock('../lib/x402Call.js', () => ({
  callPaidApi: vi.fn(),
  callUrl: vi.fn(),
}));

import { callPaidApi, callUrl } from '../lib/x402Call.js';

const baseProps = {
  open: true,
  onClose: vi.fn(),
  wallet: { address: '0x1234567890abcdef1234567890abcdef12345678' },
  endpoint: {
    method: 'GET',
    path: '/api/paid',
    price: '0.01',
  },
};

function renderModal(overrides = {}) {
  return render(<TryItModal {...baseProps} {...overrides} />);
}

describe('TryItModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders charged result with status badge, charged label, pretty-printed JSON and explorer link', async () => {
    const user = userEvent.setup();

    callPaidApi.mockResolvedValue({
      status: 200,
      charged: true,
      price: '0.01',
      explorerUrl: 'https://explorer.example.com/tx/0xabc',
      contentType: 'application/json',
      body: { hello: 'world', nested: { a: 1 } },
    });

    renderModal();

    await user.click(screen.getByRole('button', { name: /send|try|run/i }));

    await waitFor(() => {
      expect(callPaidApi).toHaveBeenCalled();
    });

    expect(await screen.findByText('200')).toBeInTheDocument();
    expect(await screen.findByText(/Charged\s+0\.01\s+USDC/i)).toBeInTheDocument();

    const expectedJson = JSON.stringify({ hello: 'world', nested: { a: 1 } }, null, 2);
    expect(await screen.findByText((content) => content.includes('"hello": "world"'))).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('"nested": {'))).toBeInTheDocument();

    const pre = document.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre.textContent).toBe(expectedJson);

    const link = screen.getByRole('link', { name: /explorer/i });
    expect(link).toHaveAttribute('href', 'https://explorer.example.com/tx/0xabc');
  });

  it('renders uncharged result with Not charged label and red badge styling', async () => {
    const user = userEvent.setup();

    callPaidApi.mockResolvedValue({
      status: 402,
      charged: false,
      price: '0.01',
      contentType: 'application/json',
      body: { error: 'payment required' },
    });

    renderModal();

    await user.click(screen.getByRole('button', { name: /send|try|run/i }));

    await waitFor(() => {
      expect(callPaidApi).toHaveBeenCalled();
    });

    expect(await screen.findByText(/Not charged/i)).toBeInTheDocument();

    const badge = await screen.findByText('402');
    expect(badge.className).toMatch(/red/i);
  });

  it('renders error alert and no result block when callPaidApi throws', async () => {
    const user = userEvent.setup();

    callPaidApi.mockRejectedValue(new Error('boom'));

    renderModal();

    await user.click(screen.getByRole('button', { name: /send|try|run/i }));

    await waitFor(() => {
      expect(callPaidApi).toHaveBeenCalled();
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/boom/i);

    expect(document.querySelector('pre')).toBeNull();
  });
});