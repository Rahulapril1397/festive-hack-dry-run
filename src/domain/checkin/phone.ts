/** Normalise an Indian mobile number to its 10 digits ("+91 98765-00001" → "9876500001"). */
export function normalizePhone(input: string): string | null {
  let d = input.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

export const isCheckinCode = (s: string) => /^\d{4}$/.test(s);
