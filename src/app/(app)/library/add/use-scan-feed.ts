"use client";

import { useEffect, useRef } from "react";
import type { QuickAddOutcome } from "@/server/quick-add";
import type { ShelfSlot, ShelfTally } from "@/server/shelf-scan";

export type ScanFeedEvent =
  | { seq: number; kind: "book_added"; payload: Extract<QuickAddOutcome, { status: "added" }> }
  | { seq: number; kind: "lookup_failed"; payload: Exclude<QuickAddOutcome, { status: "added" }> }
  // `tally` is missing from shelves sent before phones could pass a count.
  | { seq: number; kind: "shelf_proposed"; payload: { slots: ShelfSlot[]; needsAttention: number; tally?: ShelfTally; otherShelf?: number } };

/** Slow enough to be cheap, fast enough that a scan feels like it landed instantly. */
const INTERVAL_MS = 2000;

/**
 * Watches for work done by a paired phone.
 *
 * Polling rather than a live connection: it is a handful of lines with no reconnection
 * logic, survives a laptop sleeping through half a shelf, and costs nothing when the
 * tab is hidden. The phone's own request already did the adding, so arriving a second
 * late changes nothing but the animation.
 */
export function useScanFeed(
  enabled: boolean,
  /** Where the page was when it rendered, so opening it doesn't replay the whole day. */
  initialCursor: number,
  onEvents: (events: ScanFeedEvent[]) => void,
) {
  const cursor = useRef(initialCursor);
  const handler = useRef(onEvents);

  useEffect(() => {
    handler.current = onEvents;
  }, [onEvents]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        try {
          const response = await fetch(`/api/scan/feed?since=${cursor.current}`, { cache: "no-store" });
          if (response.ok) {
            const body = (await response.json()) as { events: ScanFeedEvent[]; cursor: number };
            if (body.events.length > 0) {
              cursor.current = body.cursor;
              handler.current(body.events);
            }
          }
        } catch {
          // A dropped poll is a dropped poll; the next one catches up from the same cursor.
        }
      }
      timer = setTimeout(poll, INTERVAL_MS);
    }

    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled]);
}
