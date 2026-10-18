import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { api as apiTable } from '../db/schema.js';
import type { ApiRow } from '../db/schema.js';
import { sharedX402ResourceServer } from '../lib/x402.js';

export interface ApiPaywallOptions {
  price?: string;
  network?: string;
  description?: string;
  mimeType?: string;
}

const middlewareCache = new Map<string, ReturnType<typeof buildMiddleware>>();

function buildMiddleware(api: ApiRow, options: ApiPaywallOptions) {
  const price = options.price ?? api.price ?? '$0.01';
  const network = options.network ?? api.network ?? 'base-sepolia';
  const payTo = api.walletAddress;

  const router = Router();

  router.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      const resourceServer = await sharedX402ResourceServer({
        network,
        payTo,
        price,
      });

      const middleware = resourceServer.middleware({
        price,
        network,
        payTo,
        description: options.description ?? api.description ?? undefined,
        mimeType: options.mimeType ?? api.mimeType ?? undefined,
      });

      return middleware(req, res, next);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

export function apiPaywall(options: ApiPaywallOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const api = res.locals.api as ApiRow | undefined;

    if (!api) {
      return res.status(500).json({ error: 'apiPaywall requires res.locals.api' });
    }

    const cacheKey = `${api.id}:${options.price ?? api.price ?? ''}:${options.network ?? api.network ?? ''}`;

    let middleware = middlewareCache.get(cacheKey);
    if (!middleware) {
      middleware = buildMiddleware(api, options);
      middlewareCache.set(cacheKey, middleware);
    }

    return middleware(req, res, next);
  };
}

export async function loadProxiedApi(req: Request, res: Response, next: NextFunction) {
  const apiId = req.params.apiId ?? req.params.id;

  if (!apiId) {
    return res.status(404).json({ error: 'API not found' });
  }

  const rows = await db.select().from(apiTable).where(eq(apiTable.id, apiId)).limit(1);
  const api = rows[0];

  if (!api || !api.listed) {
    return res.status(404).json({ error: 'API not found' });
  }

  const method = req.method.toUpperCase();
  const allowed = (api.allowedMethods ?? ['GET', 'POST']).map((m) => m.toUpperCase());

  if (!allowed.includes(method)) {
    res.setHeader('Allow', allowed.join(', '));
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.locals.api = api;
  return next();
}

export function clearApiPaywallCache() {
  middlewareCache.clear();
}
</｜｜DSML｜｜ parameter>
<｜｜DSML｜｜ parameter name="file_path" string="true">server/src/middleware/apiPaywall.ts</｜｜DSML｜｜ parameter>
</｜｜DSML｜｜ invoke>
</｜｜DSML｜｜ calls>