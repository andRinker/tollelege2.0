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

/**
 * Why a reading failed, so a teacher can be told something they can act on and the logs say
 * which it was. They used to share one message, which made three failures in a row impossible
 * to tell apart: a slow answer, a busy service and a refused request call for different fixes.
 */
export type ShelfScanFailure = "timeout" | "busy" | "refused" | "unreadable" | "unconfigured";

export class ShelfScanUnavailableError extends Error {
  constructor(
    message: string,
    readonly reason: ShelfScanFailure = "busy",
  ) {
    super(message);
    this.name = "ShelfScanUnavailableError";
  }
}

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";
// An alias rather than a pinned version, so the model can improve without a code change.
// Numbered previews come and go, and some of them answer on a different API entirely.
const DEFAULT_MODEL = "gemini-flash-latest";
/**
 * The longest one reading may take. Measured on a real 42-book shelf, the default model took
 * 15 to 45 seconds and occasionally more with its full thinking, and was right on nearly
 * every spine; told to think less it took 5 seconds but left a quarter of the shelf unread
 * or muddled. On a 48-book shelf it took 10 to 70 seconds, and twice in fifteen went past
 * 75. A slow right answer beats a quick half one, so the time is given rather than the
 * thinking taken away. The request is allowed 180 seconds to fit this and the matching.
 */
const TIMEOUT_MS = 110_000;
/** Below this, there's no point starting a reading: it couldn't finish in time. */
const MIN_READING_MS = 5_000;
/** Statuses that mean "not now" rather than "not this": worth one quick retry. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
/** A shelf photo holding more than this is almost certainly a whole bookcase, shot too far away. */
const MAX_READINGS = 60;

const PROMPT = [
  "This photo shows books on a shelf, viewed from the side so mostly spines are visible.",
  "",
  "The photo is meant to show ONE shelf: the row of books it is centred on, which fills most of the",
  "frame. Parts of the shelves above or below may creep in at the top or bottom edge. Read only the",
  "one shelf. Do not list spines from any other shelf; count them instead, in \"otherShelfSpines\".",
  "",
  'List every spine on that shelf, in order from left to right, in "spines".',
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
  "- A book leaning at an angle or turned to show its cover is still one book: list it once, by its",
  "  spine if you can see it. Its front or back cover, and the gap it leaves beside it, are not more",
  "  spines. Nor are bookends, shelf edges, empty space, or a sticker or label on its own.",
  '- Return an empty "spines" list if the photo has no books in it.',
].join("\n");

/**
 * The first reading's prompt. A teacher's count joins it only to settle which shelf was meant
 * when the photo shows two about equally; it is phrased so it can't become a number to reach.
 */
function firstLookPrompt(expected: number | null): string {
  if (expected === null) return PROMPT;
  return [
    PROMPT,
    "",
    `If it is unclear which shelf is meant, the teacher counted about ${expected} books on theirs: read the`,
    "shelf whose spine count is nearer that. Never add or leave out spines to match it.",
  ].join("\n");
}

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
  type: "OBJECT",
  properties: {
    spines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING", nullable: true },
          author: { type: "STRING", nullable: true },
          fragment: { type: "STRING", nullable: true },
        },
      },
    },
    otherShelfSpines: { type: "INTEGER" },
  },
  required: ["spines"],
} as const;

/** One reading of a photo: the shelf's spines, and how many from other shelves were left out. */
export type ShelfReading = { sightings: SpineSighting[]; otherShelf: number };

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
  again?: { expected: number; previous: SpineSighting[] },
): Promise<SpineSighting[]> {
  return (await readShelf(image, fetchFn, again ? { again } : {})).sightings;
}

/**
 * Reads the one shelf a photo shows. `expected` is the teacher's count, if they gave one;
 * `again` makes this the second look, with the first reading to go on.
 */
export async function readShelf(
  image: { data: ArrayBuffer; mimeType: string },
  fetchFn: typeof fetch = fetch,
  {
    expected = null,
    again,
    deadline = Date.now() + TIMEOUT_MS,
  }: {
    expected?: number | null;
    again?: { expected: number; previous: SpineSighting[] };
    /** When this reading must be finished by (epoch ms), so a scan fits in its request. */
    deadline?: number;
  } = {},
): Promise<ShelfReading> {
  if (process.env.SHELF_SCAN_FIXTURES === "1") {
    const { FIXTURE_SHELF, FIXTURE_SECOND_LOOK, FIXTURE_OTHER_SHELF } = await import("./fixtures");
    return { sightings: again ? FIXTURE_SECOND_LOOK : FIXTURE_SHELF, otherShelf: FIXTURE_OTHER_SHELF };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ShelfScanUnavailableError("GEMINI_API_KEY is not set.", "unconfigured");
  let model = configuredModel();
  const pass = again ? "second look" : "first reading";
  const body = JSON.stringify({
    contents: [
      {
        parts: [
          { text: again ? secondLookPrompt(again.expected, again.previous) : firstLookPrompt(expected) },
          { inline_data: { mime_type: image.mimeType, data: Buffer.from(image.data).toString("base64") } },
        ],
      },
    ],
    // Temperature 0 keeps two photos of the same shelf from disagreeing with each other.
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      temperature: 0,
      ...thinkingConfig(),
    },
  });

  const started = Date.now();
  const elapsed = () => `${pass}, ${model}, ${Date.now() - started}ms`;
  let response: Response;
  for (let attempt = 1; ; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_READING_MS) {
      throw new ShelfScanUnavailableError(`No time left to start a reading (${elapsed()}).`, "timeout");
    }
    try {
      response = await fetchFn(`${ENDPOINT}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(Math.min(TIMEOUT_MS, remaining)),
        body,
      });
    } catch (error) {
      const timedOut = (error as Error).name === "TimeoutError" || (error as Error).name === "AbortError";
      throw new ShelfScanUnavailableError(
        `${timedOut ? "Timed out" : "Request failed"} (${elapsed()}): ${(error as Error).message}`,
        timedOut ? "timeout" : "busy",
      );
    }
    if (response.ok) break;

    // A model name Google doesn't know (a typo, or a model since retired) would fail every
    // scan until someone noticed. Fall back to the default alias, once, and say so loudly.
    if (response.status === 404 && model !== DEFAULT_MODEL) {
      console.error(`Shelf scan: model "${model}" not found; using ${DEFAULT_MODEL}. Check GEMINI_MODEL.`);
      model = DEFAULT_MODEL;
      continue;
    }

    // Google explains a refusal in the body ("model is overloaded", "API key not valid",
    // "quota exceeded"). Kept, briefly, for the log: it is the difference between waiting
    // a minute and fixing a setting.
    const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
    const retryable = RETRYABLE.has(response.status);
    if (retryable && attempt === 1 && deadline - Date.now() > MIN_READING_MS * 3) {
      console.warn(`Shelf scan: HTTP ${response.status}, retrying once (${elapsed()}): ${detail}`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }
    throw new ShelfScanUnavailableError(
      `HTTP ${response.status} (${elapsed()}): ${detail}`,
      retryable ? "busy" : "refused",
    );
  }

  const payload = (await response.json()) as {
    candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
    promptFeedback?: { blockReason?: string };
  };
  const candidate = payload.candidates?.[0];
  // An answer can arrive in several parts; a model that thinks may also send its thoughts.
  const raw = (candidate?.content?.parts ?? [])
    .filter((part) => !part.thought)
    .map((part) => part.text ?? "")
    .join("");
  const finish = candidate?.finishReason ?? payload.promptFeedback?.blockReason ?? "none";
  if (!raw.trim()) {
    // No answer at all is only "an empty shelf" when the model finished normally.
    if (finish === "STOP") return { sightings: [], otherShelf: 0 };
    throw new ShelfScanUnavailableError(`Empty answer, finish reason ${finish} (${elapsed()}).`, "unreadable");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ShelfScanUnavailableError(
      `Answer wasn't JSON, finish reason ${finish}, ${raw.length} characters (${elapsed()}).`,
      "unreadable",
    );
  }
  // The reader answers { spines, otherShelfSpines }; a bare list is accepted too, as older
  // answers were, with nothing known about other shelves.
  const record = parsed as { spines?: unknown; otherShelfSpines?: unknown } | null;
  const list = Array.isArray(parsed) ? parsed : Array.isArray(record?.spines) ? record.spines : null;
  if (!list) return { sightings: [], otherShelf: 0 };
  const other = Array.isArray(parsed) ? 0 : Number(record?.otherShelfSpines);
  const otherShelf = Number.isInteger(other) && other > 0 ? Math.min(other, 500) : 0;

  const sightings: SpineSighting[] = [];
  const seen = new Map<string, SpineSighting>();
  for (const entry of list) {
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
  // How long a reading takes, and how big, is what tunes the time budget; worth a line each.
  console.info(`Shelf scan: ${sightings.length} rows, ${otherShelf} left out, finish ${finish} (${elapsed()}).`);
  return { sightings, otherShelf };
}

/** What makes two readings the same book, for folding copies together. */
export function spineKey(reading: SpineReading): string {
  return `${reading.title.toLowerCase()}|${reading.author?.toLowerCase() ?? ""}`;
}

/**
 * The model to read with: `GEMINI_MODEL` if set, else the default alias. Forgiving of how a
 * person types a model name, since a near miss fails every scan: "3.5 Flash Lite",
 * "models/gemini-3.5-flash-lite" and "gemini-3.5-flash-lite" all mean the same model.
 */
export function configuredModel(raw = process.env.GEMINI_MODEL): string {
  const name = (raw ?? "").trim().toLowerCase().replace(/^models\//, "").replace(/\s+/g, "-");
  if (!name) return DEFAULT_MODEL;
  return /^\d/.test(name) ? `gemini-${name}` : name;
}

/**
 * `GEMINI_THINKING` (minimal, low, medium or high) overrides how much the model thinks
 * before answering. Unset leaves the model's own default, which measured best on accuracy.
 */
function thinkingConfig(): { thinkingConfig?: { thinkingLevel: string } } {
  const level = process.env.GEMINI_THINKING?.trim().toLowerCase();
  return level && ["minimal", "low", "medium", "high"].includes(level) ? { thinkingConfig: { thinkingLevel: level } } : {};
}
