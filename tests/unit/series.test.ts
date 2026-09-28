import { describe, expect, it } from "vitest";
import { formatSeriesNumber, parseSeries, seriesKey } from "@/lib/series";

describe("parseSeries", () => {
  it.each([
    ["The 39 clues ; bk. 1", "The 39 Clues", 1],
    ["Beyond the Spiderwick chronicles -- 1", "Beyond the Spiderwick Chronicles", 1],
    ["Magic tree house ; #1", "Magic Tree House", 1],
    ["(Harry Potter ; 7)", "Harry Potter", 7],
    ["A Series of Unfortunate Events, book 3", "A Series of Unfortunate Events", 3],
    ["Warriors: The New Prophecy ; 2", "Warriors: The New Prophecy", 2],
    ["The Baby-sitters Club (Graphic Novel) ; 1", "The Baby-sitters Club (Graphic Novel)", 1],
    ["Diary of a wimpy kid", "Diary of a Wimpy Kid", null],
    ["Dog Man ;", "Dog Man", null],
    ["Wings of Fire ; v. 1.5", "Wings of Fire", 1.5],
  ])("reads %j", (raw, name, number) => {
    expect(parseSeries(raw)).toEqual({ name, number });
  });

  it("gives nothing for nothing", () => {
    expect(parseSeries("")).toBeNull();
    expect(parseSeries(" ; 3")).toBeNull();
    expect(parseSeries(null)).toBeNull();
  });
});

describe("seriesKey", () => {
  it("treats spellings of one series as one", () => {
    expect(seriesKey("The 39 Clues")).toBe(seriesKey("39 clues"));
    expect(seriesKey("Dork Diaries")).toBe(seriesKey("dork  diaries"));
    expect(seriesKey("Dog Man")).not.toBe(seriesKey("Dog Days"));
  });
});

describe("formatSeriesNumber", () => {
  it("shows whole numbers plainly", () => {
    expect(formatSeriesNumber(3)).toBe("3");
    expect(formatSeriesNumber(1.5)).toBe("1.5");
    expect(formatSeriesNumber(null)).toBe("");
  });
});
