import sharp from "sharp";

import type { ImageRedactionInput } from "@/lib/contract/interfaces";

// Image redaction (overview section 14, plan R20, spike F4). Decodes to
// pixels, paints opaque filled rectangles with padding, and encodes a new
// file in the same format with no metadata. Output has no EXIF and no
// trailing data because it is re-encoded from pixels.

const BOX_PADDING_PX = 3;

export type PixelBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function padBox(box: PixelBox, imageWidth: number, imageHeight: number): PixelBox | null {
  const left = Math.max(0, Math.floor(box.left) - BOX_PADDING_PX);
  const top = Math.max(0, Math.floor(box.top) - BOX_PADDING_PX);
  const right = Math.min(imageWidth, Math.ceil(box.left + box.width) + BOX_PADDING_PX);
  const bottom = Math.min(imageHeight, Math.ceil(box.top + box.height) + BOX_PADDING_PX);

  if (right <= left || bottom <= top) {
    return null;
  }

  return { left, top, width: right - left, height: bottom - top };
}

/** Paints one opaque black rectangle into raw pixel rows. */
export function paintBox(pixels: Uint8Array, imageWidth: number, channels: number, box: PixelBox): void {
  const painted = Math.min(channels, 3);

  for (let y = box.top; y < box.top + box.height; y += 1) {
    for (let x = box.left; x < box.left + box.width; x += 1) {
      const offset = (y * imageWidth + x) * channels;

      for (let channel = 0; channel < painted; channel += 1) {
        pixels[offset + channel] = 0;
      }
    }
  }
}

export async function redactImage(input: ImageRedactionInput): Promise<Uint8Array> {
  const meta = await sharp(input.bytes).metadata();

  if (meta.width === undefined || meta.height === undefined) {
    throw new Error("The image data cannot be read.");
  }

  const width = meta.width;
  const height = meta.height;

  const { data, info } = await sharp(input.bytes)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);
  const channels = info.channels;

  for (const box of input.boxes) {
    const padded = padBox({ left: box.x, top: box.y, width: box.w, height: box.h }, width, height);

    if (padded !== null) {
      paintBox(pixels, width, channels, padded);
    }
  }

  // Re-encode from pixels in the same format. Metadata is not copied, so
  // the output carries no EXIF, and encoding starts clean, so trailing
  // bytes from the original cannot survive.
  if (input.mime === "image/png") {
    return new Uint8Array(await sharp(pixels, { raw: { width, height, channels } }).png().toBuffer());
  }

  if (input.mime === "image/jpeg") {
    return new Uint8Array(await sharp(pixels, { raw: { width, height, channels } }).jpeg({ quality: 90 }).toBuffer());
  }

  throw new Error(`Redaction does not support ${input.mime}.`);
}
