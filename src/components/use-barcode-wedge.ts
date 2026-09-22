"use client";

import { useEffect, useRef } from "react";

/** Scanners send keys a few milliseconds apart; people rarely type faster than ~80 ms. */
const MAX_KEY_GAP_MS = 50;
const MIN_CODE_LENGTH = 10;

/** Inputs that take no characters, so a burst of digits was never meant for them. */
const NOT_TYPED_INTO = new Set(["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"]);

function isTextEntry(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const field = target.closest("input, textarea, select");
  // A checkbox is a button that happens to be an `<input>`: React Aria leaves focus on one
  // whenever the control the teacher just pressed unmounts, and treating that as typing
  // threw the next scan away. Only a field that actually accepts characters swallows one.
  if (field && !(field instanceof HTMLInputElement && NOT_TYPED_INTO.has(field.type))) return true;
  // A dialog swallows scans by default: Enter inside one usually means "press this button".
  // But when something on the page is expressly waiting for a scan — the shelf review with
  // a gap armed — the burst belongs to it. That is a whole-document state rather than a
  // focus one, deliberately: the teacher is at the shelf with a scanner, and whatever the
  // browser left focused when the row armed itself shouldn't decide where the book lands.
  if (target.ownerDocument.querySelector("[data-barcode-wedge]") !== null) return false;
  return target.closest("[role='dialog'], [role='alertdialog']") !== null;
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
