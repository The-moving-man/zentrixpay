import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface IntegrationHarness {
  client: Client;
  close: () => Promise<void>;
}

export interface StartIntegrationHarnessOptions {
  /** Extra environment variables merged on top of the defaults. */
  env?: Record<string, string>;
  /** Command used to launch the server (defaults to the current node binary). */
  command?: string;
  /** Arguments passed to the command (defaults to the built/tsx entrypoint). */
  args?: string[];
  /** Working directory for the spawned server. */
  cwd?: string;
}

/**
 * Spawns the real ZentrixPay MCP server over stdio and returns a connected
 * MCP client. The server is launched with ZENTRIXPAY_MOCK=1 by default so the
 * mock fixtures in mock.ts are active.
 */
export async function startIntegrationHarness(
  options: StartIntegrationHarnessOptions = {},
): Promise<IntegrationHarness> {
  const entry = resolve(__dirname, 'index.js');

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ZENTRIXPAY_MOCK: '1',
    ...(options.env ?? {}),
  };

  const transport = new StdioClientTransport({
    command: options.command ?? process.execPath,
    args: options.args ?? [entry],
    cwd: options.cwd ?? __dirname,
    env,
    stderr: 'pipe',
  });

  const client = new Client(
    { name: 'zentrixpay-integration-harness', version: '1.0.0' },
    { capabilities: {} },
  );

  await client.connect(transport);

  return {
    client,
    close: async () => {
      await client.close();
    },
  };
}

/** Extracts the concatenated text content from a tool result. */
export function harnessResultText(result: unknown): string {
  const content = (result as { content?: unknown })?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (part): part is { type: 'text'; text: string } =>
        !!part &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string',
    )
    .map((part) => part.text)
    .join('\n');
}

/** Returns true when the tool result is flagged as an error. */
export function harnessIsToolError(result: unknown): boolean {
  return (result as { isError?: unknown })?.isError === true;
}

/** Returns the structuredContent payload of a tool result, if present. */
export function harnessStructuredContent<T = unknown>(result: unknown): T | undefined {
  return (result as { structuredContent?: T })?.structuredContent;
}

/** Convenience helper: spawn a detached child process (used by some tests). */
export function spawnServer(
  command: string,
  args: string[],
  env: Record<string, string> = {},
): ReturnType<typeof spawn> {
  return spawn(command, args, {
    env: { ...(process.env as Record<string, string>), ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}