import { DEFAULT_INDEX_PATTERN } from '../../common';
import type {
  ConversationMessage,
  CostEstimate,
  ProviderStatus,
  QueryExecutionResponse,
  QueryGenerationResponse,
  SystemHealth,
  TokenEstimate,
  ValidationResult,
} from '../../common/types';
import {
  addMessage,
  queryError,
  querySuccess,
  resetSession,
  sendQuery,
  setGenerating,
  setIndexPattern,
  setProviderState,
  setQueryResults,
  setTimeRange,
  setValidationResult,
  updateKql,
} from './copilot.actions';
import { copilotReducer, createInitialState, INITIAL_COPILOT_STATE } from './copilot.reducer';
import type { CopilotError, CopilotState } from './types';

function message(id: string, content = 'hi'): ConversationMessage {
  return {
    id,
    role: 'user',
    content,
    timestamp: '2026-01-01T00:00:00.000Z',
    pipelineId: null,
    queryDraftId: null,
    metadata: { tokensUsed: null, provider: null, model: null, latencyMs: null },
  };
}

const tokenEstimate = { promptTokens: 30, completionTokens: 12, totalTokens: 42 } as TokenEstimate;
const costEstimate = { provider: 'openai', model: 'gpt', totalCostUsd: 1 } as unknown as CostEstimate;
const validationResult = { isValid: true } as ValidationResult;

function successResult(queryString: string | null): QueryGenerationResponse {
  return {
    pipelineId: 'p1',
    finalQuery: queryString === null ? null : ({ id: 'd1', queryString } as never),
    validationResult,
    tokenEstimate,
    costEstimate,
    errorMessage: null,
    totalDurationMs: 100,
  } as unknown as QueryGenerationResponse;
}

describe('copilotReducer', () => {
  it('createInitialState produces a clean state with the given index pattern', () => {
    const s = createInitialState('logs-*');
    expect(s).toEqual({
      conversation: [],
      currentKQL: '',
      validationResult: null,
      providerState: { providers: [], health: null },
      tokenUsage: null,
      estimatedCost: null,
      isGenerating: false,
      error: null,
      queryResults: null,
      indexPattern: 'logs-*',
      timeRange: { from: 'now-24h', to: 'now' },
      credentialsStatus: null,
      sessionTokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 },
      sessionCostUsd: 0,
    });
  });

  it('createInitialState defaults the time range to the last 24 hours', () => {
    expect(createInitialState('*').timeRange).toEqual({ from: 'now-24h', to: 'now' });
  });

  it('SET_TIME_RANGE replaces the time range', () => {
    const next = copilotReducer(
      createInitialState('*'),
      setTimeRange({ from: 'now-10m', to: 'now' })
    );
    expect(next.timeRange).toEqual({ from: 'now-10m', to: 'now' });
  });

  it('INITIAL_COPILOT_STATE defaults to the configured default index pattern', () => {
    expect(INITIAL_COPILOT_STATE.indexPattern).toBe(DEFAULT_INDEX_PATTERN);
    expect(INITIAL_COPILOT_STATE.indexPattern).toBe('fosstlsoc-logs-*');
  });

  it('SET_INDEX_PATTERN updates the index pattern', () => {
    const next = copilotReducer(
      createInitialState('*'),
      setIndexPattern('fosstlsoc-logs-2026')
    );
    expect(next.indexPattern).toBe('fosstlsoc-logs-2026');
  });

  it('SEND_QUERY sets isGenerating and clears error', () => {
    const start: CopilotState = {
      ...createInitialState('*'),
      error: { message: 'old', statusCode: 500, requestId: null },
    };
    const next = copilotReducer(start, sendQuery('find logins'));
    expect(next.isGenerating).toBe(true);
    expect(next.error).toBeNull();
  });

  it('QUERY_SUCCESS hydrates state from the result and appends the assistant message', () => {
    const start = createInitialState('*');
    const msg = { ...message('a1'), role: 'assistant' as const };
    const next = copilotReducer(start, querySuccess(successResult('event.action: login'), msg));
    expect(next.isGenerating).toBe(false);
    expect(next.error).toBeNull();
    expect(next.currentKQL).toBe('event.action: login');
    expect(next.validationResult).toBe(validationResult);
    expect(next.tokenUsage).toBe(tokenEstimate);
    expect(next.estimatedCost).toBe(costEstimate);
    expect(next.conversation).toEqual([msg]);
  });

  it('QUERY_SUCCESS accumulates session token usage and cost across requests', () => {
    const msg = { ...message('a1'), role: 'assistant' as const };
    const once = copilotReducer(
      createInitialState('*'),
      querySuccess(successResult('event.action: login'), msg)
    );
    expect(once.sessionTokenUsage).toEqual({
      promptTokens: 30,
      completionTokens: 12,
      totalTokens: 42,
      requests: 1,
    });
    expect(once.sessionCostUsd).toBe(1);

    const twice = copilotReducer(once, querySuccess(successResult('event.action: login'), msg));
    expect(twice.sessionTokenUsage).toEqual({
      promptTokens: 60,
      completionTokens: 24,
      totalTokens: 84,
      requests: 2,
    });
    expect(twice.sessionCostUsd).toBe(2);
  });

  it('QUERY_SUCCESS keeps current KQL when finalQuery is null', () => {
    const start: CopilotState = { ...createInitialState('*'), currentKQL: 'keep-me' };
    const msg = { ...message('a1'), role: 'assistant' as const };
    const next = copilotReducer(start, querySuccess(successResult(null), msg));
    expect(next.currentKQL).toBe('keep-me');
  });

  it('QUERY_ERROR stores the error and stops generating', () => {
    const err: CopilotError = { message: 'boom', statusCode: 503, requestId: 'r1' };
    const next = copilotReducer({ ...createInitialState('*'), isGenerating: true }, queryError(err));
    expect(next.isGenerating).toBe(false);
    expect(next.error).toBe(err);
  });

  it('UPDATE_KQL replaces currentKQL without touching validation', () => {
    const start: CopilotState = { ...createInitialState('*'), validationResult };
    const next = copilotReducer(start, updateKql('manual edit'));
    expect(next.currentKQL).toBe('manual edit');
    expect(next.validationResult).toBe(validationResult);
  });

  it('SET_GENERATING toggles the flag', () => {
    expect(copilotReducer(createInitialState('*'), setGenerating(true)).isGenerating).toBe(true);
  });

  it('SET_PROVIDER_STATE replaces the provider slice', () => {
    const providers = [{ name: 'openai' } as unknown as ProviderStatus];
    const health = { status: 'green' } as unknown as SystemHealth;
    const next = copilotReducer(createInitialState('*'), setProviderState(providers, health));
    expect(next.providerState).toEqual({ providers, health });
  });

  it('ADD_MESSAGE appends immutably', () => {
    const start = createInitialState('*');
    const next = copilotReducer(start, addMessage(message('m1')));
    expect(next.conversation).toHaveLength(1);
    expect(start.conversation).toHaveLength(0);
  });

  it('SET_VALIDATION_RESULT stores the validation result', () => {
    const next = copilotReducer(createInitialState('*'), setValidationResult(validationResult));
    expect(next.validationResult).toBe(validationResult);
  });

  it('SET_QUERY_RESULTS stores results and stops generating', () => {
    const results = {
      columns: [],
      rows: [],
      total: 0,
      tookMs: 1,
      timedOut: false,
    } as QueryExecutionResponse;
    const next = copilotReducer(
      { ...createInitialState('*'), isGenerating: true },
      setQueryResults(results)
    );
    expect(next.queryResults).toBe(results);
    expect(next.isGenerating).toBe(false);
  });

  it('RESET_SESSION clears everything but preserves the index pattern', () => {
    const dirty: CopilotState = {
      ...createInitialState('logs-*'),
      currentKQL: 'x',
      isGenerating: true,
      conversation: [message('m1')],
      error: { message: 'e', statusCode: null, requestId: null },
    };
    const next = copilotReducer(dirty, resetSession());
    expect(next).toEqual(createInitialState('logs-*'));
  });

  it('returns the same state reference for an unknown action', () => {
    const start = createInitialState('*');
    const next = copilotReducer(start, { type: 'NOPE' } as never);
    expect(next).toBe(start);
  });
});
