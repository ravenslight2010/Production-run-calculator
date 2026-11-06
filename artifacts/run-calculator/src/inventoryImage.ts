import { HEIC_UNSUPPORTED_MESSAGE, isHeicFile } from "./inventoryShared";

type HeicConverter = (file: File) => Promise<Blob | Blob[]>;

async function convertHeicToJpeg(file: File): Promise<Blob | Blob[]> {
  const heic2any = (await import("heic2any")).default;
  return heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
}

/**
 * Convert HEIC/HEIF input when supported. If the optional converter cannot be
 * loaded or rejects the file, let the browser decoder provide the existing
 * actionable HEIC error instead of failing before decode.
 */
export async function prepareImageSource(
  file: File,
  convert: HeicConverter = convertHeicToJpeg,
): Promise<Blob> {
  if (!isHeicFile(file)) return file;

  try {
    const converted = await convert(file);
    return Array.isArray(converted) ? converted[0] ?? file : converted;
  } catch {
    return file;
  }
}

export async function decodeImageWithHeicFallback<T>(
  file: File,
  decode: (source: Blob) => Promise<T>,
  convert: HeicConverter = convertHeicToJpeg,
): Promise<{ source: Blob; decoded: T }> {
  if (!isHeicFile(file)) return { source: file, decoded: await decode(file) };

  try {
    return { source: file, decoded: await decode(file) };
  } catch {
    const converted = await prepareImageSource(file, convert);
    if (converted === file) throw new Error(HEIC_UNSUPPORTED_MESSAGE);
    return { source: converted, decoded: await decode(converted) };
  }
}
