import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useServices } from '../../core/services';
import type { Book } from '../../core/types';

export type SortKey = 'recent' | 'added' | 'title' | 'series';
export type SeriesInfo = { name: string; count: number };

export function useBooks(sort: SortKey, query: string, series: string | null) {
  const services = useServices();
  const [books, setBooks] = useState<Book[]>([]);
  const [seriesList, setSeriesList] = useState<SeriesInfo[]>([]);
  const refresh = useCallback(async () => {
    setBooks(await services.books.listBooks({ sort, query, series: series ?? undefined }));
    setSeriesList(await services.books.listSeries());
  }, [services, sort, query, series]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  return { books, seriesList, refresh };
}
