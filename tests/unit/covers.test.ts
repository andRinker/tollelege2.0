import { describe, expect, it } from "vitest";
import { coverCandidates, coverPhotoUrl, isCoverPhotoUrl, isStoredCover } from "@/lib/covers";
import { jpegOf } from "../helpers/images";
import { bestCover, imageSize, probeCover } from "@/server/isbn-lookup/cover";

const imageFetch = (images: Record<string, Uint8Array | number>): typeof fetch =>
  (async (input: RequestInfo | URL) => {
    const image = images[String(input)];
    if (image === undefined) throw new Error("offline");
    return typeof image === "number" ? new Response("no", { status: image }) : new Response(image.slice());
  }) as typeof fetch;

describe("cover addresses", () => {
  it("offers the larger sizes of a catalogue cover first, then the stored one", () => {
    expect(coverCandidates("https://covers.openlibrary.org/b/id/1-M.jpg")).toEqual([
      "https://covers.openlibrary.org/b/id/1-L.jpg",
      "https://covers.openlibrary.org/b/id/1-M.jpg",
    ]);
    const google = "https://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=1&source=gbs_api";
    expect(coverCandidates(google)[0]).toContain("zoom=3");
    expect(coverCandidates(google).at(-1)).toBe(google);
    expect(coverCandidates("https://example.org/x.jpg")).toEqual(["https://example.org/x.jpg"]);
  });

  it("knows a teacher's photo from a link", () => {
    const photo = coverPhotoUrl("0b0c7b0e-4c52-4d8b-9f79-3f4d9f0b2c11", 1700000000000);
    expect(isCoverPhotoUrl(photo)).toBe(true);
    expect(isStoredCover(photo)).toBe(true);
    expect(isStoredCover("https://covers.openlibrary.org/b/id/1-L.jpg")).toBe(true);
    expect(isStoredCover("http://covers.openlibrary.org/b/id/1-L.jpg")).toBe(false);
    expect(isStoredCover("/api/covers/not-a-book")).toBe(false);
  });
});

describe("cover quality", () => {
  it("reads the size of a JPEG, PNG and GIF", () => {
    expect(imageSize(jpegOf(400, 600))).toEqual({ width: 400, height: 600 });
    const png = new Uint8Array(32);
    png.set([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 144, 0, 0, 2, 88]);
    expect(imageSize(png)).toEqual({ width: 400, height: 600 });
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("calls a missing or tiny image bad, and an unreachable one nothing at all", async () => {
    const fetchFn = imageFetch({ "https://a/ok": jpegOf(400, 600), "https://a/tiny": jpegOf(1, 1), "https://a/gone": 404, "https://a/down": 503 });
    expect(await probeCover("https://a/ok", fetchFn)).toMatchObject({ status: "ok" });
    expect(await probeCover("https://a/tiny", fetchFn)).toEqual({ status: "bad" });
    expect(await probeCover("https://a/gone", fetchFn)).toEqual({ status: "bad" });
    expect(await probeCover("https://a/down", fetchFn)).toEqual({ status: "unreachable" });
    expect(await probeCover("https://a/offline", fetchFn)).toEqual({ status: "unreachable" });
  });

  it("keeps the sharpest working cover of the catalogues", async () => {
    const fetchFn = imageFetch({
      "https://covers.openlibrary.org/b/id/1-L.jpg": jpegOf(300, 450),
      "https://books.google.com/books/content?id=g&zoom=3": jpegOf(575, 800),
    });
    const google = "https://books.google.com/books/content?id=g&zoom=1";
    expect(await bestCover(["https://covers.openlibrary.org/b/id/1-L.jpg", google], fetchFn)).toBe(
      "https://books.google.com/books/content?id=g&zoom=3",
    );
  });

  it("drops a dead cover for the other catalogue's, and keeps one when nothing could be reached", async () => {
    const dead = imageFetch({ "https://covers.openlibrary.org/b/id/1-L.jpg": 404, "https://b/g.jpg": jpegOf(300, 450) });
    expect(await bestCover(["https://covers.openlibrary.org/b/id/1-L.jpg", "https://b/g.jpg"], dead)).toBe("https://b/g.jpg");
    expect(await bestCover(["https://covers.openlibrary.org/b/id/1-L.jpg"], dead)).toBeNull();
    expect(await bestCover(["https://offline/1.jpg"], imageFetch({}))).toBe("https://offline/1.jpg");
    expect(await bestCover([null, undefined], imageFetch({}))).toBeNull();
  });
});
