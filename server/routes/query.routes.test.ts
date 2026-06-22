import { errorCodeToHttpStatus, registerQueryRoutes } from './query.routes';
import { ERROR_CODES } from '../../common';
import type { IRouter } from '@kbn/core/server';
import type { QueryCopilotContext } from '../types';

describe('errorCodeToHttpStatus', () => {
  it('maps rate-limit error codes to 429', () => {
    expect(errorCodeToHttpStatus(ERROR_CODES.PROVIDER_RATE_LIMITED)).toBe(429);
    expect(errorCodeToHttpStatus(ERROR_CODES.RATE_LIMIT_EXCEEDED)).toBe(429);
  });

  it('maps provider-unavailable error codes to 503', () => {
    expect(errorCodeToHttpStatus(ERROR_CODES.PROVIDER_UNREACHABLE)).toBe(503);
    expect(errorCodeToHttpStatus(ERROR_CODES.PROVIDER_TIMEOUT)).toBe(503);
  });

  it('maps validation error codes to 400', () => {
    expect(errorCodeToHttpStatus(ERROR_CODES.PIPELINE_MAX_CORRECTIONS_EXCEEDED)).toBe(400);
    expect(errorCodeToHttpStatus(ERROR_CODES.VALIDATION_UNKNOWN_FIELD)).toBe(400);
  });

  it('maps unknown / null / internal error codes to 500', () => {
    expect(errorCodeToHttpStatus(ERROR_CODES.INTERNAL_ERROR)).toBe(500);
    expect(errorCodeToHttpStatus(null)).toBe(500);
    expect(errorCodeToHttpStatus('SOME_UNKNOWN_CODE')).toBe(500);
  });
});

function captureHandler(): { router: IRouter; getHandler: () => any } {
  let handler: any;
  const router = {
    post: jest.fn((_opts: unknown, h: unknown) => {
      handler = h;
    }),
    get: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn(),
  } as unknown as IRouter;
  return { router, getHandler: () => handler };
}

// By default the mocked credentials service returns a usable primary credential
// so the handler proceeds to the pipeline. Individual tests can override it.
const DEFAULT_CREDS = { primary: { provider: 'openai', apiKey: 'sk-test' }, fallback: null };

function makeContext(
  execute: jest.Mock,
  createPipeline?: jest.Mock,
  getDecryptedCredentialsForUser?: jest.Mock
): QueryCopilotContext {
  const cp = createPipeline ?? jest.fn(() => ({ execute }));
  const credentialsService = {
    getDecryptedCredentialsForUser:
      getDecryptedCredentialsForUser ?? jest.fn().mockResolvedValue(DEFAULT_CREDS),
  };
  return {
    logger: {
      logRequest: jest.fn(),
      logPipelineStage: jest.fn(),
      logError: jest.fn(),
      logProviderCall: jest.fn(),
      logCacheEvent: jest.fn(),
    },
    metrics: {},
    config: {},
    router: {},
    createPipeline: cp,
    getCredentialsService: jest.fn(() => credentialsService),
  } as unknown as QueryCopilotContext;
}

const esClient = { search: jest.fn() };
function makeCtx() {
  return {
    core: Promise.resolve({
      elasticsearch: { client: { asCurrentUser: esClient } },
      security: { authc: { getCurrentUser: () => ({ username: 'alice' }) } },
    }),
  };
}
function makeRequest() {
  return {
    body: {
      query: 'find failed logins',
      indexPattern: 'logs-*',
      sessionId: 's1',
      conversationHistory: [],
    },
    url: { pathname: '/api/query_copilot/generate' },
    headers: {},
  };
}
function makeResponse() {
  return {
    ok: jest.fn((x) => ({ kind: 'ok', ...x })),
    customError: jest.fn((x) => ({ kind: 'customError', ...x })),
  };
}

describe('registerQueryRoutes handler', () => {
  it('returns 200 ok with X-Request-ID and the pipeline result on success', async () => {
    const result = {
      status: 'succeeded',
      totalDurationMs: 12,
      errorCode: null,
      errorMessage: null,
    } as any;
    const execute = jest.fn().mockResolvedValue(result);
    const createPipeline = jest.fn(() => ({ execute }));
    const context = makeContext(execute, createPipeline);

    const { router, getHandler } = captureHandler();
    registerQueryRoutes(router, context);
    const handler = getHandler();

    const response = makeResponse();
    await handler(makeCtx(), makeRequest(), response as any);

    expect(response.ok).toHaveBeenCalledTimes(1);
    const okArg = response.ok.mock.calls[0][0];
    expect(okArg.body).toBe(result);
    expect(typeof okArg.headers['X-Request-ID']).toBe('string');
    expect(okArg.headers['X-Request-ID'].length).toBeGreaterThan(0);

    // Credentials are resolved server-side from the user's encrypted SO and
    // forwarded to the pipeline factory (no longer read from the request body).
    expect(createPipeline).toHaveBeenCalledWith(esClient, DEFAULT_CREDS);

    expect(execute).toHaveBeenCalledTimes(1);
    const pipelineRequest = execute.mock.calls[0][0];
    expect(pipelineRequest.query).toBe('find failed logins');
    expect(pipelineRequest.indexPattern).toBe('logs-*');
    expect(pipelineRequest.sessionId).toBe('s1');
    expect(typeof pipelineRequest.requestId).toBe('string');

    expect(context.logger.logRequest).toHaveBeenCalled();
  });

  it('always sets the X-Request-ID header on a successful response', async () => {
    const result = { status: 'succeeded', totalDurationMs: 1, errorCode: null } as any;
    const execute = jest.fn().mockResolvedValue(result);
    const context = makeContext(execute);

    const { router, getHandler } = captureHandler();
    registerQueryRoutes(router, context);
    const handler = getHandler();

    const response = makeResponse();
    await handler(makeCtx(), makeRequest(), response as any);

    const okArg = response.ok.mock.calls[0][0];
    expect(okArg.headers).toHaveProperty('X-Request-ID');
  });

  it('returns 422 with a friendly message when no credentials are configured', async () => {
    const execute = jest.fn();
    const createPipeline = jest.fn(() => ({ execute }));
    const noCreds = jest.fn().mockResolvedValue(null);
    const context = makeContext(execute, createPipeline, noCreds);

    const { router, getHandler } = captureHandler();
    registerQueryRoutes(router, context);
    const handler = getHandler();

    const response = makeResponse();
    await handler(makeCtx(), makeRequest(), response as any);

    expect(createPipeline).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(response.customError).toHaveBeenCalledTimes(1);
    const errArg = response.customError.mock.calls[0][0];
    expect(errArg.statusCode).toBe(422);
    expect(errArg.body.message).toContain('No LLM API key configured');
    expect(errArg.headers).toHaveProperty('X-Request-ID');
  });

  it('returns 503 customError with X-Request-ID for PROVIDER_UNREACHABLE failures', async () => {
    const result = {
      status: 'failed',
      errorCode: ERROR_CODES.PROVIDER_UNREACHABLE,
      errorMessage: 'all providers down',
      totalDurationMs: 5,
    } as any;
    const execute = jest.fn().mockResolvedValue(result);
    const context = makeContext(execute);

    const { router, getHandler } = captureHandler();
    registerQueryRoutes(router, context);
    const handler = getHandler();

    const response = makeResponse();
    await handler(makeCtx(), makeRequest(), response as any);

    expect(response.customError).toHaveBeenCalledTimes(1);
    const errArg = response.customError.mock.calls[0][0];
    expect(errArg.statusCode).toBe(503);
    expect(errArg.headers).toHaveProperty('X-Request-ID');
    expect(errArg.body.message).toContain('all providers down');
  });

  it('returns 400 customError for PIPELINE_MAX_CORRECTIONS_EXCEEDED failures', async () => {
    const result = {
      status: 'failed',
      errorCode: ERROR_CODES.PIPELINE_MAX_CORRECTIONS_EXCEEDED,
      errorMessage: 'too many corrections',
      totalDurationMs: 7,
    } as any;
    const execute = jest.fn().mockResolvedValue(result);
    const context = makeContext(execute);

    const { router, getHandler } = captureHandler();
    registerQueryRoutes(router, context);
    const handler = getHandler();

    const response = makeResponse();
    await handler(makeCtx(), makeRequest(), response as any);

    expect(response.customError).toHaveBeenCalledTimes(1);
    expect(response.customError.mock.calls[0][0].statusCode).toBe(400);
  });

  it('returns 500 customError and logs when the route throws', async () => {
    const execute = jest.fn();
    const createPipeline = jest.fn(() => {
      throw new Error('boom');
    });
    const context = makeContext(execute, createPipeline);

    const { router, getHandler } = captureHandler();
    registerQueryRoutes(router, context);
    const handler = getHandler();

    const response = makeResponse();
    await expect(handler(makeCtx(), makeRequest(), response as any)).resolves.toBeDefined();

    expect(response.customError).toHaveBeenCalledTimes(1);
    const errArg = response.customError.mock.calls[0][0];
    expect(errArg.statusCode).toBe(500);
    expect(errArg.headers).toHaveProperty('X-Request-ID');
    expect(context.logger.logError).toHaveBeenCalled();
  });
});
