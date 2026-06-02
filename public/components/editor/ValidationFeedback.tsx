import React from 'react';
import { EuiBadge, EuiCallOut, EuiFlexGroup, EuiFlexItem, EuiText } from '@elastic/eui';

import type { ValidationError, ValidationResult } from '../../../common/types';

export interface ValidationFeedbackProps {
  validationResult: ValidationResult | null;
  ecsCoverage?: { matched: number; total: number };
}

/**
 * Renders a single error/warning list item: message, optional suggestion, and
 * an optional subdued line/column hint.
 */
const IssueItem: React.FC<{ issue: ValidationError }> = ({ issue }) => (
  <li>
    {issue.message}
    {issue.suggestion ? ` — ${issue.suggestion}` : ''}
    {issue.line != null ? (
      <EuiText size="xs" color="subdued" component="span">
        {` (line ${issue.line}, col ${issue.column})`}
      </EuiText>
    ) : null}
  </li>
);

export const ValidationFeedback: React.FC<ValidationFeedbackProps> = ({
  validationResult,
  ecsCoverage,
}) => {
  // Nothing to show until a validation has run.
  if (validationResult === null) {
    return null;
  }

  if (validationResult.isValid) {
    return (
      <div data-test-subj="queryCopilotValidationFeedback">
        <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
          <EuiFlexItem grow={false}>
            <EuiBadge color="success" iconType="check">
              Syntax Passed
            </EuiBadge>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            {/*
              ValidationResult carries no ECS-coverage data, so the real X/Y is
              supplied by a caller (Task 7.5) via the optional `ecsCoverage`
              prop. Absent that we show a neutral language badge — we do NOT
              fabricate counts.
            */}
            {ecsCoverage ? (
              <EuiBadge color={ecsCoverage.matched === ecsCoverage.total ? 'success' : 'warning'}>
                {`ECS Fields: ${ecsCoverage.matched} / ${ecsCoverage.total}`}
              </EuiBadge>
            ) : (
              <EuiBadge color="hollow">{validationResult.language.toUpperCase()}</EuiBadge>
            )}
          </EuiFlexItem>
        </EuiFlexGroup>

        {validationResult.warnings.length > 0 ? (
          <EuiCallOut size="s" color="warning" title="Warnings">
            <ul>
              {validationResult.warnings.map((warning, i) => (
                <li key={i}>
                  {warning.message}
                  {warning.field ? ` (${warning.field})` : ''}
                </li>
              ))}
            </ul>
          </EuiCallOut>
        ) : null}
      </div>
    );
  }

  // Invalid: split into syntax errors (no field) and field errors.
  const syntaxErrors: readonly ValidationError[] = validationResult.errors.filter(
    (error) => error.field == null
  );
  const fieldErrors: readonly ValidationError[] = validationResult.errors.filter(
    (error) => error.field != null
  );

  return (
    <div data-test-subj="queryCopilotValidationFeedback">
      <EuiCallOut size="s" color="danger" iconType="alert" title="Validation failed">
        {syntaxErrors.length > 0 ? (
          <>
            <EuiText size="s">
              <strong>Syntax errors</strong>
            </EuiText>
            <ul>
              {syntaxErrors.map((error, i) => (
                <IssueItem key={`syntax-${i}`} issue={error} />
              ))}
            </ul>
          </>
        ) : null}
        {fieldErrors.length > 0 ? (
          <>
            <EuiText size="s">
              <strong>Field errors</strong>
            </EuiText>
            <ul>
              {fieldErrors.map((error, i) => (
                <IssueItem key={`field-${i}`} issue={error} />
              ))}
            </ul>
          </>
        ) : null}
      </EuiCallOut>
    </div>
  );
};
