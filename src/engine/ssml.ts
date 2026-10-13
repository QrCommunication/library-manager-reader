// foliate-js's TTS returns serialized SSML fragments (<speak> wrapping the
// sentence, with <mark name="…"/> position markers, <break/>, <emphasis>…);
// expo-speech speaks plain text. DOMParser strips the elements, whitespace
// runs collapse and the ends trim — the result goes verbatim in the
// 'ttsSentence' payload.

export const ssmlToText = (ssml: string): string => {
  const doc = new DOMParser().parseFromString(ssml, 'text/xml');
  return (doc.documentElement.textContent ?? '').replace(/\s+/g, ' ').trim();
};
