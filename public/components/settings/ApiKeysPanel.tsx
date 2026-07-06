import React, { useEffect, useMemo, useState } from 'react';
import {
  EuiButton,
  EuiButtonEmpty,
  EuiCallOut,
  EuiForm,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';

import type {
  MaskedProvider,
  ProviderName,
  SaveCredentialInput,
  SaveCredentialsInput,
} from '../../../common/types';
import { ALL_PROVIDER_NAMES, PROVIDER_NAMES } from '../../../common';
import { useCredentials } from '../../hooks/useCredentials';
import { providerDisplayName } from '../statusbar/provider_display';
import { ProviderCard, type ProviderSectionState } from './ProviderCard';

/**
 * Settings form for the user's OWN LLM credentials, presented as a LIST of
 * provider cards: add a key for any (or all) of the supported providers and mark
 * one as the default primary. Each card is a provider-aware {@link ProviderCard}
 * (API key input, live connection status, discovered-model dropdown, refresh +
 * test connection).
 *
 * Keys live in encrypted SERVER-SIDE storage; the browser only ever handles
 * MASKED metadata. The form prefills provider/model/endpoint from the masked
 * status and shows a "key set"/"no key set" indicator, but the password fields
 * ALWAYS start empty (raw keys are never returned). Leaving a password field
 * empty on save PRESERVES the existing stored key. Keys are rendered only in
 * password fields and never placed in tooltips, logs, or aria-labels.
 */

interface ApiKeysPanelProps {
  readonly onClose: () => void;
  /** Called after a successful save/clear so global credential status refreshes. */
  readonly onChange?: () => void;
}

/** A provider slot in the editable list, with a stable id for React keys. */
interface Slot {
  readonly id: string;
  readonly section: ProviderSectionState;
}

let slotSeq = 0;
/** Generates a stable, process-unique id for a new slot. */
function nextSlotId(): string {
  slotSeq += 1;
  return `slot-${slotSeq}`;
}

/** Builds an empty section for the given provider. */
function emptySection(provider: ProviderName): ProviderSectionState {
  return { provider, apiKey: '', model: '', endpoint: '' };
}

/** Seeds a section from masked status (provider/model/endpoint only — no key). */
function sectionFromMasked(masked: MaskedProvider): ProviderSectionState {
  return {
    provider: masked.provider,
    apiKey: '',
    model: masked.model ?? '',
    endpoint: masked.endpoint ?? '',
  };
}

/** First provider not already used by a slot, or null when all are configured. */
function firstUnusedProvider(used: readonly ProviderName[]): ProviderName | null {
  return ALL_PROVIDER_NAMES.find((name) => !used.includes(name)) ?? null;
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

export const ApiKeysPanel: React.FC<ApiKeysPanelProps> = ({ onClose, onChange }) => {
  const { status, save, clear, error: hookError } = useCredentials(onChange);

  // A brand-new user (no stored credentials) starts with a single blank slot so
  // there is always a card to type into; masked status replaces it once loaded.
  const [slots, setSlots] = useState<Slot[]>(() => [
    { id: nextSlotId(), section: emptySection(PROVIDER_NAMES.ANTHROPIC) },
  ]);
  const [primaryProvider, setPrimaryProvider] = useState<ProviderName | null>(
    PROVIDER_NAMES.ANTHROPIC
  );
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState<boolean>(false);

  // Prefill from masked status once it loads (provider/model/endpoint only). An
  // empty stored set leaves the default blank slot in place.
  useEffect(() => {
    if (status && !hydrated && status.providers.length > 0) {
      const seeded: Slot[] = status.providers.map((p) => ({
        id: nextSlotId(),
        section: sectionFromMasked(p),
      }));
      setSlots(seeded);
      setPrimaryProvider(status.primaryProvider ?? seeded[0]?.section.provider ?? null);
      setHydrated(true);
    }
  }, [status, hydrated]);

  const usedProviders = useMemo<ProviderName[]>(
    () => slots.map((slot) => slot.section.provider),
    [slots]
  );

  const canAddProvider = slots.length < ALL_PROVIDER_NAMES.length;

  /** Whether a slot's provider already has a usable stored key on the server. */
  const hasStoredKeyFor = (provider: ProviderName): boolean =>
    Boolean(status?.providers.some((p) => p.provider === provider && p.hasKey));

  const updateSlot = (id: string, section: ProviderSectionState): void => {
    setSlots((prev) => {
      const previous = prev.find((slot) => slot.id === id);
      const next = prev.map((slot) => (slot.id === id ? { ...slot, section } : slot));
      // If a slot changed provider and it was the primary, keep the pointer on
      // the same slot by following it to the new provider.
      if (previous && previous.section.provider === primaryProvider) {
        setPrimaryProvider(section.provider);
      }
      return next;
    });
  };

  const addSlot = (): void => {
    const provider = firstUnusedProvider(usedProviders);
    if (provider === null) {
      return;
    }
    setSlots((prev) => [...prev, { id: nextSlotId(), section: emptySection(provider) }]);
    setPrimaryProvider((prev) => prev ?? provider);
  };

  const removeSlot = (id: string): void => {
    setSlots((prev) => {
      const next = prev.filter((slot) => slot.id !== id);
      const removed = prev.find((slot) => slot.id === id);
      if (removed && removed.section.provider === primaryProvider) {
        setPrimaryProvider(next[0]?.section.provider ?? null);
      }
      return next;
    });
  };

  const handleSave = async (): Promise<void> => {
    if (slots.length === 0) {
      setError('Add at least one provider before saving.');
      return;
    }
    // First-time set for a non-ollama provider with no key typed is blocked
    // client-side (mirrors the backend 400). When a key is already stored for
    // the same provider, an empty field is fine (it preserves the key).
    for (const { section } of slots) {
      const isOllama = section.provider === PROVIDER_NAMES.OLLAMA;
      if (!isOllama && section.apiKey.trim().length === 0 && !hasStoredKeyFor(section.provider)) {
        setError(
          `${providerDisplayName(section.provider)} needs an API key (Ollama is the only provider that runs without one).`
        );
        return;
      }
    }
    setError(null);

    const providers: SaveCredentialInput[] = slots.map((slot) => inputFromSection(slot.section));
    // Pin the chosen primary when it is still in the list; otherwise the server
    // defaults to providers[0].
    const chosenPrimary =
      primaryProvider !== null && usedProviders.includes(primaryProvider)
        ? primaryProvider
        : providers[0]?.provider;

    const input: SaveCredentialsInput = {
      providers,
      ...(chosenPrimary ? { primaryProvider: chosenPrimary } : {}),
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
      setSlots([{ id: nextSlotId(), section: emptySection(PROVIDER_NAMES.ANTHROPIC) }]);
      setPrimaryProvider(PROVIDER_NAMES.ANTHROPIC);
    } catch {
      // Surfaced via hookError.
    }
  };

  const displayError = error ?? hookError;

  const configuredCount = status?.providers.filter(
    (p) => p.hasKey || p.provider === PROVIDER_NAMES.OLLAMA
  ).length ?? 0;

  return (
    <div data-test-subj="queryCopilotApiKeysPanel">
      <EuiTitle size="s">
        <h3>Your LLM API keys</h3>
      </EuiTitle>
      <EuiText size="xs" color="subdued">
        Keys are stored encrypted on the server, scoped to your account. They are never written to
        the server config and never returned to the browser. Add a key for any provider and pick one
        as your default.
      </EuiText>
      <EuiSpacer size="s" />
      <EuiText size="xs" color="subdued" data-test-subj="queryCopilotApiKeysStatus">
        {configuredCount > 0
          ? `${configuredCount} provider${configuredCount === 1 ? '' : 's'} ready`
          : 'No keys set'}
      </EuiText>
      <EuiSpacer size="m" />

      {displayError && (
        <>
          <EuiCallOut color="danger" iconType="alert" title={displayError} size="s" />
          <EuiSpacer size="m" />
        </>
      )}

      <EuiForm component="form">
        {slots.map((slot) => {
          const otherProviders = slots
            .filter((s) => s.id !== slot.id)
            .map((s) => s.section.provider);
          return (
            <React.Fragment key={slot.id}>
              <ProviderCard
                section={slot.section}
                onChange={(section) => updateSlot(slot.id, section)}
                hasStoredKey={hasStoredKeyFor(slot.section.provider)}
                keyPrefix={slot.section.provider}
                unavailableProviders={otherProviders}
                isPrimary={slot.section.provider === primaryProvider}
                onMakePrimary={() => setPrimaryProvider(slot.section.provider)}
                onRemove={() => removeSlot(slot.id)}
              />
              <EuiSpacer size="m" />
            </React.Fragment>
          );
        })}

        <EuiButton
          iconType="plusInCircle"
          onClick={addSlot}
          isDisabled={!canAddProvider}
          data-test-subj="queryCopilotAddProviderButton"
        >
          Add provider
        </EuiButton>

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
