import { DEFAULT_INDEX_PATTERN } from '../../common';
import { COPILOT_ACTION_TYPES, type CopilotAction, type CopilotState } from './types';

/**
 * Builds a fresh session state for the given index pattern. Used both for the
 * default initial state and to reset a session while preserving its index
 * pattern.
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
    indexPattern,
    // Default to the last 24 hours so results show even when the most recent
    // logs are older than a few minutes; the time picker overrides this.
    timeRange: { from: 'now-24h', to: 'now' },
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

    case COPILOT_ACTION_TYPES.SET_INDEX_PATTERN:
      return { ...state, indexPattern: action.indexPattern };

    case COPILOT_ACTION_TYPES.RESET_SESSION:
      return createInitialState(state.indexPattern);

    default:
      assertNever(action);
      return state;
  }
}
