import type { ECSFieldCategory, ECSFieldType } from '../constants';

export interface ECSField {
  readonly name: string;
  readonly type: ECSFieldType;
  readonly category: ECSFieldCategory;
  readonly description: string;
  readonly example?: string | number | boolean;
  readonly isRequired: boolean;
  readonly isMultiValue: boolean;
  readonly normalizationLevel: ECSNormalizationLevel;
}

export type ECSNormalizationLevel = 'core' | 'extended' | 'custom';

export interface ECSFieldGroup {
  readonly category: ECSFieldCategory;
  readonly fields: readonly ECSField[];
  readonly description: string;
}

export interface ECSFieldIndex {
  readonly indexPattern: string;
  readonly availableFields: readonly ECSField[];
  readonly lastRefreshedAt: string; // ISO 8601
  readonly totalFields: number;
  readonly ecsCompliantFields: number;
}

export interface ECSFieldMapping {
  readonly sourceField: string;
  readonly ecsField: ECSField;
  readonly confidence: number; // 0.0 – 1.0
  readonly transformRequired: boolean;
}
