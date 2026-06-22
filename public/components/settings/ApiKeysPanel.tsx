import React, { useEffect, useMemo, useState } from 'react';
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

import type {
  MaskedProvider,
  ProviderName,
  SaveCredentialInput,
  SaveCredentialsInput,
} from '../../../common/types';
import { ALL_PROVIDER_NAMES, PROVIDER_DEFAULT_MODELS, PROVIDER_NAMES } from '../../../common';
import { providerDisplayName } from '../statusbar/provider_display';
import { useCredentials } from '../../hooks/useCredentials';

/**
 * Settings form for the user's OWN primary (+ optional fallback) LLM credentials.
 *
 * Keys now live in encrypted SERVER-SIDE storage; the browser only ever handles
 * MASKED metadata. The form prefills provider/model/endpoint from the masked
 * status and shows a "key set"/"no key set" indicator per slot, but the password
 * fields ALWAYS start empty (raw keys are never returned). Leaving a password
 * field empty on save PRESERVES the existing stored key. Keys are rendered only
 * in password fields and never placed in tooltips, logs, or aria-labels.
 */

interface ApiKeysPanelProps {
  readonly onClose: () => void;
  /** Called after a successful save/clear so global credential status refreshes. */
  readonly onChange?: () => void;
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

function emptySection(): SectionState {
  return { provider: DEFAULT_PROVIDER, apiKey: '', model: '', endpoint: '' };
}

/** Seeds a section from masked status (provider/model/endpoint only — no key). */
function sectionFromMasked(masked: MaskedProvider | null | undefined): SectionState {
  if (!masked) {
    return emptySection();
  }
  return {
    provider: masked.provider,
    apiKey: '',
    model: masked.model ?? '',
    endpoint: masked.endpoint ?? '',
  };
}

/**
 * Builds a {@link SaveCredentialInput} from a section, omitting empty fields. An
 * empty apiKey is omitted so the server preserves the existing stored key.
 */
function inputFromSection(section: SectionState): SaveCredentialInput {
  const result: { -readonly [K in keyof SaveCredentialInput]: SaveCredentialInput[K] } = {
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

/** "key set" status text for a slot (key present, or Ollama which needs none). */
function slotStatus(masked: MaskedProvider | null | undefined): string {
  if (!masked) {
    return 'no key set';
  }
  if (masked.provider === PROVIDER_NAMES.OLLAMA) {
    return 'key set ✓';
  }
  return masked.hasKey ? 'key set ✓' : 'no key set';
}

export const ApiKeysPanel: React.FC<ApiKeysPanelProps> = ({ onClose, onChange }) => {
  const { status, save, clear, error: hookError } = useCredentials(onChange);

  const [primary, setPrimary] = useState<SectionState>(emptySection);
  const [fallbackEnabled, setFallbackEnabled] = useState<boolean>(false);
  const [fallback, setFallback] = useState<SectionState>(emptySection);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState<boolean>(false);

  // Prefill from masked status once it loads (provider/model/endpoint only).
  useEffect(() => {
    if (status && !hydrated) {
      setPrimary(sectionFromMasked(status.primary));
      setFallbackEnabled(Boolean(status.fallback?.enabled));
      setFallback(sectionFromMasked(status.fallback ?? null));
      setHydrated(true);
    }
  }, [status, hydrated]);

  const primaryIsOllama = primary.provider === PROVIDER_NAMES.OLLAMA;
  const fallbackIsOllama = fallback.provider === PROVIDER_NAMES.OLLAMA;

  // Whether the slot already has a usable stored key (so an empty password field
  // is fine — it preserves the existing key rather than being a first-time set).
  const primaryHasStoredKey = useMemo<boolean>(() => {
    if (!status) {
      return false;
    }
    return status.primary.provider === primary.provider && status.primary.hasKey;
  }, [status, primary.provider]);

  const fallbackHasStoredKey = useMemo<boolean>(() => {
    if (!status?.fallback) {
      return false;
    }
    return status.fallback.provider === fallback.provider && status.fallback.hasKey;
  }, [status, fallback.provider]);

  const handleSave = async (): Promise<void> => {
    // First-time set for a non-ollama provider with no key typed is blocked
    // client-side (mirrors the backend 400). When a key is already stored for
    // the same provider, an empty field is fine (it preserves the key).
    if (!primaryIsOllama && primary.apiKey.trim().length === 0 && !primaryHasStoredKey) {
      setError('A primary API key is required (Ollama is the only provider that runs without one).');
      return;
    }
    if (
      fallbackEnabled &&
      !fallbackIsOllama &&
      fallback.apiKey.trim().length === 0 &&
      !fallbackHasStoredKey
    ) {
      setError('The fallback provider needs an API key (or choose Ollama).');
      return;
    }
    setError(null);

    const input: SaveCredentialsInput = {
      primary: inputFromSection(primary),
      fallback: fallbackEnabled
        ? { ...inputFromSection(fallback), enabled: true }
        : null,
    };

    try {
      await save(input);
      onClose();
    } catch {
      // Error message is surfaced via the hook's `error` (rendered below).
    }
  };

  const handleClear = async (): Promise<void> => {
    setError(null);
    try {
      await clear();
      setPrimary(emptySection());
      setFallback(emptySection());
      setFallbackEnabled(false);
    } catch {
      // Surfaced via hookError.
    }
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
          <EuiFormRow
            label="API key"
            helpText="Leave blank to keep your existing key. Keys are stored encrypted on the server."
          >
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

  const displayError = error ?? hookError;

  return (
    <div data-test-subj="queryCopilotApiKeysPanel">
      <EuiTitle size="s">
        <h3>Your LLM API keys</h3>
      </EuiTitle>
      <EuiText size="xs" color="subdued">
        Keys are stored encrypted on the server, scoped to your account. They are never written to
        the server config and never returned to the browser.
      </EuiText>
      <EuiSpacer size="s" />
      <EuiText size="xs" color="subdued" data-test-subj="queryCopilotApiKeysStatus">
        Primary: {slotStatus(status?.primary)}
        {status?.fallback ? ` | Fallback: ${slotStatus(status.fallback)}` : ''}
      </EuiText>
      <EuiSpacer size="m" />

      {displayError && (
        <>
          <EuiCallOut color="danger" iconType="alert" title={displayError} size="s" />
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

        <EuiButton fill onClick={() => void handleSave()} data-test-subj="queryCopilotSaveKeysButton">
          Save keys
        </EuiButton>
        &nbsp;
        <EuiButtonEmpty
          color="danger"
          onClick={() => void handleClear()}
          data-test-subj="queryCopilotClearKeysButton"
        >
          Clear keys
        </EuiButtonEmpty>
      </EuiForm>
    </div>
  );
};
