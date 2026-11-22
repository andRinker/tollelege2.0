import { coverCandidates } from "@/lib/covers";
import type { Fetch } from "./sources";

const TIMEOUT_MS = 4000;
/** Enough of any image to read its size from the header. */
const HEADER_BYTES = 64 * 1024;
/** Below this a cover is a thumbnail or a "no image" stub, and blurs wherever it's shown. */
const MIN_WIDTH = 150;

export type ImageSize = { width: number; height: number };

/** Width and height read from the start of a JPEG, PNG or GIF; null for anything else. */
export function imageSize(bytes: Uint8Array): ImageSize | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length > 24 && view.getUint32(0) === 0x89504e47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length > 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      // Start-of-frame markers carry the size; the rest are skipped by their length.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      offset += 2 + view.getUint16(offset + 2);
    }
  }
  return null;
}

export type CoverProbe = { status: "ok"; size: ImageSize } | { status: "bad" } | { status: "unreachable" };

/**
 * Whether a cover link is worth keeping. "Bad" is a definite answer (gone, not an image, or too
 * small to show well); "unreachable" is a failed request, which says nothing about the cover, so
 * an outage never costs a book its cover.
 */
export async function probeCover(url: string, fetchFn: Fetch = fetch): Promise<CoverProbe> {
  try {
    const response = await fetchFn(url, {
      headers: { Range: `bytes=0-${HEADER_BYTES - 1}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });
    if (response.status === 404 || response.status === 403 || response.status === 410) return { status: "bad" };
    if (!response.ok) return { status: "unreachable" };
    const bytes = new Uint8Array(await response.arrayBuffer()).subarray(0, HEADER_BYTES);
    const size = imageSize(bytes);
    if (!size || size.width < MIN_WIDTH || size.height < MIN_WIDTH) return { status: "bad" };
    // A cover is portrait or near square; a wide banner is a different image altogether.
    if (size.width > size.height * 1.3) return { status: "bad" };
    return { status: "ok", size };
  } catch {
    return { status: "unreachable" };
  }
}

/**
 * The sharpest working cover among the catalogues' answers, each tried at every size it can be
 * had in. Falls back to the first candidate unchecked when nothing could be reached, and to null
 * only when every one answered and none was any good.
 */
export async function bestCover(urls: (string | null | undefined)[], fetchFn: Fetch = fetch): Promise<string | null> {
  const listed = [...new Set(urls.filter((url): url is string => Boolean(url)))];
  if (listed.length === 0) return null;
  // Each catalogue's own address, sharpest size first: the biggest that works is that catalogue's pick.
  const perSource = await Promise.all(
    listed.map(async (url) => {
      let best: { url: string; width: number } | null = null;
      let reachable = false;
      for (const candidate of coverCandidates(url)) {
        const probe = await probeCover(candidate, fetchFn);
        if (probe.status !== "unreachable") reachable = true;
        if (probe.status === "ok") {
          best = { url: candidate, width: probe.size.width };
          break;
        }
      }
      return { url, best, reachable };
    }),
  );
  const working = perSource.filter((entry) => entry.best).sort((a, b) => b.best!.width - a.best!.width);
  if (working.length > 0) return working[0].best!.url;
  // Nothing answered at all: keep the first, which may well be fine.
  if (perSource.every((entry) => !entry.reachable)) return listed[0];
  return null;
}
