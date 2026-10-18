import { Pool } from 'pg';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { ApiService } from './apiService';

/**
 * Integration tests for ApiService against a real Postgres database.
 *
 * These tests use Testcontainers to spin up a throwaway Postgres instance so
 * that the actual SQL (escaping, aggregates, filters, listing rules) is
 * exercised end-to-end. This catches SQL errors that mocks would hide.
 *
 * In CI, either Docker must be available (for Testcontainers) or a Postgres
 * service can be provided via the DATABASE_URL environment variable.
 */

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS apis (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  origin TEXT NOT NULL,
  owner TEXT,
  price NUMERIC(20, 8) NOT NULL DEFAULT 0,
  listed BOOLEAN NOT NULL DEFAULT false,
  ownership_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_calls (
  id SERIAL PRIMARY KEY,
  api_id INTEGER NOT NULL REFERENCES apis(id) ON DELETE CASCADE,
  payer TEXT,
  charged BOOLEAN NOT NULL DEFAULT false,
  amount NUMERIC(20, 8) NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

describe('ApiService integration (real Postgres)', () => {
  let container: StartedTestContainer | undefined;
  let pool: Pool;
  let service: ApiService;
  let externalDatabaseUrl: string | undefined;

  beforeAll(async () => {
    externalDatabaseUrl = process.env.DATABASE_URL;

    if (externalDatabaseUrl) {
      // CI Postgres service path.
      pool = new Pool({ connectionString: externalDatabaseUrl });
    } else {
      // Testcontainers path.
      container = await new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_USER: 'test',
          POSTGRES_PASSWORD: 'test',
          POSTGRES_DB: 'test',
        })
        .withExposedPorts(5432)
        .withStartupTimeout(120_000)
        .start();

      pool = new Pool({
        host: container.getHost(),
        port: container.getMappedPort(5432),
        user: 'test',
        password: 'test',
        database: 'test',
      });
    }

    // Wait for Postgres to accept connections.
    const deadline = Date.now() + 60_000;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await pool.query('SELECT 1');
        break;
      } catch (err) {
        if (Date.now() > deadline) {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    await pool.query(SCHEMA_SQL);
    service = new ApiService(pool);
  }, 180_000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
    if (container) {
      await container.stop();
    }
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE api_calls, apis RESTART IDENTITY CASCADE');
  });

  async function insertApi(overrides: Partial<{
    name: string;
    description: string | null;
    origin: string;
    owner: string | null;
    price: number;
    listed: boolean;
    ownershipVerifiedAt: Date | null;
  }> = {}): Promise<number> {
    const {
      name = 'Test API',
      description = 'A test API',
      origin = 'https://example.com',
      owner = 'alice',
      price = 0,
      listed = false,
      ownershipVerifiedAt = null,
    } = overrides;

    const result = await pool.query(
      `INSERT INTO apis (name, description, origin, owner, price, listed, ownership_verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [name, description, origin, owner, price, listed, ownershipVerifiedAt],
    );
    return result.rows[0].id as number;
  }

  async function insertCall(overrides: Partial<{
    apiId: number;
    payer: string | null;
    charged: boolean;
    amount: number;
    durationMs: number;
    createdAt: Date;
  }> = {}): Promise<void> {
    const {
      apiId,
      payer = 'payer-1',
      charged = false,
      amount = 0,
      durationMs = 100,
      createdAt = new Date(),
    } = overrides;

    await pool.query(
      `INSERT INTO api_calls (api_id, payer, charged, amount, duration_ms, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [apiId, payer, charged, amount, durationMs, createdAt],
    );
  }

  describe('catalog search escaping', () => {
    it('treats % as a literal character, not a wildcard', async () => {
      await insertApi({ name: 'Discount 50% off', listed: true });
      await insertApi({ name: 'Plain name', listed: true });

      const results = await service.searchApis({ q: '50%' });

      expect(results.map((r) => r.name)).toEqual(['Discount 50% off']);
    });

    it('treats _ as a literal character, not a single-char wildcard', async () => {
      await insertApi({ name: 'snake_case api', listed: true });
      await insertApi({ name: 'snakeXcase api', listed: true });

      const results = await service.searchApis({ q: 'snake_case' });

      expect(results.map((r) => r.name)).toEqual(['snake_case api']);
    });

    it('treats backslash as a literal character', async () => {
      await insertApi({ name: 'path\\to\\api', listed: true });
      await insertApi({ name: 'path to api', listed: true });

      const results = await service.searchApis({ q: 'path\\to' });

      expect(results.map((r) => r.name)).toEqual(['path\\to\\api']);
    });

    it('does not error on a lone backslash', async () => {
      await insertApi({ name: 'trailing\\', listed: true });

      const results = await service.searchApis({ q: '\\' });

      expect(results.map((r) => r.name)).toEqual(['trailing\\']);
    });

    it('matches case-insensitively on plain terms', async () => {
      await insertApi({ name: 'Weather API', listed: true });
      await insertApi({ name: 'Other API', listed: true });

      const results = await service.searchApis({ q: 'weather' });

      expect(results.map((r) => r.name)).toEqual(['Weather API']);
    });

    it('only returns listed APIs in catalog search', async () => {
      await insertApi({ name: 'Listed Weather', listed: true });
      await insertApi({ name: 'Unlisted Weather', listed: false });

      const results = await service.searchApis({ q: 'Weather' });

      expect(results.map((r) => r.name)).toEqual(['Listed Weather']);
    });
  });

  describe('getApiStats filters and aggregates', () => {
    it('sums revenue only over charged calls', async () => {
      const apiId = await insertApi({ owner: 'alice' });
      await insertCall({ apiId, charged: true, amount: 1.5, payer: 'p1' });
      await insertCall({ apiId, charged: true, amount: 2.25, payer: 'p2' });
      await insertCall({ apiId, charged: false, amount: 99, payer: 'p3' });

      const stats = await service.getApiStats(apiId);

      expect(stats.totalCalls).toBe(3);
      expect(stats.chargedCalls).toBe(2);
      expect(Number(stats.revenue)).toBeCloseTo(3.75, 8);
    });

    it('counts unique payers across all calls', async () => {
      const apiId = await insertApi({ owner: 'alice' });
      await insertCall({ apiId, payer: 'p1', charged: true, amount: 1 });
      await insertCall({ apiId, payer: 'p1', charged: true, amount: 1 });
      await insertCall({ apiId, payer: 'p2', charged: false });
      await insertCall({ apiId, payer: null, charged: false });

      const stats = await service.getApiStats(apiId);

      expect(stats.uniquePayers).toBe(2);
    });

    it('computes average duration over all calls', async () => {
      const apiId = await insertApi({ owner: 'alice' });
      await insertCall({ apiId, durationMs: 100 });
      await insertCall({ apiId, durationMs: 200 });
      await insertCall({ apiId, durationMs: 300 });

      const stats = await service.getApiStats(apiId);

      expect(Number(stats.avgDurationMs)).toBeCloseTo(200, 5);
    });

    it('filters by since date', async () => {
      const apiId = await insertApi({ owner: 'alice' });
      const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

      await insertCall({ apiId, charged: true, amount: 5, createdAt: old });
      await insertCall({ apiId, charged: true, amount: 7, createdAt: recent });

      const since = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const stats = await service.getApiStats(apiId, { since });

      expect(stats.totalCalls).toBe(1);
      expect(stats.chargedCalls).toBe(1);
      expect(Number(stats.revenue)).toBeCloseTo(7, 8);
    });

    it('returns zeroed stats for an API with no calls', async () => {
      const apiId = await insertApi({ owner: 'alice' });

      const stats = await service.getApiStats(apiId);

      expect(stats.totalCalls).toBe(0);
      expect(stats.chargedCalls).toBe(0);
      expect(Number(stats.revenue)).toBe(0);
      expect(stats.uniquePayers).toBe(0);
      expect(Number(stats.avgDurationMs)).toBe(0);
    });
  });

  describe('listing rules on upstream change', () => {
    it('resets ownershipVerifiedAt and listed=false when origin changes', async () => {
      const apiId = await insertApi({
        owner: 'alice',
        origin: 'https://old.example.com',
        listed: true,
        ownershipVerifiedAt: new Date(),
      });

      await service.updateApi(apiId, { origin: 'https://new.example.com' });

      const row = await pool.query(
        'SELECT origin, listed, ownership_verified_at FROM apis WHERE id = $1',
        [apiId],
      );

      expect(row.rows[0].origin).toBe('https://new.example.com');
      expect(row.rows[0].listed).toBe(false);
      expect(row.rows[0].ownership_verified_at).toBeNull();
    });

    it('keeps verification and listing when origin is unchanged', async () => {
      const verifiedAt = new Date();
      const apiId = await insertApi({
        owner: 'alice',
        origin: 'https://same.example.com',
        listed: true,
        ownershipVerifiedAt: verifiedAt,
      });

      await service.updateApi(apiId, { description: 'updated' });

      const row = await pool.query(
        'SELECT listed, ownership_verified_at FROM apis WHERE id = $1',
        [apiId],
      );

      expect(row.rows[0].listed).toBe(true);
      expect(row.rows[0].ownership_verified_at).not.toBeNull();
    });

    it('throws 409 when listing without ownership verification', async () => {
      const apiId = await insertApi({
        owner: 'alice',
        listed: false,
        ownershipVerifiedAt: null,
      });

      await expect(service.updateApi(apiId, { listed: true })).rejects.toMatchObject({
        status: 409,
      });

      const row = await pool.query('SELECT listed FROM apis WHERE id = $1', [apiId]);
      expect(row.rows[0].listed).toBe(false);
    });

    it('allows listing when ownership is verified', async () => {
      const apiId = await insertApi({
        owner: 'alice',
        listed: false,
        ownershipVerifiedAt: new Date(),
      });

      await service.updateApi(apiId, { listed: true });

      const row = await pool.query('SELECT listed FROM apis WHERE id = $1', [apiId]);
      expect(row.rows[0].listed).toBe(true);
    });
  });
});