import type {
  ConversationMessage,
  MaskedCredentials,
  ProviderStatus,
  QueryExecutionResponse,
  QueryGenerationResponse,
  SystemHealth,
  TimeRange,
  ValidationResult,
} from '../../common/types';
import {
  COPILOT_ACTION_TYPES,
  type AddMessageAction,
  type CopilotError,
  type QueryErrorAction,
  type QuerySuccessAction,
  type ResetSessionAction,
  type SendQueryAction,
  type SetCredentialsStatusAction,
  type SetGeneratingAction,
  type SetProviderStateAction,
  type SetIndexPatternAction,
  type SetQueryResultsAction,
  type SetTimeRangeAction,
  type SetValidationResultAction,
  type UpdateKqlAction,
} from './types';

export function sendQuery(query: string): SendQueryAction {
  return { type: COPILOT_ACTION_TYPES.SEND_QUERY, query };
}

export function querySuccess(
  result: QueryGenerationResponse,
  assistantMessage: ConversationMessage
): QuerySuccessAction {
  return { type: COPILOT_ACTION_TYPES.QUERY_SUCCESS, result, assistantMessage };
}

export function queryError(error: CopilotError): QueryErrorAction {
  return { type: COPILOT_ACTION_TYPES.QUERY_ERROR, error };
}

export function updateKql(kql: string): UpdateKqlAction {
  return { type: COPILOT_ACTION_TYPES.UPDATE_KQL, kql };
}

export function setGenerating(isGenerating: boolean): SetGeneratingAction {
  return { type: COPILOT_ACTION_TYPES.SET_GENERATING, isGenerating };
}

export function setProviderState(
  providers: readonly ProviderStatus[],
  health: SystemHealth | null
): SetProviderStateAction {
  return { type: COPILOT_ACTION_TYPES.SET_PROVIDER_STATE, providers, health };
}

export function addMessage(message: ConversationMessage): AddMessageAction {
  return { type: COPILOT_ACTION_TYPES.ADD_MESSAGE, message };
}

export function resetSession(): ResetSessionAction {
  return { type: COPILOT_ACTION_TYPES.RESET_SESSION };
}

export function setValidationResult(
  validationResult: ValidationResult | null
): SetValidationResultAction {
  return { type: COPILOT_ACTION_TYPES.SET_VALIDATION_RESULT, validationResult };
}

/**
 * Supplemental creator (see {@link COPILOT_ACTION_TYPES.SET_QUERY_RESULTS}):
 * writes the execution response produced by the `runQuery` thunk into state.
 */
export function setQueryResults(
  results: QueryExecutionResponse | null
): SetQueryResultsAction {
  return { type: COPILOT_ACTION_TYPES.SET_QUERY_RESULTS, results };
}

/** Replaces the time window applied to the next query execution. */
export function setTimeRange(timeRange: TimeRange): SetTimeRangeAction {
  return { type: COPILOT_ACTION_TYPES.SET_TIME_RANGE, timeRange };
}

/** Replaces the index pattern used for query generation and execution. */
export function setIndexPattern(indexPattern: string): SetIndexPatternAction {
  return { type: COPILOT_ACTION_TYPES.SET_INDEX_PATTERN, indexPattern };
}

/** Stores the masked credential status loaded from the server (or null). */
export function setCredentialsStatus(
  status: MaskedCredentials | null
): SetCredentialsStatusAction {
  return { type: COPILOT_ACTION_TYPES.SET_CREDENTIALS_STATUS, status };
}
