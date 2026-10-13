import i18next, { type i18n as I18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import { en } from './en';
import { fr } from './fr';

export const resources = { en: { translation: en }, fr: { translation: fr } } as const;

export async function initI18n(pref: 'auto' | 'fr' | 'en'): Promise<I18n> {
  const device = getLocales()[0]?.languageCode ?? 'en';
  const lang = pref === 'auto' ? (device === 'fr' ? 'fr' : 'en') : pref;
  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({ resources, lng: lang, fallbackLng: 'en', interpolation: { escapeValue: false } });
  } else {
    await i18next.changeLanguage(lang);
  }
  return i18next;
}
