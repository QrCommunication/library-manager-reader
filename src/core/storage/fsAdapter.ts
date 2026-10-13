export interface FsAdapter {
  freeDiskBytes(): Promise<number>;
  ensureDir(path: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  fileSize(path: string): Promise<number>;
  writeBase64(path: string, b64: string): Promise<void>;
  readBase64Chunks(path: string, chunkSize: number, onChunk: (b64: string) => Promise<void>): Promise<void>;
  directorySize(path: string): Promise<number>;
}
