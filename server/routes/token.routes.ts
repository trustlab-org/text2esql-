/**
 * Token-estimate route for the Query Copilot plugin.
 *
 * Exposes `POST /api/query_copilot/token-estimate`, returning a pure
 * (NO LLM API call) per-provider token and cost estimate for a candidate query.
 * For each requested provider it builds the minimal ProviderPrompt the pipeline
 * would send (SYSTEM_PROMPT + the user's query), counts the prompt tokens via
 * {@link TokenEstimatorService}, projects a nominal completion size, and prices
 * the result with {@link CostEstimatorService}.
 *
 * The estimate is intentionally cheap and synchronous: it never contacts any
 * provider, so it carries no API key and cannot fail on an upstream call.
 */

import { schema, type TypeOf } from '@kbn/config-schema';
import { randomUUID } from 'node:crypto';
import type { IRouter } from '@kbn/core/server';
import type { QueryCopilotContext } from '../types';
import type { ProviderName, TokenEstimate, CostEstimate } from '../../common/types';
import {
  PLUGIN_ROUTE_PREFIX,
  PROVIDER_NAMES,
  PROVIDER_DEFAULT_MODELS,
} from '../../common';
import { TokenEstimatorService, CostEstimatorService } from '../services';
import type { ProviderPrompt } from '../services';
import { SYSTEM_PROMPT } from '../services/prompt';

const providerLiteral = schema.oneOf([
  schema.literal(PROVIDER_NAMES.GEMINI),
  schema.literal(PROVIDER_NAMES.GROQ),
  schema.literal(PROVIDER_NAMES.OLLAMA),
  schema.literal(PROVIDER_NAMES.ANTHROPIC),
  schema.literal(PROVIDER_NAMES.OPENAI),
]);

const tokenEstimateRequestBodySchema = schema.object({
  query: schema.string({ minLength: 1, maxLength: 8192 }),
  providers: schema.arrayOf(
    schema.object({
      provider: providerLiteral,
      model: schema.maybe(schema.string({ maxLength: 256 })),
    }),
    { minSize: 1, maxSize: 5 }
  ),
});

type TokenEstimateRequestBody = TypeOf<typeof tokenEstimateRequestBodySchema>;

/**
 * Nominal completion text used to project `completionTokens` without an API
 * call. Completion size is inherently unknowable before generation, so we model
 * a representative "average" KQL JSON response that satisfies the SYSTEM_PROMPT
 * output contract (a kql string, a short explanation, a couple of fields/filters
 * and a reasoning sentence). Running it through `estimateResponseTokens` yields a
 * deterministic, provider-tokeniser-aware completion estimate (~80–110 tokens)
 * rather than an arbitrary constant. isActual is therefore false on the result.
 */
const NOMINAL_COMPLETION_SAMPLE = JSON.stringify({
  kql: 'event.category : "authentication" and event.outcome : "failure"',
  explanation:
    'Matches failed authentication events recorded in the security index.',
  fieldsUsed: ['event.category', 'event.outcome'],
  filtersApplied: ['event.category is authentication', 'event.outcome is failure'],
  investigationReasoning:
    'These fields surface failed sign-in attempts relevant to the investigation.',
});

/**
 * A single provider's estimate in the response payload.
 */
export interface ProviderTokenEstimateResult {
  readonly provider: ProviderName;
  readonly model: string;
  readonly tokenEstimate: TokenEstimate;
  readonly costEstimate: CostEstimate;
}

/**
 * Response payload for POST /token-estimate.
 */
export interface TokenEstimateResponse {
  readonly estimates: readonly ProviderTokenEstimateResult[];
}

/**
 * Builds the per-provider estimates for a query. Pure and synchronous — exposed
 * separately from the HTTP handler so it can be unit-tested without a router.
 */
export function buildTokenEstimates(
  query: string,
  providers: readonly { provider: ProviderName; model?: string }[],
  tokenEstimator: TokenEstimatorService,
  costEstimator: CostEstimatorService
): TokenEstimateResponse {
  const nowIso = new Date().toISOString();

  const estimates = providers.map(({ provider, model }) => {
    const resolvedModel = model ?? PROVIDER_DEFAULT_MODELS[provider];

    const prompt: ProviderPrompt = {
      systemPrompt: SYSTEM_PROMPT,
      userMessage: query,
    };

    const promptTokens = tokenEstimator.estimatePromptTokens(prompt, provider).inputTokens;
    const completionTokens = tokenEstimator.estimateResponseTokens(
      NOMINAL_COMPLETION_SAMPLE,
      provider
    ).outputTokens;

    const tokenEstimate: TokenEstimate = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimatedAt: nowIso,
      isActual: false,
    };

    const costEstimate = costEstimator.estimate(tokenEstimate, provider, resolvedModel);

    return { provider, model: resolvedModel, tokenEstimate, costEstimate };
  });

  return { estimates };
}

/**
 * Registers POST /api/query_copilot/token-estimate.
 *
 * Validates the body, computes a per-provider {@link TokenEstimate} and
 * {@link CostEstimate} with no LLM call, and returns them. Every response
 * carries the `X-Request-ID` correlation header.
 */
export function registerTokenRoutes(router: IRouter, context: QueryCopilotContext): void {
  // Both estimators are stateless and cheap; one shared instance per
  // registration is sufficient and avoids re-parsing the tokeniser per request.
  const tokenEstimator = new TokenEstimatorService();
  const costEstimator = new CostEstimatorService();

  router.post(
    {
      path: `${PLUGIN_ROUTE_PREFIX}/token-estimate`,
      validate: { body: tokenEstimateRequestBodySchema },
      options: {
        authRequired: true,
        tags: ['access:queryCopilot'],
        body: { accepts: ['application/json'], maxBytes: 1024 * 16 },
      },
    },
    async (_ctx, request, response) => {
      const requestId = randomUUID();
      const headers = { 'X-Request-ID': requestId };
      context.logger.logRequest(requestId, 'POST', request.url.pathname);

      try {
        const body: TokenEstimateRequestBody = request.body;
        const result = buildTokenEstimates(
          body.query,
          body.providers,
          tokenEstimator,
          costEstimator
        );
        return response.ok({ headers, body: result });
      } catch (error) {
        context.logger.logError(requestId, error, { stage: 'token_estimate_route' });
        return response.customError({
          statusCode: 500,
          headers,
          body: {
            message:
              error instanceof Error ? error.message : 'Unexpected error estimating tokens.',
            attributes: { requestId },
          },
        });
      }
    }
  );
}
