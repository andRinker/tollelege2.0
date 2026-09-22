import "server-only";

/** One book as read off a spine. Nothing here is trusted until it matches a real catalogue record. */
export type SpineReading = {
  title: string;
  author: string | null;
};

/**
 * One spine as the reader saw it, in shelf order.
 *
 * A spine it could see but not read is reported rather than dropped. Silently omitting
 * it is how a shelf of thirty comes back as twenty-eight with nobody any the wiser — and
 * the teacher standing at the shelf is the one person who can fix it in three seconds.
 */
export type SpineSighting = {
  /** Null when the spine was visible but not legible. */
  reading: SpineReading | null;
  /** Whatever *was* legible on an unreadable spine. A partial read, never a guess. */
  fragment: string | null;
};

export class ShelfScanUnavailableError extends Error {}

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";
// An alias rather than a pinned version, so the model can improve without a code change.
// Numbered previews come and go, and some of them answer on a different API entirely.
const DEFAULT_MODEL = "gemini-flash-latest";
const TIMEOUT_MS = 30_000;
/** A shelf photo holding more than this is almost certainly a whole bookcase, shot too far away. */
const MAX_READINGS = 60;

const PROMPT = [
  "This photo shows books on a shelf, viewed from the side so mostly spines are visible.",
  "",
  "List every spine you can see, in order from left to right. Return a JSON array of objects.",
  "",
  'For a spine you can genuinely read, set "title", and "author" when an author is printed.',
  'For a spine you can see but cannot read, set "title" to null and put whatever IS legible in',
  '"fragment" — a few words of the title, a publisher, a series name. Leave "fragment" null when',
  "nothing at all is legible.",
  "",
  "Rules:",
  '- Never guess a title. If you cannot read it, leaving "title" null is the useful answer.',
  "- Do not infer a book from context, from the books beside it, or from a series it might belong to.",
  "- Do not invent subtitles or series names that are not printed on the spine.",
  "- List only spines actually present in the photo. Do not pad the list out to a round number.",
  "- Return an empty array if the photo has no books in it.",
].join("\n");

const SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      title: { type: "STRING", nullable: true },
      author: { type: "STRING", nullable: true },
      fragment: { type: "STRING", nullable: true },
    },
  },
} as const;

export function shelfScanConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY) || process.env.SHELF_SCAN_FIXTURES === "1";
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function cleanSighting(value: unknown): SpineSighting | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { title?: unknown; author?: unknown; fragment?: unknown };

  const title = text(record.title, 300);
  if (!title) {
    // A spine it could see but not read. Kept rather than dropped, which is the whole point.
    const fragment = text(record.fragment, 200);
    return { reading: null, fragment: fragment || null };
  }
  const author = text(record.author, 200);
  return { reading: { title, author: author || null }, fragment: null };
}

/**
 * Reads book spines out of a photo. Returns what the model claims to see — every entry
 * still has to survive matching against a real catalogue before a teacher is shown it.
 * The photo is sent to Google and never stored, here or there.
 */
export async function readSpines(
  image: { data: ArrayBuffer; mimeType: string },
  fetchFn: typeof fetch = fetch,
): Promise<SpineSighting[]> {
  if (process.env.SHELF_SCAN_FIXTURES === "1") {
    const { FIXTURE_SHELF } = await import("./fixtures");
    return FIXTURE_SHELF;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ShelfScanUnavailableError("GEMINI_API_KEY is not set.");
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  let response: Response;
  try {
    response = await fetchFn(`${ENDPOINT}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: PROMPT },
              { inline_data: { mime_type: image.mimeType, data: Buffer.from(image.data).toString("base64") } },
            ],
          },
        ],
        // Temperature 0 keeps two photos of the same shelf from disagreeing with each other.
        generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0 },
      }),
    });
  } catch (error) {
    throw new ShelfScanUnavailableError(`Request failed: ${(error as Error).message}`);
  }

  if (!response.ok) {
    throw new ShelfScanUnavailableError(`HTTP ${response.status} from the image reader.`);
  }

  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const raw = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ShelfScanUnavailableError("The image reader returned something that wasn't a book list.");
  }
  if (!Array.isArray(parsed)) return [];

  const sightings: SpineSighting[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    const sighting = cleanSighting(entry);
    if (!sighting) continue;
    if (sighting.reading) {
      // Two copies side by side read as two identical spines; the teacher only needs one row.
      // Unread spines are never folded together: they have no title to be the same by, and
      // each one is a different book somebody has to go and look at.
      const key = `${sighting.reading.title.toLowerCase()}|${sighting.reading.author?.toLowerCase() ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    sightings.push(sighting);
    if (sightings.length >= MAX_READINGS) break;
  }
  return sightings;
}
