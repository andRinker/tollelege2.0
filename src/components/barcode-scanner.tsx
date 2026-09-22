"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { normalizeIsbn } from "@/lib/isbn";
import { cx } from "@/ui/cx";
import { Dialog } from "@/ui/components/dialog";
import { Icon } from "@/ui/components/icon";
import { ToggleIconButton } from "@/ui/components/icon-button";
import { LoadingIndicator } from "@/ui/components/loading-indicator";
import { iconFlashlightOn, iconPhotoCamera } from "@/ui/icons/generated";

type ScannerState =
  | { kind: "starting" }
  | { kind: "scanning" }
  | { kind: "error"; message: string };

type BarcodeScannerDialogProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Called with a valid ISBN-13 each time a new book barcode is read. */
  onDetected: (isbn13: string) => void;
  /** Shown under the viewfinder, e.g. the last book added in rapid scan. */
  status?: ReactNode;
  title?: string;
};

// The same book counts again only once its barcode has been out of frame this long.
// A plain timer re-added whatever the camera happened to still be pointing at.
const CLEAR_FRAME_MS = 1200;

function beep() {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 1046;
    gain.gain.value = 0.08;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.08);
    oscillator.onended = () => context.close();
  } catch {
    // Sound is optional.
  }
}

/** Reads EAN-13 book barcodes from the device camera using ZXing (WASM served from /vendor). */
export function BarcodeScannerDialog({ isOpen, onOpenChange, onDetected, status, title = "Scan a barcode" }: BarcodeScannerDialogProps) {
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={title} fullScreenOnCompact isDismissable className="max-w-[640px]">
      {isOpen && <Scanner onDetected={onDetected} status={status} />}
    </Dialog>
  );
}

function Scanner({ onDetected, status }: { onDetected: (isbn13: string) => void; status?: ReactNode }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const lastRead = useRef<{ isbn: string; seenAt: number } | null>(null);
  const onDetectedRef = useRef(onDetected);
  const [state, setState] = useState<ScannerState>({ kind: "starting" });
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState({ kind: "error", message: "This browser can't use the camera. Type the ISBN or use a USB barcode scanner instead." });
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (error) {
        const name = (error as DOMException).name;
        setState({
          kind: "error",
          message:
            name === "NotAllowedError"
              ? "Camera access is blocked. Allow the camera for this site in your browser settings, then try again."
              : name === "NotFoundError"
                ? "No camera was found on this device."
                : "The camera couldn't start. Close other apps that might be using it and try again.",
        });
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => {});

      const track = stream.getVideoTracks()[0];
      trackRef.current = track;
      const capabilities = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
      setTorchSupported(Boolean(capabilities.torch));

      const { BarcodeDetector, prepareZXingModule } = await import("barcode-detector/ponyfill");
      prepareZXingModule({
        overrides: {
          locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? `/vendor/${path}` : `${prefix}${path}`),
        },
      });
      const detector = new BarcodeDetector({ formats: ["ean_13", "upc_a"] });
      setState({ kind: "scanning" });

      const scan = async () => {
        if (stopped) return;
        try {
          if (video.readyState >= 2) {
            for (const barcode of await detector.detect(video)) {
              const isbn = normalizeIsbn(barcode.rawValue);
              if (!isbn) continue;
              const now = Date.now();
              const previous = lastRead.current;
              if (previous?.isbn === isbn) {
                const goneFor = now - previous.seenAt;
                previous.seenAt = now;
                // Still the book we just added, so keep ignoring it however long it lingers.
                if (goneFor < CLEAR_FRAME_MS) continue;
              }
              lastRead.current = { isbn, seenAt: now };
              beep();
              navigator.vibrate?.(60);
              setFlash(true);
              setTimeout(() => setFlash(false), 250);
              onDetectedRef.current(isbn);
              break;
            }
          }
        } catch {
          // A frame can fail to decode; keep scanning.
        }
        timer = setTimeout(scan, 150);
      };
      scan();
    }

    start();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      trackRef.current = null;
    };
  }, []);

  const toggleTorch = useCallback(async (on: boolean) => {
    try {
      await trackRef.current?.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      setTorchOn(on);
    } catch {
      setTorchSupported(false);
    }
  }, []);

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-inverse-surface">
        <video ref={videoRef} muted playsInline className="absolute inset-0 size-full object-cover" />
        {state.kind === "scanning" && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center">
            <div
              className={cx(
                "relative h-1/3 w-3/4 rounded-lg border-4 transition-colors duration-150",
                flash ? "border-primary-container bg-primary-container/25" : "border-white/85",
              )}
            >
              <span className="absolute inset-x-3 top-1/2 h-0.5 -translate-y-1/2 animate-pulse rounded-full bg-primary-container" />
            </div>
          </div>
        )}
        {state.kind === "starting" && (
          <div className="absolute inset-0 grid place-items-center">
            <LoadingIndicator contained label="Starting camera" />
          </div>
        )}
        {state.kind === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-inverse-on-surface">
            <Icon icon={iconPhotoCamera} size={40} />
            <p className="max-w-sm text-body-lg">{state.message}</p>
          </div>
        )}
        {torchSupported && (
          <div className="absolute top-3 right-3">
            <ToggleIconButton icon={iconFlashlightOn} label={torchOn ? "Turn off light" : "Turn on light"} variant="filled" isSelected={torchOn} onChange={toggleTorch} />
          </div>
        )}
      </div>
      <p className="text-center text-body-md text-on-surface-variant">
        {state.kind === "scanning" ? "Hold the barcode on the back cover inside the frame." : " "}
      </p>
      {status && <div aria-live="polite">{status}</div>}
    </div>
  );
}
