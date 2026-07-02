import { createContext, useContext } from 'react';
import type { HttpSetup } from '@kbn/core/public';
import { QueryApiService } from './query.api';
import { ProviderApiService } from './provider.api';
import { BenchmarkApiService } from './benchmark.api';
import { CredentialsApiService } from './credentials.api';
import { DataViewsApiService } from './dataviews.api';

export { ApiClient, ApiError } from './api.client';
export { QueryApiService } from './query.api';
export { ProviderApiService } from './provider.api';
export { BenchmarkApiService } from './benchmark.api';
export { CredentialsApiService } from './credentials.api';
export { DataViewsApiService } from './dataviews.api';

/** All API service instances made available to the React tree. */
export interface Services {
  readonly queryApi: QueryApiService;
  readonly providerApi: ProviderApiService;
  readonly benchmarkApi: BenchmarkApiService;
  readonly credentialsApi: CredentialsApiService;
  readonly dataViewsApi: DataViewsApiService;
}

/** Constructs the service instances from a Kibana HttpSetup. */
export function createServices(http: HttpSetup): Services {
  return {
    queryApi: new QueryApiService(http),
    providerApi: new ProviderApiService(http),
    benchmarkApi: new BenchmarkApiService(http),
    credentialsApi: new CredentialsApiService(http),
    dataViewsApi: new DataViewsApiService(http),
  };
}

/** React context carrying the API service instances. */
export const ServicesContext = createContext<Services | null>(null);

/** Provider component for {@link ServicesContext}. */
export const ServicesProvider = ServicesContext.Provider;

/** Hook to access the API services; throws if used outside a ServicesProvider. */
export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (services === null) {
    throw new Error('useServices must be called within a <ServicesProvider>.');
  }
  return services;
}
