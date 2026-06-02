import type { QueryLanguage } from '../constants';
import type { ProviderName } from './provider.types';
import type { ConversationMessage, QueryPipelineResult } from './pipeline.types';
import type { QueryExecutionResult } from './execution.types';

/**
 * Shared HTTP API contract between the Query Copilot browser client and server.
 *
 * These are the canonical request/response shapes that cross the wire. They
 * structurally mirror the server's internal route/pipeline types; the server
 * currently keeps its own local definitions (a future change could have the
 * routes import these directly to make this the single source of truth).
 */

/** Request body for `POST /api/query_copilot/generate`. */
export interface QueryGenerationRequest {
  readonly query: string;
  readonly indexPattern: string;
  readonly sessionId: string;
  readonly requestedLanguage?: QueryLanguage | null;
  readonly conversationHistory?: readonly ConversationMessage[];
  readonly preferredProvider?: ProviderName;
}

/** Response from `POST /api/query_copilot/generate` — the full pipeline result. */
export type QueryGenerationResponse = QueryPipelineResult;

/**
 * Response from executing a generated KQL query against an index.
 *
 * Aliased to {@link QueryExecutionResult} so the executor service's result and
 * the wire contract are a single source of truth.
 */
export type QueryExecutionResponse = QueryExecutionResult;

/** Status of a single LLM provider (item in `GET /api/query_copilot/providers`). */
export interface ProviderStatus {
  readonly name: ProviderName;
  readonly role: string;
  readonly priority: number;
  readonly healthy: boolean;
  readonly lastCheckedAt: string;
  readonly model: string;
  readonly enabled: boolean;
}

/** Health rollup status for the system and its individual components. */
export type ComponentHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/** Health of a single subsystem. */
export interface ComponentHealth {
  readonly status: ComponentHealthStatus;
  readonly detail: string;
}

/** Aggregate system health (`GET /api/query_copilot/health`). */
export interface SystemHealth {
  readonly status: ComponentHealthStatus;
  readonly components: {
    readonly redis: ComponentHealth;
    readonly providers: ComponentHealth;
    readonly pipeline: ComponentHealth;
  };
}
