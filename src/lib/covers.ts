/**
 * Cover URLs, free of server imports so the browser and the server agree on them.
 *
 * A cover is either a link to a catalogue's image or a teacher's own photo of the book, which the
 * app serves itself from `/api/covers/<bookId>`.
 */

const PHOTO_COVER = /^\/api\/covers\/[0-9a-f-]{36}(\?v=\d{1,15})?$/i;

/** The address a teacher's photo of a book's cover is served from. `version` busts caches on a retake. */
export function coverPhotoUrl(bookId: string, version: number): string {
  return `/api/covers/${bookId}?v=${version}`;
}

export function isCoverPhotoUrl(url: string | null | undefined): boolean {
  return Boolean(url && PHOTO_COVER.test(url));
}

/** What a stored cover may be: a catalogue's https link, or the app's own photo address. */
export function isStoredCover(url: string): boolean {
  return isCoverPhotoUrl(url) || (url.startsWith("https://") && url.length <= 500 && URL.canParse(url));
}

/**
 * Catalogues hand out their smallest image by default: Open Library's medium (`-M`) is about 180
 * pixels wide and Google's thumbnail (`zoom=1`) about 128, which blurs on a book's page. This lists
 * the same cover at larger sizes, then the address as stored, so a caller tries each in turn and a
 * size a catalogue doesn't have costs nothing. Anything else is returned as it is.
 */
export function coverCandidates(url: string): string[] {
  if (/^https:\/\/covers\.openlibrary\.org\/b\/.+-M\.jpg$/.test(url)) return [url.replace(/-M\.jpg$/, "-L.jpg"), url];
  if (/^https:\/\/books\.google\.com\/books\/content/.test(url) && /[?&]zoom=1\b/.test(url)) {
    return [url.replace(/([?&])zoom=1\b/, "$1zoom=3"), url.replace(/([?&])zoom=1\b/, "$1zoom=2"), url];
  }
  return [url];
}
