import React, { useEffect, useMemo, useState } from 'react';
import {
  EuiButton,
  EuiButtonEmpty,
  EuiCallOut,
  EuiFlexGroup,
  EuiFlexItem,
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
  // The designated fallback (tried right after the primary). Encoded purely by
  // save order — [primary, fallback, ...backups] — so it needs no server field.
  const [fallbackProvider, setFallbackProvider] = useState<ProviderName | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState<boolean>(false);

  // Prefill from masked status once it loads (provider/model/endpoint only). An
  // empty stored set leaves the default blank slot in place. The saved order is
  // [primary, fallback, ...backups], so the first non-primary slot is the
  // de-facto fallback and is re-labelled as such.
  useEffect(() => {
    if (status && !hydrated && status.providers.length > 0) {
      const seeded: Slot[] = status.providers.map((p) => ({
        id: nextSlotId(),
        section: sectionFromMasked(p),
      }));
      const primary = status.primaryProvider ?? seeded[0]?.section.provider ?? null;
      setSlots(seeded);
      setPrimaryProvider(primary);
      setFallbackProvider(
        status.providers.find((p) => p.provider !== primary)?.provider ?? null
      );
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
      // If a slot changed provider, follow any primary/fallback pointer that was
      // aimed at it onto the new provider so the role sticks to the same card.
      if (previous && previous.section.provider === primaryProvider) {
        setPrimaryProvider(section.provider);
      }
      if (previous && previous.section.provider === fallbackProvider) {
        setFallbackProvider(section.provider);
      }
      return next;
    });
  };

  /** Marks a provider as the primary; it can no longer also be the fallback. */
  const makePrimary = (provider: ProviderName): void => {
    setPrimaryProvider(provider);
    setFallbackProvider((prev) => (prev === provider ? null : prev));
  };

  /** Marks a provider as the fallback (tried right after the primary). */
  const makeFallback = (provider: ProviderName): void => {
    setFallbackProvider(provider);
  };

  const addSlot = (): void => {
    const provider = firstUnusedProvider(usedProviders);
    if (provider === null) {
      return;
    }
    setSlots((prev) => [...prev, { id: nextSlotId(), section: emptySection(provider) }]);
    setPrimaryProvider((prev) => prev ?? provider);
  };

  /** Adds a new provider slot and designates it the fallback. */
  const addFallbackSlot = (): void => {
    const provider = firstUnusedProvider(usedProviders);
    if (provider === null) {
      return;
    }
    setSlots((prev) => [...prev, { id: nextSlotId(), section: emptySection(provider) }]);
    setPrimaryProvider((prev) => prev ?? provider);
    // A new fallback provider is, by construction, not the primary (the primary
    // is already in a used slot and firstUnusedProvider excludes it).
    setFallbackProvider(provider);
  };

  const removeSlot = (id: string): void => {
    setSlots((prev) => {
      const next = prev.filter((slot) => slot.id !== id);
      const removed = prev.find((slot) => slot.id === id);
      if (removed && removed.section.provider === primaryProvider) {
        setPrimaryProvider(next[0]?.section.provider ?? null);
      }
      if (removed && removed.section.provider === fallbackProvider) {
        setFallbackProvider(null);
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

    // Pin the chosen primary when it is still in the list; otherwise fall back
    // to the first slot (the server also defaults to providers[0]).
    const chosenPrimary =
      primaryProvider !== null && usedProviders.includes(primaryProvider)
        ? primaryProvider
        : slots[0]?.section.provider;

    // Order the slots as [primary, fallback, ...backups]. The server hoists the
    // primary and preserves the rest of the order, so this ordering IS the
    // provider chain: primary → fallback → remaining backups.
    const ordered: Slot[] = [];
    const pushOnce = (slot: Slot | undefined): void => {
      if (slot && !ordered.includes(slot)) {
        ordered.push(slot);
      }
    };
    pushOnce(slots.find((s) => s.section.provider === chosenPrimary));
    if (fallbackProvider !== null && fallbackProvider !== chosenPrimary) {
      pushOnce(slots.find((s) => s.section.provider === fallbackProvider));
    }
    slots.forEach((s) => pushOnce(s));

    const providers: SaveCredentialInput[] = ordered.map((slot) => inputFromSection(slot.section));

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
      setFallbackProvider(null);
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
                onMakePrimary={() => makePrimary(slot.section.provider)}
                isFallback={slot.section.provider === fallbackProvider}
                onMakeFallback={() => makeFallback(slot.section.provider)}
                onRemove={() => removeSlot(slot.id)}
              />
              <EuiSpacer size="m" />
            </React.Fragment>
          );
        })}

        <EuiFlexGroup gutterSize="s" responsive={false} alignItems="center">
          <EuiFlexItem grow={false}>
            <EuiButton
              iconType="plusInCircle"
              onClick={addSlot}
              isDisabled={!canAddProvider}
              data-test-subj="queryCopilotAddProviderButton"
            >
              Add provider
            </EuiButton>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty
              iconType="plusInCircle"
              onClick={addFallbackSlot}
              isDisabled={!canAddProvider}
              data-test-subj="queryCopilotAddFallbackButton"
            >
              Add as fallback
            </EuiButtonEmpty>
          </EuiFlexItem>
        </EuiFlexGroup>

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
