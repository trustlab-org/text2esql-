import { buildTokenEstimates, registerTokenRoutes } from './token.routes';
import { TokenEstimatorService, CostEstimatorService } from '../services';
import { PROVIDER_NAMES, PROVIDER_DEFAULT_MODELS } from '../../common';
import type { ProviderName } from '../../common';

// ---------------------------------------------------------------------------
// token.routes unit tests.
//
// buildTokenEstimates is the pure core: it never calls an LLM. We use the real
// (stateless) TokenEstimatorService and CostEstimatorService since they make no
// network calls, then assert the response envelope shape.
// ---------------------------------------------------------------------------

const tokenEstimator = new TokenEstimatorService();
const costEstimator = new CostEstimatorService();

const OPENAI = PROVIDER_NAMES.OPENAI as ProviderName;
const GEMINI = PROVIDER_NAMES.GEMINI as ProviderName;
const OLLAMA = PROVIDER_NAMES.OLLAMA as ProviderName;

describe('buildTokenEstimates', () => {
  it('returns one estimate per requested provider with non-actual flags', () => {
    const result = buildTokenEstimates(
      'find failed logins',
      [{ provider: OPENAI }, { provider: GEMINI }],
      tokenEstimator,
      costEstimator
    );

    expect(result.estimates).toHaveLength(2);
    for (const e of result.estimates) {
      expect(e.tokenEstimate.isActual).toBe(false);
      expect(e.costEstimate.isActual).toBe(false);
      expect(e.tokenEstimate.promptTokens).toBeGreaterThan(0);
      expect(e.tokenEstimate.completionTokens).toBeGreaterThan(0);
      expect(e.tokenEstimate.totalTokens).toBe(
        e.tokenEstimate.promptTokens + e.tokenEstimate.completionTokens
      );
    }
  });

  it('defaults the model to PROVIDER_DEFAULT_MODELS when absent', () => {
    const result = buildTokenEstimates(
      'q',
      [{ provider: OPENAI }],
      tokenEstimator,
      costEstimator
    );
    expect(result.estimates[0].model).toBe(PROVIDER_DEFAULT_MODELS.openai);
  });

  it('honours a supplied model override', () => {
    const result = buildTokenEstimates(
      'q',
      [{ provider: OPENAI, model: 'gpt-4o-mini' }],
      tokenEstimator,
      costEstimator
    );
    expect(result.estimates[0].model).toBe('gpt-4o-mini');
  });

  it('prices ollama at zero cost (free local provider)', () => {
    const result = buildTokenEstimates('q', [{ provider: OLLAMA }], tokenEstimator, costEstimator);
    expect(result.estimates[0].costEstimate.totalCostUsd).toBe(0);
  });

  it('produces a non-zero USD cost for a priced provider', () => {
    const result = buildTokenEstimates('q', [{ provider: OPENAI }], tokenEstimator, costEstimator);
    expect(result.estimates[0].costEstimate.totalCostUsd).toBeGreaterThan(0);
  });
});

describe('registerTokenRoutes', () => {
  it('registers a POST handler that returns estimates with an X-Request-ID header', async () => {
    let handler: any;
    const router = {
      get: jest.fn(),
      post: jest.fn((_opts: unknown, h: unknown) => {
        handler = h;
      }),
      put: jest.fn(),
      delete: jest.fn(),
    } as unknown as import('@kbn/core/server').IRouter;

    const context = {
      logger: { logRequest: jest.fn(), logError: jest.fn() },
    } as unknown as import('../types').QueryCopilotContext;

    registerTokenRoutes(router, context);

    const response = { ok: jest.fn((x) => x), customError: jest.fn((x) => x) };
    const request = {
      body: { query: 'find failed logins', providers: [{ provider: OPENAI }] },
      url: { pathname: '/api/query_copilot/token-estimate' },
    };

    await handler({}, request, response);

    expect(response.ok).toHaveBeenCalledTimes(1);
    const arg = response.ok.mock.calls[0][0];
    expect(arg.headers).toHaveProperty('X-Request-ID');
    expect(arg.body.estimates).toHaveLength(1);
    expect(arg.body.estimates[0].provider).toBe(OPENAI);
  });
});
