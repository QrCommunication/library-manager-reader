import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
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

  it('only allows engine-origin loads through onShouldStartLoadWithRequest', async () => {
    await render(<EngineWebView bridge={fakeBridge} onReload={onReload} onFatal={onFatal} />);
    const gate = (mockWebViewProps as { onShouldStartLoadWithRequest: (r: { url: string }) => boolean }).onShouldStartLoadWithRequest;
    expect(gate({ url: 'about:blank' })).toBe(true);
    expect(gate({ url: 'data:text/html,<b>x</b>' })).toBe(true);
    expect(gate({ url: 'blob:https://origin/uuid' })).toBe(true);
    expect(gate({ url: 'https://evil.example/page' })).toBe(false);
    expect(gate({ url: 'file:///sdcard/evil.html' })).toBe(false);
  });

  it('suppresses the native selection menu so the app popover (with Copier) shows instead', async () => {
    await render(<EngineWebView bridge={fakeBridge} onReload={onReload} onFatal={onFatal} />);
    // contextMenuHidden is gone in react-native-webview 13: an EMPTY custom
    // menuItems list is the supported way to replace the system action mode
    expect(mockWebViewProps?.menuItems).toEqual([]);
  });

  it('reserves the status-bar height above the engine viewport when topInset is set', async () => {
    await render(<EngineWebView bridge={fakeBridge} onReload={onReload} onFatal={onFatal} topInset={24} />);
    const root = screen.getByTestId('engine-root');
    const style = StyleSheet.flatten(root.props.style as never);
    expect(style).toEqual(expect.objectContaining({ top: 24 }));
  });

  it('keeps the engine viewport full-bleed when no topInset is given', async () => {
    await render(<EngineWebView bridge={fakeBridge} onReload={onReload} onFatal={onFatal} />);
    const root = screen.getByTestId('engine-root');
    const style = StyleSheet.flatten(root.props.style as never);
    expect(style).toEqual(expect.objectContaining({ top: 0 }));
  });
});
