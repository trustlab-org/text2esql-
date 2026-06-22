import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import { DEFAULT_INDEX_PATTERN, PROVIDER_NAMES } from '../../common';
import type { ConversationMessage, MaskedCredentials } from '../../common/types';
import { ApiError, useServices } from '../services';
import {
  addMessage,
  queryError,
  querySuccess,
  sendQuery as actionSendQuery,
  setCredentialsStatus,
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

/**
 * True when the masked status has a usable primary slot: either the primary has
 * a stored key, or its provider is Ollama (which runs locally and needs none).
 */
export function hasUsablePrimary(status: MaskedCredentials | null): boolean {
  if (status === null) {
    return false;
  }
  if (status.primary.provider === PROVIDER_NAMES.OLLAMA) {
    return true;
  }
  return status.primary.hasKey;
}

/** Value exposed by {@link CopilotContext}. */
export interface CopilotContextValue {
  readonly state: CopilotState;
  readonly dispatch: React.Dispatch<CopilotAction>;
  readonly sendQuery: (query: string) => Promise<void>;
  readonly runQuery: () => Promise<void>;
  readonly refreshProviders: () => Promise<void>;
  readonly refreshCredentials: () => Promise<void>;
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
      // are no default keys). The key now lives in encrypted server-side storage;
      // we gate on the masked status loaded into state. When no usable primary is
      // configured, surface a guidance error and return WITHOUT calling the API
      // or recording any assistant/user message.
      if (!hasUsablePrimary(stateRef.current.credentialsStatus)) {
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

  // Loads the user's masked credential status from the server into state. Used
  // on mount and after the settings panel saves/clears keys. Failures (e.g. the
  // user has no stored credentials) reset the status to null rather than
  // surfacing an error banner.
  const refreshCredentials = useCallback(async (): Promise<void> => {
    try {
      const status = await services.credentialsApi.getCredentials();
      dispatch(setCredentialsStatus(status));
    } catch {
      dispatch(setCredentialsStatus(null));
    }
  }, [services]);

  const value = useMemo<CopilotContextValue>(
    () => ({ state, dispatch, sendQuery, runQuery, refreshProviders, refreshCredentials }),
    [state, sendQuery, runQuery, refreshProviders, refreshCredentials]
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
