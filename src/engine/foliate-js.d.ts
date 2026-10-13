// Minimal ambient declaration for the plain-JS foliate-js View (node_modules/foliate-js/view.js).
// Declares only the members the engine actually uses; `addEventListener`/`append` come from HTMLElement.
declare module 'foliate-js/view.js' {
  export class View extends HTMLElement {
    constructor();
    open(book: Blob): Promise<void>;
    goTo(target: string): Promise<unknown>;
    goToFraction(fraction: number): Promise<void>;
    getCFI(index: number, range: Range): string;
    resolveNavigation(target: string): Promise<{ index: number; anchor?: unknown }>;
    addAnnotation(annotation: { id?: string; value: string }, remove?: boolean): Promise<{ index: number; label?: string }>;
    deleteAnnotation(annotation: { id?: string; value: string }): Promise<{ index: number; label?: string }>;
    clearSearch(): void;
    search(opts: { query: string; index?: number; caseDiacriticsInsensitive?: boolean; caseSensitive?: boolean; defaultLocale?: string }): AsyncGenerator<
      { progress: number } | { label?: string; subitems: { cfi: string; excerpt: string }[] } | { cfi: string; excerpt: string } | 'done',
      void,
      unknown
    >;
    tts?: unknown;
    book?: {
      toc?: unknown;
      metadata?: {
        title?: string;
        author?: string;
        language?: string;
        publisher?: string;
        identifier?: string;
      };
    };
    renderer: {
      next(): Promise<void>;
      prev(): Promise<void>;
      setStyles?(css: string): void;
      getContents(): { index: number; doc?: Document }[];
    };
  }
}

declare module 'foliate-js/overlayer.js' {
  export class Overlayer {
    static highlight(rects: unknown, options?: { color?: string }): unknown;
    static underline(rects: unknown, options?: { color?: string }): unknown;
    constructor(doc: Document);
  }
}
