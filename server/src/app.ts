import express, { type Express, type Request, type Response, type NextFunction } from "express";
import compression from "compression";
import { config } from "./config.js";
import { corsMiddleware } from "./cors.js";
import { securityHeaders } from "./middleware/security.js";
import { getLogger } from "./lib/logger.js";
import { requestContextMiddleware } from "./middleware/requestContext.js";
import { inFlightMiddleware } from "./middleware/inFlight.js";
import { requestTimeout } from "./middleware/timeout.js";
import { requestDurationMiddleware } from "./middleware/requestDuration.js";
import { captureServerException } from "./lib/sentry.js";
import healthRouter from "./routes/health.js";
import publisherRouter from "./routes/publishers.js";
import registryRouter from "./routes/registry.js";
import resourceRouter from "./routes/resources.js";
import verifyRouter from "./routes/verify.js";
import paymentsRouter from "./routes/payments.js";
import apisRouter from "./routes/apis.js";
import docsRouter from "./routes/docs.js";
import metricsRouter from "./routes/metrics.js";

export function createApp(): Express {
  const app = express();

  app.use(securityHeaders());
  app.use(compression());
  app.use(corsMiddleware());
  app.use(requestContextMiddleware);
  app.use(inFlightMiddleware);
  // The pay-per-call proxy forwards request bodies byte-for-byte, so it reads
  // them raw itself (routes/apis.ts) instead of going through the JSON parser.
  const jsonParser = express.json({ limit: config.MAX_JSON_BODY_SIZE });
  app.use((req, res, next) => (req.path.startsWith("/api/") ? next() : jsonParser(req, res, next)));
  app.use(requestTimeout(config.REQUEST_TIMEOUT_MS));
  app.use(requestDurationMiddleware);

  // Routes
  app.use(healthRouter);
  app.use(publisherRouter);
  app.use(registryRouter);
  app.use(resourceRouter);
  app.use(verifyRouter);
  app.use(paymentsRouter);
  app.use(apisRouter);
  app.use(metricsRouter);

  // OpenAPI spec + Swagger UI (all envs; UI is CDN-based, no extra package needed)
  app.use(docsRouter);

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    getLogger().error({ err, event: "unhandled_error" }, "unhandled error");
    captureServerException(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
