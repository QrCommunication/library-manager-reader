import {
  LM_CLIENT_ID, LM_REDIRECT_URI, LM_SCOPES,
  base64url, hexToBase64url, createChallenge, buildAuthorizationUrl, parseCallback,
} from '../lmPkce';

describe('pkce primitives', () => {
  it('encodes bytes as unpadded base64url', () => {
    expect(base64url(new Uint8Array([0, 1, 2, 250, 251]))).toBe('AAEC-vs');
    expect(base64url(new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]))).toBe('qrvM3Q');
  });

  it('converts hex digests to base64url', () => {
    expect(hexToBase64url('aabbccdd')).toBe('qrvM3Q');
  });

  it('builds a challenge from deterministic entropy and digest', async () => {
    const ch = await createChallenge({
      random: (n) => new Uint8Array(n).fill(1),
      sha256Base64url: async () => 'AP8Q',
    });
    expect(ch.verifier).toBe(base64url(new Uint8Array(32).fill(1)));
    expect(ch.verifier.length).toBe(43);
    expect(ch.challenge).toBe('AP8Q');
    expect(ch.state).toBe(ch.verifier);
  });
});

describe('authorization url + callback', () => {
  const ch = { verifier: 'v'.repeat(43), challenge: 'ch-alg', state: 'st-123' };

  it('builds the authorize url with S256 and the public client', () => {
    const url = buildAuthorizationUrl(ch);
    expect(url.startsWith('https://library-manager.com/api/mobile/oauth/authorize?')).toBe(true);
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    expect(params.get('response_type')).toBe('code');
    expect(params.get('client_id')).toBe(LM_CLIENT_ID);
    expect(params.get('redirect_uri')).toBe(LM_REDIRECT_URI);
    expect(params.get('code_challenge')).toBe('ch-alg');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('state')).toBe('st-123');
    expect(params.get('scope')).toBe(LM_SCOPES);
  });

  it('parses code and state from the callback url', () => {
    expect(parseCallback('https://library-manager.com/mobile/callback?code=abc-1&state=st-123'))
      .toEqual({ code: 'abc-1', state: 'st-123', error: null });
  });

  it('parses an oauth error return and a callback without query', () => {
    expect(parseCallback('https://library-manager.com/mobile/callback?error=access_denied&state=st-123'))
      .toEqual({ code: null, state: 'st-123', error: 'access_denied' });
    expect(parseCallback('https://library-manager.com/mobile/callback').code).toBeNull();
  });
});
