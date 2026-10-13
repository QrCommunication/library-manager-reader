export interface LookupLanguage {
  code: string; // ISO 639-1
  wiktionary: string; // sous-domaine de l'édition Wiktionary
  label: { fr: string; en: string };
}

// Langues souveraines d'Europe (≈45) — la source de traduction est la langue
// du livre, la cible est la langue de l'interface (fr|en).
export const LOOKUP_LANGUAGES: LookupLanguage[] = [
  { code: 'sq', wiktionary: 'sq', label: { fr: 'Albanais', en: 'Albanian' } },
  { code: 'de', wiktionary: 'de', label: { fr: 'Allemand', en: 'German' } },
  { code: 'en', wiktionary: 'en', label: { fr: 'Anglais', en: 'English' } },
  { code: 'hy', wiktionary: 'hy', label: { fr: 'Arménien', en: 'Armenian' } },
  { code: 'az', wiktionary: 'az', label: { fr: 'Azéri', en: 'Azerbaijani' } },
  { code: 'eu', wiktionary: 'eu', label: { fr: 'Basque', en: 'Basque' } },
  { code: 'be', wiktionary: 'be', label: { fr: 'Biélorusse', en: 'Belarusian' } },
  { code: 'bs', wiktionary: 'bs', label: { fr: 'Bosnien', en: 'Bosnian' } },
  { code: 'bg', wiktionary: 'bg', label: { fr: 'Bulgare', en: 'Bulgarian' } },
  { code: 'ca', wiktionary: 'ca', label: { fr: 'Catalan', en: 'Catalan' } },
  { code: 'hr', wiktionary: 'hr', label: { fr: 'Croate', en: 'Croatian' } },
  { code: 'da', wiktionary: 'da', label: { fr: 'Danois', en: 'Danish' } },
  { code: 'es', wiktionary: 'es', label: { fr: 'Espagnol', en: 'Spanish' } },
  { code: 'et', wiktionary: 'et', label: { fr: 'Estonien', en: 'Estonian' } },
  { code: 'fi', wiktionary: 'fi', label: { fr: 'Finnois', en: 'Finnish' } },
  { code: 'fr', wiktionary: 'fr', label: { fr: 'Français', en: 'French' } },
  { code: 'gl', wiktionary: 'gl', label: { fr: 'Galicien', en: 'Galician' } },
  { code: 'cy', wiktionary: 'cy', label: { fr: 'Gallois', en: 'Welsh' } },
  { code: 'gd', wiktionary: 'gd', label: { fr: 'Écossais (gaélique)', en: 'Scottish Gaelic' } },
  { code: 'ka', wiktionary: 'ka', label: { fr: 'Géorgien', en: 'Georgian' } },
  { code: 'el', wiktionary: 'el', label: { fr: 'Grec', en: 'Greek' } },
  { code: 'hu', wiktionary: 'hu', label: { fr: 'Hongrois', en: 'Hungarian' } },
  { code: 'ga', wiktionary: 'ga', label: { fr: 'Irlandais', en: 'Irish' } },
  { code: 'is', wiktionary: 'is', label: { fr: 'Islandais', en: 'Icelandic' } },
  { code: 'it', wiktionary: 'it', label: { fr: 'Italien', en: 'Italian' } },
  { code: 'lv', wiktionary: 'lv', label: { fr: 'Letton', en: 'Latvian' } },
  { code: 'lt', wiktionary: 'lt', label: { fr: 'Lituanien', en: 'Lithuanian' } },
  { code: 'lb', wiktionary: 'lb', label: { fr: 'Luxembourgeois', en: 'Luxembourgish' } },
  { code: 'mk', wiktionary: 'mk', label: { fr: 'Macédonien', en: 'Macedonian' } },
  { code: 'mt', wiktionary: 'mt', label: { fr: 'Maltais', en: 'Maltese' } },
  { code: 'no', wiktionary: 'no', label: { fr: 'Norvégien', en: 'Norwegian' } },
  { code: 'nl', wiktionary: 'nl', label: { fr: 'Néerlandais', en: 'Dutch' } },
  { code: 'pl', wiktionary: 'pl', label: { fr: 'Polonais', en: 'Polish' } },
  { code: 'pt', wiktionary: 'pt', label: { fr: 'Portugais', en: 'Portuguese' } },
  { code: 'ro', wiktionary: 'ro', label: { fr: 'Roumain', en: 'Romanian' } },
  { code: 'ru', wiktionary: 'ru', label: { fr: 'Russe', en: 'Russian' } },
  { code: 'sr', wiktionary: 'sr', label: { fr: 'Serbe', en: 'Serbian' } },
  { code: 'sk', wiktionary: 'sk', label: { fr: 'Slovaque', en: 'Slovak' } },
  { code: 'sl', wiktionary: 'sl', label: { fr: 'Slovène', en: 'Slovenian' } },
  { code: 'sv', wiktionary: 'sv', label: { fr: 'Suédois', en: 'Swedish' } },
  { code: 'cs', wiktionary: 'cs', label: { fr: 'Tchèque', en: 'Czech' } },
  { code: 'tr', wiktionary: 'tr', label: { fr: 'Turc', en: 'Turkish' } },
  { code: 'uk', wiktionary: 'uk', label: { fr: 'Ukrainien', en: 'Ukrainian' } },
];

export function byCode(code: string): LookupLanguage | null {
  return LOOKUP_LANGUAGES.find((l) => l.code === code.toLowerCase()) ?? null;
}

export function wiktionarySubdomain(lang: string | null): string {
  const base = lang?.split('-')[0]?.toLowerCase() ?? '';
  return byCode(base)?.wiktionary ?? 'en';
}
