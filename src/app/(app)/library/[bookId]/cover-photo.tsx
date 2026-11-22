"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { isCoverPhotoUrl } from "@/lib/covers";
import { Button } from "@/ui/components/button";
import { Icon } from "@/ui/components/icon";
import { useSnackbar } from "@/ui/components/snackbar";
import { iconPhotoCamera } from "@/ui/icons/generated";
import { removeCoverPhotoAction, setCoverPhotoAction } from "../actions";

const LONGEST_SIDE = 800;

/** Shrinks a photo to a JPEG about 800 pixels tall, as base64, which is plenty for any cover on screen. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, LONGEST_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("Couldn't read that photo.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Photograph a book's cover, for a book the catalogues have none for or have wrong. The photo
 * stands in for the cover and, being the teacher's own edit, is never replaced by automation.
 */
export function CoverPhoto({ bookId, coverUrl }: { bookId: string; coverUrl: string | null }) {
  const router = useRouter();
  const showSnackbar = useSnackbar();
  const [pending, setPending] = useState(false);
  const hasPhoto = isCoverPhotoUrl(coverUrl);

  async function pick(file: File) {
    setPending(true);
    try {
      const result = await setCoverPhotoAction(bookId, await shrink(file));
      showSnackbar({ message: result.ok ? "Cover saved." : result.message });
      if (result.ok) router.refresh();
    } catch {
      showSnackbar({ message: "Couldn't read that photo. Try another." });
    }
    setPending(false);
  }

  async function remove() {
    setPending(true);
    const result = await removeCoverPhotoAction(bookId);
    showSnackbar({ message: result.ok ? "Photo removed." : result.message });
    if (result.ok) router.refresh();
    setPending(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label
        className={`flex cursor-pointer items-center gap-2 rounded-full bg-secondary-container px-4 py-2 text-label-lg text-on-secondary-container ${pending ? "pointer-events-none opacity-60" : ""}`}
      >
        <Icon icon={iconPhotoCamera} size={18} />
        {hasPhoto ? "Retake cover" : coverUrl ? "Photograph the cover" : "Add a cover photo"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={pending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void pick(file);
            event.target.value = "";
          }}
        />
      </label>
      {hasPhoto && (
        <Button variant="text" size="xs" isDisabled={pending} onPress={() => void remove()}>
          Remove photo
        </Button>
      )}
    </div>
  );
}
