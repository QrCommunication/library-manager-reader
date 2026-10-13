import { formatBytes } from '../format';

describe('formatBytes', () => {
  it('formats zero bytes', () => {
    expect(formatBytes(0, 'fr')).toBe('0 Mo');
  });

  it('formats megabytes with a decimal comma in fr', () => {
    expect(formatBytes(5.3 * 1024 * 1024, 'fr')).toBe('5,3 Mo');
  });

  it('formats megabytes with a decimal point in en', () => {
    expect(formatBytes(5.3 * 1024 * 1024, 'en')).toBe('5.3 MB');
  });
});
