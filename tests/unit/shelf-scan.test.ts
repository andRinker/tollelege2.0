import { afterEach, describe, expect, it, vi } from "vitest";
import { matchSpine } from "@/server/shelf-scan/match";
import { findOwned } from "@/server/shelf-scan/owned";
import { mergeLooks, scanShelf, tidyShelf } from "@/server/shelf-scan";
import { fragmentFits, leadAuthor, sameTitle } from "@/server/shelf-scan/titles";
import { configuredModel, readShelf, readSpines, ShelfScanUnavailableError } from "@/server/shelf-scan/vision";

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

  describe("when the first search finds nothing", () => {
    /** Open Library, answering only the searches `knows` accepts; Google isn't configured. */
    function openLibrary(knows: (query: { title: string | null; author: string | null }) => Volume[]) {
      const searches: { title: string | null; author: string | null }[] = [];
      const fetchFn = (async (input: RequestInfo | URL) => {
        const params = new URL(String(input)).searchParams;
        const query = { title: params.get("title"), author: params.get("author") };
        searches.push(query);
        return Response.json({
          docs: knows(query).map((volume) => ({ title: volume.title, author_name: volume.authors, isbn: [volume.isbn13] })),
        });
      }) as typeof fetch;
      return { fetchFn, searches };
    }
    const frindle = { title: "Frindle", authors: ["Andrew Clements"], isbn13: "9780689818769" };

    it("searches by the first of two names printed on the spine", async () => {
      // Author and illustrator, as the spine prints them. As one author, nothing has it.
      const { fetchFn, searches } = openLibrary((query) => (query.author === "Clements" ? [frindle] : []));
      const match = await matchSpine({ title: "Frindle", author: "Clements/Selznick" }, fetchFn);
      expect(searches).toEqual([{ title: "Frindle", author: "Clements" }]);
      expect(match.candidates[0]).toMatchObject({ isbn13: frindle.isbn13, confidence: "exact" });
    });

    it("tries the title alone, and still grades against the author read", async () => {
      const { fetchFn, searches } = openLibrary((query) => (query.author ? [] : [frindle]));
      const match = await matchSpine({ title: "Frindle", author: "Clements" }, fetchFn);
      expect(searches.map((search) => search.author)).toEqual(["Clements", null]);
      expect(match.candidates[0]).toMatchObject({ isbn13: frindle.isbn13, confidence: "exact" });
    });

    it("finds a title with a letter misread among its author's books, as one to check", async () => {
      const jumbies = { title: "The Rise of the Jumbies", authors: ["Tracey Baptiste"], isbn13: "9781616206154" };
      const other = { title: "The Jumbies", authors: ["Tracey Baptiste"], isbn13: "9781616205942" };
      const { fetchFn, searches } = openLibrary((query) => (query.title ? [] : [other, jumbies]));
      const match = await matchSpine({ title: "RISE of the JUMBLES", author: "Baptiste" }, fetchFn);
      expect(searches.at(-1)).toEqual({ title: null, author: "Baptiste" });
      expect(match.candidates).toEqual([expect.objectContaining({ isbn13: jumbies.isbn13, confidence: "weak" })]);
    });

    it("doesn't take a misread title by someone else", async () => {
      const { fetchFn } = openLibrary(() => [{ title: "Rise of the Jumbies", authors: ["Someone Else"], isbn13: "9781616206154" }]);
      expect((await matchSpine({ title: "Rise of the Jumbles", author: "Baptiste" }, fetchFn)).candidates).toEqual([]);
    });
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

describe("comparing what a spine says", () => {
  it("takes the first of several names", () => {
    expect(leadAuthor("Clements/Selznick")).toBe("Clements");
    expect(leadAuthor("VERONICA CHAMBERS / SUJEAN RIM")).toBe("VERONICA CHAMBERS");
    expect(leadAuthor("Balliett & Helquist")).toBe("Balliett");
    expect(leadAuthor("Laurie Halse Anderson")).toBe("Laurie Halse Anderson");
    expect(leadAuthor(null)).toBeNull();
  });

  it("forgives a stray letter in a long word, and nothing more", () => {
    expect(sameTitle("RISE of the JUMBLES", "Rise of the Jumbies")).toBe(true);
    expect(sameTitle("The One and Only Ivan", "The One and Only Bob")).toBe(false);
    expect(sameTitle("Holes", "Hole")).toBe(false);
    expect(sameTitle("Cat", "Hat")).toBe(false);
  });

  it("fits a fragment only to a title whose words it starts, in order", () => {
    expect(fragmentFits("THE WA SAVED", "The War That Saved My Life")).toBe(true);
    expect(fragmentFits("SAVED WAR", "The War That Saved My Life")).toBe(false);
    expect(fragmentFits("Level V", "Incident at Hawk's Hill")).toBe(false);
  });
});

describe("reading spines from a photo", () => {
  afterEach(() => vi.unstubAllEnvs());

  function geminiReturning(body: unknown): typeof fetch {
    return (async () =>
      Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] })) as typeof fetch;
  }

  const image = { data: new ArrayBuffer(8), mimeType: "image/jpeg" };

  it("keeps one row per book when two copies stand side by side, remembering there were two", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const sightings = await readSpines(
      image,
      geminiReturning([
        { title: "Wonder", author: "R. J. Palacio" },
        { title: "Wonder", author: "R. J. Palacio" },
        { title: "Holes", author: "Louis Sachar" },
      ]),
    );
    expect(sightings).toEqual([
      { reading: { title: "Wonder", author: "R. J. Palacio" }, fragment: null, copies: 2 },
      { reading: { title: "Holes", author: "Louis Sachar" }, fragment: null, copies: 1 },
    ]);
  });

  it("keeps a missing author as null", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const sightings = await readSpines(image, geminiReturning([{ title: "Orthodoxy" }]));
    expect(sightings).toEqual([{ reading: { title: "Orthodoxy", author: null }, fragment: null, copies: 1 }]);
  });

  it("keeps a spine it could see but not read, in its place on the shelf", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const sightings = await readSpines(
      image,
      geminiReturning([
        { title: "Hatchet", author: "Gary Paulsen" },
        { title: null, fragment: "The Mouse and the" },
        { title: "Holes", author: "Louis Sachar" },
      ]),
    );
    expect(sightings).toEqual([
      { reading: { title: "Hatchet", author: "Gary Paulsen" }, fragment: null, copies: 1 },
      { reading: null, fragment: "The Mouse and the", copies: 1 },
      { reading: { title: "Holes", author: "Louis Sachar" }, fragment: null, copies: 1 },
    ]);
  });

  it("never folds two unread spines together — they are two different books to go and look at", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const sightings = await readSpines(image, geminiReturning([{ title: null }, { title: "   " }, {}]));
    expect(sightings).toEqual([
      { reading: null, fragment: null, copies: 1 },
      { reading: null, fragment: null, copies: 1 },
      { reading: null, fragment: null, copies: 1 },
    ]);
  });

  it("reads one shelf, and counts the spines it left out from others in the frame", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    let prompt = "";
    const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text;
      const answer = { spines: [{ title: "Holes", author: "Louis Sachar" }], otherShelfSpines: 4 };
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] });
    }) as typeof fetch;
    const reading = await readShelf(image, fetchFn, { expected: 30 });
    expect(reading).toEqual({ sightings: [{ reading: { title: "Holes", author: "Louis Sachar" }, fragment: null, copies: 1 }], otherShelf: 4 });
    expect(prompt).toContain("Read only the");
    // The count only settles which shelf was meant, and says so.
    expect(prompt).toContain("counted about 30 books on theirs");
    expect(prompt).toContain("Never add or leave out spines to match it.");
  });

  it("leaves the count out of the first reading when there isn't one", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    let prompt = "";
    const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text;
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ spines: [] }) }] } }] });
    }) as typeof fetch;
    expect(await readShelf(image, fetchFn)).toEqual({ sightings: [], otherShelf: 0 });
    expect(prompt).not.toContain("counted");
  });

  it("refuses to run without a key rather than failing silently", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(readSpines(image, geminiReturning([]))).rejects.toThrow(/GEMINI_API_KEY/);
  });
});

describe("recognising a book already on the shelves", () => {
  const shelf = [
    { id: "book-1", title: "Charlotte's Web", authors: ["E. B. White"], isbn13: "9780064400558", copies: 2 },
    { id: "book-2", title: "Hatchet", authors: ["Gary Paulsen"], isbn13: null, copies: 1 },
  ];

  function match(reading: { title: string; author: string | null }, isbns: string[]) {
    return {
      reading,
      candidates: isbns.map((isbn13) => ({
        isbn13,
        title: reading.title,
        authors: reading.author ? [reading.author] : [],
        coverUrl: null,
        confidence: "exact" as const,
      })),
    };
  }

  it("matches on ISBN when the same edition is already owned", () => {
    const owned = findOwned(match({ title: "Charlotte's Web", author: "E. B. White" }, ["9780064400558"]), shelf);
    expect(owned).toMatchObject({ bookId: "book-1", copies: 2, via: "isbn" });
  });

  it("still recognises the book when the shelf copy is a different printing", () => {
    // The bug this fixes: a different ISBN used to create a second "Charlotte's Web".
    const owned = findOwned(match({ title: "Charlotte's Web", author: "E. B. White" }, ["9780060263850"]), shelf);
    expect(owned).toMatchObject({ bookId: "book-1", via: "title" });
  });

  it("recognises a book catalogued without an ISBN at all", () => {
    const owned = findOwned(match({ title: "Hatchet", author: "Gary Paulsen" }, ["9781442403321"]), shelf);
    expect(owned).toMatchObject({ bookId: "book-2", via: "title" });
  });

  it("does not claim a book the teacher does not have", () => {
    expect(findOwned(match({ title: "Holes", author: "Louis Sachar" }, ["9780440228592"]), shelf)).toBeNull();
  });

  it("does not match a same-named book by a different author", () => {
    const owned = findOwned(match({ title: "Charlotte's Web", author: "Someone Else" }, ["9781111111111"]), shelf);
    expect(owned).toBeNull();
  });
});

describe("checking a shelf against the teacher's count", () => {
  afterEach(() => vi.unstubAllEnvs());

  const read = (title: string, copies = 1) => ({ reading: { title, author: null }, fragment: null, copies });
  const unread = (fragment: string | null = null) => ({ reading: null, fragment, copies: 1 });
  const titles = (sightings: { reading: { title: string } | null }[]) => sightings.map((s) => s.reading?.title ?? "?");

  it("keeps the first reading when the second saw no more", () => {
    const first = [read("Hatchet"), read("Holes")];
    expect(mergeLooks(first, [read("Hatchet")])).toEqual(first.map((s) => ({ ...s, secondLook: false, partial: null })));
  });

  it("takes the fuller second look, flagging only the titles the first never saw", () => {
    const merged = mergeLooks([read("Hatchet"), unread(), read("Holes")], [read("Hatchet", 2), read("Wonder"), unread(), unread("The Mou"), read("Holes")]);
    expect(merged.map(({ reading, copies, secondLook }) => [reading?.title ?? "?", copies, secondLook])).toEqual([
      // A second copy of a book already found is just another copy.
      ["Hatchet", 2, false],
      ["Wonder", 1, true],
      ["?", 1, false],
      // The first reading saw one unreadable spine; a second is new.
      ["?", 1, true],
      ["Holes", 1, false],
    ]);
  });

  it("never takes a book off the shelf that the first reading found, and puts it back beside its nearer neighbour", () => {
    const first = [read("Alchemist"), unread(), unread(), read("Deathly Hallows"), read("Boxcar")];
    const second = [read("Alchemist"), read("Frog and Toad"), unread(), unread(), read("Boxcar"), unread()];
    expect(titles(mergeLooks(first, second))).toEqual(["Alchemist", "Frog and Toad", "?", "?", "Deathly Hallows", "Boxcar", "?"]);
  });

  it("recognises a book both readings saw, however differently they spelled it", () => {
    // From a real 48-book shelf: the second look fixed "Jumbles" and filled in authors, and
    // putting the first reading's versions back as well turned 48 books into 51.
    const first = [
      { reading: { title: "The One and Only Bob", author: null }, fragment: null, copies: 1 },
      { reading: { title: "Crossing the Pressure Line", author: "Laura Bird" }, fragment: null, copies: 1 },
      { reading: { title: "RISE of the JUMBLES", author: "Baptiste" }, fragment: null, copies: 1 },
    ];
    const second = [
      { reading: { title: "THE ONE AND ONLY BOB", author: "Applegate" }, fragment: null, copies: 1 },
      { reading: { title: "Crossing the Pressure Line", author: "Laura Anne Bird" }, fragment: null, copies: 1 },
      read("Frindle"),
      { reading: { title: "Rise of the Jumbies", author: "Baptiste" }, fragment: null, copies: 1 },
    ];
    const merged = mergeLooks(first, second);
    expect(merged.map(({ reading, secondLook }) => [reading?.title, secondLook])).toEqual([
      ["THE ONE AND ONLY BOB", false],
      ["Crossing the Pressure Line", false],
      ["Frindle", true],
      ["Rise of the Jumbies", false],
    ]);
  });

  describe("tidying a reading", () => {
    const looked = (reading: { title: string; author: string | null } | null, fragment: string | null = null, copies = 1) => ({
      reading,
      fragment,
      copies,
      secondLook: false,
      partial: null,
    });

    it("folds copies standing side by side into one row, whatever author each printed", () => {
      const tidy = tidyShelf([
        looked({ title: "Tears of a Tiger", author: "Sharon M. Draper" }),
        looked({ title: "Tears of a Tiger", author: "DRAPER" }),
        looked({ title: "Dillon Dillon", author: "Banks" }),
      ]);
      expect(tidy.map(({ reading, copies }) => [reading?.title, reading?.author, copies])).toEqual([
        ["Tears of a Tiger", "Sharon M. Draper", 2],
        ["Dillon Dillon", "Banks", 1],
      ]);
    });

    it("keeps apart same-named books whose authors disagree, and copies that aren't side by side", () => {
      const tidy = tidyShelf([
        looked({ title: "Home", author: "Toni Morrison" }),
        looked({ title: "Home", author: "Marilynne Robinson" }),
        looked({ title: "Holes", author: null }),
        looked({ title: "Home", author: "Marilynne Robinson" }),
      ]);
      expect(tidy.map(({ copies }) => copies)).toEqual([1, 1, 1, 1]);
    });

    it("offers a partly read spine as the book beside it when its letters fit, and nothing else", () => {
      const tidy = tidyShelf([
        looked(null, "THE WA SAVED"),
        looked({ title: "The War That Saved My Life", author: "Kimberly Brubaker Bradley" }),
        looked({ title: "Incident at Hawk's Hill", author: "Eckert" }),
        // A reading-level sticker on a leaning cover fits nothing.
        looked(null, "Level V"),
        looked(null, "THE WAR"),
        looked(null, null),
      ]);
      expect(tidy.map(({ reading, partial, fragment }) => [reading?.title ?? "?", partial, fragment])).toEqual([
        ["The War That Saved My Life", "THE WA SAVED", "THE WA SAVED"],
        ["The War That Saved My Life", null, null],
        ["Incident at Hawk's Hill", null, null],
        ["?", null, "Level V"],
        // One legible word is too little to go on, even beside a match.
        ["?", null, "THE WAR"],
        ["?", null, null],
      ]);
    });
  });

  it("keeps a partly read copy as a gap unless the book beside it was found", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const image = { data: new ArrayBuffer(8), mimeType: "image/jpeg" };
    const answer = [{ title: null, fragment: "THE WA SAVED" }, { title: "The War That Saved My Life", author: "Bradley" }];
    const shelf = (catalogueKnows: boolean) =>
      (async (input: RequestInfo | URL) => {
        if (String(input).includes("generativelanguage")) {
          return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] });
        }
        const docs = catalogueKnows
          ? [{ title: "The War That Saved My Life", author_name: ["Kimberly Brubaker Bradley"], isbn: ["9780147510488"] }]
          : [];
        return Response.json({ docs });
      }) as typeof fetch;

    const found = await scanShelf(image, { fetchFn: shelf(true) });
    expect(found.slots.map((slot) => [slot.proposal?.candidates[0].isbn13 ?? null, slot.partial, slot.fragment])).toEqual([
      ["9780147510488", "THE WA SAVED", "THE WA SAVED"],
      ["9780147510488", null, null],
    ]);

    const unknown = await scanShelf(image, { fetchFn: shelf(false) });
    expect(unknown.slots[0]).toMatchObject({ reading: null, proposal: null, partial: null, fragment: "THE WA SAVED" });
    expect(unknown.needsAttention).toBe(2);
  });

  describe("the second look", () => {
    const image = { data: new ArrayBuffer(8), mimeType: "image/jpeg" };

    /** Gemini answers each call with the next reading; every catalogue knows nothing. */
    function readings(...answers: unknown[][]) {
      const prompts: string[] = [];
      const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (!String(input).includes("generativelanguage")) return Response.json({ docs: [] });
        const body = JSON.parse(String(init?.body));
        prompts.push(body.contents[0].parts[0].text);
        const answer = answers[prompts.length - 1];
        if (!answer) return new Response("overloaded", { status: 503 });
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] });
      }) as typeof fetch;
      return { fetchFn, prompts };
    }

    it("isn't taken without a count, or when the count is met", async () => {
      vi.stubEnv("GEMINI_API_KEY", "test-key");
      const shelf = [{ title: "Hatchet" }, { title: "Hatchet" }, { title: "Holes" }];
      for (const expected of [null, 3]) {
        const { fetchFn, prompts } = readings(shelf);
        const scan = await scanShelf(image, { fetchFn, expected });
        expect(prompts).toHaveLength(1);
        expect(scan.tally).toEqual({ expected, seen: 3, missing: 0, foundOnSecondLook: 0 });
      }
    });

    it("is taken when the photo comes up short, knowing the count and the first reading", async () => {
      vi.stubEnv("GEMINI_API_KEY", "test-key");
      const { fetchFn, prompts } = readings(
        [{ title: "Hatchet" }, { title: "Holes" }],
        [{ title: "Hatchet" }, { title: "Wonder" }, { title: "Holes" }],
      );
      const scan = await scanShelf(image, { fetchFn, expected: 5 });
      expect(prompts).toHaveLength(2);
      expect(prompts[1]).toContain("counted 5 books on this shelf. A first reading found 2:");
      expect(prompts[1]).toContain("1. Hatchet");
      expect(prompts[1]).toContain("Do not add a spine");
      expect(scan.tally).toEqual({ expected: 5, seen: 3, missing: 2, foundOnSecondLook: 1 });
      expect(scan.slots.map((slot) => [slot.reading?.title, slot.secondLook])).toEqual([
        ["Hatchet", false],
        ["Wonder", true],
        ["Holes", false],
      ]);
    });

    it("keeps the first reading if the second look fails", async () => {
      vi.stubEnv("GEMINI_API_KEY", "test-key");
      const { fetchFn } = readings([{ title: "Hatchet" }]);
      const scan = await scanShelf(image, { fetchFn, expected: 4 });
      expect(scan.slots).toHaveLength(1);
      expect(scan.tally).toEqual({ expected: 4, seen: 1, missing: 3, foundOnSecondLook: 0 });
    });
  });
});

describe("when the reader fails", () => {
  afterEach(() => vi.unstubAllEnvs());
  const image = { data: new ArrayBuffer(8), mimeType: "image/jpeg" };
  const answer = (candidate: object) => Response.json({ candidates: [candidate] });
  const ok = (text: string) => answer({ finishReason: "STOP", content: { parts: [{ text }] } });

  /** Answers each call with the next response in line. */
  function responses(...queue: (Response | Error)[]) {
    let calls = 0;
    const fetchFn = (async () => {
      const next = queue[calls++];
      if (next instanceof Error) throw next;
      return next;
    }) as unknown as typeof fetch;
    return { fetchFn, calls: () => calls };
  }

  async function failure(fetchFn: typeof fetch) {
    try {
      await readShelf(image, fetchFn);
    } catch (error) {
      return error as ShelfScanUnavailableError;
    }
    throw new Error("expected the reading to fail");
  }

  it("tries once more when the service is busy, and succeeds", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const { fetchFn, calls } = responses(
      new Response('{"error":{"message":"The model is overloaded."}}', { status: 503 }),
      ok(JSON.stringify({ spines: [{ title: "Holes" }] })),
    );
    expect((await readShelf(image, fetchFn)).sightings).toHaveLength(1);
    expect(calls()).toBe(2);
  });

  it("says a busy service is busy after the retry, and keeps Google's reason for the log", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const busy = () => new Response('{"error":{"message":"Resource has been exhausted (e.g. check quota)."}}', { status: 429 });
    const error = await failure(responses(busy(), busy()).fetchFn);
    expect(error.reason).toBe("busy");
    expect(error.message).toContain("HTTP 429");
    expect(error.message).toContain("check quota");
  });

  it("doesn't retry a refused request, which would only be refused again", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const { fetchFn, calls } = responses(new Response('{"error":{"message":"API key not valid."}}', { status: 400 }));
    const error = await failure(fetchFn);
    expect(error.reason).toBe("refused");
    expect(error.message).toContain("API key not valid");
    expect(calls()).toBe(1);
  });

  it("calls a timeout a timeout", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    expect((await failure(responses(timeout).fetchFn)).reason).toBe("timeout");
  });

  it("won't start a reading there's no time left to finish", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const { fetchFn, calls } = responses(ok("{}"));
    await expect(readShelf(image, fetchFn, { deadline: Date.now() + 1000 })).rejects.toMatchObject({ reason: "timeout" });
    expect(calls()).toBe(0);
  });

  it("reads an answer that arrives in several parts, skipping the model's thoughts", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const { fetchFn } = responses(
      answer({
        finishReason: "STOP",
        content: { parts: [{ text: "planning…", thought: true }, { text: '{"spines":[{"title":"Ho' }, { text: 'les"}]}' }] },
      }),
    );
    expect((await readShelf(image, fetchFn)).sightings).toEqual([{ reading: { title: "Holes", author: null }, fragment: null, copies: 1 }]);
  });

  it("reports an answer cut short or withheld, rather than an empty shelf", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const cut = await failure(responses(answer({ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"spines":[{"ti' }] } })).fetchFn);
    expect(cut).toMatchObject({ reason: "unreadable" });
    expect(cut.message).toContain("MAX_TOKENS");
    const withheld = await failure(responses(answer({ finishReason: "SAFETY" })).fetchFn);
    expect(withheld.message).toContain("SAFETY");
  });
});

describe("choosing the model", () => {
  afterEach(() => vi.unstubAllEnvs());
  const image = { data: new ArrayBuffer(8), mimeType: "image/jpeg" };

  it("forgives the ways a person might type a model's name", () => {
    expect(configuredModel(undefined)).toBe("gemini-flash-latest");
    expect(configuredModel("  ")).toBe("gemini-flash-latest");
    expect(configuredModel("3.5-flash-lite")).toBe("gemini-3.5-flash-lite");
    expect(configuredModel("3.5 Flash Lite")).toBe("gemini-3.5-flash-lite");
    expect(configuredModel("models/gemini-3.8-flash")).toBe("gemini-3.8-flash");
  });

  it("falls back to the default when Google doesn't know the configured model", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_MODEL", "gemini-9-imaginary");
    const urls: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      if (String(input).includes("imaginary")) return new Response('{"error":{"message":"not found"}}', { status: 404 });
      return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"spines":[{"title":"Holes"}]}' }] } }] });
    }) as typeof fetch;
    expect((await readShelf(image, fetchFn)).sightings).toHaveLength(1);
    expect(urls.map((url) => url.match(/models\/([^:]+)/)?.[1])).toEqual(["gemini-9-imaginary", "gemini-flash-latest"]);
  });

  it("passes a thinking level through only when one is set", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const bodies: { generationConfig: { thinkingConfig?: unknown } }[] = [];
    const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"spines":[]}' }] } }] });
    }) as typeof fetch;
    await readShelf(image, fetchFn);
    vi.stubEnv("GEMINI_THINKING", "Low");
    await readShelf(image, fetchFn);
    expect(bodies[0].generationConfig.thinkingConfig).toBeUndefined();
    expect(bodies[1].generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
  });
});
