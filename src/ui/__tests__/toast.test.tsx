import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';
import { initI18n } from '../../i18n';
import { resetToasts, showToast, useToastStore } from '../toast';
import { ToastHost } from '../ToastHost';

beforeAll(async () => {
  await initI18n('fr');
});

beforeEach(() => {
  resetToasts();
});

// real timers on purpose: the host schedules its own dismiss, and RNTL v14's
// async render does not play well with jest fake timers
describe('ToastHost — self-dismissing notifications', () => {
  it('shows the message and dismisses itself after the delay', async () => {
    await render(
      <>
        <Text onPress={() => showToast('Livre ajouté à la bibliothèque', 'success')}>go</Text>
        <ToastHost />
      </>,
    );
    fireEvent.press(screen.getByText('go'));
    expect(useToastStore.getState().toast?.message).toBe('Livre ajouté à la bibliothèque');
    await waitFor(() => expect(screen.getByText('Livre ajouté à la bibliothèque')).toBeOnTheScreen());
    await waitFor(() => expect(screen.queryByText('Livre ajouté à la bibliothèque')).toBeNull(), { timeout: 5000 });
    expect(useToastStore.getState().toast).toBeNull();
  });

  it('a new toast replaces the current one', async () => {
    await render(
      <>
        <Text onPress={() => { showToast('premier', 'success'); showToast('second', 'error'); }}>go</Text>
        <ToastHost />
      </>,
    );
    fireEvent.press(screen.getByText('go'));
    await waitFor(() => expect(screen.getByText('second')).toBeOnTheScreen());
    expect(screen.queryByText('premier')).toBeNull();
  });
});
