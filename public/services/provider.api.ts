import type {
  ModelDiscoveryRequest,
  ModelDiscoveryResponse,
  ProviderStatus,
  SystemHealth,
} from '../../common/types';
import { PLUGIN_ROUTE_PREFIX } from '../../common';
import { ApiClient } from './api.client';

/** Typed client for the provider-status, health, and model-discovery endpoints. */
export class ProviderApiService extends ApiClient {
  public async getProviders(): Promise<{ providers: ProviderStatus[] }> {
    return this.get<{ providers: ProviderStatus[] }>(`${PLUGIN_ROUTE_PREFIX}/providers`);
  }

  public async getHealth(): Promise<SystemHealth> {
    return this.get<SystemHealth>(`${PLUGIN_ROUTE_PREFIX}/health`);
  }

  /**
   * Discovers the models available for a provider (POST /models). Omitting the
   * apiKey makes the server use the user's STORED key for that provider; the
   * key is therefore only included when the caller typed a non-empty one.
   * `forceRefresh` bypasses the server's 5-minute per-provider+key cache.
   * The apiKey is never logged.
   */
  public async discoverModels(
    request: ModelDiscoveryRequest & { forceRefresh?: boolean }
  ): Promise<ModelDiscoveryResponse> {
    const body: {
      provider: ModelDiscoveryRequest['provider'];
      apiKey?: string;
      endpoint?: string;
      forceRefresh?: boolean;
    } = { provider: request.provider };
    if (request.apiKey !== undefined && request.apiKey.length > 0) {
      body.apiKey = request.apiKey;
    }
    if (request.endpoint !== undefined && request.endpoint.length > 0) {
      body.endpoint = request.endpoint;
    }
    if (request.forceRefresh === true) {
      body.forceRefresh = true;
    }
    return this.post<ModelDiscoveryResponse>(`${PLUGIN_ROUTE_PREFIX}/models`, body);
  }
}
