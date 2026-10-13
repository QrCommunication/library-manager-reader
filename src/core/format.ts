// Manual MB formatting — no Intl/toLocaleString, which is non-deterministic
// under Node's ICU availability. One decimal, trailing ".0" stripped,
// decimal comma in fr.
export function formatBytes(bytes: number, lang: 'fr' | 'en'): string {
  const mb = Math.round((bytes / (1024 * 1024)) * 10) / 10;
  const fixed = mb.toFixed(1).replace(/\.0$/, '');
  const decimal = lang === 'fr' ? fixed.replace('.', ',') : fixed;
  return `${decimal} ${lang === 'fr' ? 'Mo' : 'MB'}`;
}
