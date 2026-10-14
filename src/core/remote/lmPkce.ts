// PKCE S256 helpers for the library-manager.com mobile OAuth flow.
// The client is public: no secret ever lives in the app.

export const LM_CLIENT_ID = 'library-manager-mobile';
export const LM_REDIRECT_URI = 'https://library-manager.com/mobile/callback';
export const LM_SCOPES = 'library:read files:read files:write progress:read progress:write';

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export interface PkceChallenge {
  verifier: string;
  challenge: string;
  state: string;
}

export interface PkceDeps {
  random(count: number): Uint8Array;
  sha256Base64url(ascii: string): Promise<string>;
}

export function base64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64URL[b0 >> 2]!;
    out += B64URL[((b0 & 0x03) << 4) | (b1 >> 4)]!;
    if (i + 1 < bytes.length) out += B64URL[((b1 & 0x0f) << 2) | (b2 >> 6)]!;
    if (i + 2 < bytes.length) out += B64URL[b2 & 0x3f]!;
  }
  return out;
}

export function hexToBase64url(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return base64url(bytes);
}

// 32 random bytes -> 43-char verifier (PKCE alphabet), challenge = S256(verifier),
// state from the same deterministic source when injected by tests.
export async function createChallenge(deps: PkceDeps): Promise<PkceChallenge> {
  const verifierBytes = deps.random(32);
  const stateBytes = deps.random(32);
  const verifier = base64url(verifierBytes);
  const challenge = await deps.sha256Base64url(verifier);
  return { verifier, challenge, state: base64url(stateBytes) };
}

export function buildAuthorizationUrl(ch: PkceChallenge, baseUrl = 'https://library-manager.com'): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: LM_CLIENT_ID,
    redirect_uri: LM_REDIRECT_URI,
    code_challenge: ch.challenge,
    code_challenge_method: 'S256',
    state: ch.state,
    scope: LM_SCOPES,
  });
  return `${baseUrl}/api/mobile/oauth/authorize?${params.toString()}`;
}

export interface ParsedCallback {
  code: string | null;
  state: string | null;
  error: string | null;
}

export function parseCallback(url: string): ParsedCallback {
  const q = url.indexOf('?');
  const params = new URLSearchParams(q === -1 ? '' : url.slice(q + 1));
  return {
    code: params.get('code'),
    state: params.get('state'),
    error: params.get('error'),
  };
}
