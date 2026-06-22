/**
 * @jest-environment jsdom
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';

import { TopStatusBar } from './TopStatusBar';
import { CopilotProvider, useCopilot } from '../../store/copilot.context';
import { ServicesContext, type Services } from '../../services';
import type { MaskedCredentials } from '../../../common/types';

const WITH_KEY: MaskedCredentials = {
  primary: { provider: 'anthropic', model: null, endpoint: null, hasKey: true },
  fallback: null,
};

/** Loads credential status into context (simulating the on-mount refresh). */
const Loader: React.FC = () => {
  const { refreshCredentials } = useCopilot();
  React.useEffect(() => {
    void refreshCredentials();
  }, [refreshCredentials]);
  return null;
};

function makeServices(getCredentials: jest.Mock): Services {
  return {
    queryApi: {},
    providerApi: {},
    benchmarkApi: {},
    credentialsApi: { getCredentials, saveCredentials: jest.fn(), deleteCredentials: jest.fn() },
  } as unknown as Services;
}

function renderBar(getCredentials: jest.Mock, onOpenSettings: () => void = jest.fn()) {
  return render(
    <ServicesContext.Provider value={makeServices(getCredentials)}>
      <CopilotProvider>
        <Loader />
        <TopStatusBar onOpenSettings={onOpenSettings} />
      </CopilotProvider>
    </ServicesContext.Provider>
  );
}

describe('TopStatusBar settings affordance', () => {
  it('shows a prominent "Add API key" call-to-action when no key is configured', async () => {
    const getCredentials = jest.fn().mockRejectedValue(new Error('none'));
    const { getByTestId } = renderBar(getCredentials);

    await waitFor(() =>
      expect(getByTestId('queryCopilotOpenSettings').textContent).toContain('Add API key')
    );
  });

  it('falls back to the quiet "Settings" button once a usable key exists', async () => {
    const getCredentials = jest.fn().mockResolvedValue(WITH_KEY);
    const { getByTestId } = renderBar(getCredentials);

    await waitFor(() => expect(getCredentials).toHaveBeenCalled());
    await waitFor(() =>
      expect(getByTestId('queryCopilotOpenSettings').textContent).toContain('Settings')
    );
  });

  it('opens settings when clicked', async () => {
    const onOpenSettings = jest.fn();
    const getCredentials = jest.fn().mockRejectedValue(new Error('none'));
    const { getByTestId } = renderBar(getCredentials, onOpenSettings);

    await waitFor(() => expect(getByTestId('queryCopilotOpenSettings')).toBeTruthy());
    await act(async () => {
      fireEvent.click(getByTestId('queryCopilotOpenSettings'));
    });

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
