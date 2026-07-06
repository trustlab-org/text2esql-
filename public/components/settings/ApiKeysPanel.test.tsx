/**
 * @jest-environment jsdom
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';

import { ApiKeysPanel } from './ApiKeysPanel';
import { ServicesContext, type Services } from '../../services';
import type { MaskedCredentials } from '../../../common/types';

function makeServices(overrides: {
  getCredentials?: jest.Mock;
  saveCredentials?: jest.Mock;
  deleteCredentials?: jest.Mock;
  discoverModels?: jest.Mock;
}): {
  services: Services;
  saveCredentials: jest.Mock;
  deleteCredentials: jest.Mock;
  discoverModels: jest.Mock;
} {
  const saveCredentials = overrides.saveCredentials ?? jest.fn().mockResolvedValue(null);
  const deleteCredentials = overrides.deleteCredentials ?? jest.fn().mockResolvedValue(undefined);
  // Model discovery is auto-triggered by the provider cards (stored key / ollama);
  // default to an empty successful discovery so cards settle without a live server.
  const discoverModels =
    overrides.discoverModels ??
    jest.fn().mockResolvedValue({ provider: 'anthropic', models: [] });
  const services = {
    queryApi: {},
    providerApi: { discoverModels },
    benchmarkApi: {},
    credentialsApi: {
      getCredentials: overrides.getCredentials ?? jest.fn().mockRejectedValue(new Error('none')),
      saveCredentials,
      deleteCredentials,
    },
  } as unknown as Services;
  return { services, saveCredentials, deleteCredentials, discoverModels };
}

function renderPanel(services: Services, onClose: () => void = jest.fn()) {
  return render(
    <ServicesContext.Provider value={services}>
      <ApiKeysPanel onClose={onClose} />
    </ServicesContext.Provider>
  );
}

describe('ApiKeysPanel', () => {
  it('renders the keys form with a provider api key + add/save/clear controls', async () => {
    const { services } = makeServices({});
    const { getByTestId } = renderPanel(services);

    expect(getByTestId('queryCopilotApiKeysPanel')).toBeTruthy();
    // A brand-new user starts with a single blank Anthropic slot.
    await waitFor(() => expect(getByTestId('queryCopilotanthropicApiKey')).toBeTruthy());
    expect(getByTestId('queryCopilotAddProviderButton')).toBeTruthy();
    expect(getByTestId('queryCopilotSaveKeysButton')).toBeTruthy();
    expect(getByTestId('queryCopilotClearKeysButton')).toBeTruthy();
  });

  it('renders the masked status line (providers ready) from the server', async () => {
    const masked: MaskedCredentials = {
      providers: [{ provider: 'anthropic', model: null, endpoint: null, hasKey: true }],
      primaryProvider: 'anthropic',
    };
    const { services } = makeServices({ getCredentials: jest.fn().mockResolvedValue(masked) });
    const { getByTestId } = renderPanel(services);

    await waitFor(() =>
      expect(getByTestId('queryCopilotApiKeysStatus').textContent).toContain('provider')
    );
  });

  it('save posts a SaveCredentialsInput with the typed key and closes', async () => {
    const onClose = jest.fn();
    const { services, saveCredentials } = makeServices({});
    const { getByTestId } = renderPanel(services, onClose);

    await waitFor(() => expect(getByTestId('queryCopilotanthropicApiKey')).toBeTruthy());
    fireEvent.change(getByTestId('queryCopilotanthropicApiKey'), { target: { value: 'sk-abc' } });
    fireEvent.click(getByTestId('queryCopilotSaveKeysButton'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(saveCredentials).toHaveBeenCalledWith({
      providers: [{ provider: 'anthropic', apiKey: 'sk-abc' }],
      primaryProvider: 'anthropic',
    });
  });

  it('blocks save (no close, no post) when a non-ollama provider has no key', async () => {
    const onClose = jest.fn();
    const { services, saveCredentials } = makeServices({});
    const { getByTestId } = renderPanel(services, onClose);

    await waitFor(() => expect(getByTestId('queryCopilotanthropicApiKey')).toBeTruthy());
    fireEvent.click(getByTestId('queryCopilotSaveKeysButton'));

    await waitFor(() =>
      expect(getByTestId('queryCopilotApiKeysPanel').textContent).toContain('needs an API key')
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(saveCredentials).not.toHaveBeenCalled();
  });

  it('hides the api key field and shows an endpoint field when ollama is selected', async () => {
    const { services } = makeServices({});
    const { getByTestId, queryByTestId } = renderPanel(services);

    await waitFor(() => expect(getByTestId('queryCopilotanthropicProvider')).toBeTruthy());
    fireEvent.change(getByTestId('queryCopilotanthropicProvider'), { target: { value: 'ollama' } });

    expect(queryByTestId('queryCopilotollamaApiKey')).toBeNull();
    expect(getByTestId('queryCopilotollamaEndpoint')).toBeTruthy();
  });

  it('saves ollama without an api key (closes + posts)', async () => {
    const onClose = jest.fn();
    const { services, saveCredentials } = makeServices({});
    const { getByTestId } = renderPanel(services, onClose);

    await waitFor(() => expect(getByTestId('queryCopilotanthropicProvider')).toBeTruthy());
    fireEvent.change(getByTestId('queryCopilotanthropicProvider'), { target: { value: 'ollama' } });
    fireEvent.click(getByTestId('queryCopilotSaveKeysButton'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(saveCredentials).toHaveBeenCalledWith({
      providers: [{ provider: 'ollama' }],
      primaryProvider: 'ollama',
    });
  });

  it('clear keys calls deleteCredentials', async () => {
    const { services, deleteCredentials } = makeServices({});
    const { getByTestId } = renderPanel(services);

    fireEvent.click(getByTestId('queryCopilotClearKeysButton'));

    await waitFor(() => expect(deleteCredentials).toHaveBeenCalledTimes(1));
  });
});
