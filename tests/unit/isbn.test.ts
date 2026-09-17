import { describe, expect, it } from "vitest";
import { formatIsbn13, isbn10To13, isValidIsbn10, isValidIsbn13, looksLikeIsbn, normalizeIsbn } from "@/lib/isbn";

describe("ISBN helpers", () => {
  it("accepts valid ISBN-13s with or without separators", () => {
    expect(normalizeIsbn("9780064440202")).toBe("9780064440202");
    expect(normalizeIsbn("978-0-06-444020-2")).toBe("9780064440202");
    expect(normalizeIsbn(" 978 0439 708180 ")).toBe("9780439708180");
  });

  it("converts ISBN-10, including an X check digit", () => {
    expect(normalizeIsbn("0064440206")).toBe("9780064440202");
    expect(isbn10To13("080442957X")).toBe("9780804429573");
    expect(normalizeIsbn("0-8044-2957-x")).toBe("9780804429573");
  });

  it("accepts 979-prefixed ISBNs", () => {
    expect(isValidIsbn13("9791032305690")).toBe(true);
  });

  it("strips a price add-on from scanned barcodes", () => {
    expect(normalizeIsbn("978006444020251299")).toBe("9780064440202");
    expect(normalizeIsbn("978006444020299")).toBe("9780064440202");
  });

  it("rejects bad checksums, non-book EANs, and junk", () => {
    expect(normalizeIsbn("9780064440203")).toBeNull();
    expect(normalizeIsbn("0064440207")).toBeNull();
    expect(normalizeIsbn("0123456789012")).toBeNull();
    expect(normalizeIsbn("frog and toad")).toBeNull();
    expect(normalizeIsbn("")).toBeNull();
    expect(isValidIsbn10("12345")).toBe(false);
  });

  it("detects ISBN-like search input", () => {
    expect(looksLikeIsbn("978-0-06-444020-2")).toBe(true);
    expect(looksLikeIsbn("080442957X")).toBe(true);
    expect(looksLikeIsbn("Frog and Toad")).toBe(false);
    expect(looksLikeIsbn("2026")).toBe(false);
  });

  it("formats for display", () => {
    expect(formatIsbn13("9780064440202")).toBe("978-006444020-2");
  });
});
