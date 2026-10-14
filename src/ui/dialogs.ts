// App-wide dialog store: a themed replacement for Alert.alert. Screens fire
// requests through alert()/confirm()/inform(); the single <DialogHost /> at
// the app root renders them with the app's design language.

import { create } from 'zustand';
import i18next from 'i18next';

export interface DialogButton {
  text: string;
  onPress?(): void;
  style?: 'cancel' | 'destructive' | 'default';
}

export interface DialogRequest {
  title?: string;
  message?: string;
  buttons: DialogButton[];
}

interface DialogState {
  request: DialogRequest | null;
  show(request: DialogRequest): void;
  clear(): void;
}

export const useDialogStore = create<DialogState>((set) => ({
  request: null,
  show: (request) => set({ request }),
  clear: () => set({ request: null }),
}));

export const resetDialogs = (): void => useDialogStore.setState({ request: null });

export function alert(title?: string, message?: string, buttons: DialogButton[] = [{ text: 'OK' }]): void {
  useDialogStore.getState().show({ title, message, buttons });
}

/** two-ways question resolving to the pressed side; backdrop press = cancel */
export function confirm(opts: {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.getState().show({
      title: opts.title,
      message: opts.message,
      buttons: [
        {
          text: opts.cancelLabel ?? i18next.t('common.cancel'),
          style: 'cancel',
          onPress: () => resolve(false),
        },
        {
          text: opts.confirmLabel ?? i18next.t('common.confirm'),
          style: opts.destructive ? 'destructive' : 'default',
          onPress: () => resolve(true),
        },
      ],
    });
  });
}

/** single-button announcement resolving when acknowledged */
export function inform(title?: string, message?: string, okLabel = 'OK'): Promise<void> {
  return new Promise((resolve) => {
    useDialogStore.getState().show({
      title,
      message,
      buttons: [{ text: okLabel, onPress: () => resolve() }],
    });
  });
}
