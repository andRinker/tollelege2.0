// Throwaway experiment: how much of a shelf can we catalogue from one photo?
//
//   node scripts/spine-spike.mjs <photo> [--model gemini-...]
//
// Two separate questions, reported separately, because they fail for different
// reasons and only one of them is the model's fault:
//
//   1. READING  - can the model list the books on the shelf?
//   2. MATCHING - can each of those titles be turned into a real ISBN?
//
// Reading is the part people test. Matching is the part that decides whether the
// feature is usable, and a better model does not fix it.
import { readFileSync } from "node:fs";
import path from "node:path";

const GEMINI = "https://generativelanguage.googleapis.com/v1beta";

function envValue(name) {
  const line = readFileSync(".env.local", "utf8")
    .split("\n")
    .find((entry) => entry.startsWith(`${name}=`));
  return line ? line.split("=").slice(1).join("=").trim().replace(/^"|"$/g, "") : "";
}

const args = process.argv.slice(2);
const photo = args.find((arg) => !arg.startsWith("--"));
const modelArg = args.includes("--model") ? args[args.indexOf("--model") + 1] : null;
if (!photo) {
  console.error("usage: node scripts/spine-spike.mjs <photo> [--model <name>]");
  process.exit(1);
}

const geminiKey = envValue("GEMINI_API_KEY");
const booksKey = envValue("GOOGLE_BOOKS_API_KEY");
if (!geminiKey) {
  console.error("GEMINI_API_KEY is not in .env.local");
  process.exit(1);
}

const MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
};
const mimeType = MIME[path.extname(photo).toLowerCase()];
if (!mimeType) {
  console.error(`unsupported image type: ${path.extname(photo)}`);
  process.exit(1);
}

/** Asks the key which models it can use, rather than hardcoding a name that may have moved. */
async function pickModel() {
  if (modelArg) return modelArg;
  const res = await fetch(`${GEMINI}/models?key=${encodeURIComponent(geminiKey)}&pageSize=200`);
  if (!res.ok) throw new Error(`listing models failed: HTTP ${res.status}`);
  const usable = (await res.json()).models
    .filter((model) => (model.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((model) => model.name.replace(/^models\//, ""));
  // Plain numbered flash tiers only. The image, audio, transcribe and "omni" variants
  // either cannot read a photo or answer on a different API entirely.
  const numbered = usable
    .map((name) => ({ name, version: Number(name.match(/^gemini-(\d+(?:\.\d+)?)-flash$/)?.[1] ?? NaN) }))
    .filter((entry) => !Number.isNaN(entry.version))
    .sort((a, b) => b.version - a.version);
  const chosen = numbered[0]?.name ?? usable.find((name) => name === "gemini-flash-latest");
  if (!chosen) throw new Error("no usable vision model for this key");
  return chosen;
}

const PROMPT = [
  "This photo shows books on a shelf, viewed from the side so mostly spines are visible.",
  "",
  'List every book whose spine you can actually read. Return a JSON array of objects with keys "title" and "author".',
  "",
  "Rules:",
  "- Only include books you can genuinely read. Do not guess or infer from context.",
  '- If you can read a title but not the author, use null for "author".',
  "- Do not invent subtitles or series names that are not printed on the spine.",
  "- Return an empty array if no spines are readable.",
].join("\n");

/** Normalizes a title for comparison: case, punctuation and leading articles all vary between records. */
function compareKey(value) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titlesAgree(recognized, candidate) {
  const left = compareKey(recognized);
  const right = compareKey(candidate);
  if (!left || !right) return "none";
  if (left === right) return "exact";
  // A subtitle on one side but not the other is still the same book.
  if (right.startsWith(left) || left.startsWith(right)) return "close";
  const words = new Set(left.split(" "));
  const shared = right.split(" ").filter((word) => words.has(word)).length;
  return shared / Math.max(words.size, 1) >= 0.7 ? "close" : "none";
}

async function searchGoogleBooks(title, author) {
  const query = [`intitle:"${title}"`, author ? `inauthor:"${author}"` : ""].filter(Boolean).join("+");
  const key = booksKey ? `&key=${encodeURIComponent(booksKey)}` : "";
  const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=5${key}`);
  if (!res.ok) return { error: `HTTP ${res.status}` };
  for (const item of (await res.json()).items ?? []) {
    const info = item.volumeInfo ?? {};
    const isbn = (info.industryIdentifiers ?? []).find((id) => id.type === "ISBN_13")?.identifier;
    if (!isbn) continue;
    return { isbn, title: info.title, authors: info.authors ?? [], agreement: titlesAgree(title, info.title) };
  }
  return {};
}

async function searchOpenLibrary(title, author) {
  const params = new URLSearchParams({ title, limit: "5", fields: "title,author_name,isbn" });
  if (author) params.set("author", author);
  const res = await fetch(`https://openlibrary.org/search.json?${params}`);
  if (!res.ok) return { error: `HTTP ${res.status}` };
  for (const doc of (await res.json()).docs ?? []) {
    const isbn = (doc.isbn ?? []).find((candidate) => /^97[89]\d{10}$/.test(candidate));
    if (!isbn) continue;
    return { isbn, title: doc.title, authors: doc.author_name ?? [], agreement: titlesAgree(title, doc.title) };
  }
  return {};
}

const model = await pickModel();
console.log(`model : ${model}`);
console.log(`photo : ${photo}\n`);

const started = Date.now();
const response = await fetch(`${GEMINI}/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    contents: [
      {
        parts: [
          { text: PROMPT },
          { inline_data: { mime_type: mimeType, data: readFileSync(photo).toString("base64") } },
        ],
      },
    ],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  }),
});
if (!response.ok) {
  console.error(`Gemini returned HTTP ${response.status}`);
  console.error((await response.text()).slice(0, 400));
  process.exit(1);
}

const payload = await response.json();
const raw = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

let books;
try {
  books = JSON.parse(raw.replace(/^```(?:json)?/, "").replace(/```$/, "").trim());
} catch {
  console.error("could not parse the model's reply:\n", raw.slice(0, 400));
  process.exit(1);
}

const usage = payload.usageMetadata ?? {};
console.log(`READING: ${books.length} spine(s) in ${elapsed}s  (${usage.totalTokenCount ?? "?"} tokens)\n`);

const results = [];
for (const [index, book] of books.entries()) {
  const [google, openLibrary] = await Promise.all([
    searchGoogleBooks(book.title, book.author).catch((error) => ({ error: error.message })),
    searchOpenLibrary(book.title, book.author).catch((error) => ({ error: error.message })),
  ]);
  const candidates = [google, openLibrary];
  const best =
    candidates.find((result) => result.agreement === "exact") ??
    candidates.find((result) => result.agreement === "close") ??
    candidates.find((result) => result.isbn);
  results.push({ book, best, google, openLibrary });

  const label = `${String(index + 1).padStart(2)}. ${book.title}${book.author ? ` - ${book.author}` : ""}`;
  if (!best?.isbn) {
    const why = google.error ?? openLibrary.error;
    console.log(`${label}\n    NO MATCH${why ? `  (${why})` : ""}`);
  } else {
    const via = best === google ? "google" : "openlibrary";
    console.log(`${label}\n    ${best.agreement.toUpperCase().padEnd(5)} ${best.isbn}  ${best.title}  [${via}]`);
  }
}

const exact = results.filter((result) => result.best?.agreement === "exact").length;
const close = results.filter((result) => result.best?.agreement === "close").length;
const weak = results.filter((result) => result.best?.isbn && result.best.agreement === "none").length;
const missing = results.filter((result) => !result.best?.isbn).length;

console.log("\n-- MATCHING ------------------------------");
console.log(`  exact match : ${exact}`);
console.log(`  close match : ${close}   (needs a human glance)`);
console.log(`  weak match  : ${weak}   (found something, titles disagree)`);
console.log(`  no match    : ${missing}`);
console.log(`\n  usable without review : ${exact}/${books.length}`);
