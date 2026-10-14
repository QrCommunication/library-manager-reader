import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { RemoteBookGridItem } from '../RemoteBookGridItem';
import { initI18n } from '../../../i18n';

const base = { id: 'r1', title: 'Dune', author: 'F. Herbert', series: null as string | null, seriesIndex: null as number | null, updatedAt: null as number | null };

beforeAll(async () => {
  await initI18n('fr');
});

describe('RemoteBookGridItem', () => {
  it('renders the remote title and author like a library tile', async () => {
    await await render(<RemoteBookGridItem book={base} inLibrary={false} onLongPress={jest.fn()} />);
    expect(screen.getByText('Dune')).toBeOnTheScreen();
    expect(screen.getByText('F. Herbert')).toBeOnTheScreen();
  });

  it('marks books already matched in the local library', async () => {
    await render(<RemoteBookGridItem book={base} inLibrary onLongPress={jest.fn()} />);
    expect(await screen.findByLabelText('Dune — F. Herbert — Dans la bibliothèque')).toBeOnTheScreen();
  });

  it('hides the badge and exposes the long-press transfer for books not in the library', async () => {
    const onLongPress = jest.fn();
    await render(<RemoteBookGridItem book={base} inLibrary={false} onLongPress={onLongPress} />);
    const tile = await screen.findByLabelText('Dune — F. Herbert');
    expect(screen.queryByLabelText('Dune — F. Herbert — Dans la bibliothèque')).toBeNull();
    fireEvent(tile, 'longPress');
    expect(onLongPress).toHaveBeenCalled();
  });
});
