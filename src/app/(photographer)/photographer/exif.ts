"use client";

import exifr from "exifr";
import jsQR from "jsqr";
import { exifToEpochMs } from "@/domain/photos/time";

/** Read the raw EXIF capture time in the browser (never trusts file mtime). */
export async function readCaptureMs(file: File): Promise<{ ms: number | null; raw: string | null }> {
  try {
    const t = (await exifr.parse(file, { pick: ["DateTimeOriginal", "SubSecTimeOriginal", "OffsetTimeOriginal"], reviveValues: false })) as
      | { DateTimeOriginal?: string; SubSecTimeOriginal?: string | number; OffsetTimeOriginal?: string }
      | undefined;
    const raw = t?.DateTimeOriginal ?? null;
    return { ms: exifToEpochMs(raw, t?.SubSecTimeOriginal, t?.OffsetTimeOriginal), raw };
  } catch {
    return { ms: null, raw: null };
  }
}

/** Decode a QR code from a photo; tries a couple of scales because the code may be small in frame. */
export async function decodeQr(file: File): Promise<string | null> {
  const bmp = await createImageBitmap(file);
  try {
    for (const maxSide of [2400, 1600, 1000]) {
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * scale);
      const h = Math.round(bmp.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(bmp, 0, 0, w, h);
      const hit = jsQR(ctx.getImageData(0, 0, w, h).data, w, h);
      if (hit?.data) return hit.data;
    }
    return null;
  } finally {
    bmp.close();
  }
}
