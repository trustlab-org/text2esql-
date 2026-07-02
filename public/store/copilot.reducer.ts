import { DEFAULT_INDEX_PATTERN } from '../../common';
import { COPILOT_ACTION_TYPES, type CopilotAction, type CopilotState } from './types';

/**
 * Builds a fresh session state seeded with the given index pattern (as the sole
 * selected data view). Used both for the default initial state and to reset a
 * session while preserving its data-view selection.
 */
export function createInitialState(indexPattern: string): CopilotState {
  return {
    conversation: [],
    currentKQL: '',
    validationResult: null,
    providerState: { providers: [], health: null },
    tokenUsage: null,
    estimatedCost: null,
    isGenerating: false,
    error: null,
    queryResults: null,
    selectedDataViews: [indexPattern],
    // Default to the last 24 hours so results show even when the most recent
    // logs are older than a few minutes; the time picker overrides this.
    timeRange: { from: 'now-24h', to: 'now' },
    credentialsStatus: null,
    sessionTokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 },
    sessionCostUsd: 0,
  };
}

/** Default initial state, using the configured default index pattern. */
export const INITIAL_COPILOT_STATE: CopilotState = createInitialState(DEFAULT_INDEX_PATTERN);

/**
 * Exhaustiveness guard. The `switch` default calls this with the narrowed
 * action; if a new action type is added without a case, this fails to compile.
 * At runtime it is a no-op (the reducer still returns the current state).
 */
function assertNever(_action: never): void {
  // No-op: compile-time exhaustiveness only.
}

/** Pure reducer for the copilot session state. All updates are immutable. */
export function copilotReducer(state: CopilotState, action: CopilotAction): CopilotState {
  switch (action.type) {
    case COPILOT_ACTION_TYPES.SEND_QUERY:
      return { ...state, isGenerating: true, error: null };

    case COPILOT_ACTION_TYPES.QUERY_SUCCESS:
      return {
        ...state,
        isGenerating: false,
        error: null,
        currentKQL: action.result.finalQuery?.queryString ?? state.currentKQL,
        validationResult: action.result.validationResult,
        tokenUsage: action.result.tokenEstimate,
        estimatedCost: action.result.costEstimate,
        conversation: [...state.conversation, action.assistantMessage],
        // Accumulate per-request usage into the session totals so the status
        // bar counters update after every request without a refresh.
        sessionTokenUsage: {
          promptTokens:
            state.sessionTokenUsage.promptTokens + action.result.tokenEstimate.promptTokens,
          completionTokens:
            state.sessionTokenUsage.completionTokens + action.result.tokenEstimate.completionTokens,
          totalTokens: state.sessionTokenUsage.totalTokens + action.result.tokenEstimate.totalTokens,
          requests: state.sessionTokenUsage.requests + 1,
        },
        sessionCostUsd: state.sessionCostUsd + action.result.costEstimate.totalCostUsd,
      };

    case COPILOT_ACTION_TYPES.QUERY_ERROR:
      return { ...state, isGenerating: false, error: action.error };

    case COPILOT_ACTION_TYPES.UPDATE_KQL:
      return { ...state, currentKQL: action.kql };

    case COPILOT_ACTION_TYPES.SET_GENERATING:
      return { ...state, isGenerating: action.isGenerating };

    case COPILOT_ACTION_TYPES.SET_PROVIDER_STATE:
      return {
        ...state,
        providerState: { providers: action.providers, health: action.health },
      };

    case COPILOT_ACTION_TYPES.ADD_MESSAGE:
      return { ...state, conversation: [...state.conversation, action.message] };

    case COPILOT_ACTION_TYPES.SET_VALIDATION_RESULT:
      return { ...state, validationResult: action.validationResult };

    case COPILOT_ACTION_TYPES.SET_QUERY_RESULTS:
      return { ...state, queryResults: action.results, isGenerating: false };

    case COPILOT_ACTION_TYPES.SET_TIME_RANGE:
      return { ...state, timeRange: action.timeRange };

    case COPILOT_ACTION_TYPES.SET_SELECTED_DATA_VIEWS:
      return { ...state, selectedDataViews: action.dataViews };

    case COPILOT_ACTION_TYPES.SET_CREDENTIALS_STATUS:
      return { ...state, credentialsStatus: action.status };

    case COPILOT_ACTION_TYPES.RESET_SESSION:
      // Preserve the server-loaded credential status AND the data-view selection
      // across a session reset; both reflect durable user/server state, not
      // per-session conversation state.
      return {
        ...createInitialState(DEFAULT_INDEX_PATTERN),
        selectedDataViews: state.selectedDataViews,
        credentialsStatus: state.credentialsStatus,
      };

    default:
      assertNever(action);
      return state;
  }
}
