import { useLocalSearchParams } from 'expo-router';
import { ReaderScreen } from '../../src/features/reader/ReaderScreen';

export default function BookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id) return null;
  return <ReaderScreen bookId={id} />;
}
