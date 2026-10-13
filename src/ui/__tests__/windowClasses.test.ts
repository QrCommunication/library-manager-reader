import { isLandscape, libraryColumns, panelLayout, windowSizeClass } from '../windowClasses';

describe('windowSizeClass', () => {
  it('is compact below 600 dp (Fold cover closed, S Ultra, phones portrait)', () => {
    expect(windowSizeClass(344)).toBe('compact');
    expect(windowSizeClass(374)).toBe('compact');
    expect(windowSizeClass(427)).toBe('compact');
    expect(windowSizeClass(599)).toBe('compact');
  });

  it('is medium from 600 dp (Fold inner open, small tablets portrait)', () => {
    expect(windowSizeClass(600)).toBe('medium');
    expect(windowSizeClass(697)).toBe('medium');
    expect(windowSizeClass(839)).toBe('medium');
  });

  it('is expanded from 840 dp (tablets landscape, desktop-class windows)', () => {
    expect(windowSizeClass(840)).toBe('expanded');
    expect(windowSizeClass(1194)).toBe('expanded');
  });
});

describe('isLandscape', () => {
  it('detects orientation from width vs height', () => {
    expect(isLandscape(800, 400)).toBe(true);
    expect(isLandscape(400, 800)).toBe(false);
    expect(isLandscape(600, 600)).toBe(false);
  });
});

describe('libraryColumns', () => {
  it('keeps at least 2 columns on narrow screens', () => {
    expect(libraryColumns(320)).toBe(2);
    expect(libraryColumns(374)).toBe(2);
  });

  it('grows with window width (~180 dp per cover)', () => {
    expect(libraryColumns(600)).toBe(3);
    expect(libraryColumns(840)).toBe(4);
    expect(libraryColumns(1194)).toBe(6);
  });

  it('caps at 6 columns', () => {
    expect(libraryColumns(2000)).toBe(6);
  });
});

describe('panelLayout', () => {
  it('uses a bottom sheet on compact windows', () => {
    expect(panelLayout(374)).toBe('bottom');
    expect(panelLayout(599)).toBe('bottom');
  });

  it('switches to a side drawer on medium and expanded windows', () => {
    expect(panelLayout(600)).toBe('side');
    expect(panelLayout(697)).toBe('side');
    expect(panelLayout(1194)).toBe('side');
  });
});
