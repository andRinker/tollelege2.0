"use client";

import { useEffect, useRef } from "react";

/** Scanners send keys a few milliseconds apart; people rarely type faster than ~80 ms. */
const MAX_KEY_GAP_MS = 50;
const MIN_CODE_LENGTH = 10;

function isTextEntry(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest("input, textarea, select, [role='dialog'], [role='alertdialog']") !== null)
  );
}

/**
 * USB and Bluetooth barcode scanners act as keyboards: a burst of digits, then Enter.
 * When focus isn't in a text field (the teacher just tapped a button, say), catch that
 * burst and hand it to `onScan` instead of letting Enter press whatever is focused.
 */
export function useBarcodeWedge(onScan: (code: string) => void, enabled = true) {
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  });

  useEffect(() => {
    if (!enabled) return;
    let buffer = "";
    let lastKeyAt = 0;

    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || isTextEntry(event.target)) {
        buffer = "";
        return;
      }
      const burst = event.timeStamp - lastKeyAt <= MAX_KEY_GAP_MS;
      lastKeyAt = event.timeStamp;

      if (event.key === "Enter") {
        if (burst && buffer.length >= MIN_CODE_LENGTH) {
          // Capture phase: stop the focused button from also seeing this Enter.
          event.preventDefault();
          event.stopPropagation();
          onScanRef.current(buffer);
        }
        buffer = "";
      } else if (/^[\dXx-]$/.test(event.key)) {
        buffer = burst ? buffer + event.key : event.key;
      } else if (event.key !== "Shift") {
        buffer = "";
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled]);
}
