import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { BookGridItem } from '../BookGridItem';

const baseBook = (over: Record<string, unknown> = {}) => ({
  id: 'b1', title: 'Le Golem', author: 'Meyrink', format: 'epub', originalFormat: null,
  fileName: 'g.epub', fileSize: 1, language: null, publisher: null,
  series: 'Fondation', seriesIndex: 2, drmIdentifier: null,
  addedAt: 1, updatedAt: 1, deletedAt: null, lastReadAt: null, ...over,
});

const renderCell = async (book: Record<string, unknown>, progress?: number) =>
  render(<BookGridItem book={book as never} coverUri="unused" onPress={() => {}} onLongPress={() => {}} progress={progress} />);

describe('BookGridItem series metadata', () => {
  it('shows a tome badge on the cover and the series line in meta', async () => {
    await renderCell(baseBook());
    expect(screen.getByText('T2')).toBeOnTheScreen();
    expect(screen.getByText('Fondation')).toBeOnTheScreen();
  });

  it('omits the badge and series line for standalone books', async () => {
    await renderCell(baseBook({ series: null, seriesIndex: null }));
    expect(screen.queryByText(/^T\d+$/)).toBeNull();
    expect(screen.queryByText('Fondation')).toBeNull();
  });

  it('skips the series line when it is identical to the title', async () => {
    await renderCell(baseBook({ title: 'Fondation', series: 'Fondation', seriesIndex: 1 }));
    expect(screen.getByText('T1')).toBeOnTheScreen();
    // the title only — no redundant duplicate underneath
    expect(screen.getAllByText('Fondation')).toHaveLength(1);
  });
});

describe('BookGridItem reading progress', () => {
  it('shows a progress bar with the rounded % at the bottom of the cover', async () => {
    await renderCell(baseBook(), 0.426);
    const band = screen.getByTestId('book-progress');
    expect(band.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 43 });
    expect(screen.getByText('43 %')).toBeOnTheScreen();
  });

  it('clamps out-of-range fractions', async () => {
    await renderCell(baseBook(), 1.4);
    expect(screen.getByText('100 %')).toBeOnTheScreen();
  });

  it('shows no bar for a never-opened book', async () => {
    await renderCell(baseBook());
    expect(screen.queryByTestId('book-progress')).toBeNull();
    expect(screen.queryByText(/%$/)).toBeNull();
  });
});
