import { useWindowDimensions } from 'react-native';

export type WindowSizeClass = 'compact' | 'medium' | 'expanded';

// Material 3 window size classes: phones (incl. Fold cover closed, S Ultra)
// are compact; the Fold inner display and small tablets are medium; large
// tablets in landscape are expanded.
export function windowSizeClass(width: number): WindowSizeClass {
  if (width >= 840) return 'expanded';
  if (width >= 600) return 'medium';
  return 'compact';
}

export function isLandscape(width: number, height: number): boolean {
  return width > height;
}

export function libraryColumns(width: number): number {
  return Math.max(2, Math.min(6, Math.floor(width / 180)));
}

export function panelLayout(width: number): 'bottom' | 'side' {
  return width >= 600 ? 'side' : 'bottom';
}

export interface WindowLayout {
  width: number;
  height: number;
  sizeClass: WindowSizeClass;
  landscape: boolean;
  columns: number;
  panel: 'bottom' | 'side';
}

export function useWindowLayout(): WindowLayout {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    sizeClass: windowSizeClass(width),
    landscape: isLandscape(width, height),
    columns: libraryColumns(width),
    panel: panelLayout(width),
  };
}
