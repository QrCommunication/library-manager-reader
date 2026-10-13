import { createContext, useContext } from 'react';
import { themeTokens, type ThemeTokens } from './tokens';

// Reader surfaces (bars, drawers, panels, popover) follow the READER theme so a
// night reading session never pops white chrome. Components outside a reader
// screen fall back to day tokens.
const ReaderThemeContext = createContext<ThemeTokens>(themeTokens('day'));

export const ReaderThemeProvider = ReaderThemeContext.Provider;

export function useReaderTheme(): ThemeTokens {
  return useContext(ReaderThemeContext);
}
