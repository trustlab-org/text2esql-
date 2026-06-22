import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import { DEFAULT_INDEX_PATTERN } from '../../common';
import type { ConversationMessage } from '../../common/types';
import { ApiError, useServices } from '../services';
import { hasUsablePrimary, loadCredentials } from '../services/credentials.store';
import {
  addMessage,
  queryError,
  querySuccess,
  sendQuery as actionSendQuery,
  setGenerating,
  setProviderState,
  setQueryResults,
} from './copilot.actions';
import { copilotReducer, createInitialState } from './copilot.reducer';
import type { CopilotAction, CopilotError, CopilotState } from './types';

/** Generates a stable, reasonably-unique identifier. */
function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}`;
}

/** Builds a {@link CopilotError} from any thrown value. */
function toCopilotError(error: unknown): CopilotError {
  if (error instanceof ApiError) {
    return { message: error.message, statusCode: error.statusCode, requestId: error.requestId ?? null };
  }
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);
  return { message, statusCode: null, requestId: null };
}

/** Value exposed by {@link CopilotContext}. */
export interface CopilotContextValue {
  readonly state: CopilotState;
  readonly dispatch: React.Dispatch<CopilotAction>;
  readonly sendQuery: (query: string) => Promise<void>;
  readonly runQuery: () => Promise<void>;
  readonly refreshProviders: () => Promise<void>;
}

export const CopilotContext = createContext<CopilotContextValue | null>(null);

export interface CopilotProviderProps {
  readonly children: React.ReactNode;
  readonly indexPattern?: string;
  readonly sessionId?: string;
}

export function CopilotProvider({ children, indexPattern, sessionId }: CopilotProviderProps) {
  const services = useServices();

  const [state, dispatch] = useReducer(copilotReducer, undefined, () =>
    createInitialState(indexPattern ?? DEFAULT_INDEX_PATTERN)
  );

  // Stable session id for the lifetime of the provider.
  const sessionIdRef = useRef<string>(sessionId ?? generateId());

  // Keep a live reference to the latest state so callbacks can read current
  // values without being re-created (stable identities across renders).
  const stateRef = useRef<CopilotState>(state);
  stateRef.current = state;

  const sendQuery = useCallback(
    async (query: string): Promise<void> => {
      // Gate generation on the user supplying their OWN primary LLM key (there
      // are no default keys). When no usable primary is configured, surface a
      // guidance error and return WITHOUT calling the API or recording any
      // assistant/user message.
      const creds = loadCredentials();
      if (!hasUsablePrimary(creds)) {
        dispatch(
          queryError({
            message: 'Add your LLM API key in Settings (gear icon) before generating a query.',
            statusCode: null,
            requestId: null,
          })
        );
        return;
      }

      const userMsg: ConversationMessage = {
        id: generateId(),
        role: 'user',
        content: query,
        timestamp: new Date().toISOString(),
        pipelineId: null,
        queryDraftId: null,
        metadata: { tokensUsed: null, provider: null, model: null, latencyMs: null },
      };
      dispatch(addMessage(userMsg));
      dispatch(actionSendQuery(query));

      try {
        const result = await services.queryApi.generateQuery({
          query,
          indexPattern: stateRef.current.indexPattern,
          sessionId: sessionIdRef.current,
          conversationHistory: stateRef.current.conversation,
          credentials: creds ?? undefined,
        });
        const assistantMsg: ConversationMessage = {
          id: generateId(),
          role: 'assistant',
          content: result.finalQuery?.queryString ?? result.errorMessage ?? '',
          timestamp: new Date().toISOString(),
          pipelineId: result.pipelineId,
          queryDraftId: result.finalQuery?.id ?? null,
          metadata: {
            tokensUsed: result.tokenEstimate.totalTokens,
            provider: result.costEstimate.provider,
            model: result.costEstimate.model,
            latencyMs: result.totalDurationMs,
          },
        };
        dispatch(querySuccess(result, assistantMsg));
      } catch (e) {
        dispatch(queryError(toCopilotError(e)));
      }
    },
    [services]
  );

  const runQuery = useCallback(async (): Promise<void> => {
    const kql = stateRef.current.currentKQL;
    if (kql.trim().length === 0) {
      dispatch(queryError({ message: 'No KQL to run.', statusCode: null, requestId: null }));
      return;
    }
    dispatch(setGenerating(true));
    try {
      const results = await services.queryApi.executeQuery(
        kql,
        stateRef.current.indexPattern,
        stateRef.current.timeRange
      );
      dispatch(setQueryResults(results));
    } catch (e) {
      dispatch(queryError(toCopilotError(e)));
      dispatch(setGenerating(false));
    }
  }, [services]);

  const refreshProviders = useCallback(async (): Promise<void> => {
    try {
      const [{ providers }, health] = await Promise.all([
        services.providerApi.getProviders(),
        services.providerApi.getHealth(),
      ]);
      dispatch(setProviderState(providers, health));
    } catch (e) {
      dispatch(queryError(toCopilotError(e)));
    }
  }, [services]);

  const value = useMemo<CopilotContextValue>(
    () => ({ state, dispatch, sendQuery, runQuery, refreshProviders }),
    [state, sendQuery, runQuery, refreshProviders]
  );

  return <CopilotContext.Provider value={value}>{children}</CopilotContext.Provider>;
}

/** Hook to access the copilot context; throws outside a {@link CopilotProvider}. */
export function useCopilot(): CopilotContextValue {
  const ctx = useContext(CopilotContext);
  if (ctx === null) {
    throw new Error('useCopilot must be used within a <CopilotProvider>.');
  }
  return ctx;
}
