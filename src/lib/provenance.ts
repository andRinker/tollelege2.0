/**
 * Where each field of a book came from, so automation can tell what a teacher decided from what
 * a catalogue or Gemini said. A field a teacher has set, or cleared, is theirs: nothing automatic
 * fills it, rewrites it or respells it afterwards.
 */

/** The fields whose origin is kept. A genre is `genreId`; a series' number goes with its name. */
export const TRACKED_FIELDS = [
  "title",
  "subtitle",
  "authors",
  "description",
  "coverUrl",
  "publisher",
  "publishedYear",
  "pageCount",
  "readingLevel",
  "tags",
  "series",
  "genreId",
] as const;
export type TrackedField = (typeof TRACKED_FIELDS)[number];

export const FIELD_SOURCES = ["teacher", "catalogue", "search", "gemini"] as const;
export type FieldSource = (typeof FIELD_SOURCES)[number];

export type FieldSources = Partial<Record<TrackedField, FieldSource>>;

const tracked = new Set<string>(TRACKED_FIELDS);

/** What is stored, read back safely: anything that isn't a known field and source is dropped. */
export function readSources(value: unknown): FieldSources {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const sources: FieldSources = {};
  for (const [field, source] of Object.entries(value)) {
    if (tracked.has(field) && (FIELD_SOURCES as readonly unknown[]).includes(source)) sources[field as TrackedField] = source as FieldSource;
  }
  return sources;
}

/** The fields a teacher has set, which automation leaves alone. */
export function lockedFields(sources: FieldSources): TrackedField[] {
  return TRACKED_FIELDS.filter((field) => sources[field] === "teacher");
}

/** The tracked fields an edit actually changes, compared by value. */
export function changedFields(before: Partial<Record<TrackedField, unknown>>, after: Partial<Record<TrackedField, unknown>>): TrackedField[] {
  return TRACKED_FIELDS.filter((field) => field in after && JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null));
}
