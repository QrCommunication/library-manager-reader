import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { ReaderScreen } from '../ReaderScreen';
import { ServicesProvider } from '../../../core/services';
import { initI18n } from '../../../i18n';

// Seam test: REAL ReaderBridge + REAL bridge.ts protocol handling; only the RN
// WebView surface is mocked. The mock boots the engine protocol from inside the
// "page": on mount it sends engineReady through props.onMessage, and its
// postMessage side answers data chunks with dataAck and dataEnd with bookLoaded
// (message shapes from src/core/bridge/protocol.ts + src/engine/engine.ts).

type SeamOnMessage = (e: { nativeEvent: { data: string } }) => void;
let mockMounted = 0;
let mockPosted: string[] = [];
let mockLatestProps: { onMessage: SeamOnMessage } | null = null;
let mockFailOpen = false;

jest.mock('react-native-webview', () => {
  const React = require('react');
  const sendToBridge = (onMessage: { onMessage: SeamOnMessage } | null, msg: unknown) => {
    onMessage?.onMessage({ nativeEvent: { data: JSON.stringify(msg) } });
  };
  return {
    __esModule: true,
    WebView: React.forwardRef(function SeamWebView(props: { onMessage: SeamOnMessage }, ref: React.Ref<unknown>) {
      mockLatestProps = props;
      React.useEffect(() => {
        mockMounted += 1;
        // engine boot: the page announces itself as soon as it exists
        sendToBridge(props, { type: 'engineReady', protocolVersion: 1 });
      }, []);
      React.useImperativeHandle(ref, () => ({
        postMessage: (raw: string) => {
          mockPosted.push(raw);
          const msg = JSON.parse(raw) as { type: string; seq?: number };
          if (msg.type === 'data') sendToBridge(mockLatestProps, { type: 'dataAck', seq: msg.seq });
          if (msg.type === 'dataEnd') {
            sendToBridge(mockLatestProps, mockFailOpen
              ? { type: 'engineError', code: 'open_failed', message: 'boom' }
              : {
                  type: 'bookLoaded',
                  toc: [{ label: 'C1', target: 'h1' }],
                  metadata: { title: 'Dune', author: null, language: null, publisher: null, identifier: null, coverJpegBase64: null },
                });
          }
        },
        reload: () => {},
      }));
      return React.createElement('View', { testID: 'seam-webview' });
    }),
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));

const fakeFs = () => ({
  freeDiskBytes: async () => 1e9, ensureDir: async () => {}, copy: async () => {}, exists: async () => true,
  remove: async () => {}, fileSize: async () => 4, writeBase64: async () => {},
  // one real chunk so openBook exercises the data/dataAck path
  readBase64Chunks: async (_p: string, _chunkSize: number, onChunk: (b64: string) => Promise<void>) => { await onChunk('QQ=='); },
  directorySize: async () => 0,
});

const makeServices = async () => {
  const { DatabaseSync } = require('node:sqlite');
  const { createNodeSqliteDriver } = require('../../../db/nodeSqliteDriver');
  const { migrate } = require('../../../db/migrate');
  const { createServices } = require('../../../core/services');
  const db = createNodeSqliteDriver(new DatabaseSync(':memory:'));
  await migrate(db);
  const services = createServices({ db, fs: fakeFs(), root: '/doc', newId: (() => { let i = 0; return () => `id-${++i}`; })() });
  await services.books.createBook({ id: 'b1', title: 'Dune', author: null, format: 'epub', originalFormat: null, fileName: 'b1.epub', fileSize: 4, language: null, publisher: null, drmIdentifier: null, addedAt: 1, updatedAt: 1, deletedAt: null, lastReadAt: null });
  return services;
};

describe('ReaderScreen engine seam', () => {
  beforeAll(async () => {
    await initI18n('fr');
  });

  beforeEach(() => {
    mockMounted = 0;
    mockPosted = [];
    mockLatestProps = null;
    mockFailOpen = false;
  });

  it('mounts the engine webview during loading and reaches the ready UI', async () => {
    const services = await makeServices();
    await render(
      <ServicesProvider value={services}>
        <ReaderScreen bookId="b1" />
      </ServicesProvider>,
    );
    // the WebView (and therefore its engineReady) must exist while the session
    // is still 'loading' — the ready-gate depends on it
    await waitFor(() => expect(mockMounted).toBeGreaterThan(0));
    // openBook must have been sent through the mounted page
    await waitFor(() => expect(mockPosted.some((m) => m.includes('"openBook"'))).toBe(true));
    // the session must settle on the ready UI (no spinner, no error panel)
    await waitFor(() => expect(screen.queryByText('Chargement…')).toBeNull(), { timeout: 5000 });
    expect(screen.queryByText('Impossible d’ouvrir ce livre')).toBeNull();
    expect(screen.queryByText('Réessayer')).toBeNull();
  });

  it('remounts a fresh engine page on retry so the new bridge receives engineReady', async () => {
    const services = await makeServices();
    // first open fails at the engine level (armed before mount so the first
    // openBook transaction is the failing one)
    mockFailOpen = true;
    await render(
      <ServicesProvider value={services}>
        <ReaderScreen bookId="b1" />
      </ServicesProvider>,
    );
    await waitFor(() => expect(mockPosted.some((m) => m.includes('"dataEnd"'))).toBe(true));
    fireEvent.press(await screen.findByText('Réessayer'));
    // retry goes back through loading — the fresh page must mount and re-open
    mockFailOpen = false;
    await waitFor(() => expect(mockMounted).toBe(2));
    await waitFor(() => expect(screen.queryByText('Chargement…')).toBeNull(), { timeout: 5000 });
    expect(screen.queryByText('Impossible d’ouvrir ce livre')).toBeNull();
    expect(mockPosted.filter((m) => m.includes('"openBook"'))).toHaveLength(2);
  });
});
