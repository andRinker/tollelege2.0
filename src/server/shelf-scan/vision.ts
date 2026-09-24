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
  /**
   * How many identical spines this one row stands for. Copies of a book are folded into
   * one row, but they are still books on the shelf: a count the teacher gave is checked
   * against them, and confirming the row adds that many.
   */
  copies: number;
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

/**
 * The second look, when the first came up short of the count a teacher gave. It sees what
 * the first reading listed, so it can hunt for the spines between them rather than start
 * again, and it keeps every rule of the first: a count is a reason to look harder, never a
 * number to reach. A spine invented to make up the total is exactly the failure the rules
 * exist to prevent, so it is told outright that coming up short is the right answer.
 */
function secondLookPrompt(expected: number, previous: SpineSighting[]): string {
  const listed = previous.map((sighting, index) => {
    const copies = sighting.copies > 1 ? ` (${sighting.copies} identical spines)` : "";
    if (sighting.reading) {
      return `${index + 1}. ${sighting.reading.title}${sighting.reading.author ? ` — ${sighting.reading.author}` : ""}${copies}`;
    }
    return `${index + 1}. (could not be read${sighting.fragment ? `; legible: "${sighting.fragment}"` : ""})`;
  });
  const seen = previous.reduce((total, sighting) => total + sighting.copies, 0);
  return [
    PROMPT,
    "",
    `The teacher who took this photo counted ${expected} books on this shelf. A first reading found ${seen}:`,
    ...listed,
    "",
    "Look at the shelf again, carefully, for spines that reading missed: very thin spines, spines at",
    "either end of the shelf, spines in shadow, books lying flat, and two similar spines side by side",
    "that may have been read as one. Then list every spine again, from left to right, including the",
    "ones the first reading found. Every rule above still applies.",
    `If you still see fewer than ${expected} spines, return only the ones you see. Do not add a spine`,
    "to reach the teacher's count: a missing book is found in seconds, and an invented one is not.",
  ].join("\n");
}

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
    return { reading: null, fragment: fragment || null, copies: 1 };
  }
  const author = text(record.author, 200);
  return { reading: { title, author: author || null }, fragment: null, copies: 1 };
}

/**
 * Reads book spines out of a photo. Returns what the model claims to see — every entry
 * still has to survive matching against a real catalogue before a teacher is shown it.
 * The photo is sent to Google and never stored, here or there.
 */
export async function readSpines(
  image: { data: ArrayBuffer; mimeType: string },
  fetchFn: typeof fetch = fetch,
  /** A second look: the teacher's count, and what the first reading found. */
  again?: { expected: number; previous: SpineSighting[] },
): Promise<SpineSighting[]> {
  if (process.env.SHELF_SCAN_FIXTURES === "1") {
    const { FIXTURE_SHELF, FIXTURE_SECOND_LOOK } = await import("./fixtures");
    return again ? FIXTURE_SECOND_LOOK : FIXTURE_SHELF;
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
              { text: again ? secondLookPrompt(again.expected, again.previous) : PROMPT },
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
  const seen = new Map<string, SpineSighting>();
  for (const entry of parsed) {
    const sighting = cleanSighting(entry);
    if (!sighting) continue;
    if (sighting.reading) {
      // Two copies side by side read as two identical spines; the teacher only needs one
      // row, but it remembers there were two. Unread spines are never folded together:
      // they have no title to be the same by, and each is a different book to go and see.
      const key = spineKey(sighting.reading);
      const earlier = seen.get(key);
      if (earlier) {
        earlier.copies += 1;
        continue;
      }
      seen.set(key, sighting);
    }
    sightings.push(sighting);
    if (sightings.length >= MAX_READINGS) break;
  }
  return sightings;
}

/** What makes two readings the same book, for folding copies together. */
export function spineKey(reading: SpineReading): string {
  return `${reading.title.toLowerCase()}|${reading.author?.toLowerCase() ?? ""}`;
}
