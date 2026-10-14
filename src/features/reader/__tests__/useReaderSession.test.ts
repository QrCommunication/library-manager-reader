import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useReaderSession } from '../useReaderSession';

const book = { id: 'b1', title: 'T', format: 'epub' as const, fileName: 'b1.epub', fileSize: 10 };

const makeDeps = () => {
  const calls: string[] = [];
  const state = {
    openArgs: null as { format: string; path: string; size: number; resume?: { cfi?: string | null; fraction?: number } | null } | null,
  };
  return {
    calls,
    state,
    getBook: async () => book,
    getProgress: async () => ({ bookId: 'b1', cfi: 'c7', fraction: 0.7, sectionIndex: 3, updatedAt: 1 }),
    fileExists: async () => true,
    bookPath: (fileName: string) => `/books/${fileName}`,
    saveProgress: async () => { calls.push('save'); },
    touchLastRead: async () => { calls.push('touch'); },
    makeBridge: () => ({
      openBook: async (args: { format: string; path: string; size: number; resume?: { cfi?: string | null; fraction?: number } | null }) => {
        state.openArgs = args;
        calls.push('open');
        return { toc: [{ label: 'C1', target: 'h1' }], metadata: { title: 'T', author: null, language: null, publisher: null, identifier: null, coverJpegBase64: null } };
      },
      goTo: (t: string) => { calls.push(`goTo:${t}`); },
      goToFraction: (f: number) => { calls.push(`goToFraction:${f}`); },
      applySettings: () => { calls.push('settings'); },
      onProgress: () => () => {},
      onEngineError: () => () => {},
      onResumeApplied: () => { calls.push('resumeApplied'); },
      whenReady: async () => 1,
    }),
  };
};

describe('useReaderSession', () => {
  it('hands the saved position to openBook as the resume target (engine applies it inside init)', async () => {
    const deps = makeDeps();
    const { result } = await renderHook(() => useReaderSession('b1', deps as never));
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(deps.calls).toContain('open');
    expect(deps.calls).toContain('settings');
    expect(deps.state.openArgs?.resume).toEqual({ cfi: 'c7', fraction: 0.7 });
    // resume navigation is engine-side now: no post-open goTo burst
    expect(deps.calls).not.toContain('goTo:c7');
    expect(deps.calls).not.toContain('goToFraction');
  });

  it('flags a missing file', async () => {
    const deps = makeDeps();
    deps.fileExists = async () => false;
    const { result } = await renderHook(() => useReaderSession('b1', deps as never));
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.errorKind).toBe('missing');
  });

  it('drops a progress event that arrives before the resume is applied and still hands it to openBook', async () => {
    const deps = makeDeps();
    let releaseOpen!: () => void;
    const openGate = new Promise<void>((resolve) => { releaseOpen = resolve; });
    let progressCb: ((p: { cfi: string | null; fraction: number; sectionIndex: number | null }) => void) | null = null;
    const gatedBridge = deps.makeBridge();
    deps.makeBridge = () => ({
      ...gatedBridge,
      openBook: async (args: { format: string; path: string; size: number; resume?: { cfi?: string | null; fraction?: number } | null }) => {
        deps.state.openArgs = args;
        deps.calls.push('open');
        await openGate;
        return { toc: [{ label: 'C1', target: 'h1' }], metadata: { title: 'T', author: null, language: null, publisher: null, identifier: null, coverJpegBase64: null } };
      },
      onProgress: (cb: (p: { cfi: string | null; fraction: number; sectionIndex: number | null }) => void) => {
        progressCb = cb;
        return () => {};
      },
    } as typeof gatedBridge);
    const { result } = await renderHook(() => useReaderSession('b1', deps as never));
    await waitFor(() => expect(progressCb).not.toBeNull());
    // foliate emits an early relocate (fraction≈0) while the engine-side resume
    // has not been applied yet: it must not clobber the row
    await act(async () => { progressCb!({ cfi: null, fraction: 0.01, sectionIndex: 0 }); });
    expect(deps.calls).not.toContain('save');
    expect(deps.calls).not.toContain('touch');
    await act(async () => { releaseOpen(); });
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(deps.state.openArgs?.resume).toEqual({ cfi: 'c7', fraction: 0.7 });
    expect(deps.calls).not.toContain('save');
  });

  it('exposes the book language from the engine metadata (drives the TTS voice)', async () => {
    const deps = makeDeps();
    const base = deps.makeBridge();
    deps.makeBridge = () => ({
      ...base,
      openBook: async () => ({ toc: [{ label: 'C1', target: 'h1' }], metadata: { title: 'T', author: null, language: 'fr' as string | null, publisher: null, identifier: null, coverJpegBase64: null } }),
    } as typeof base);
    const { result } = await renderHook(() => useReaderSession('b1', deps as never));
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.language).toBe('fr');
  });
});
