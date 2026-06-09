import type {
  ConversationMessage,
  CostEstimate,
  ProviderStatus,
  QueryExecutionResponse,
  QueryGenerationResponse,
  SystemHealth,
  TimeRange,
  TokenEstimate,
  ValidationResult,
} from '../../common/types';

/**
 * Provider-related slice of the copilot state: the list of configured providers
 * and the most recently fetched system health snapshot.
 */
export interface ProviderState {
  readonly providers: readonly ProviderStatus[];
  readonly health: SystemHealth | null;
}

/**
 * Normalised error surfaced to the UI. Built from {@link ApiError} (or any thrown
 * value) by the provider so the reducer/components never deal with raw errors.
 */
export interface CopilotError {
  readonly message: string;
  readonly statusCode: number | null;
  readonly requestId: string | null;
}

/**
 * Full state shape for a copilot session. Field order is significant and matches
 * the task contract.
 */
export interface CopilotState {
  readonly conversation: readonly ConversationMessage[];
  readonly currentKQL: string;
  readonly validationResult: ValidationResult | null;
  readonly providerState: ProviderState;
  readonly tokenUsage: TokenEstimate | null;
  readonly estimatedCost: CostEstimate | null;
  readonly isGenerating: boolean;
  readonly error: CopilotError | null;
  readonly queryResults: QueryExecutionResponse | null;
  readonly indexPattern: string;
  readonly timeRange: TimeRange;
}

/**
 * Action type identifiers. Declared as an `as const` object (matching the
 * codebase convention used for `PROVIDER_NAMES`, etc.) with a derived union type.
 *
 * Note: `SET_QUERY_RESULTS` supplements the originally-listed action set so the
 * `runQuery` thunk can write {@link QueryExecutionResponse} into state without an
 * out-of-band mechanism.
 */
export const COPILOT_ACTION_TYPES = {
  SEND_QUERY: 'SEND_QUERY',
  QUERY_SUCCESS: 'QUERY_SUCCESS',
  QUERY_ERROR: 'QUERY_ERROR',
  UPDATE_KQL: 'UPDATE_KQL',
  SET_GENERATING: 'SET_GENERATING',
  SET_PROVIDER_STATE: 'SET_PROVIDER_STATE',
  ADD_MESSAGE: 'ADD_MESSAGE',
  RESET_SESSION: 'RESET_SESSION',
  SET_VALIDATION_RESULT: 'SET_VALIDATION_RESULT',
  SET_QUERY_RESULTS: 'SET_QUERY_RESULTS',
  SET_TIME_RANGE: 'SET_TIME_RANGE',
  SET_INDEX_PATTERN: 'SET_INDEX_PATTERN',
} as const;

export type CopilotActionType =
  (typeof COPILOT_ACTION_TYPES)[keyof typeof COPILOT_ACTION_TYPES];

export interface SendQueryAction {
  readonly type: typeof COPILOT_ACTION_TYPES.SEND_QUERY;
  readonly query: string;
}

export interface QuerySuccessAction {
  readonly type: typeof COPILOT_ACTION_TYPES.QUERY_SUCCESS;
  readonly result: QueryGenerationResponse;
  readonly assistantMessage: ConversationMessage;
}

export interface QueryErrorAction {
  readonly type: typeof COPILOT_ACTION_TYPES.QUERY_ERROR;
  readonly error: CopilotError;
}

export interface UpdateKqlAction {
  readonly type: typeof COPILOT_ACTION_TYPES.UPDATE_KQL;
  readonly kql: string;
}

export interface SetGeneratingAction {
  readonly type: typeof COPILOT_ACTION_TYPES.SET_GENERATING;
  readonly isGenerating: boolean;
}

export interface SetProviderStateAction {
  readonly type: typeof COPILOT_ACTION_TYPES.SET_PROVIDER_STATE;
  readonly providers: readonly ProviderStatus[];
  readonly health: SystemHealth | null;
}

export interface AddMessageAction {
  readonly type: typeof COPILOT_ACTION_TYPES.ADD_MESSAGE;
  readonly message: ConversationMessage;
}

export interface ResetSessionAction {
  readonly type: typeof COPILOT_ACTION_TYPES.RESET_SESSION;
}

export interface SetValidationResultAction {
  readonly type: typeof COPILOT_ACTION_TYPES.SET_VALIDATION_RESULT;
  readonly validationResult: ValidationResult | null;
}

export interface SetQueryResultsAction {
  readonly type: typeof COPILOT_ACTION_TYPES.SET_QUERY_RESULTS;
  readonly results: QueryExecutionResponse | null;
}

export interface SetTimeRangeAction {
  readonly type: typeof COPILOT_ACTION_TYPES.SET_TIME_RANGE;
  readonly timeRange: TimeRange;
}

export interface SetIndexPatternAction {
  readonly type: typeof COPILOT_ACTION_TYPES.SET_INDEX_PATTERN;
  readonly indexPattern: string;
}

/** Discriminated union of every copilot action. */
export type CopilotAction =
  | SendQueryAction
  | QuerySuccessAction
  | QueryErrorAction
  | UpdateKqlAction
  | SetGeneratingAction
  | SetProviderStateAction
  | AddMessageAction
  | ResetSessionAction
  | SetValidationResultAction
  | SetQueryResultsAction
  | SetTimeRangeAction
  | SetIndexPatternAction;
