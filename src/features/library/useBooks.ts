import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useServices } from '../../core/services';
import type { Book } from '../../core/types';

export type SortKey = 'recent' | 'added' | 'title';

export function useBooks(sort: SortKey, query: string) {
  const services = useServices();
  const [books, setBooks] = useState<Book[]>([]);
  const refresh = useCallback(async () => {
    setBooks(await services.books.listBooks({ sort, query }));
  }, [services, sort, query]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  return { books, refresh };
}
