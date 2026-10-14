import { StorageAccessFramework, writeAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import { encode } from 'base64-arraybuffer';

/** asks the user where to save, then writes the bytes there; false when cancelled */
export async function saveBytesToUserDir(name: string, mime: string, bytes: Uint8Array): Promise<boolean> {
  const perms = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!perms.granted) return false;
  const uri = await StorageAccessFramework.createFileAsync(perms.directoryUri, name, mime);
  await writeAsStringAsync(uri, encode(bytes.buffer as ArrayBuffer), { encoding: EncodingType.Base64 });
  return true;
}

export const EXPORT_MIME: Record<string, string> = {
  epub: 'application/epub+zip',
  mobi: 'application/x-mobipocket-ebook',
  azw3: 'application/vnd.amazon.ebook',
  cbz: 'application/vnd.comicbook+zip',
  zip: 'application/zip',
};
