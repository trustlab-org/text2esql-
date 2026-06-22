import { CredentialsApiService } from './credentials.api';
import { ApiError } from './api.client';
import type { HttpSetup } from '@kbn/core/public';
import type { MaskedCredentials, SaveCredentialsInput } from '../../common/types';

const MASKED: MaskedCredentials = {
  primary: { provider: 'anthropic', model: null, endpoint: null, hasKey: true },
  fallback: null,
};

describe('CredentialsApiService', () => {
  it('getCredentials GETs and unwraps the credentials envelope', async () => {
    const http = {
      get: jest.fn().mockResolvedValue({ credentials: MASKED }),
      post: jest.fn(),
      delete: jest.fn(),
    };
    const svc = new CredentialsApiService(http as unknown as HttpSetup);

    const res = await svc.getCredentials();

    expect(res).toEqual(MASKED);
    expect(http.get).toHaveBeenCalledWith('/api/query_copilot/credentials');
  });

  it('saveCredentials POSTs the input and unwraps the response', async () => {
    const http = {
      get: jest.fn(),
      post: jest.fn().mockResolvedValue({ credentials: MASKED }),
      delete: jest.fn(),
    };
    const svc = new CredentialsApiService(http as unknown as HttpSetup);
    const input: SaveCredentialsInput = {
      primary: { provider: 'anthropic', apiKey: 'sk-x' },
      fallback: null,
    };

    const res = await svc.saveCredentials(input);

    expect(res).toEqual(MASKED);
    expect(http.post).toHaveBeenCalledWith('/api/query_copilot/credentials', {
      body: JSON.stringify(input),
    });
  });

  it('deleteCredentials DELETEs the credentials endpoint', async () => {
    const http = {
      get: jest.fn(),
      post: jest.fn(),
      delete: jest.fn().mockResolvedValue({ deleted: true }),
    };
    const svc = new CredentialsApiService(http as unknown as HttpSetup);

    await svc.deleteCredentials();

    expect(http.delete).toHaveBeenCalledWith('/api/query_copilot/credentials');
  });

  it('rejects with ApiError on a failed request', async () => {
    const http = {
      get: jest.fn().mockRejectedValue({ response: { status: 500 }, body: { message: 'boom' } }),
      post: jest.fn(),
      delete: jest.fn(),
    };
    const svc = new CredentialsApiService(http as unknown as HttpSetup);

    await expect(svc.getCredentials()).rejects.toBeInstanceOf(ApiError);
  });
});
