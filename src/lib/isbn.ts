/**
 * ISBN helpers. Everything is stored as ISBN-13; ISBN-10 input is converted.
 * Book barcodes are EAN-13 (978/979 prefix), sometimes followed by a 2- or 5-digit price add-on.
 */

function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidIsbn13(value: string): boolean {
  return /^97[89]\d{10}$/.test(value) && ean13CheckDigit(value.slice(0, 12)) === Number(value[12]);
}

export function isValidIsbn10(value: string): boolean {
  if (!/^\d{9}[\dX]$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const digit = value[i] === "X" ? 10 : Number(value[i]);
    sum += digit * (10 - i);
  }
  return sum % 11 === 0;
}

export function isbn10To13(isbn10: string): string {
  const first12 = `978${isbn10.slice(0, 9)}`;
  return `${first12}${ean13CheckDigit(first12)}`;
}

/** Returns a valid ISBN-13, or null if the input isn't a valid ISBN. */
export function normalizeIsbn(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[\s.\-–—]/g, "");
  if (isValidIsbn10(cleaned)) return isbn10To13(cleaned);
  if (isValidIsbn13(cleaned)) return cleaned;
  // EAN-13 with a 2- or 5-digit add-on, as some scanners report it.
  if (/^\d{15}$|^\d{18}$/.test(cleaned) && isValidIsbn13(cleaned.slice(0, 13))) return cleaned.slice(0, 13);
  return null;
}

/** True when the text is probably an ISBN attempt (digits, hyphens, X), valid or not. */
export function looksLikeIsbn(input: string): boolean {
  const cleaned = input.replace(/[\s\-]/g, "");
  return /^\d{9,18}X?$/i.test(cleaned);
}

/** 9780064440202 → 978-0-06-444020-2 is publisher-specific, so display uses simple grouping. */
export function formatIsbn13(isbn13: string): string {
  return `${isbn13.slice(0, 3)}-${isbn13.slice(3, 12)}-${isbn13.slice(12)}`;
}
