import { describe, expect, it } from "vitest";
import { planReconcile, settleSeries } from "@/lib/reconcile";
import { looseSeriesKey } from "@/lib/series";

describe("looseSeriesKey", () => {
  it("joins spellings that differ only by dressing", () => {
    const narnia = ["Narnia", "Chronicles of Narnia", "The Chronicles of Narnia", "The Chronicles of Narnia Series", "chronicles of narnia"];
    expect(new Set(narnia.map(looseSeriesKey)).size).toBe(1);
    expect(looseSeriesKey("Percy Jackson & the Olympians")).toBe(looseSeriesKey("Percy Jackson and the Olympians"));
    expect(looseSeriesKey("Harry Potter")).toBe(looseSeriesKey("Harry Potter Series"));
  });

  it("keeps different series apart", () => {
    expect(looseSeriesKey("Beyond the Spiderwick Chronicles")).not.toBe(looseSeriesKey("The Spiderwick Chronicles"));
    expect(looseSeriesKey("Magic Tree House")).not.toBe(looseSeriesKey("Magic Tree House: Merlin Missions"));
    expect(looseSeriesKey("The Series")).toBe("series");
  });
});

describe("settleSeries", () => {
  it("takes the library's own spelling, the most used", () => {
    const known = new Map([["The Chronicles of Narnia", 5], ["Narnia", 1]]);
    expect(settleSeries("Chronicles of Narnia", known)).toBe("The Chronicles of Narnia");
    expect(settleSeries("Harry Potter", known)).toBe("Harry Potter");
  });
});

describe("planReconcile", () => {
  const library = [
    { id: "1", series: "The Chronicles of Narnia", authors: ["C. S. Lewis"] },
    { id: "2", series: "The Chronicles of Narnia", authors: ["C. S. Lewis"] },
    { id: "3", series: "Chronicles of Narnia", authors: ["Clive Staples Lewis"] },
    { id: "4", series: "Narnia", authors: ["C.S. Lewis"] },
    { id: "5", series: "Beyond the Spiderwick Chronicles", authors: ["Tony DiTerlizzi", "Holly Black"] },
    { id: "6", series: null, authors: ["Lewis Carroll"] },
  ];

  it("settles series and authors on the most used spelling, and touches nothing else", () => {
    const changes = planReconcile(library);
    expect(changes).toEqual([
      { bookId: "3", field: "series", from: "Chronicles of Narnia", to: "The Chronicles of Narnia" },
      { bookId: "3", field: "authors", from: ["Clive Staples Lewis"], to: ["C. S. Lewis"] },
      { bookId: "4", field: "series", from: "Narnia", to: "The Chronicles of Narnia" },
      { bookId: "4", field: "authors", from: ["C.S. Lewis"], to: ["C. S. Lewis"] },
    ]);
  });

  it("is settled once settled", () => {
    expect(planReconcile(library.map((book) => ({ ...book, series: book.series && "The Chronicles of Narnia", authors: book.authors.map((a) => (a.includes("Lewis") && a !== "Lewis Carroll" ? "C. S. Lewis" : a)) })).filter((b) => b.id !== "5"))).toEqual([]);
  });
});
