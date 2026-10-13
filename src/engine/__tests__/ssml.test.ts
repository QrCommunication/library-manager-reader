/**
 * @jest-environment jsdom
 */

// ssmlToText is the engine→app TTS payload converter (pure, DOMParser-based):
// foliate-js's TTS returns serialized SSML fragments (<speak> wrapping the
// sentence with <mark name="…"/> position markers, <break/>, <emphasis>…);
// expo-speech on the RN side speaks plain text. Runs of blank space must
// collapse to single spaces and the ends must be trimmed, since the spoken
// string is passed verbatim to the platform TTS engine. The jsdom docblock
// provides the browser DOMParser global (jest-expo's default env is
// node-like; jsdom cannot load inside it).

import { ssmlToText } from '../ssml';

describe('ssmlToText', () => {
  it('strips speak/mark markup and keeps the sentence text', () => {
    expect(ssmlToText('<speak>Hello <mark name="0"/>world.</speak>')).toBe('Hello world.');
  });

  it('collapses whitespace runs and trims both ends', () => {
    expect(ssmlToText('<speak>  One  two\tthree\n\nfour  </speak>')).toBe('One two three four');
  });

  it('handles a realistic foliate fragment: namespace, marks, break, emphasis', () => {
    const ssml = '<speak xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="fr">'
      + '<mark name="0"/>Il était <break/>une fois <emphasis>un</emphasis> château.</speak>';
    expect(ssmlToText(ssml)).toBe('Il était une fois un château.');
  });

  it('keeps accented text intact', () => {
    expect(ssmlToText('<speak>Déjà vu, où ?</speak>')).toBe('Déjà vu, où ?');
  });

  it('returns an empty string for markup-only fragments', () => {
    expect(ssmlToText('<speak><mark name="0"/><break/></speak>')).toBe('');
  });
});
