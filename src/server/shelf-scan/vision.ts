import "server-only";

/** One book as read off a spine. Nothing here is trusted until it matches a real catalogue record. */
export type SpineReading = {
  title: string;
  author: string | null;
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
  'List every book whose spine you can actually read. Return a JSON array of objects with keys "title" and "author".',
  "",
  "Rules:",
  "- Only include books you can genuinely read. Do not guess, and do not infer a book from context.",
  '- If you can read a title but not the author, use null for "author".',
  "- Do not invent subtitles or series names that are not printed on the spine.",
  "- Return an empty array if no spines are readable.",
].join("\n");

const SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: { title: { type: "STRING" }, author: { type: "STRING", nullable: true } },
    required: ["title"],
  },
} as const;

export function shelfScanConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

function cleanReading(value: unknown): SpineReading | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { title?: unknown; author?: unknown };
  const title = typeof record.title === "string" ? record.title.replace(/\s+/g, " ").trim() : "";
  if (!title) return null;
  const author = typeof record.author === "string" ? record.author.replace(/\s+/g, " ").trim() : "";
  return { title: title.slice(0, 300), author: author ? author.slice(0, 200) : null };
}

/**
 * Reads book spines out of a photo. Returns what the model claims to see — every entry
 * still has to survive matching against a real catalogue before a teacher is shown it.
 * The photo is sent to Google and never stored, here or there.
 */
export async function readSpines(
  image: { data: ArrayBuffer; mimeType: string },
  fetchFn: typeof fetch = fetch,
): Promise<SpineReading[]> {
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

  const readings: SpineReading[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    const reading = cleanReading(entry);
    if (!reading) continue;
    // Two copies side by side read as two identical spines; the teacher only needs one row.
    const key = `${reading.title.toLowerCase()}|${reading.author?.toLowerCase() ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    readings.push(reading);
    if (readings.length >= MAX_READINGS) break;
  }
  return readings;
}
