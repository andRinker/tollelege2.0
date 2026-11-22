import { z } from "zod";
import { getDb } from "@/db/client";
import { getCoverPhoto } from "@/server/covers";

/** A teacher's photo of a book's cover. The address carries `?v=` for the time it was taken, so it never goes stale. */
export async function GET(_request: Request, { params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  if (!z.uuid().safeParse(bookId).success) return new Response("Not found", { status: 404 });
  const photo = await getCoverPhoto(getDb(), bookId);
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(photo.bytes), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
