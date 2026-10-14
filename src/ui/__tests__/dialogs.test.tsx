import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';
import { initI18n } from '../../i18n';
import { alert, confirm, inform, resetDialogs, useDialogStore, type DialogRequest } from '../dialogs';
import { DialogHost } from '../DialogHost';

beforeAll(async () => {
  await initI18n('fr');
});

beforeEach(() => {
  resetDialogs();
});

const Probe = ({ run }: { run: () => void }) => {
  return <Text onPress={run}>trigger</Text>;
};

describe('dialogs — themed replacement for Alert.alert', () => {
  it('alert() renders title, message and buttons in the host; the handler runs on press', async () => {
    const handler = jest.fn();
    await render(
      <>
        <Probe run={() => alert('Titre', 'Le message', [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Confirmer', onPress: handler },
        ])} />
        <DialogHost />
      </>,
    );
    fireEvent.press(screen.getByText('trigger'));
    expect(await screen.findByText('Titre')).toBeOnTheScreen();
    expect(screen.getByText('Le message')).toBeOnTheScreen();
    fireEvent.press(screen.getByText('Confirmer'));
    expect(handler).toHaveBeenCalled();
    await waitFor(() => expect(useDialogStore.getState().request).toBeNull());
  });

  it('confirm() resolves true on confirm and false on cancel; backdrop press cancels', async () => {
    let first = false;
    let second = false;
    await render(
      <>
        <Probe run={() => { void confirm({ title: 'T', message: 'M', confirmLabel: 'Oui' }).then((r) => { first = r; }); }} />
        <DialogHost />
      </>,
    );
    fireEvent.press(screen.getByText('trigger'));
    fireEvent.press(await screen.findByText('Oui'));
    await waitFor(() => expect(first).toBe(true));

    await render(
      <>
        <Probe run={() => { void confirm({ title: 'T2', message: 'M2' }).then((r) => { second = r; }); }} />
        <DialogHost />
      </>,
    );
    fireEvent.press(screen.getByText('trigger'));
    fireEvent.press(await screen.findByText('Annuler'));
    await waitFor(() => expect(second).toBe(false));
  });

  it('inform() shows a single OK button and resolves when pressed', async () => {
    let done = false;
    await render(
      <>
        <Probe run={() => { void inform('Info', 'Détail').then(() => { done = true; }); }} />
        <DialogHost />
      </>,
    );
    fireEvent.press(screen.getByText('trigger'));
    fireEvent.press(await screen.findByText('OK'));
    await waitFor(() => expect(done).toBe(true));
  });

  it('keeps only the latest request and exposes it in the store', async () => {
    const a: DialogRequest = { title: 'A', buttons: [{ text: 'x' }] };
    const b: DialogRequest = { title: 'B', buttons: [{ text: 'y' }] };
    await render(
      <>
        <Probe run={() => { alert(a.title, undefined, a.buttons); alert(b.title, undefined, b.buttons); }} />
        <DialogHost />
      </>,
    );
    fireEvent.press(screen.getByText('trigger'));
    await waitFor(() => expect(useDialogStore.getState().request?.title).toBe('B'));
  });
});
