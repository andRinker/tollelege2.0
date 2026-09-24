import { describe, expect, it } from "vitest";
import { cropPixels, FULL_FRAME, isFullFrame, MIN_CROP, moveBox, moveEdge } from "@/lib/crop";

describe("cropping a shelf photo", () => {
  it("keeps each edge inside the photo and clear of the edge opposite it", () => {
    expect(moveEdge(FULL_FRAME, "top", -0.5).top).toBe(0);
    expect(moveEdge(FULL_FRAME, "bottom", 1.5).bottom).toBe(1);
    const squeezed = moveEdge({ ...FULL_FRAME, bottom: 0.5 }, "top", 0.9);
    expect(squeezed.top).toBeCloseTo(0.5 - MIN_CROP);
    expect(moveEdge({ ...FULL_FRAME, left: 0.6 }, "right", 0.1).right).toBeCloseTo(0.6 + MIN_CROP);
  });

  it("slides the whole box without changing its size or leaving the photo", () => {
    const band = { left: 0, top: 0.3, right: 1, bottom: 0.6 };
    expect(moveBox(band, 0, 0.1)).toEqual({ left: 0, top: 0.4, right: 1, bottom: expect.closeTo(0.7) });
    expect(moveBox(band, 0.5, 0.9)).toEqual({ left: 0, top: expect.closeTo(0.7), right: 1, bottom: 1 });
  });

  it("turns a box into whole pixels of the full-size photo", () => {
    expect(cropPixels({ left: 0, top: 0.25, right: 1, bottom: 0.5 }, 4000, 3000)).toEqual({ x: 0, y: 750, width: 4000, height: 750 });
    // Never a zero-sized crop, however thin.
    expect(cropPixels({ left: 0.5, top: 0.5, right: 0.5, bottom: 0.5 }, 10, 10)).toMatchObject({ width: 1, height: 1 });
  });

  it("knows an untouched box means the whole photo", () => {
    expect(isFullFrame(FULL_FRAME)).toBe(true);
    expect(isFullFrame(moveEdge(FULL_FRAME, "top", 0.1))).toBe(false);
  });
});
