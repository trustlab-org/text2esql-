import { z } from 'zod';
import { ProviderNameSchema, ISODateTimeSchema } from './primitives.schema';
import type { TokenEstimate, CostEstimate, ProviderRateCard } from '../types';

// ---------------------------------------------------------------------------
// TokenEstimate
// ---------------------------------------------------------------------------
export const TokenEstimateSchema: z.ZodType<TokenEstimate> = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  estimatedAt: ISODateTimeSchema,
  isActual: z.boolean(),
});

// ---------------------------------------------------------------------------
// CostEstimate
// ---------------------------------------------------------------------------
export const CostEstimateSchema: z.ZodType<CostEstimate> = z.object({
  provider: ProviderNameSchema,
  model: z.string().min(1),
  promptCostUsd: z.number().nonnegative(),
  completionCostUsd: z.number().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
  currency: z.literal('USD'),
  rateCardVersion: z.string().min(1),
  estimatedAt: ISODateTimeSchema,
  isActual: z.boolean(),
});

// ---------------------------------------------------------------------------
// ProviderRateCard
// ---------------------------------------------------------------------------
export const ProviderRateCardSchema: z.ZodType<ProviderRateCard> = z.object({
  provider: ProviderNameSchema,
  model: z.string().min(1),
  promptCostPerThousandTokens: z.number().nonnegative(),
  completionCostPerThousandTokens: z.number().nonnegative(),
  currency: z.literal('USD'),
  effectiveDate: ISODateTimeSchema,
  version: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type TokenEstimateSchemaType = z.infer<typeof TokenEstimateSchema>;
export type CostEstimateSchemaType = z.infer<typeof CostEstimateSchema>;
export type ProviderRateCardSchemaType = z.infer<typeof ProviderRateCardSchema>;
