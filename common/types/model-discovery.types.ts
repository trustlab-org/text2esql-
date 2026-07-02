import type { ProviderName } from './provider.types';

/** One model available on a provider account, discovered live (never hardcoded). */
export interface DiscoveredModel {
  readonly id: string;
  readonly displayName: string;
}

/** Request body for POST /api/query_copilot/models. */
export interface ModelDiscoveryRequest {
  readonly provider: ProviderName;
  /** Raw key typed by the user; omit to use the user's stored credential for this provider. Never logged. */
  readonly apiKey?: string;
  /** Endpoint override (Ollama). */
  readonly endpoint?: string;
}

/** Response payload for POST /api/query_copilot/models. */
export interface ModelDiscoveryResponse {
  readonly provider: ProviderName;
  readonly models: readonly DiscoveredModel[];
}
