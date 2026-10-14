export type KoSyncErrorKind = 'auth' | 'network' | 'server';

export class KoSyncError extends Error {
  constructor(readonly kind: KoSyncErrorKind, message: string) {
    super(message);
    this.name = 'KoSyncError';
  }
}
