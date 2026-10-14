// App-wide toast store: success-style notifications that dismiss themselves.
// Fire-and-forget via showToast(); the single <ToastHost /> renders them.

import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastMessage {
  message: string;
  kind: ToastKind;
  id: number;
}

interface ToastState {
  toast: ToastMessage | null;
  show(message: string, kind?: ToastKind): void;
  clear(): void;
}

export const useToastStore = create<ToastState>((set) => ({
  toast: null,
  show: (message, kind = 'success') => set({ toast: { message, kind, id: Date.now() } }),
  clear: () => set({ toast: null }),
}));

export const showToast = (message: string, kind: ToastKind = 'success'): void =>
  useToastStore.getState().show(message, kind);

export const resetToasts = (): void => useToastStore.setState({ toast: null });
