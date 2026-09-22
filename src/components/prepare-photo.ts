/** Big enough for the reader to make out a spine, small enough to upload over a classroom's wifi. */
const MAX_EDGE = 1600;

/** Shrinks a phone photo before upload. Falls back to the original if the browser can't decode it. */
export async function preparePhoto(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas context");
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("could not encode");
    return new File([blob], "shelf.jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
