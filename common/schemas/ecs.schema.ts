import { z } from 'zod';
import {
  ECSFieldCategorySchema,
  ECSFieldTypeSchema,
  ECSNormalizationLevelSchema,
} from './primitives.schema';
import type {
  ECSField,
  ECSFieldGroup,
  ECSFieldIndex,
  ECSFieldMapping,
} from '../types';

// ---------------------------------------------------------------------------
// ECSField
// ---------------------------------------------------------------------------
export const ECSFieldSchema: z.ZodType<ECSField> = z.object({
  name: z.string().min(1),
  type: ECSFieldTypeSchema,
  category: ECSFieldCategorySchema,
  description: z.string().min(1),
  example: z.union([z.string(), z.number(), z.boolean()]).optional(),
  isRequired: z.boolean(),
  isMultiValue: z.boolean(),
  normalizationLevel: ECSNormalizationLevelSchema,
});

// ---------------------------------------------------------------------------
// ECSFieldGroup
// ---------------------------------------------------------------------------
export const ECSFieldGroupSchema: z.ZodType<ECSFieldGroup> = z.object({
  category: ECSFieldCategorySchema,
  fields: z.array(ECSFieldSchema).readonly(),
  description: z.string().min(1),
});

// ---------------------------------------------------------------------------
// ECSFieldIndex
// ---------------------------------------------------------------------------
export const ECSFieldIndexSchema: z.ZodType<ECSFieldIndex> = z.object({
  indexPattern: z.string().min(1),
  availableFields: z.array(ECSFieldSchema).readonly(),
  lastRefreshedAt: z.string().datetime({ offset: true }),
  totalFields: z.number().int().nonnegative(),
  ecsCompliantFields: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// ECSFieldMapping
// ---------------------------------------------------------------------------
export const ECSFieldMappingSchema: z.ZodType<ECSFieldMapping> = z.object({
  sourceField: z.string().min(1),
  ecsField: ECSFieldSchema,
  confidence: z.number().min(0).max(1),
  transformRequired: z.boolean(),
});

// ---------------------------------------------------------------------------
// Inferred types — must be structurally identical to common/types/ecs.types.ts
// ---------------------------------------------------------------------------
export type ECSFieldSchemaType = z.infer<typeof ECSFieldSchema>;
export type ECSFieldGroupSchemaType = z.infer<typeof ECSFieldGroupSchema>;
export type ECSFieldIndexSchemaType = z.infer<typeof ECSFieldIndexSchema>;
export type ECSFieldMappingSchemaType = z.infer<typeof ECSFieldMappingSchema>;
