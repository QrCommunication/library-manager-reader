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
        accent: '#7FB4C9', chrome: '#1A1F21', border: '#2A3134',
        danger: '#E6B0AA', onAccent: '#101314',
      };
    default:
      return {
        background: '#FAFAF8', foreground: '#1C1B1A', muted: '#6B6963',
        accent: '#2D6CDF', chrome: '#FFFFFF', border: '#E4E2DD',
        danger: '#C0392B', onAccent: '#FFFFFF',
      };
  }
}
