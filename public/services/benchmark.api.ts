import type { BenchmarkReport, BenchmarkRunRequest } from '../../common/types';
import type { ProviderName } from '../../common';
import { PLUGIN_ROUTE_PREFIX } from '../../common';
import { ApiClient } from './api.client';

/** Typed client for the admin benchmark endpoint. */
export class BenchmarkApiService extends ApiClient {
  public async runBenchmark(providers?: readonly ProviderName[]): Promise<BenchmarkReport> {
    const body: BenchmarkRunRequest = providers && providers.length ? { providers } : {};
    return this.post<BenchmarkReport>(`${PLUGIN_ROUTE_PREFIX}/benchmark`, body);
  }
}
