import { renderHook, waitFor } from '@testing-library/react-native';
import { useReaderSession } from '../useReaderSession';

const book = { id: 'b1', title: 'T', format: 'epub' as const, fileName: 'b1.epub', fileSize: 10 };

const makeDeps = () => {
  const calls: string[] = [];
  return {
    calls,
    getBook: async () => book,
    getProgress: async () => ({ bookId: 'b1', cfi: 'c7', fraction: 0.7, sectionIndex: 3, updatedAt: 1 }),
    fileExists: async () => true,
    bookPath: (fileName: string) => `/books/${fileName}`,
    saveProgress: async () => { calls.push('save'); },
    touchLastRead: async () => { calls.push('touch'); },
    makeBridge: () => ({
      openBook: async () => { calls.push('open'); return { toc: [{ label: 'C1', target: 'h1' }], metadata: { title: 'T', author: null, language: null, publisher: null, identifier: null, coverJpegBase64: null } }; },
      goTo: (t: string) => { calls.push(`goTo:${t}`); },
      goToFraction: (f: number) => { calls.push(`goToFraction:${f}`); },
      applySettings: () => { calls.push('settings'); },
      onProgress: () => () => {},
      onEngineError: () => () => {},
      whenReady: async () => 1,
    }),
  };
};

describe('useReaderSession', () => {
  it('opens the book and resumes at saved cfi', async () => {
    const deps = makeDeps();
    const { result } = await renderHook(() => useReaderSession('b1', deps as never));
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(deps.calls).toContain('open');
    expect(deps.calls).toContain('settings');
    expect(deps.calls).toContain('goTo:c7');
  });

  it('flags a missing file', async () => {
    const deps = makeDeps();
    deps.fileExists = async () => false;
    const { result } = await renderHook(() => useReaderSession('b1', deps as never));
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.errorKind).toBe('missing');
  });
});
