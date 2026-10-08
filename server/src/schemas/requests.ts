import { z } from "zod/v4";

export const publisherRegisterSchema = z
  .object({
    name: z.string().min(1),
    email: z.email(),
    walletAddress: z.string().min(1),
  })
  .strict();

export const linkPublishSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().optional(),
    price: z.string().min(1),
    walletAddress: z.string().optional(),
    externalUrl: z.url(),
  })
  .strict();

export const filePublishBodySchema = z
  .object({
    title: z.string().min(1),
    price: z.string().min(1),
    description: z.string().optional(),
    walletAddress: z.string().optional(),
  })
  .strict();

export const verifyContentSchema = z
  .object({
    content: z.string().min(1),
    resourceId: z.string().min(1).optional(),
  })
  .strict();

export const registerResourceSchema = z
  .object({
    signedXdr: z.string().min(1).optional(),
  })
  .strict();

export const preparePriceSchema = z
  .object({
    price: z.string().min(1),
  })
  .strict();

export const setPriceSchema = z
  .object({
    signedXdr: z.string().min(1),
    price: z.string().min(1),
  })
  .strict();

export const prepareOwnershipSchema = z
  .object({
    newCreator: z.string().min(1),
  })
  .strict();

export const transferOwnershipSchema = z
  .object({
    signedXdr: z.string().min(1),
    newCreator: z.string().min(1),
  })
  .strict();

/** Sort values supported by GET /resources (#163). */
export const catalogSortValues = ["newest", "price_asc", "price_desc", "title"] as const;

export const CATALOG_DEFAULT_LIMIT = 20;
export const CATALOG_MAX_LIMIT = 100;

/** Query params for GET /resources (public catalog). */
export const catalogQuerySchema = z
  .object({
    verificationStatus: z.enum(["verified", "pending", "rejected"]).optional(),
    minPrice: z
      .string()
      .regex(/^\d+(\.\d+)?$/, "must be a non-negative number")
      .optional(),
    maxPrice: z
      .string()
      .regex(/^\d+(\.\d+)?$/, "must be a non-negative number")
      .optional(),
    search: z.string().optional(),
    resourceType: z.enum(["file", "link"]).optional(),
    owner: z.string().optional(),
    sort: z.enum(catalogSortValues).optional(),
    limit: z.coerce.number().int().min(1).max(CATALOG_MAX_LIMIT).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.minPrice !== undefined && data.maxPrice !== undefined) {
        return parseFloat(data.minPrice) <= parseFloat(data.maxPrice);
      }
      return true;
    },
    {
      message: "minPrice cannot be greater than maxPrice",
      path: ["minPrice"],
    },
  );

// ── Pay-per-call APIs ─────────────────────────────────────────────────────────

export const API_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const usdcPrice = z
  .string()
  .regex(/^\d+(\.\d{1,7})?$/, "price must be a USDC amount with at most 7 decimals")
  .refine((v) => Number(v) > 0, "price must be greater than 0");

const stellarAddress = z
  .string()
  .regex(/^G[A-Z2-7]{55}$/, "walletAddress must be a Stellar public key (G...)");

// Headers the proxy itself controls; a provider secret may not use these names.
const RESERVED_HEADER_NAMES = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "upgrade",
  "cookie",
  "x-payment",
  "payment-signature",
]);

const upstreamHeader = z
  .object({
    name: z
      .string()
      .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/, "header name contains invalid characters")
      .refine((n) => !RESERVED_HEADER_NAMES.has(n.toLowerCase()), "header name is reserved"),
    value: z
      .string()
      .min(1)
      .max(4096)
      .refine((v) => !/[\r\n\0]/.test(v), "header value must not contain line breaks"),
  })
  .strict();

const tagList = z.array(z.string().trim().min(1).max(32).toLowerCase()).max(10);

export const createApiSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000).optional(),
    upstreamUrl: z.url(),
    price: usdcPrice,
    walletAddress: stellarAddress.optional(),
    allowedMethods: z.array(z.enum(API_METHODS)).min(1).default(["GET"]),
    upstreamHeader: upstreamHeader.optional(),
    timeoutMs: z.number().int().min(1000).optional(),
    tags: tagList.default([]),
  })
  .strict();

export const updateApiSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(2000).nullable().optional(),
    upstreamUrl: z.url().optional(),
    price: usdcPrice.optional(),
    walletAddress: stellarAddress.optional(),
    allowedMethods: z.array(z.enum(API_METHODS)).min(1).optional(),
    upstreamHeader: upstreamHeader.nullable().optional(),
    timeoutMs: z.number().int().min(1000).nullable().optional(),
    tags: tagList.optional(),
    listed: z.boolean().optional(),
  })
  .strict();

export const apiCatalogQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(CATALOG_MAX_LIMIT).default(CATALOG_DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});
