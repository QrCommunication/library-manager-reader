jest.mock('expo-crypto', () => {
  const { createHash } = require('node:crypto');
  const digest = async (algorithm: string, data: BufferSource): Promise<ArrayBuffer> => {
    if (algorithm !== 'SHA-256') throw new Error(`unexpected algorithm ${algorithm}`);
    const hashed = createHash('sha256').update(new Uint8Array(data as ArrayBuffer)).digest();
    return hashed.buffer.slice(hashed.byteOffset, hashed.byteOffset + hashed.byteLength);
  };
  return { __esModule: true, CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest, getRandomValues: (arr: Uint8Array) => { require('node:crypto').webcrypto.getRandomValues(arr); return arr; } };
});

import { sha256HexOfBytes, sha256Base64urlOfAscii, lmCrypto } from '../lmSha256';

describe('sha256 helpers', () => {
  it('hashes bytes to lowercase hex (RFC 8439 vectors)', async () => {
    const abc = new TextEncoder().encode('abc');
    await expect(sha256HexOfBytes(abc)).resolves.toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    await expect(sha256HexOfBytes(new Uint8Array(0))).resolves.toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('produces the PKCE challenge: base64url of the SHA-256 of the ascii verifier', async () => {
    // cross-checked with: openssl dgst -sha256 -binary | basenc --base64url | tr -d '='
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    await expect(sha256Base64urlOfAscii(verifier)).resolves.toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('exposes the LmCrypto port used by the PKCE flow', async () => {
    const random = lmCrypto.random(4);
    expect(random).toBeInstanceOf(Uint8Array);
    expect(random).toHaveLength(4);
    const challenge = await lmCrypto.sha256Base64url('abc');
    expect(challenge).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
  });
});
