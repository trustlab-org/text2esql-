import React from 'react';
import { EuiSelect } from '@elastic/eui';
import type { EuiSelectOption } from '@elastic/eui';

import type { ProviderName } from '../../../common/types';
import { useCopilot } from '../../store/copilot.context';
import { setPreferredProvider } from '../../store/copilot.actions';
import { providerDisplayName } from './provider_display';

/**
 * Main-screen LLM selector. Lets the analyst pin generation to the Primary or
 * Fallback provider they configured in Settings, or leave it on "Auto"
 * (Primary → Fallback routing order). The selection is stored in
 * `state.preferredProvider`, sent as `preferredProvider` on every generation
 * request, and survives reloads via session persistence. Renders nothing until
 * the masked credential status has loaded.
 *
 * When primary and fallback use the SAME provider, only the Auto and Primary
 * entries are offered — the wire contract pins by provider name, so a
 * same-provider fallback cannot be addressed separately.
 */
export const ProviderSelector: React.FC = () => {
  const { state, dispatch } = useCopilot();
  const status = state.credentialsStatus;

  if (status === null) {
    return null;
  }

  const primary = status.primary;
  const fallback = status.fallback?.enabled ? status.fallback : null;

  const labelFor = (provider: ProviderName, model: string | null): string =>
    `${providerDisplayName(provider)}${model ? ` · ${model}` : ''}`;

  const options: EuiSelectOption[] = [
    { value: '', text: 'Auto (Primary → Fallback)' },
    { value: primary.provider, text: `Primary: ${labelFor(primary.provider, primary.model)}` },
  ];
  if (fallback && fallback.provider !== primary.provider) {
    options.push({
      value: fallback.provider,
      text: `Fallback: ${labelFor(fallback.provider, fallback.model)}`,
    });
  }

  // A stale pin (provider no longer in any slot) falls back to Auto visually;
  // the next change event overwrites it in state.
  const currentValue =
    state.preferredProvider !== null &&
    options.some((option) => option.value === state.preferredProvider)
      ? state.preferredProvider
      : '';

  return (
    <EuiSelect
      compressed
      prepend="LLM"
      options={options}
      value={currentValue}
      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
        const value = e.target.value;
        dispatch(setPreferredProvider(value === '' ? null : (value as ProviderName)));
      }}
      aria-label="LLM provider used for query generation"
      data-test-subj="queryCopilotProviderSelector"
    />
  );
};
