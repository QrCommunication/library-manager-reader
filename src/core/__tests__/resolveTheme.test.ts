import { resolveTheme } from '../types';

describe('resolveTheme', () => {
  it('passes concrete themes through', () => {
    expect(resolveTheme('day', 'dark')).toBe('day');
    expect(resolveTheme('sepia', 'dark')).toBe('sepia');
    expect(resolveTheme('night', 'light')).toBe('night');
  });

  it('resolves auto from the system scheme', () => {
    expect(resolveTheme('auto', 'dark')).toBe('night');
    expect(resolveTheme('auto', 'light')).toBe('day');
    expect(resolveTheme('auto', null)).toBe('day');
  });
});
