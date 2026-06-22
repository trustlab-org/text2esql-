import React, { useMemo, useState } from 'react';
import {
  EuiButton,
  EuiButtonEmpty,
  EuiCallOut,
  EuiFieldPassword,
  EuiFieldText,
  EuiForm,
  EuiFormRow,
  EuiSelect,
  EuiSpacer,
  EuiSwitch,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import type { EuiSelectOption } from '@elastic/eui';

import type { ProviderCredential, ProviderName, RequestCredentials } from '../../../common/types';
import { ALL_PROVIDER_NAMES, PROVIDER_DEFAULT_MODELS, PROVIDER_NAMES } from '../../../common';
import { providerDisplayName } from '../statusbar/provider_display';
import { useCredentials } from '../../hooks/useCredentials';

/**
 * Settings form for the user's OWN primary (+ optional fallback) LLM credentials.
 *
 * Keys are rendered ONLY in password fields and never placed in tooltips, logs,
 * or aria-labels. On save the bundle is persisted to localStorage via
 * {@link useCredentials} and the flyout is closed.
 */

interface ApiKeysPanelProps {
  readonly onClose: () => void;
}

const PROVIDER_OPTIONS: EuiSelectOption[] = ALL_PROVIDER_NAMES.map((name) => ({
  value: name,
  text: providerDisplayName(name as ProviderName),
}));

/** Editable form state for one provider section. */
interface SectionState {
  provider: ProviderName;
  apiKey: string;
  model: string;
  endpoint: string;
}

const DEFAULT_PROVIDER: ProviderName = PROVIDER_NAMES.ANTHROPIC;

function sectionFromCredential(cred: ProviderCredential | null | undefined): SectionState {
  if (!cred) {
    return { provider: DEFAULT_PROVIDER, apiKey: '', model: '', endpoint: '' };
  }
  return {
    provider: cred.provider,
    apiKey: cred.apiKey ?? '',
    model: cred.model ?? '',
    endpoint: cred.endpoint ?? '',
  };
}

/** Builds a {@link ProviderCredential} from a section, omitting empty fields. */
function credentialFromSection(section: SectionState): ProviderCredential {
  const result: { -readonly [K in keyof ProviderCredential]: ProviderCredential[K] } = {
    provider: section.provider,
  };
  const apiKey = section.apiKey.trim();
  const model = section.model.trim();
  const endpoint = section.endpoint.trim();
  if (apiKey.length > 0) {
    result.apiKey = apiKey;
  }
  if (model.length > 0) {
    result.model = model;
  }
  if (endpoint.length > 0) {
    result.endpoint = endpoint;
  }
  return result;
}

export const ApiKeysPanel: React.FC<ApiKeysPanelProps> = ({ onClose }) => {
  const { credentials, setCredentials, clearCredentials } = useCredentials();

  const [primary, setPrimary] = useState<SectionState>(() =>
    sectionFromCredential(credentials?.primary)
  );
  const [fallbackEnabled, setFallbackEnabled] = useState<boolean>(
    () => Boolean(credentials?.fallback)
  );
  const [fallback, setFallback] = useState<SectionState>(() =>
    sectionFromCredential(credentials?.fallback ?? null)
  );
  const [error, setError] = useState<string | null>(null);

  const primaryIsOllama = primary.provider === PROVIDER_NAMES.OLLAMA;
  const fallbackIsOllama = fallback.provider === PROVIDER_NAMES.OLLAMA;

  const statusLine = useMemo<string>(() => {
    if (!credentials) {
      return 'Primary: not set';
    }
    const usable =
      credentials.primary.provider === PROVIDER_NAMES.OLLAMA ||
      (credentials.primary.apiKey ?? '').length > 0;
    return `Primary: ${usable ? 'key set' : 'not set'}`;
  }, [credentials]);

  const handleSave = (): void => {
    if (!primaryIsOllama && primary.apiKey.trim().length === 0) {
      setError('A primary API key is required (Ollama is the only provider that runs without one).');
      return;
    }
    if (fallbackEnabled && !fallbackIsOllama && fallback.apiKey.trim().length === 0) {
      setError('The fallback provider needs an API key (or choose Ollama).');
      return;
    }
    setError(null);
    const next: RequestCredentials = fallbackEnabled
      ? { primary: credentialFromSection(primary), fallback: credentialFromSection(fallback) }
      : { primary: credentialFromSection(primary) };
    setCredentials(next);
    onClose();
  };

  const handleClear = (): void => {
    clearCredentials();
    setPrimary({ provider: DEFAULT_PROVIDER, apiKey: '', model: '', endpoint: '' });
    setFallback({ provider: DEFAULT_PROVIDER, apiKey: '', model: '', endpoint: '' });
    setFallbackEnabled(false);
    setError(null);
  };

  const renderSection = (
    section: SectionState,
    setSection: React.Dispatch<React.SetStateAction<SectionState>>,
    keyPrefix: string
  ): React.ReactNode => {
    const isOllama = section.provider === PROVIDER_NAMES.OLLAMA;
    return (
      <>
        <EuiFormRow label="Provider">
          <EuiSelect
            options={PROVIDER_OPTIONS}
            value={section.provider}
            onChange={(e) =>
              setSection((s) => ({ ...s, provider: e.target.value as ProviderName }))
            }
            data-test-subj={`queryCopilot${keyPrefix}Provider`}
          />
        </EuiFormRow>
        {isOllama ? (
          <EuiFormRow label="Endpoint" helpText="Local Ollama endpoint (optional).">
            <EuiFieldText
              placeholder="http://localhost:11434"
              value={section.endpoint}
              onChange={(e) => setSection((s) => ({ ...s, endpoint: e.target.value }))}
              data-test-subj={`queryCopilot${keyPrefix}Endpoint`}
            />
          </EuiFormRow>
        ) : (
          <EuiFormRow label="API key">
            <EuiFieldPassword
              type="dual"
              value={section.apiKey}
              onChange={(e) => setSection((s) => ({ ...s, apiKey: e.target.value }))}
              data-test-subj={`queryCopilot${keyPrefix}ApiKey`}
            />
          </EuiFormRow>
        )}
        <EuiFormRow label="Model" helpText="Optional; leave blank to use the default.">
          <EuiFieldText
            placeholder={PROVIDER_DEFAULT_MODELS[section.provider]}
            value={section.model}
            onChange={(e) => setSection((s) => ({ ...s, model: e.target.value }))}
            data-test-subj={`queryCopilot${keyPrefix}Model`}
          />
        </EuiFormRow>
      </>
    );
  };

  return (
    <div data-test-subj="queryCopilotApiKeysPanel">
      <EuiTitle size="s">
        <h3>Your LLM API keys</h3>
      </EuiTitle>
      <EuiText size="xs" color="subdued">
        Keys are stored only in this browser and sent with each query. They are never written to
        the server config.
      </EuiText>
      <EuiSpacer size="s" />
      <EuiText size="xs" color="subdued" data-test-subj="queryCopilotApiKeysStatus">
        {statusLine}
      </EuiText>
      <EuiSpacer size="m" />

      {error && (
        <>
          <EuiCallOut color="danger" iconType="alert" title={error} size="s" />
          <EuiSpacer size="m" />
        </>
      )}

      <EuiForm component="form">
        <EuiTitle size="xs">
          <h4>Primary provider</h4>
        </EuiTitle>
        <EuiSpacer size="s" />
        {renderSection(primary, setPrimary, 'Primary')}

        <EuiSpacer size="l" />

        <EuiFormRow>
          <EuiSwitch
            label="Enable fallback provider"
            checked={fallbackEnabled}
            onChange={(e) => setFallbackEnabled(e.target.checked)}
            data-test-subj="queryCopilotFallbackToggle"
          />
        </EuiFormRow>
        {fallbackEnabled && (
          <>
            <EuiSpacer size="s" />
            {renderSection(fallback, setFallback, 'Fallback')}
          </>
        )}

        <EuiSpacer size="l" />

        <EuiButton fill onClick={handleSave} data-test-subj="queryCopilotSaveKeysButton">
          Save keys
        </EuiButton>
        &nbsp;
        <EuiButtonEmpty
          color="danger"
          onClick={handleClear}
          data-test-subj="queryCopilotClearKeysButton"
        >
          Clear keys
        </EuiButtonEmpty>
      </EuiForm>
    </div>
  );
};
