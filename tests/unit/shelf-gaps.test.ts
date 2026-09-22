import { describe, expect, it } from "vitest";
import { describeGap } from "@/lib/shelf-gaps";

describe("placing a book the scanner couldn't finish", () => {
  it("names the books either side of it", () => {
    expect(describeGap(["Hatchet", null, "Holes"], 1)).toBe("between “Hatchet” and “Holes”");
  });

  it("uses the one neighbour it has at either end of the shelf", () => {
    expect(describeGap([null, "Hatchet", "Holes"], 0)).toBe("before “Hatchet”");
    expect(describeGap(["Hatchet", "Holes", null], 2)).toBe("after “Holes”");
  });

  it("counts within a run, so three unread spines don't all get the same name", () => {
    const shelf = ["Hatchet", null, null, null, "Holes"];
    expect(describeGap(shelf, 1)).toBe("1st of 3, between “Hatchet” and “Holes”");
    expect(describeGap(shelf, 2)).toBe("2nd of 3, between “Hatchet” and “Holes”");
    expect(describeGap(shelf, 3)).toBe("3rd of 3, between “Hatchet” and “Holes”");
  });

  it("counts from the left when there is nothing on the shelf to anchor to", () => {
    expect(describeGap([null, null, null], 0)).toBe("1st from the left");
    expect(describeGap([null, null, null], 2)).toBe("3rd from the left");
  });

  it("skips over other unfinished slots to reach a real neighbour", () => {
    // The run's neighbours are the nearest books, not the adjacent blanks.
    expect(describeGap([null, null, "Holes"], 0)).toBe("1st of 2, before “Holes”");
    expect(describeGap([null, null, "Holes"], 1)).toBe("2nd of 2, before “Holes”");
  });

  it("leaves a spine that was read out of the run of blanks beside it", () => {
    // Slot 1 was read as "Boxcar Children" but matched nothing, so it still needs the
    // teacher — yet it is named by its own title, and it anchors slot 2 rather than
    // joining it. Calling it "1st of 2" would number a run that isn't there.
    const shelf = ["Holes", "Boxcar Children", null];
    expect(describeGap(shelf, 1)).toBe("after “Holes”");
    expect(describeGap(shelf, 2)).toBe("after “Boxcar Children”");
  });

  it("handles the shelf with exactly one thing on it", () => {
    expect(describeGap([null], 0)).toBe("1st from the left");
  });

  it("gets its ordinals right past the teens", () => {
    const shelf: (string | null)[] = Array.from({ length: 25 }, () => null);
    expect(describeGap(shelf, 10)).toBe("11th from the left");
    expect(describeGap(shelf, 11)).toBe("12th from the left");
    expect(describeGap(shelf, 12)).toBe("13th from the left");
    expect(describeGap(shelf, 20)).toBe("21st from the left");
    expect(describeGap(shelf, 21)).toBe("22nd from the left");
  });
});
