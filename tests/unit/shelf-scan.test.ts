import { afterEach, describe, expect, it, vi } from "vitest";
import { matchSpine } from "@/server/shelf-scan/match";
import { readSpines } from "@/server/shelf-scan/vision";

type Volume = { title: string; authors: string[]; isbn13: string };

/** Serves one canned Google Books result set; Open Library answers with nothing. */
function googleReturning(volumes: Volume[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    if (!String(input).includes("googleapis.com")) return Response.json({ docs: [] });
    return Response.json({
      items: volumes.map((volume) => ({
        volumeInfo: {
          title: volume.title,
          authors: volume.authors,
          industryIdentifiers: [{ type: "ISBN_13", identifier: volume.isbn13 }],
        },
      })),
    });
  }) as typeof fetch;
}

describe("grading a spine against a catalogue record", () => {
  afterEach(() => vi.unstubAllEnvs());

  function withKey() {
    vi.stubEnv("GOOGLE_BOOKS_API_KEY", "test-key");
  }

  it("accepts a title that matches with an author that agrees", async () => {
    withKey();
    const match = await matchSpine(
      { title: "That Hideous Strength", author: "C. S. Lewis" },
      googleReturning([{ title: "That Hideous Strength", authors: ["C. S. Lewis"], isbn13: "9781514285503" }]),
    );
    expect(match.candidates[0]).toMatchObject({ isbn13: "9781514285503", confidence: "exact" });
  });

  it("demotes a matching title whose author contradicts the spine", async () => {
    withKey();
    // The real failure this rule exists for: a shelf copy of the Locke/Berkeley/Hume
    // anthology should not quietly become a different book about Kant.
    const match = await matchSpine(
      { title: "The Empiricists", author: "Locke Berkeley Hume" },
      googleReturning([{ title: "Kant and the Empiricists", authors: ["Wayne Waxman"], isbn13: "9780195177398" }]),
    );
    expect(match.candidates[0].confidence).toBe("weak");
  });

  it("treats a subtitle on one side only as the same work", async () => {
    withKey();
    const match = await matchSpine(
      { title: "The Origin of Species", author: "Charles Darwin" },
      googleReturning([{ title: "On the Origin of Species", authors: ["Charles Darwin"], isbn13: "9781500926847" }]),
    );
    expect(match.candidates[0].confidence).toBe("exact");
  });

  it("ignores a record that is not the same book at all", async () => {
    withKey();
    const match = await matchSpine(
      { title: "Hatchet", author: "Gary Paulsen" },
      googleReturning([{ title: "Brian's Winter", authors: ["Gary Paulsen"], isbn13: "9780307929587" }]),
    );
    expect(match.candidates).toEqual([]);
  });

  it("offers the strongest candidates first, so classics can be re-picked by edition", async () => {
    withKey();
    const match = await matchSpine(
      { title: "The Inferno", author: "Dante" },
      googleReturning([
        { title: "The Inferno: A Verse Translation", authors: ["Dante Alighieri"], isbn13: "9780385496988" },
        { title: "The Inferno", authors: ["Dante Alighieri"], isbn13: "9781627887427" },
      ]),
    );
    expect(match.candidates.map((candidate) => candidate.confidence)).toEqual(["exact", "close"]);
    expect(match.candidates[0].isbn13).toBe("9781627887427");
  });

  it("returns nothing rather than throwing when both catalogues fail", async () => {
    withKey();
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(matchSpine({ title: "Holes", author: "Louis Sachar" }, failing)).resolves.toMatchObject({
      candidates: [],
    });
  });
});

describe("reading spines from a photo", () => {
  afterEach(() => vi.unstubAllEnvs());

  function geminiReturning(body: unknown): typeof fetch {
    return (async () =>
      Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] })) as typeof fetch;
  }

  const image = { data: new ArrayBuffer(8), mimeType: "image/jpeg" };

  it("keeps one row per book when two copies stand side by side", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const readings = await readSpines(
      image,
      geminiReturning([
        { title: "Wonder", author: "R. J. Palacio" },
        { title: "Wonder", author: "R. J. Palacio" },
        { title: "Holes", author: "Louis Sachar" },
      ]),
    );
    expect(readings).toEqual([
      { title: "Wonder", author: "R. J. Palacio" },
      { title: "Holes", author: "Louis Sachar" },
    ]);
  });

  it("drops entries with no readable title and keeps a missing author as null", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const readings = await readSpines(
      image,
      geminiReturning([{ title: "   " }, { author: "Nobody" }, { title: "Orthodoxy" }]),
    );
    expect(readings).toEqual([{ title: "Orthodoxy", author: null }]);
  });

  it("refuses to run without a key rather than failing silently", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(readSpines(image, geminiReturning([]))).rejects.toThrow(/GEMINI_API_KEY/);
  });
});
