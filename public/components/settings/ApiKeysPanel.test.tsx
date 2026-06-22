/**
 * @jest-environment jsdom
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react';

import { ApiKeysPanel } from './ApiKeysPanel';
import { loadCredentials } from '../../services/credentials.store';

describe('ApiKeysPanel', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the keys form with primary api key + save/clear controls', () => {
    const { getByTestId } = render(<ApiKeysPanel onClose={jest.fn()} />);

    expect(getByTestId('queryCopilotApiKeysPanel')).toBeTruthy();
    expect(getByTestId('queryCopilotPrimaryApiKey')).toBeTruthy();
    expect(getByTestId('queryCopilotSaveKeysButton')).toBeTruthy();
    expect(getByTestId('queryCopilotClearKeysButton')).toBeTruthy();
  });

  it('save persists the primary credential and closes', () => {
    const onClose = jest.fn();
    const { getByTestId } = render(<ApiKeysPanel onClose={onClose} />);

    fireEvent.change(getByTestId('queryCopilotPrimaryApiKey'), { target: { value: 'sk-abc' } });
    fireEvent.click(getByTestId('queryCopilotSaveKeysButton'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(loadCredentials()).toEqual({ primary: { provider: 'anthropic', apiKey: 'sk-abc' } });
  });

  it('blocks save (no close, no persist) when a non-ollama provider has no key', () => {
    const onClose = jest.fn();
    const { getByTestId } = render(<ApiKeysPanel onClose={onClose} />);

    fireEvent.click(getByTestId('queryCopilotSaveKeysButton'));

    expect(onClose).not.toHaveBeenCalled();
    expect(loadCredentials()).toBeNull();
  });

  it('hides the api key field and shows an endpoint field when ollama is selected', () => {
    const { getByTestId, queryByTestId } = render(<ApiKeysPanel onClose={jest.fn()} />);

    fireEvent.change(getByTestId('queryCopilotPrimaryProvider'), { target: { value: 'ollama' } });

    expect(queryByTestId('queryCopilotPrimaryApiKey')).toBeNull();
    expect(getByTestId('queryCopilotPrimaryEndpoint')).toBeTruthy();
  });

  it('saves ollama without an api key (closes + persists)', () => {
    const onClose = jest.fn();
    const { getByTestId } = render(<ApiKeysPanel onClose={onClose} />);

    fireEvent.change(getByTestId('queryCopilotPrimaryProvider'), { target: { value: 'ollama' } });
    fireEvent.click(getByTestId('queryCopilotSaveKeysButton'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(loadCredentials()).toEqual({ primary: { provider: 'ollama' } });
  });

  it('clear keys removes the persisted bundle', () => {
    const { getByTestId } = render(<ApiKeysPanel onClose={jest.fn()} />);

    fireEvent.change(getByTestId('queryCopilotPrimaryApiKey'), { target: { value: 'sk-abc' } });
    fireEvent.click(getByTestId('queryCopilotSaveKeysButton'));
    expect(loadCredentials()).not.toBeNull();

    render(<ApiKeysPanel onClose={jest.fn()} />);
    const clearButtons = document.querySelectorAll('[data-test-subj="queryCopilotClearKeysButton"]');
    fireEvent.click(clearButtons[clearButtons.length - 1]);

    expect(loadCredentials()).toBeNull();
  });
});
