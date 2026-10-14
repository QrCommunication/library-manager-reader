import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

// Height of the currently visible keyboard, 0 when hidden. A Modal's window
// is not resized by the soft input on Android, so a bottom-anchored sheet
// lifts itself with this value instead of relying on window insets.
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
