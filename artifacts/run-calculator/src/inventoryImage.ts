import { isHeicFile } from "./inventoryShared";

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
