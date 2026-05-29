import { z } from 'zod';
import { CacheKeyStrategySchema, ISODateTimeSchema } from './primitives.schema';
import { PIPELINE_CONFIG } from '../constants';
import type { CacheStats } from '../types';

// ---------------------------------------------------------------------------
// CacheEntry<unknown>
// CacheEntry is generic in the type system; the schema validates the envelope.
// Consumers needing typed values should compose: CacheEntrySchema(valueSchema).
// ---------------------------------------------------------------------------
/**
 * CacheEntry envelope validator for unknown payloads.
 * For typed payload validation, use CacheEntryOf(valueSchema) instead.
 *
 * Note: We intentionally do not annotate this as ZodType<CacheEntry<unknown>>
 * because z.any() causes Zod to infer `value` as optional in its output type.
 * Structural correctness is verified via the CacheEntryOf factory below, which
 * uses a concrete ZodType<T> and is validated at each call site.
 */
export const CacheEntrySchema = z.object({
  key: z.string().min(1).max(512),
  value: z.any(),
  createdAt: ISODateTimeSchema,
  expiresAt: ISODateTimeSchema,
  hitCount: z.number().int().nonnegative(),
  lastAccessedAt: ISODateTimeSchema,
  sizeBytes: z.number().int().nonnegative(),
  tags: z.array(z.string()).readonly(),
});

/**
 * Factory for typed CacheEntry schemas.
 * Usage: CacheEntryOf(z.string()) → validates CacheEntry<string>
 */
export function CacheEntryOf<T>(valueSchema: z.ZodType<T>) {
  return z.object({
    key: z.string().min(1).max(512),
    value: valueSchema,
    createdAt: ISODateTimeSchema,
    expiresAt: ISODateTimeSchema,
    hitCount: z.number().int().nonnegative(),
    lastAccessedAt: ISODateTimeSchema,
    sizeBytes: z.number().int().nonnegative(),
    tags: z.array(z.string()).readonly(),
  });
}

// ---------------------------------------------------------------------------
// CacheStats
// ---------------------------------------------------------------------------
export const CacheStatsSchema: z.ZodType<CacheStats> = z.object({
  totalEntries: z.number().int().nonnegative(),
  totalSizeBytes: z.number().int().nonnegative(),
  hitCount: z.number().int().nonnegative(),
  missCount: z.number().int().nonnegative(),
  hitRatio: z.number().min(0).max(1),
  evictionCount: z.number().int().nonnegative(),
  oldestEntryAt: ISODateTimeSchema.nullable(),
});

// ---------------------------------------------------------------------------
// CacheConfigSchema — runtime cache configuration (not in common/types)
// ---------------------------------------------------------------------------
export const CacheConfigSchema = z.object({
  enabled: z.boolean().default(true),
  ttlSeconds: z
    .number()
    .int()
    .positive()
    .max(86_400) // 24h ceiling
    .default(PIPELINE_CONFIG.CACHE_TTL_SECONDS),
  maxEntries: z
    .number()
    .int()
    .positive()
    .max(100_000)
    .default(1_000),
  maxSizeBytes: z
    .number()
    .int()
    .positive()
    .max(1_073_741_824) // 1 GiB ceiling
    .default(104_857_600), // 100 MiB default
  keyStrategy: CacheKeyStrategySchema.default('normalized'),
  allowStaleOnError: z.boolean().default(false),
  backgroundRefresh: z.boolean().default(false),
  backgroundRefreshThresholdSeconds: z
    .number()
    .int()
    .positive()
    .default(30)
    .describe('Refresh if TTL remaining is below this threshold'),
});

export type CacheConfig = z.infer<typeof CacheConfigSchema>;
export type CacheEntrySchemaType = z.infer<typeof CacheEntrySchema>;
export type CacheStatsSchemaType = z.infer<typeof CacheStatsSchema>;
