import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { LmAuthSheet } from '../LmAuthSheet';

const mockCaptured: { current: { source: { uri: string }; onShouldStartLoadWithRequest: (req: { url: string }) => boolean } | null } = { current: null };

jest.mock('react-native-webview', () => ({
  __esModule: true,
  default: (props: { source: { uri: string }; onShouldStartLoadWithRequest: (req: { url: string }) => boolean }) => {
    mockCaptured.current = props;
    return null;
  },
}));

const AUTHORIZE = 'https://library-manager.com/api/mobile/oauth/authorize?response_type=code&client_id=library-manager-mobile&state=abc';
const CALLBACK = 'https://library-manager.com/mobile/callback?code=lmc_123&state=abc';

describe('LmAuthSheet', () => {
  beforeAll(async () => {
    const { initI18n } = require('../../../i18n');
    await initI18n('fr');
  });

  beforeEach(() => {
    mockCaptured.current = null;
  });

  it('loads the authorize URL and intercepts the callback navigation, handing over the full URL', async () => {
    const onComplete = jest.fn();
    const onClose = jest.fn();
    render(<LmAuthSheet visible url={AUTHORIZE} onClose={onClose} onComplete={onComplete} />);
    // React 19 defers reconciliation past render(): waitFor flushes until mounted
    await waitFor(() => expect(mockCaptured.current).not.toBeNull());
    expect(mockCaptured.current!.source.uri).toBe(AUTHORIZE);

    const allow = mockCaptured.current!.onShouldStartLoadWithRequest({ url: CALLBACK });
    expect(allow).toBe(false);
    expect(onComplete).toHaveBeenCalledWith(CALLBACK);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('lets every other navigation through untouched', async () => {
    const onComplete = jest.fn();
    render(<LmAuthSheet visible url={AUTHORIZE} onClose={jest.fn()} onComplete={onComplete} />);
    await waitFor(() => expect(mockCaptured.current).not.toBeNull());
    expect(mockCaptured.current!.onShouldStartLoadWithRequest({ url: 'https://library-manager.com/login' })).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('calls onClose when the close button is pressed', async () => {
    const onClose = jest.fn();
    render(<LmAuthSheet visible url={AUTHORIZE} onClose={onClose} onComplete={jest.fn()} />);
    // flush the deferred commit first: `screen` binds only once render has settled
    await waitFor(() => expect(mockCaptured.current).not.toBeNull());
    fireEvent.press(await screen.findByLabelText('Fermer'));
    expect(onClose).toHaveBeenCalled();
  });
});
