"use client";

import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { type CropBox, type CropEdge, FULL_FRAME, isFullFrame, moveBox, moveEdge } from "@/lib/crop";
import { cx } from "@/ui/cx";
import { Button } from "@/ui/components/button";

const EDGE_LABEL: Record<CropEdge, string> = {
  top: "Top edge of the shelf",
  bottom: "Bottom edge of the shelf",
  left: "Left edge of the shelf",
  right: "Right edge of the shelf",
};

/**
 * Lets a teacher draw a box around one shelf before a photo is read.
 *
 * It exists for two reasons. Books from the shelf above or below creeping into the frame get
 * read as if they were on this one; and the photo is shrunk before it is sent, so every pixel
 * spent on the rest of the bookcase is one taken from this shelf's spines. Cropping first
 * fixes both. It is always optional: "Use the whole photo" sends what was taken.
 *
 * Each edge is a slider, so the box can be set with a finger, a mouse or the arrow keys.
 */
export function ShelfCropper({
  file,
  onUse,
  busyLabel,
}: {
  file: File;
  /** The crop chosen, or null for the whole photo. */
  onUse: (crop: CropBox | null) => void;
  /** Shown on the buttons while the photo is on its way, if the caller is busy with it. */
  busyLabel?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [box, setBox] = useState<CropBox>(FULL_FRAME);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ edge: CropEdge | "box"; x: number; y: number; start: CropBox } | null>(null);

  // Read as a data URL rather than an object URL: an object URL revoked by an effect's
  // cleanup is gone for good, and React runs cleanups more often than a component unmounts.
  useEffect(() => {
    let current = true;
    const reader = new FileReader();
    reader.onload = () => {
      if (current) setUrl(String(reader.result));
    };
    reader.readAsDataURL(file);
    return () => {
      current = false;
      reader.abort();
    };
  }, [file]);

  /** Where a pointer is, as a fraction of the photo. */
  function fraction(event: PointerEvent) {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  }

  /** Starts dragging whatever was pressed: an edge, named by its `data-edge`, or the box. */
  function start(event: PointerEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const at = fraction(event);
    const edge = (event.currentTarget.dataset.edge ?? "box") as CropEdge | "box";
    drag.current = { edge, x: at.x, y: at.y, start: box };
  }

  function move(event: PointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current) return;
    const at = fraction(event);
    if (current.edge === "box") {
      setBox(moveBox(current.start, at.x - current.x, at.y - current.y));
    } else {
      const horizontal = current.edge === "left" || current.edge === "right";
      setBox(moveEdge(current.start, current.edge, horizontal ? at.x : at.y));
    }
  }

  function end() {
    drag.current = null;
  }

  function nudge(event: KeyboardEvent<HTMLElement>) {
    const edge = event.currentTarget.dataset.edge as CropEdge;
    const step = event.key === "PageUp" || event.key === "PageDown" ? 0.1 : 0.02;
    const direction =
      event.key === "ArrowUp" || event.key === "ArrowLeft" || event.key === "PageUp"
        ? -1
        : event.key === "ArrowDown" || event.key === "ArrowRight" || event.key === "PageDown"
          ? 1
          : 0;
    if (direction === 0) return;
    event.preventDefault();
    setBox((current) => moveEdge(current, edge, current[edge] + direction * step));
  }

  const percent = (value: number) => `${value * 100}%`;
  const handle = (edge: CropEdge) => {
    const horizontal = edge === "left" || edge === "right";
    return (
      <div
        role="slider"
        tabIndex={0}
        aria-label={EDGE_LABEL[edge]}
        aria-orientation={horizontal ? "horizontal" : "vertical"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(box[edge] * 100)}
        aria-valuetext={`${Math.round(box[edge] * 100)}%`}
        data-edge={edge}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={nudge}
        className={cx(
          // A generous invisible target around a slim visible bar, for fingers.
          "group absolute z-10 flex touch-none items-center justify-center outline-none",
          horizontal ? "top-0 h-full w-11 -translate-x-1/2 cursor-ew-resize" : "left-0 h-11 w-full -translate-y-1/2 cursor-ns-resize",
        )}
        style={horizontal ? { left: percent(box[edge]) } : { top: percent(box[edge]) }}
      >
        <span
          className={cx(
            "rounded-full bg-primary shadow-2 group-focus-visible:outline-3 group-focus-visible:outline-offset-2 group-focus-visible:outline-secondary",
            horizontal ? "h-12 w-1.5" : "h-1.5 w-12",
          )}
        />
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body-md text-on-surface-variant">
        Drag the edges to fit one shelf. Leaving out the shelves above and below keeps their books off this list, and
        gives the spines on this one more detail to be read by.
      </p>
      <div className="flex justify-center">
        <div ref={frame} className="relative touch-none select-none">
          {/* The dimming around the box is clipped to the photo; the handles are not, so they
              stay easy to grab right at its edges. */}
          <div className="relative overflow-hidden rounded-md">
          {url ? (
            // A photo on this device, as a data URL; next/image has nothing to optimise here.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="The shelf photo" className="block max-h-[50dvh] w-auto max-w-full" draggable={false} />
          ) : (
            <div className="h-48 w-72 max-w-full animate-pulse bg-surface-container-high" />
          )}
          {/* The box, with everything outside it dimmed. Dragging inside it moves it. */}
          <div
            aria-hidden="true"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            className="absolute cursor-move rounded-sm border-2 border-primary shadow-[0_0_0_9999px_color-mix(in_srgb,var(--md-sys-color-scrim)_55%,transparent)]"
            style={{
              left: percent(box.left),
              top: percent(box.top),
              width: percent(box.right - box.left),
              height: percent(box.bottom - box.top),
            }}
          />
          </div>
          {/* Handles sit on the frame, not the box, so their positions are fractions of the photo. */}
          {handle("top")}
          {handle("bottom")}
          {handle("left")}
          {handle("right")}
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="text" isDisabled={Boolean(busyLabel)} onPress={() => onUse(null)}>
          Use the whole photo
        </Button>
        <Button isPending={Boolean(busyLabel)} onPress={() => onUse(isFullFrame(box) ? null : box)}>
          {busyLabel ?? "Read this shelf"}
        </Button>
      </div>
    </div>
  );
}
