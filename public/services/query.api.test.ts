import { QueryApiService } from './query.api';
import { ApiError } from './api.client';
import type { HttpSetup } from '@kbn/core/public';
import type { QueryGenerationRequest } from '../../common/types';

describe('QueryApiService', () => {
  it('generateQuery posts to the generate endpoint', async () => {
    const http = {
      post: jest.fn().mockResolvedValue({ pipelineId: 'p1', status: 'succeeded' }),
      get: jest.fn(),
    };
    const svc = new QueryApiService(http as unknown as HttpSetup);
    const req = {
      query: 'failed logins',
      indexPattern: 'logs-*',
      sessionId: 's1',
    } as QueryGenerationRequest;

    const res = await svc.generateQuery(req);

    expect(res.pipelineId).toBe('p1');
    expect(http.post).toHaveBeenCalledWith('/api/query_copilot/generate', {
      body: JSON.stringify(req),
    });
  });

  it('executeQuery posts kql and indexPattern to the execute endpoint', async () => {
    const http = {
      post: jest.fn().mockResolvedValue({ columns: [], rows: [], total: 0, tookMs: 5, timedOut: false }),
      get: jest.fn(),
    };
    const svc = new QueryApiService(http as unknown as HttpSetup);

    await svc.executeQuery('user.name : "x"', 'logs-*');

    expect(http.post).toHaveBeenCalledWith('/api/query_copilot/execute', {
      body: JSON.stringify({ kql: 'user.name : "x"', indexPattern: 'logs-*' }),
    });
  });

  it('executeQuery forwards a scoped (non-wildcard) index pattern in the POST body', async () => {
    const http = {
      post: jest.fn().mockResolvedValue({ columns: [], rows: [], total: 0, tookMs: 5, timedOut: false }),
      get: jest.fn(),
    };
    const svc = new QueryApiService(http as unknown as HttpSetup);

    await svc.executeQuery('event.action:*', 'fosstlsoc-logs-*');

    expect(http.post).toHaveBeenCalledTimes(1);
    const [, options] = http.post.mock.calls[0] as [string, { body: string }];
    const sentBody = JSON.parse(options.body) as { kql: string; indexPattern: string };
    expect(sentBody.indexPattern).toBe('fosstlsoc-logs-*');
    expect(sentBody.indexPattern).not.toBe('*');
  });

  it('estimateTokens posts query + providers to the token-estimate endpoint', async () => {
    const http = {
      post: jest.fn().mockResolvedValue({ estimates: [] }),
      get: jest.fn(),
    };
    const svc = new QueryApiService(http as unknown as HttpSetup);

    await svc.estimateTokens('failed logins', [
      { provider: 'anthropic', model: 'claude-x' },
      { provider: 'openai' },
    ]);

    expect(http.post).toHaveBeenCalledWith('/api/query_copilot/token-estimate', {
      body: JSON.stringify({
        query: 'failed logins',
        providers: [{ provider: 'anthropic', model: 'claude-x' }, { provider: 'openai' }],
      }),
    });
  });

  it('rejects with ApiError on a failed request', async () => {
    const http = {
      post: jest.fn().mockRejectedValue({ response: { status: 503 }, body: { message: 'down' } }),
      get: jest.fn(),
    };
    const svc = new QueryApiService(http as unknown as HttpSetup);
    const req = {
      query: 'failed logins',
      indexPattern: 'logs-*',
      sessionId: 's1',
    } as QueryGenerationRequest;

    await expect(svc.generateQuery(req)).rejects.toBeInstanceOf(ApiError);
  });
});
