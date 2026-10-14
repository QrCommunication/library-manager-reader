// Binary SHA-256 helpers over expo-crypto's native digest (digestStringAsync
// is UTF-8-only and would corrupt binary book hashes). Feeds PKCE challenges
// and the download/upload integrity checks.

import * as Crypto from 'expo-crypto';
import { base64url } from './lmPkce';
import type { PkceDeps } from './lmPkce';

export async function sha256Digest(bytes: Uint8Array): Promise<Uint8Array> {
  const buffer = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes as Uint8Array<ArrayBuffer>);
  return new Uint8Array(buffer);
}

export async function sha256HexOfBytes(bytes: Uint8Array): Promise<string> {
  const digest = await sha256Digest(bytes);
  let hex = '';
  for (const b of digest) hex += b.toString(16).padStart(2, '0');
  return hex;
}

// manual ascii walk: TextEncoder availability is fine in Hermes, but the
// PKCE verifier is ASCII by construction and charCodeAt keeps this dependency-free
export async function sha256Base64urlOfAscii(ascii: string): Promise<string> {
  const bytes = new Uint8Array(ascii.length);
  for (let i = 0; i < ascii.length; i++) bytes[i] = ascii.charCodeAt(i) & 0xff;
  return base64url(await sha256Digest(bytes));
}

/** crypto port consumed by the PKCE flow (injected, so tests drive determinism) */
export const lmCrypto: Pick<PkceDeps, 'random' | 'sha256Base64url'> = {
  random: (count: number) => {
    const bytes = new Uint8Array(count);
    Crypto.getRandomValues(bytes);
    return bytes;
  },
  sha256Base64url: sha256Base64urlOfAscii,
};
