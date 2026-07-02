import React, { useEffect, useMemo, useState } from 'react';
import {
  EuiButton,
  EuiButtonEmpty,
  EuiCallOut,
  EuiForm,
  EuiSpacer,
  EuiSwitch,
  EuiText,
  EuiTitle,
} from '@elastic/eui';

import type {
  MaskedProvider,
  SaveCredentialInput,
  SaveCredentialsInput,
} from '../../../common/types';
import { PROVIDER_NAMES } from '../../../common';
import { useCredentials } from '../../hooks/useCredentials';
import { ProviderCard, type ProviderSectionState } from './ProviderCard';

/**
 * Settings form for the user's OWN primary (+ optional fallback) LLM credentials,
 * composed from provider-aware {@link ProviderCard}s (API key input, live
 * connection status, discovered-model dropdown, refresh + test connection).
 *
 * Keys live in encrypted SERVER-SIDE storage; the browser only ever handles
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

const DEFAULT_PROVIDER = PROVIDER_NAMES.ANTHROPIC;

function emptySection(): ProviderSectionState {
  return { provider: DEFAULT_PROVIDER, apiKey: '', model: '', endpoint: '' };
}

/** Seeds a section from masked status (provider/model/endpoint only — no key). */
function sectionFromMasked(masked: MaskedProvider | null | undefined): ProviderSectionState {
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
function inputFromSection(section: ProviderSectionState): SaveCredentialInput {
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

  const [primary, setPrimary] = useState<ProviderSectionState>(emptySection);
  const [fallbackEnabled, setFallbackEnabled] = useState<boolean>(false);
  const [fallback, setFallback] = useState<ProviderSectionState>(emptySection);
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
        <ProviderCard
          slotLabel="Primary"
          section={primary}
          onChange={setPrimary}
          hasStoredKey={primaryHasStoredKey}
          keyPrefix="Primary"
        />

        <EuiSpacer size="l" />

        <EuiSwitch
          label="Enable fallback provider"
          checked={fallbackEnabled}
          onChange={(e) => setFallbackEnabled(e.target.checked)}
          data-test-subj="queryCopilotFallbackToggle"
        />
        {fallbackEnabled && (
          <>
            <EuiSpacer size="m" />
            <ProviderCard
              slotLabel="Fallback"
              section={fallback}
              onChange={setFallback}
              hasStoredKey={fallbackHasStoredKey}
              keyPrefix="Fallback"
            />
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
