import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockVerifyToken = vi.fn();

vi.mock('../middleware/auth', () => ({
  verifyToken: (req: any, res: any, next: any) => mockVerifyToken(req, res, next),
}));

const mockApiFind = vi.fn();
const mockApiFindOne = vi.fn();
const mockApiFindOneAndUpdate = vi.fn();
const mockApiCreate = vi.fn();
const mockApiCountDocuments = vi.fn();

vi.mock('../models/Api', () => ({
  Api: {
    find: (...args: any[]) => mockApiFind(...args),
    findOne: (...args: any[]) => mockApiFindOne(...args),
    findOneAndUpdate: (...args: any[]) => mockApiFindOneAndUpdate(...args),
    create: (...args: any[]) => mockApiCreate(...args),
    countDocuments: (...args: any[]) => mockApiCountDocuments(...args),
  },
}));

const mockUsageAggregate = vi.fn();
const mockUsageCountDocuments = vi.fn();

vi.mock('../models/Usage', () => ({
  Usage: {
    aggregate: (...args: any[]) => mockUsageAggregate(...args),
    countDocuments: (...args: any[]) => mockUsageCountDocuments(...args),
  },
}));

import apisRouter from './apis';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OWNER_ID = 'owner-1';
const OTHER_ID = 'owner-2';

const UPSTREAM_URL = 'https://internal-upstream.example.com/secret-path';
const UPSTREAM_SECRET = 'super-secret-upstream-key';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/apis', apisRouter);
  return app;
}

function asOwner() {
  mockVerifyToken.mockImplementation((req: any, _res: any, next: any) => {
    req.user = { id: OWNER_ID, email: 'owner@example.com' };
    next();
  });
}

function asOther() {
  mockVerifyToken.mockImplementation((req: any, _res: any, next: any) => {
    req.user = { id: OTHER_ID, email: 'other@example.com' };
    next();
  });
}

function asAnonymous() {
  mockVerifyToken.mockImplementation((_req: any, res: any) => {
    res.status(401).json({ error: 'Unauthorized' });
  });
}

function makeApi(overrides: Record<string, any> = {}) {
  return {
    _id: 'api-1',
    name: 'Weather API',
    description: 'Provides weather data',
    owner: OWNER_ID,
    upstreamUrl: UPSTREAM_URL,
    upstreamSecret: UPSTREAM_SECRET,
    verified: false,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeQueryResult(docs: any[]) {
  const query: any = {
    sort: vi.fn(() => query),
    skip: vi.fn(() => query),
    limit: vi.fn(() => query),
    lean: vi.fn(() => Promise.resolve(docs)),
    then: (resolve: any, reject: any) => Promise.resolve(docs).then(resolve, reject),
  };
  return query;
}

function expectNoSecrets(payload: any) {
  const serialized = JSON.stringify(payload);
  expect(serialized).not.toContain(UPSTREAM_URL);
  expect(serialized).not.toContain(UPSTREAM_SECRET);
  expect(serialized).not.toContain('upstreamUrl');
  expect(serialized).not.toContain('upstreamSecret');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('routes/apis', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  // -------------------------------------------------------------------------
  // POST /apis (register)
  // -------------------------------------------------------------------------

  describe('POST /apis (register)', () => {
    it('returns 401 when unauthenticated', async () => {
      asAnonymous();

      const res = await request(app)
        .post('/apis')
        .send({ name: 'Weather API', upstreamUrl: UPSTREAM_URL, upstreamSecret: UPSTREAM_SECRET });

      expect(res.status).toBe(401);
      expect(mockApiCreate).not.toHaveBeenCalled();
    });

    it('returns 400 when required fields are missing', async () => {
      asOwner();

      const res = await request(app).post('/apis').send({});

      expect(res.status).toBe(400);
      expect(mockApiCreate).not.toHaveBeenCalled();
    });

    it('returns 400 when the upstream URL is invalid', async () => {
      asOwner();

      const res = await request(app)
        .post('/apis')
        .send({ name: 'Weather API', upstreamUrl: 'not-a-url', upstreamSecret: UPSTREAM_SECRET });

      expect(res.status).toBe(400);
      expect(mockApiCreate).not.toHaveBeenCalled();
    });

    it('registers an API and returns the public shape without secrets', async () => {
      asOwner();
      mockApiCreate.mockResolvedValue(makeApi());

      const res = await request(app)
        .post('/apis')
        .send({ name: 'Weather API', upstreamUrl: UPSTREAM_URL, upstreamSecret: UPSTREAM_SECRET });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: 'api-1',
        name: 'Weather API',
        verified: false,
      });
      expectNoSecrets(res.body);
    });
  });

  // -------------------------------------------------------------------------
  // GET /apis (list)
  // -------------------------------------------------------------------------

  describe('GET /apis (list)', () => {
    it('returns 401 when unauthenticated', async () => {
      asAnonymous();

      const res = await request(app).get('/apis');

      expect(res.status).toBe(401);
      expect(mockApiFind).not.toHaveBeenCalled();
    });

    it('returns only the caller-owned APIs without secrets', async () => {
      asOwner();
      mockApiFind.mockReturnValue(makeQueryResult([makeApi()]));

      const res = await request(app).get('/apis');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ id: 'api-1', name: 'Weather API' });
      expectNoSecrets(res.body);
    });

    it('returns an empty list when the caller owns no APIs', async () => {
      asOwner();
      mockApiFind.mockReturnValue(makeQueryResult([]));

      const res = await request(app).get('/apis');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // GET /apis/:id (detail)
  // -------------------------------------------------------------------------

  describe('GET /apis/:id (detail)', () => {
    it('returns 401 when unauthenticated', async () => {
      asAnonymous();

      const res = await request(app).get('/apis/api-1');

      expect(res.status).toBe(401);
      expect(mockApiFindOne).not.toHaveBeenCalled();
    });

    it("returns 404 for another publisher's API", async () => {
      asOther();
      mockApiFindOne.mockResolvedValue(makeApi());

      const res = await request(app).get('/apis/api-1');

      expect(res.status).toBe(404);
    });

    it('returns 404 when the API does not exist', async () => {
      asOwner();
      mockApiFindOne.mockResolvedValue(null);

      const res = await request(app).get('/apis/api-1');

      expect(res.status).toBe(404);
    });

    it('returns the public shape without secrets for the owner', async () => {
      asOwner();
      mockApiFindOne.mockResolvedValue(makeApi());

      const res = await request(app).get('/apis/api-1');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'api-1', name: 'Weather API' });
      expectNoSecrets(res.body);
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /apis/:id (update)
  // -------------------------------------------------------------------------

  describe('PATCH /apis/:id (update)', () => {
    it('returns 401 when unauthenticated', async () => {
      asAnonymous();

      const res = await request(app).patch('/apis/api-1').send({ name: 'New name' });

      expect(res.status).toBe(401);
      expect(mockApiFindOneAndUpdate).not.toHaveBeenCalled();
    });

    it("returns 404 for another publisher's API", async () => {
      asOther();
      mockApiFindOne.mockResolvedValue(makeApi());
      mockApiFindOneAndUpdate.mockResolvedValue(makeApi({ name: 'New name' }));

      const res = await request(app).patch('/apis/api-1').send({ name: 'New name' });

      expect(res.status).toBe(404);
      expect(mockApiFindOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid input', async () => {
      asOwner();
      mockApiFindOne.mockResolvedValue(makeApi());

      const res = await request(app).patch('/apis/api-1').send({ name: '' });

      expect(res.status).toBe(400);
      expect(mockApiFindOneAndUpdate).not.toHaveBeenCalled();
    });

    it('updates the API and returns the public shape without secrets', async () => {
      asOwner();
      mockApiFindOne.mockResolvedValue(makeApi());
      mockApiFindOneAndUpdate.mockResolvedValue(makeApi({ name: 'New name' }));

      const res = await request(app).patch('/apis/api-1').send({ name: 'New name' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'api-1', name: 'New name' });
      expectNoSecrets(res.body);
    });
  });

  // -------------------------------------------------------------------------
  // POST /apis/:id/verify-ownership
  // -------------------------------------------------------------------------

  describe('POST /apis/:id/verify-ownership', () => {
    it('returns 401 when unauthenticated', async () => {
      asAnonymous();

      const res = await request(app).post('/apis/api-1/verify-ownership').send({});

      expect(res.status).toBe(401);
      expect(mockApiFindOneAndUpdate).not.toHaveBeenCalled();
    });

    it("returns 404 for another publisher's API", async () => {
      asOther();
      mockApiFindOne.mockResolvedValue(makeApi());

      const res = await request(app).post('/apis/api-1/verify-ownership').send({});

      expect(res.status).toBe(404);
      expect(mockApiFindOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 400 when the verification token is missing', async () => {
      asOwner();
      mockApiFindOne.mockResolvedValue(makeApi());

      const res = await request(app).post('/apis/api-1/verify-ownership').send({});

      expect(res.status).toBe(400);
      expect(mockApiFindOneAndUpdate).not.toHaveBeenCalled();
    });

    it('verifies ownership and returns the public shape without secrets', async () => {
      asOwner();
      mockApiFindOne.mockResolvedValue(makeApi());
      mockApiFindOneAndUpdate.mockResolvedValue(makeApi({ verified: true }));

      const res = await request(app)
        .post('/apis/api-1/verify-ownership')
        .send({ token: 'verification-token' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'api-1', verified: true });
      expectNoSecrets(res.body);
    });
  });

  // -------------------------------------------------------------------------
  // GET /apis/:id/stats
  // -------------------------------------------------------------------------

  describe('GET /apis/:id/stats', () => {
    it('returns 401 when unauthenticated', async () => {
      asAnonymous();

      const res = await request(app).get('/apis/api-1/stats');

      expect(res.status).toBe(401);
    });

    it("returns 404 for another publisher's API", async () => {
      asOther();
      mockApiFindOne.mockResolvedValue(makeApi());

      const res = await request(app).get('/apis/api-1/stats');

      expect(res.status).toBe(404);
    });

    it('returns 404 when the API does not exist', async () => {
      asOwner();
      mockApiFindOne.mockResolvedValue(null);

      const res = await request(app).get('/apis/api-1/stats');

      expect(res.status).toBe(404);
    });

    it('returns stats for the owner without secrets', async () => {
      asOwner();
      mockApiFindOne.mockResolvedValue(makeApi());
      mockUsageAggregate.mockResolvedValue([
        { _id: '2024-01-01', count: 10, errors: 1 },
      ]);
      mockUsageCountDocuments.mockResolvedValue(10);

      const res = await request(app).get('/apis/api-1/stats');

      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
      expectNoSecrets(res.body);
    });
  });
});