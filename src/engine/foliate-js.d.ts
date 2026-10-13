// Minimal ambient declaration for the plain-JS foliate-js View (node_modules/foliate-js/view.js).
// Declares only the members the engine actually uses; `addEventListener`/`append` come from HTMLElement.
declare module 'foliate-js/view.js' {
  export class View extends HTMLElement {
    constructor();
    open(book: Blob): Promise<void>;
    goTo(target: string): Promise<unknown>;
    goToFraction(fraction: number): Promise<void>;
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
