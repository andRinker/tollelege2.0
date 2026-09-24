import { type CropBox, cropPixels } from "@/lib/crop";

/**
 * How much photo is sent, as a number of pixels rather than a longest side, so a crop keeps
 * its detail. 1600 × 1200 is big enough for the reader to make out a spine and small enough
 * to upload over a classroom's wifi. A band cut across a wide photo is long and thin; capped
 * by its longest side it would come out no sharper than the uncropped photo, while capped by
 * area it keeps its full width.
 */
const MAX_PIXELS = 1600 * 1200;
/** However thin the crop, no side longer than this. */
const MAX_EDGE = 3200;

/**
 * Shrinks a phone photo before upload. Falls back to the original if the browser can't decode it.
 *
 * A crop is cut from the full-size photo *before* it is shrunk, so the pixels the upload can
 * afford all go to the one shelf that matters: a shelf filling a third of the frame comes out
 * with more detail on every spine, which is what the thin ones need.
 */
export async function preparePhoto(file: File, crop?: CropBox | null): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const source = crop ? cropPixels(crop, bitmap.width, bitmap.height) : { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
    const scale = Math.min(
      1,
      Math.sqrt(MAX_PIXELS / (source.width * source.height)),
      MAX_EDGE / Math.max(source.width, source.height),
    );
    const width = Math.round(source.width * scale);
    const height = Math.round(source.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas context");
    context.drawImage(bitmap, source.x, source.y, source.width, source.height, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("could not encode");
    return new File([blob], "shelf.jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
