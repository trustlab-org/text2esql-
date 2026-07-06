/**
 * @jest-environment jsdom
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';

import { NoKeyBanner } from './NoKeyBanner';
import { CopilotProvider, useCopilot } from '../../store/copilot.context';
import { ServicesContext, type Services } from '../../services';
import type { MaskedCredentials } from '../../../common/types';

const WITH_KEY: MaskedCredentials = {
  providers: [{ provider: 'anthropic', model: null, endpoint: null, hasKey: true }],
  primaryProvider: 'anthropic',
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

function renderBanner(getCredentials: jest.Mock, onOpenSettings: () => void = jest.fn()) {
  return render(
    <ServicesContext.Provider value={makeServices(getCredentials)}>
      <CopilotProvider>
        <Loader />
        <NoKeyBanner onOpenSettings={onOpenSettings} />
      </CopilotProvider>
    </ServicesContext.Provider>
  );
}

describe('NoKeyBanner', () => {
  it('renders the banner when no usable primary key is configured', async () => {
    const getCredentials = jest.fn().mockRejectedValue(new Error('none'));
    const { getByTestId } = renderBanner(getCredentials);

    await waitFor(() => expect(getByTestId('queryCopilotNoKeyBanner')).toBeTruthy());
    expect(getByTestId('queryCopilotNoKeyBanner').textContent).toContain('No LLM API key');
  });

  it('hides the banner once a usable primary key exists', async () => {
    const getCredentials = jest.fn().mockResolvedValue(WITH_KEY);
    const { queryByTestId } = renderBanner(getCredentials);

    await waitFor(() => expect(getCredentials).toHaveBeenCalled());
    await waitFor(() => expect(queryByTestId('queryCopilotNoKeyBanner')).toBeNull());
  });

  it('fires onOpenSettings when the Open Settings button is clicked', async () => {
    const onOpenSettings = jest.fn();
    const getCredentials = jest.fn().mockRejectedValue(new Error('none'));
    const { getByTestId } = renderBanner(getCredentials, onOpenSettings);

    await waitFor(() => expect(getByTestId('queryCopilotNoKeyOpenSettings')).toBeTruthy());
    await act(async () => {
      fireEvent.click(getByTestId('queryCopilotNoKeyOpenSettings'));
    });

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
