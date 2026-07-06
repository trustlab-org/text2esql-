import React, { useCallback, useEffect, useRef } from 'react';
import {
  EuiBadge,
  EuiButtonEmpty,
  EuiButtonIcon,
  EuiCallOut,
  EuiComboBox,
  EuiFieldPassword,
  EuiFieldText,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFormRow,
  EuiLoadingSpinner,
  EuiPanel,
  EuiSelect,
  EuiSpacer,
  EuiText,
} from '@elastic/eui';
import type { EuiSelectOption } from '@elastic/eui';

import type { ProviderName } from '../../../common/types';
import { ALL_PROVIDER_NAMES, PROVIDER_NAMES } from '../../../common';
import { providerDisplayName } from '../statusbar/provider_display';
import { useProviderModels } from '../../hooks/useProviderModels';

/**
 * One provider slot's settings card in the credentials list: provider select +
 * live connection-status badge, "set as primary"/remove controls, a per-provider
 * info line, API key (or Ollama endpoint) input, a dynamically-discovered model
 * dropdown with a refresh button, and a "Test connection" action.
 *
 * Models are NEVER hardcoded — the dropdown is populated live from the server's
 * model-discovery endpoint via {@link useProviderModels}; the user may still
 * type a model id manually (custom combo option) when discovery is unavailable.
 * Raw API keys only ever live in the password field and the request body; they
 * are never logged, cached, or rendered anywhere else.
 */

/** Editable form state for one provider section. */
export interface ProviderSectionState {
  provider: ProviderName;
  apiKey: string;
  model: string;
  endpoint: string;
}

export interface ProviderCardProps {
  readonly section: ProviderSectionState;
  readonly onChange: (section: ProviderSectionState) => void;
  /** Whether the server already stores a key for this slot's provider. */
  readonly hasStoredKey: boolean;
  /** data-test-subj prefix segment, e.g. 'anthropic' -> queryCopilotanthropicModel. */
  readonly keyPrefix: string;
  /** Provider names taken by OTHER cards — disabled in the provider select. */
  readonly unavailableProviders?: readonly ProviderName[];
  /** Whether this slot is the default primary provider. */
  readonly isPrimary: boolean;
  /** Marks this slot as the default primary provider. */
  readonly onMakePrimary: () => void;
  /** Whether this slot is the designated fallback (tried right after primary). */
  readonly isFallback: boolean;
  /** Marks this slot as the fallback provider. */
  readonly onMakeFallback: () => void;
  /** Removes this slot from the list. */
  readonly onRemove: () => void;
}

/** Short static per-provider description + key requirement (no model names). */
const PROVIDER_INFO: Record<ProviderName, string> = {
  openai: 'OpenAI API — requires an API key from platform.openai.com',
  anthropic: 'Anthropic Claude API — requires an API key from console.anthropic.com',
  gemini: 'Google Gemini API — requires an API key from aistudio.google.com',
  groq: 'Groq API — requires an API key from console.groq.com',
  ollama:
    'Local Ollama server — no API key required; set the endpoint if not on localhost:11434',
};

/** Option shape used for the model combo box; `value` is the raw model id. */
interface ModelOption {
  label: string;
  value: string;
}

export const ProviderCard: React.FC<ProviderCardProps> = ({
  section,
  onChange,
  hasStoredKey,
  keyPrefix,
  unavailableProviders = [],
  isPrimary,
  onMakePrimary,
  isFallback,
  onMakeFallback,
  onRemove,
}) => {
  const { models, status, error, discover, reset } = useProviderModels();

  // Provider options: those already taken by OTHER cards are disabled so the
  // list never holds duplicate providers.
  const providerOptions: EuiSelectOption[] = ALL_PROVIDER_NAMES.map((name) => ({
    value: name,
    text: providerDisplayName(name as ProviderName),
    disabled: name !== section.provider && unavailableProviders.includes(name as ProviderName),
  }));

  const isOllama = section.provider === PROVIDER_NAMES.OLLAMA;
  const typedKey = section.apiKey.trim();

  // The key text used for the LAST discovery, so a blur with DIFFERENT text
  // re-discovers (and force-refreshes past the typed-key cache slot).
  const lastDiscoveredKeyRef = useRef<string | null>(null);

  /** Whether we have anything usable to discover with right now. */
  const canDiscover = isOllama || typedKey.length > 0 || hasStoredKey;

  const runDiscover = useCallback(
    (forceRefresh: boolean): Promise<boolean> => {
      const key = section.apiKey.trim();
      const endpoint = section.endpoint.trim();
      lastDiscoveredKeyRef.current = key;
      return discover({
        provider: section.provider,
        apiKey: key.length > 0 ? key : undefined,
        endpoint: isOllama && endpoint.length > 0 ? endpoint : undefined,
        forceRefresh,
      });
    },
    [discover, section.provider, section.apiKey, section.endpoint, isOllama]
  );

  // Auto-discovery: on mount with a stored key, and on provider change with a
  // stored or typed key present (hasStoredKey flips once masked status loads,
  // which covers the initial hydration). Without any usable key the slot goes
  // back to the pristine 'idle' state.
  useEffect(() => {
    if (canDiscover) {
      void runDiscover(false);
    } else {
      lastDiscoveredKeyRef.current = null;
      reset();
    }
    // Only provider/stored-key transitions trigger AUTO discovery; typing in the
    // key field discovers on blur instead (explicit, no debounce needed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section.provider, hasStoredKey]);

  /** Key field blur: (re-)discover on new/changed key; reset when cleared. */
  const handleApiKeyBlur = (): void => {
    if (typedKey.length === 0) {
      if (hasStoredKey) {
        // Field cleared but a stored key exists: fall back to the stored key.
        if (lastDiscoveredKeyRef.current !== '') {
          void runDiscover(false);
        }
      } else {
        lastDiscoveredKeyRef.current = null;
        reset();
      }
      return;
    }
    if (typedKey !== lastDiscoveredKeyRef.current) {
      // The key changed since the last discovery: refresh models, bypassing
      // the caches (the in-memory cache cannot tell one typed key from another).
      void runDiscover(true);
    }
  };

  /** Endpoint blur (Ollama): re-discover so the list tracks the new server. */
  const handleEndpointBlur = (): void => {
    if (isOllama) {
      void runDiscover(false);
    }
  };

  const handleProviderChange = (next: ProviderName): void => {
    if (next === section.provider) {
      return;
    }
    // Model ids are provider-specific, so a stale selection is cleared.
    onChange({ ...section, provider: next, model: '' });
  };

  const modelOptions: ModelOption[] = models.map((m) => ({
    label: m.displayName === m.id ? m.id : `${m.displayName} (${m.id})`,
    value: m.id,
  }));

  const selectedModelOptions: ModelOption[] =
    section.model.length > 0
      ? [
          modelOptions.find((o) => o.value === section.model) ?? {
            label: section.model,
            value: section.model,
          },
        ]
      : [];

  // Disabled only while discovery has FAILED and nothing is listed; while idle
  // the user can still type a model id manually (the pre-discovery workflow).
  const modelDisabled = models.length === 0 && status === 'error';

  const connectionBadge = (): React.ReactNode => {
    switch (status) {
      case 'loading':
        return (
          <EuiBadge color="hollow" data-test-subj={`queryCopilot${keyPrefix}ConnectionStatus`}>
            <EuiLoadingSpinner size="s" /> Testing…
          </EuiBadge>
        );
      case 'ready':
        return (
          <EuiBadge color="success" data-test-subj={`queryCopilot${keyPrefix}ConnectionStatus`}>
            Connected
          </EuiBadge>
        );
      case 'error':
        return (
          <EuiBadge color="danger" data-test-subj={`queryCopilot${keyPrefix}ConnectionStatus`}>
            Failed
          </EuiBadge>
        );
      default:
        return (
          <EuiBadge color="hollow" data-test-subj={`queryCopilot${keyPrefix}ConnectionStatus`}>
            Not tested
          </EuiBadge>
        );
    }
  };

  return (
    <>
      <EuiPanel hasBorder paddingSize="m" data-test-subj={`queryCopilot${keyPrefix}ProviderCard`}>
        <EuiFlexGroup gutterSize="s" alignItems="flexEnd" responsive={false}>
          <EuiFlexItem>
            <EuiFormRow label="Provider" fullWidth>
              <EuiSelect
                options={providerOptions}
                value={section.provider}
                onChange={(e) => handleProviderChange(e.target.value as ProviderName)}
                fullWidth
                data-test-subj={`queryCopilot${keyPrefix}Provider`}
              />
            </EuiFormRow>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>{connectionBadge()}</EuiFlexItem>
          <EuiFlexItem grow={false}>
            {isPrimary ? (
              <EuiBadge color="primary" data-test-subj={`queryCopilot${keyPrefix}PrimaryBadge`}>
                Primary
              </EuiBadge>
            ) : (
              <EuiButtonEmpty
                size="s"
                onClick={onMakePrimary}
                data-test-subj={`queryCopilot${keyPrefix}SetPrimary`}
              >
                Set as primary
              </EuiButtonEmpty>
            )}
          </EuiFlexItem>
          {/* The fallback role is only meaningful for a non-primary slot; the
              primary is already tried first, so it can't also be the fallback. */}
          {!isPrimary && (
            <EuiFlexItem grow={false}>
              {isFallback ? (
                <EuiBadge color="accent" data-test-subj={`queryCopilot${keyPrefix}FallbackBadge`}>
                  Fallback
                </EuiBadge>
              ) : (
                <EuiButtonEmpty
                  size="s"
                  onClick={onMakeFallback}
                  data-test-subj={`queryCopilot${keyPrefix}SetFallback`}
                >
                  Set as fallback
                </EuiButtonEmpty>
              )}
            </EuiFlexItem>
          )}
          <EuiFlexItem grow={false}>
            <EuiButtonIcon
              iconType="trash"
              color="danger"
              aria-label={`Remove ${providerDisplayName(section.provider)} provider`}
              onClick={onRemove}
              data-test-subj={`queryCopilot${keyPrefix}Remove`}
            />
          </EuiFlexItem>
        </EuiFlexGroup>

        <EuiSpacer size="xs" />
        <EuiText size="xs" color="subdued" data-test-subj={`queryCopilot${keyPrefix}ProviderInfo`}>
          {PROVIDER_INFO[section.provider]}
        </EuiText>
        <EuiSpacer size="s" />

        {isOllama ? (
          <EuiFormRow label="Endpoint" helpText="Local Ollama endpoint (optional)." fullWidth>
            <EuiFieldText
              placeholder="http://localhost:11434"
              value={section.endpoint}
              onChange={(e) => onChange({ ...section, endpoint: e.target.value })}
              onBlur={handleEndpointBlur}
              fullWidth
              data-test-subj={`queryCopilot${keyPrefix}Endpoint`}
            />
          </EuiFormRow>
        ) : (
          <EuiFormRow
            label="API key"
            helpText={
              hasStoredKey
                ? 'A key is stored for this provider. Leave blank to keep the stored key.'
                : 'Leave blank to keep your existing key. Keys are stored encrypted on the server.'
            }
            fullWidth
          >
            <EuiFieldPassword
              type="dual"
              value={section.apiKey}
              onChange={(e) => onChange({ ...section, apiKey: e.target.value })}
              onBlur={handleApiKeyBlur}
              fullWidth
              data-test-subj={`queryCopilot${keyPrefix}ApiKey`}
            />
          </EuiFormRow>
        )}

        <EuiFormRow
          label="Model"
          helpText="Discovered live from the provider; you can also type a model id."
          fullWidth
        >
          <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
            <EuiFlexItem>
              <EuiComboBox<string>
                singleSelection={{ asPlainText: true }}
                placeholder={
                  modelDisabled
                    ? 'Enter a valid API key to load models'
                    : 'Select or type a model id'
                }
                options={modelOptions}
                selectedOptions={selectedModelOptions}
                onChange={(selected: ModelOption[]) =>
                  onChange({ ...section, model: selected[0]?.value ?? '' })
                }
                onCreateOption={(searchValue: string) => {
                  const value = searchValue.trim();
                  if (value.length > 0) {
                    onChange({ ...section, model: value });
                  }
                }}
                isDisabled={modelDisabled}
                isLoading={status === 'loading'}
                fullWidth
                data-test-subj={`queryCopilot${keyPrefix}Model`}
              />
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiButtonIcon
                iconType="refresh"
                aria-label="Refresh models"
                isDisabled={!canDiscover || status === 'loading'}
                onClick={() => void runDiscover(true)}
                data-test-subj={`queryCopilot${keyPrefix}RefreshModels`}
              />
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiFormRow>

        <EuiSpacer size="s" />
        <EuiButtonEmpty
          size="s"
          iconType="link"
          isDisabled={!canDiscover}
          isLoading={status === 'loading'}
          onClick={() => void runDiscover(false)}
          data-test-subj={`queryCopilot${keyPrefix}TestConnection`}
        >
          Test connection
        </EuiButtonEmpty>
      </EuiPanel>

      {status === 'error' && error !== null && (
        <>
          <EuiSpacer size="s" />
          <EuiCallOut
            color="danger"
            iconType="alert"
            size="s"
            title={error}
            data-test-subj={`queryCopilot${keyPrefix}ConnectionError`}
          />
        </>
      )}
    </>
  );
};
