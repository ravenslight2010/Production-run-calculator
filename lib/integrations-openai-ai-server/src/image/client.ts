import type { Buffer } from "node:buffer";

// Image generation/editing is not wired to any route in this app and is not
// supported through the Gemini AI integration used here. These stubs preserve
// the export surface (so nothing that imports them fails to compile) while
// failing loudly if they are ever actually called.
const UNSUPPORTED =
  "Image generation is not supported in this project (Gemini AI integration).";

export async function generateImageBuffer(
  _prompt: string,
  _size: "1024x1024" | "512x512" | "256x256" = "1024x1024",
): Promise<Buffer> {
  throw new Error(UNSUPPORTED);
}

export async function editImages(
  _imageFiles: string[],
  _prompt: string,
  _outputPath?: string,
): Promise<Buffer> {
  throw new Error(UNSUPPORTED);
}
