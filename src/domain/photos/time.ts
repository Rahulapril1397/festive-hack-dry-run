/**
 * EXIF → epoch ms. DateTimeOriginal is "YYYY:MM:DD HH:MM:SS" with no zone; OffsetTimeOriginal
 * ("+05:30") supplies it when present, else the wedding's default (IST). SubSecTimeOriginal is
 * the fractional digits ("12" = 0.12 s).
 */
export const DEFAULT_TZ_OFFSET = "+05:30";

export function exifToEpochMs(dateTimeOriginal: string | null | undefined, subSec?: string | number | null, offset?: string | null, defaultOffset = DEFAULT_TZ_OFFSET): number | null {
  if (!dateTimeOriginal) return null;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(dateTimeOriginal.trim());
  if (!m) return null;
  const off = /^([+-])(\d{2}):?(\d{2})$/.exec((offset ?? defaultOffset).trim()) ?? /^([+-])(\d{2}):?(\d{2})$/.exec(defaultOffset)!;
  const [, y, mo, d, h, mi, s] = m.map(Number) as unknown as number[];
  const offMin = (off[1] === "-" ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3]));
  const digits = subSec == null ? "" : String(subSec).replace(/\D/g, "");
  const frac = digits ? Math.round(Number(`0.${digits}`) * 1000) : 0;
  const utc = Date.UTC(y!, mo! - 1, d!, h!, mi!, s!) - offMin * 60_000 + frac;
  return Number.isFinite(utc) ? utc : null;
}

/** offset_ms = qr_t_ms − exif_time_ms of the calibration photo. */
export const clockOffsetMs = (qrTMs: number, exifMs: number) => qrTMs - exifMs;
/** corrected_at = exif_time + offset_ms */
export const correctedMs = (exifMs: number, offsetMs: number) => exifMs + offsetMs;
