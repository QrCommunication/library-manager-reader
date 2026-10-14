import type { ThemeName } from '../core/types';

export interface ThemeTokens {
  background: string;
  foreground: string;
  /** secondary text: subtitles, authors, percentages */
  muted: string;
  accent: string;
  /** elevated surfaces: bars, sheets, cards */
  chrome: string;
  /** hairline borders and separators */
  border: string;
  danger: string;
  onAccent: string;
}

export function themeTokens(theme: ThemeName): ThemeTokens {
  switch (theme) {
    case 'sepia':
      return {
        background: '#F4ECD8', foreground: '#3B2F1E', muted: '#8A7A5E',
        accent: '#8B5E34', chrome: '#EFE6D0', border: '#DDD0B4',
        danger: '#A93226', onAccent: '#FFF8EC',
      };
    case 'night':
      return {
        background: '#101314', foreground: '#D7DBDC', muted: '#8A9296',
        accent: '#8FA8CE', chrome: '#1A1F21', border: '#2A3134',
        danger: '#E6B0AA', onAccent: '#101314',
      };
    default:
      return {
        // identity palette from the Library Manager logo: navy #17263D +
        // light gray #E5EAF0; supporting grays cooled to match
        background: '#F7F8FA', foreground: '#1C2430', muted: '#66707D',
        accent: '#17263D', chrome: '#FFFFFF', border: '#DDE2E9',
        danger: '#C0392B', onAccent: '#E5EAF0',
      };
  }
}
