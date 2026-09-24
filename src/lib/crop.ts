/**
 * A crop of a photo as fractions of its width and height, so it means the same thing on a
 * phone's preview as on the full-size picture it is later cut from.
 */
export type CropBox = { left: number; top: number; right: number; bottom: number };
export type CropEdge = keyof CropBox;

export const FULL_FRAME: CropBox = { left: 0, top: 0, right: 1, bottom: 1 };

/** The smallest a crop may get along either side, so a slip of the finger can't collapse it. */
export const MIN_CROP = 0.1;

export function isFullFrame(box: CropBox): boolean {
  return box.left <= 0 && box.top <= 0 && box.right >= 1 && box.bottom >= 1;
}

/** Moves one edge, keeping it inside the photo and at least `MIN_CROP` from its opposite. */
export function moveEdge(box: CropBox, edge: CropEdge, value: number): CropBox {
  const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
  switch (edge) {
    case "left":
      return { ...box, left: clamp(value, 0, box.right - MIN_CROP) };
    case "right":
      return { ...box, right: clamp(value, box.left + MIN_CROP, 1) };
    case "top":
      return { ...box, top: clamp(value, 0, box.bottom - MIN_CROP) };
    case "bottom":
      return { ...box, bottom: clamp(value, box.top + MIN_CROP, 1) };
  }
}

/** Slides the whole box, keeping its size and keeping it inside the photo. */
export function moveBox(box: CropBox, dx: number, dy: number): CropBox {
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  const left = Math.min(1 - width, Math.max(0, box.left + dx));
  const top = Math.min(1 - height, Math.max(0, box.top + dy));
  return { left, top, right: left + width, bottom: top + height };
}

/** The pixels a box covers in a photo of the given size, as whole pixels inside it. */
export function cropPixels(box: CropBox, width: number, height: number) {
  const x = Math.max(0, Math.floor(box.left * width));
  const y = Math.max(0, Math.floor(box.top * height));
  return {
    x,
    y,
    width: Math.max(1, Math.min(width, Math.ceil(box.right * width)) - x),
    height: Math.max(1, Math.min(height, Math.ceil(box.bottom * height)) - y),
  };
}
