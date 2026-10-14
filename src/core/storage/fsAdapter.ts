export interface FsAdapter {
  freeDiskBytes(): Promise<number>;
  ensureDir(path: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  fileSize(path: string): Promise<number>;
  writeBase64(path: string, b64: string): Promise<void>;
  writeText(path: string, text: string): Promise<void>;
  readBase64Chunks(path: string, chunkSize: number, onChunk: (b64: string) => Promise<void>): Promise<void>;
  /** byte-range read for the KOReader partial-MD5 digest; null past EOF */
  readRange(path: string, offset: number, length: number): Promise<Uint8Array | null>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  directorySize(path: string): Promise<number>;
}
