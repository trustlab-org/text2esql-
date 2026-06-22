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
}): {
  services: Services;
  saveCredentials: jest.Mock;
  deleteCredentials: jest.Mock;
} {
  const saveCredentials = overrides.saveCredentials ?? jest.fn().mockResolvedValue(null);
  const deleteCredentials = overrides.deleteCredentials ?? jest.fn().mockResolvedValue(undefined);
  const services = {
    queryApi: {},
    providerApi: {},
    benchmarkApi: {},
    credentialsApi: {
      getCredentials: overrides.getCredentials ?? jest.fn().mockRejectedValue(new Error('none')),
      saveCredentials,
      deleteCredentials,
    },
  } as unknown as Services;
  return { services, saveCredentials, deleteCredentials };
}

function renderPanel(services: Services, onClose: () => void = jest.fn()) {
  return render(
    <ServicesContext.Provider value={services}>
      <ApiKeysPanel onClose={onClose} />
    </ServicesContext.Provider>
  );
}

describe('ApiKeysPanel', () => {
  it('renders the keys form with primary api key + save/clear controls', () => {
    const { services } = makeServices({});
    const { getByTestId } = renderPanel(services);

    expect(getByTestId('queryCopilotApiKeysPanel')).toBeTruthy();
    expect(getByTestId('queryCopilotPrimaryApiKey')).toBeTruthy();
    expect(getByTestId('queryCopilotSaveKeysButton')).toBeTruthy();
    expect(getByTestId('queryCopilotClearKeysButton')).toBeTruthy();
  });

  it('renders the masked status line (key set) from the server', async () => {
    const masked: MaskedCredentials = {
      primary: { provider: 'anthropic', model: null, endpoint: null, hasKey: true },
      fallback: null,
    };
    const { services } = makeServices({ getCredentials: jest.fn().mockResolvedValue(masked) });
    const { getByTestId } = renderPanel(services);

    await waitFor(() =>
      expect(getByTestId('queryCopilotApiKeysStatus').textContent).toContain('key set')
    );
  });

  it('save posts a SaveCredentialsInput with the typed key and closes', async () => {
    const onClose = jest.fn();
    const { services, saveCredentials } = makeServices({});
    const { getByTestId } = renderPanel(services, onClose);

    fireEvent.change(getByTestId('queryCopilotPrimaryApiKey'), { target: { value: 'sk-abc' } });
    fireEvent.click(getByTestId('queryCopilotSaveKeysButton'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(saveCredentials).toHaveBeenCalledWith({
      primary: { provider: 'anthropic', apiKey: 'sk-abc' },
      fallback: null,
    });
  });

  it('blocks save (no close, no post) when a non-ollama provider has no key', async () => {
    const onClose = jest.fn();
    const { services, saveCredentials } = makeServices({});
    const { getByTestId } = renderPanel(services, onClose);

    fireEvent.click(getByTestId('queryCopilotSaveKeysButton'));

    await waitFor(() =>
      expect(getByTestId('queryCopilotApiKeysPanel').textContent).toContain('API key is required')
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(saveCredentials).not.toHaveBeenCalled();
  });

  it('hides the api key field and shows an endpoint field when ollama is selected', () => {
    const { services } = makeServices({});
    const { getByTestId, queryByTestId } = renderPanel(services);

    fireEvent.change(getByTestId('queryCopilotPrimaryProvider'), { target: { value: 'ollama' } });

    expect(queryByTestId('queryCopilotPrimaryApiKey')).toBeNull();
    expect(getByTestId('queryCopilotPrimaryEndpoint')).toBeTruthy();
  });

  it('saves ollama without an api key (closes + posts)', async () => {
    const onClose = jest.fn();
    const { services, saveCredentials } = makeServices({});
    const { getByTestId } = renderPanel(services, onClose);

    fireEvent.change(getByTestId('queryCopilotPrimaryProvider'), { target: { value: 'ollama' } });
    fireEvent.click(getByTestId('queryCopilotSaveKeysButton'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(saveCredentials).toHaveBeenCalledWith({
      primary: { provider: 'ollama' },
      fallback: null,
    });
  });

  it('clear keys calls deleteCredentials', async () => {
    const { services, deleteCredentials } = makeServices({});
    const { getByTestId } = renderPanel(services);

    fireEvent.click(getByTestId('queryCopilotClearKeysButton'));

    await waitFor(() => expect(deleteCredentials).toHaveBeenCalledTimes(1));
  });
});
