import {
  createServices,
  QueryApiService,
  ProviderApiService,
  CredentialsApiService,
} from './index';
import type { HttpSetup } from '@kbn/core/public';

describe('createServices', () => {
  it('constructs the API service instances', () => {
    const services = createServices(
      { post: jest.fn(), get: jest.fn(), delete: jest.fn() } as unknown as HttpSetup
    );

    expect(services.queryApi).toBeInstanceOf(QueryApiService);
    expect(services.providerApi).toBeInstanceOf(ProviderApiService);
    expect(services.credentialsApi).toBeInstanceOf(CredentialsApiService);
  });
});
