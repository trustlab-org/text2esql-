import { registerCredentialsRoutes } from './credentials.routes';
import type { IRouter } from '@kbn/core/server';
import type { QueryCopilotContext } from '../types';

// ---------------------------------------------------------------------------
// credentials.routes unit tests.
//
// The CredentialsService and the current-user getter are plain jest mocks. We
// assert auth gating, the masked-status responses, the first-key-required
// validation, and that an apiKey never appears in a logged/echoed payload.
// ---------------------------------------------------------------------------

type Handlers = { get?: any; post?: any; delete?: any };

function captureHandlers(): { router: IRouter; handlers: Handlers } {
  const handlers: Handlers = {};
  const router = {
    get: jest.fn((_o: unknown, h: unknown) => {
      handlers.get = h;
    }),
    post: jest.fn((_o: unknown, h: unknown) => {
      handlers.post = h;
    }),
    delete: jest.fn((_o: unknown, h: unknown) => {
      handlers.delete = h;
    }),
    put: jest.fn(),
    patch: jest.fn(),
  } as unknown as IRouter;
  return { router, handlers };
}

const MASKED = {
  providers: [{ provider: 'openai', model: 'gpt-4o', endpoint: null, hasKey: true }],
  primaryProvider: 'openai',
};

function makeService(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    getMaskedForUser: jest.fn().mockResolvedValue(MASKED),
    saveForUser: jest.fn().mockResolvedValue(undefined),
    deleteForUser: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeContext(service: ReturnType<typeof makeService>): QueryCopilotContext {
  return {
    logger: { logRequest: jest.fn(), logError: jest.fn() },
    getCredentialsService: jest.fn(() => service),
  } as unknown as QueryCopilotContext;
}

function makeCtx(username: string | null = 'alice') {
  return {
    core: Promise.resolve({
      security: { authc: { getCurrentUser: () => (username ? { username } : null) } },
    }),
  };
}

function makeRequest(body?: unknown) {
  return { body, url: { pathname: '/api/query_copilot/credentials' }, headers: {} };
}

function makeResponse() {
  return {
    ok: jest.fn((x) => ({ kind: 'ok', ...x })),
    unauthorized: jest.fn((x) => ({ kind: 'unauthorized', ...x })),
    customError: jest.fn((x) => ({ kind: 'customError', ...x })),
  };
}

describe('registerCredentialsRoutes', () => {
  describe('GET', () => {
    it('returns the masked status for the current user', async () => {
      const service = makeService();
      const { router, handlers } = captureHandlers();
      registerCredentialsRoutes(router, makeContext(service));

      const response = makeResponse();
      await handlers.get(makeCtx(), makeRequest(), response as any);

      expect(service.getMaskedForUser).toHaveBeenCalledWith('alice');
      expect(response.ok).toHaveBeenCalledTimes(1);
      const arg = response.ok.mock.calls[0][0];
      expect(arg.body.credentials).toBe(MASKED);
      expect(arg.headers).toHaveProperty('X-Request-ID');
    });

    it('401s when there is no authenticated user', async () => {
      const service = makeService();
      const { router, handlers } = captureHandlers();
      registerCredentialsRoutes(router, makeContext(service));

      const response = makeResponse();
      await handlers.get(makeCtx(null), makeRequest(), response as any);

      expect(response.unauthorized).toHaveBeenCalledTimes(1);
      expect(service.getMaskedForUser).not.toHaveBeenCalled();
    });
  });

  describe('POST', () => {
    it('saves and returns the new masked status', async () => {
      const service = makeService();
      const { router, handlers } = captureHandlers();
      registerCredentialsRoutes(router, makeContext(service));

      const body = { providers: [{ provider: 'openai', apiKey: 'sk-123' }] };
      const response = makeResponse();
      await handlers.post(makeCtx(), makeRequest(body), response as any);

      expect(service.saveForUser).toHaveBeenCalledWith('alice', body);
      expect(response.ok).toHaveBeenCalledTimes(1);
      // The raw key must never be echoed back in the response.
      expect(JSON.stringify(response.ok.mock.calls[0][0].body)).not.toContain('sk-123');
    });

    it('400s when the first key is missing for a non-ollama provider', async () => {
      const service = makeService({ getMaskedForUser: jest.fn().mockResolvedValue(null) });
      const { router, handlers } = captureHandlers();
      registerCredentialsRoutes(router, makeContext(service));

      const body = { providers: [{ provider: 'openai' }] };
      const response = makeResponse();
      await handlers.post(makeCtx(), makeRequest(body), response as any);

      expect(service.saveForUser).not.toHaveBeenCalled();
      expect(response.customError).toHaveBeenCalledTimes(1);
      expect(response.customError.mock.calls[0][0].statusCode).toBe(400);
    });

    it('allows ollama without a key', async () => {
      const service = makeService({ getMaskedForUser: jest.fn().mockResolvedValue(null) });
      const { router, handlers } = captureHandlers();
      registerCredentialsRoutes(router, makeContext(service));

      const body = { providers: [{ provider: 'ollama' }] };
      const response = makeResponse();
      await handlers.post(makeCtx(), makeRequest(body), response as any);

      expect(service.saveForUser).toHaveBeenCalledTimes(1);
      expect(response.ok).toHaveBeenCalledTimes(1);
    });

    it('allows a metadata edit when a key is already on file', async () => {
      const service = makeService(); // getMaskedForUser → MASKED (openai hasKey: true)
      const { router, handlers } = captureHandlers();
      registerCredentialsRoutes(router, makeContext(service));

      const body = { providers: [{ provider: 'openai', model: 'gpt-4o-mini' }] };
      const response = makeResponse();
      await handlers.post(makeCtx(), makeRequest(body), response as any);

      expect(service.saveForUser).toHaveBeenCalledTimes(1);
      expect(response.ok).toHaveBeenCalledTimes(1);
    });

    it('401s with no authenticated user', async () => {
      const service = makeService();
      const { router, handlers } = captureHandlers();
      registerCredentialsRoutes(router, makeContext(service));

      const response = makeResponse();
      await handlers.post(makeCtx(null), makeRequest({}), response as any);

      expect(response.unauthorized).toHaveBeenCalledTimes(1);
      expect(service.saveForUser).not.toHaveBeenCalled();
    });
  });

  describe('DELETE', () => {
    it('deletes and returns ok', async () => {
      const service = makeService();
      const { router, handlers } = captureHandlers();
      registerCredentialsRoutes(router, makeContext(service));

      const response = makeResponse();
      await handlers.delete(makeCtx(), makeRequest(), response as any);

      expect(service.deleteForUser).toHaveBeenCalledWith('alice');
      expect(response.ok).toHaveBeenCalledTimes(1);
      expect(response.ok.mock.calls[0][0].body).toEqual({ deleted: true });
    });
  });
});
