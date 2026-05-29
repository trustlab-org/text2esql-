import type { ProviderName } from './provider.types';

export interface TokenEstimate {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly estimatedAt: string; // ISO 8601
  readonly isActual: boolean; // true = actual from API, false = pre-flight estimate
}

export interface CostEstimate {
  readonly provider: ProviderName;
  readonly model: string;
  readonly promptCostUsd: number;
  readonly completionCostUsd: number;
  readonly totalCostUsd: number;
  readonly currency: 'USD';
  readonly rateCardVersion: string;
  readonly estimatedAt: string; // ISO 8601
  readonly isActual: boolean;
}

export interface ProviderRateCard {
  readonly provider: ProviderName;
  readonly model: string;
  readonly promptCostPerThousandTokens: number;
  readonly completionCostPerThousandTokens: number;
  readonly currency: 'USD';
  readonly effectiveDate: string; // ISO 8601
  readonly version: string;
}
