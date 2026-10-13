import type { ThemeName } from '../core/types';

export interface ThemeTokens { background: string; foreground: string; accent: string; chrome: string }

export function themeTokens(theme: ThemeName): ThemeTokens {
  switch (theme) {
    case 'sepia': return { background: '#F4ECD8', foreground: '#3B2F1E', accent: '#8B5E34', chrome: '#EAE0C8' };
    case 'night': return { background: '#101314', foreground: '#D7DBDC', accent: '#7FB4C9', chrome: '#1A1F21' };
    default: return { background: '#FFFFFF', foreground: '#1A1A1A', accent: '#2D6CDF', chrome: '#F0F0F0' };
  }
}
