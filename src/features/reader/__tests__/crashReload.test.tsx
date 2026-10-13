import React from 'react';
import { act, render } from '@testing-library/react-native';
import { EngineWebView } from '../EngineWebView';

// module-level state captured by the jest.mock factory below (jest hoists the
// factory, so factory-scope variables must start with "mock"; the mocks are
// only dereferenced at render time, after module init has completed).
let mockWebViewProps: Record<string, unknown> | null = null;
const mockReload = jest.fn();
const mockPostMessage = jest.fn();

jest.mock('react-native-webview', () => {
  const React = require('react');
  return {
    __esModule: true,
    WebView: React.forwardRef(function MockWebView(props: Record<string, unknown>, ref: React.Ref<unknown>) {
      mockWebViewProps = props;
      React.useImperativeHandle(ref, () => ({ reload: mockReload, postMessage: mockPostMessage }));
      return React.createElement('View', { testID: 'mock-webview' });
    }),
  };
});

const fakeBridge = { handleRaw: jest.fn() } as never;

// EngineWebView renders no localized text, so no i18n init is needed here.

describe('EngineWebView crash recovery', () => {
  let onReload: jest.Mock;
  let onFatal: jest.Mock;

  beforeEach(() => {
    mockWebViewProps = null;
    mockReload.mockClear();
    mockPostMessage.mockClear();
    onReload = jest.fn();
    onFatal = jest.fn();
  });

  const crash = async () => {
    const props = mockWebViewProps as { onRenderProcessGone: (e: unknown) => void };
    await act(async () => { props.onRenderProcessGone({}); });
  };

  it('reloads once on the first render-process crash and notifies onReload', async () => {
    await render(<EngineWebView bridge={fakeBridge} onReload={onReload} onFatal={onFatal} />);
    await crash();
    expect(mockReload).toHaveBeenCalledTimes(1);
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onFatal).not.toHaveBeenCalled();
  });

  it('goes fatal on the second crash without reloading again', async () => {
    await render(<EngineWebView bridge={fakeBridge} onReload={onReload} onFatal={onFatal} />);
    await crash();
    await crash();
    expect(mockReload).toHaveBeenCalledTimes(1);
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
