import { renderHook, act } from '@testing-library/react-native';
import { Keyboard } from 'react-native';
import { useKeyboardHeight } from '../useKeyboardHeight';

type Handler = (e: { endCoordinates: { height: number } }) => void;

const makeSubscription = () => ({ remove: jest.fn() });

describe('useKeyboardHeight', () => {
  it('follows the keyboard height and resets when it hides', async () => {
    const listeners = new Map<string, Handler[]>();
    const addListener = jest
      .spyOn(Keyboard, 'addListener')
      .mockImplementation(((event: string, handler: Handler) => {
        const list = listeners.get(event) ?? [];
        list.push(handler);
        listeners.set(event, list);
        return makeSubscription();
      }) as unknown as typeof Keyboard.addListener);

    const { result, unmount } = await renderHook(() => useKeyboardHeight());
    expect(result.current).toBe(0);
    expect(addListener).toHaveBeenCalledWith('keyboardDidShow', expect.any(Function));
    expect(addListener).toHaveBeenCalledWith('keyboardDidHide', expect.any(Function));

    await act(async () => {
      listeners.get('keyboardDidShow')!.forEach((h) => h({ endCoordinates: { height: 301 } }));
    });
    expect(result.current).toBe(301);

    await act(async () => {
      listeners.get('keyboardDidHide')!.forEach((h) => h({ endCoordinates: { height: 0 } }));
    });
    expect(result.current).toBe(0);

    await unmount();
    // both subscriptions are detached with the component
    expect((addListener.mock.results[0]!.value as { remove: jest.Mock }).remove).toHaveBeenCalled();
    expect((addListener.mock.results[1]!.value as { remove: jest.Mock }).remove).toHaveBeenCalled();
  });
});
