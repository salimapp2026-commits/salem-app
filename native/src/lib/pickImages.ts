// Photo-library picking + upload bytes for the bare app (replaces
// expo-image-picker). Supabase storage uploads from React Native need the raw
// bytes — a fetch(uri).blob() of a local file uploads empty on some devices —
// so readFileBytes() reads the file with react-native-fs and decodes it.
import { launchImageLibrary } from 'react-native-image-picker';
import RNFS from 'react-native-fs';

export type PickedImage = { uri: string; mimeType: string; fileName: string };

/** Opens the photo library. Returns [] if the user cancels. */
export async function pickImages(opts: { multiple?: boolean } = {}): Promise<PickedImage[]> {
  const res = await launchImageLibrary({
    mediaType: 'photo',
    selectionLimit: opts.multiple ? 0 : 1,
    quality: 0.8,
    maxWidth: 2048,
    maxHeight: 2048,
  });
  if (res.didCancel || res.errorCode || !res.assets) return [];
  return res.assets
    .filter((a) => a.uri)
    .map((a) => ({
      uri: a.uri!,
      mimeType: a.type ?? 'image/jpeg',
      fileName: a.fileName ?? `image-${Date.now()}.jpg`,
    }));
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(256);
for (let i = 0; i < B64.length; i++) LOOKUP[B64.charCodeAt(i)] = i;

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = LOOKUP[clean.charCodeAt(i)];
    const b = LOOKUP[clean.charCodeAt(i + 1)];
    const c = LOOKUP[clean.charCodeAt(i + 2)];
    const d = LOOKUP[clean.charCodeAt(i + 3)];
    out[o++] = (a << 2) | (b >> 4);
    if (i + 2 < clean.length) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < clean.length) out[o++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, o);
}

/** The file's bytes, ready for supabase.storage.upload(). */
export async function readFileBytes(uri: string): Promise<ArrayBuffer> {
  const path = uri.startsWith('file://') ? decodeURIComponent(uri.slice(7)) : uri;
  const bytes = base64ToBytes(await RNFS.readFile(path, 'base64'));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
