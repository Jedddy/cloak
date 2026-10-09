import { describe, expect, test } from "bun:test";
import sharp from "sharp";

import { scanJpeg, scanPng } from "@/lib/detect/structure";

import { padBox, redactImage } from "./image";

async function rawPixels(bytes: Uint8Array): Promise<{ data: Uint8Array; width: number; height: number }> {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });

  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

describe("padBox", () => {
  test("adds padding and clamps to the image", () => {
    expect(padBox({ left: 10, top: 10, width: 20, height: 20 }, 100, 100)).toEqual({
      left: 7,
      top: 7,
      width: 26,
      height: 26,
    });
    expect(padBox({ left: 0, top: 0, width: 5, height: 5 }, 100, 100)).toEqual({ left: 0, top: 0, width: 8, height: 8 });
  });

  test("drops boxes fully outside the image", () => {
    expect(padBox({ left: 200, top: 200, width: 10, height: 10 }, 100, 100)).toBeNull();
  });
});

describe("redactImage", () => {
  test("AE4: a png with trailing data and metadata comes back clean", async () => {
    const dirty = await sharp({
      create: { width: 64, height: 32, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer();

    const withTrailing = new Uint8Array([...dirty, 1, 2, 3, 4, 5]);

    const out = await redactImage({ bytes: withTrailing, mime: "image/png", boxes: [] });
    const scan = scanPng(out);

    expect(scan.trailingSize).toBe(0);
    expect(scan.hasMetadata).toBe(false);

    const pixels = await rawPixels(out);

    expect(pixels.width).toBe(64);
    expect(pixels.height).toBe(32);
  });

  test("strips jpeg metadata and trailing bytes", async () => {
    const dirty = await sharp({
      create: { width: 48, height: 24, channels: 3, background: { r: 200, g: 200, b: 200 } },
    })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Software: "SentinelTest" } } })
      .toBuffer();

    const withTrailing = new Uint8Array([...dirty, 9, 9, 9]);

    const out = await redactImage({ bytes: withTrailing, mime: "image/jpeg", boxes: [] });
    const scan = scanJpeg(out);

    expect(scan.trailingSize).toBe(0);
    expect(scan.hasMetadata).toBe(false);
  });

  test("paints opaque boxes and leaves other pixels alone", async () => {
    const white = await sharp({
      create: { width: 40, height: 20, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer();

    const out = await redactImage({ bytes: new Uint8Array(white), mime: "image/png", boxes: [{ x: 5, y: 5, w: 10, h: 5 }] });
    const pixels = await rawPixels(out);

    const at = (x: number, y: number): number[] => {
      const offset = (y * pixels.width + x) * 3;

      return [pixels.data[offset], pixels.data[offset + 1], pixels.data[offset + 2]];
    };

    expect(at(10, 7)).toEqual([0, 0, 0]);
    expect(at(0, 0)).toEqual([255, 255, 255]);
    expect(at(39, 19)).toEqual([255, 255, 255]);
  });

  test("rejects unsupported formats", async () => {
    await expect(redactImage({ bytes: new Uint8Array([1, 2, 3]), mime: "image/gif", boxes: [] })).rejects.toThrow();
  });
});
