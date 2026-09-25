"use client";

import { useState } from "react";
import { cx } from "@/ui/cx";
import { Button } from "@/ui/components/button";
import { ConfirmDialog } from "@/ui/components/dialog";
import { Icon } from "@/ui/components/icon";
import { QrCode } from "@/ui/components/qr-code";
import { useSnackbar } from "@/ui/components/snackbar";
import { iconCheckCircle, iconQrCodeScanner } from "@/ui/icons/generated";
import { revokePairingAction, type StartedPairing, startPairingAction } from "./pairing-actions";

export type PairedPhone = {
  pairingId: string;
  deviceLabel: string | null;
  /** Worked out server-side in the teacher's own time zone, not the browser's. */
  expiresLabel: string;
};

/**
 * Lends the phone in your pocket to a library it can't sign in to.
 *
 * The code carries a capability, not a session: it can add a book by ISBN and send a
 * shelf photo, and that is the whole list. It cannot read the library, the roster, or
 * anything else, and it stops working tonight.
 */
export function PhonePairing({ paired, connected }: { paired: PairedPhone[]; connected: boolean }) {
  const showSnackbar = useSnackbar();
  const [started, setStarted] = useState<StartedPairing | null>(null);
  const [pending, setPending] = useState(false);
  const [disconnecting, setDisconnecting] = useState<PairedPhone | null>(null);

  // A pairing shown earlier in this visit is the one on screen; otherwise fall back to
  // whatever the server says is still live, which we can describe but never re-display,
  // because only a hash of the code was kept.
  const active = paired[0] ?? null;

  async function start() {
    setPending(true);
    const result = await startPairingAction();
    setPending(false);
    if (!result.ok) {
      showSnackbar({ message: result.message });
      return;
    }
    setStarted(result.data);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-title-lg-em text-on-surface">Use your phone as the scanner</h2>
        <p className="max-w-prose text-body-md text-on-surface-variant">
          Point your phone&rsquo;s camera at the code. It doesn&rsquo;t need to sign in, and what it scans lands
          here.
        </p>
      </div>

      {started ? (
        // Side by side only when this box, not the window, has room: on a mid-sized screen the
        // page splits into columns and the box is narrower than on a phone.
        <div className="@container">
          <div className="flex flex-col items-start gap-4 @md:flex-row @md:items-center">
            <div className="w-full max-w-56 shrink-0 rounded-xl bg-white p-3 shadow-1">
              <QrCode value={started.url} label="Pairing code for your phone" size={200} className="block h-auto w-full" />
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <p
                className={cx(
                  "flex items-center gap-2 text-title-sm",
                  connected ? "text-primary" : "text-on-surface-variant",
                )}
              >
                {connected ? (
                  <>
                    <Icon icon={iconCheckCircle} size={20} filled />
                    {active?.deviceLabel ?? "Your phone"} is scanning
                  </>
                ) : (
                  <>
                    <span className="size-2 animate-pulse rounded-full bg-on-surface-variant" />
                    Waiting for your phone&hellip;
                  </>
                )}
              </p>
              <p className="max-w-prose text-body-sm text-on-surface-variant">
                {started.expiresLabel} The first phone to open it keeps it, so if the code has been on
                screen a while, make a new one.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="text" size="sm" onPress={start} isPending={pending}>
                  New code
                </Button>
                <Button
                  variant="text"
                  size="sm"
                  onPress={() => setDisconnecting(active ?? { ...started, deviceLabel: null })}
                >
                  Disconnect
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : active ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-container px-4 py-3">
          <span className="flex min-w-0 grow items-center gap-2 text-body-md text-on-surface">
            <span className="text-primary">
              <Icon icon={iconCheckCircle} size={20} filled />
            </span>
            {active.deviceLabel ?? "A phone"} is already paired. {active.expiresLabel}
          </span>
          <Button variant="text" size="sm" onPress={() => setDisconnecting(active)}>
            Disconnect
          </Button>
          <Button variant="tonal" size="sm" icon={iconQrCodeScanner} onPress={start} isPending={pending}>
            Pair another
          </Button>
        </div>
      ) : (
        <Button
          variant="tonal"
          size="md"
          icon={iconQrCodeScanner}
          onPress={start}
          isPending={pending}
          className="self-start"
        >
          Show the code
        </Button>
      )}

      <ConfirmDialog
        isOpen={disconnecting !== null}
        onOpenChange={(open) => !open && setDisconnecting(null)}
        title="Disconnect this phone?"
        message="It stops being able to add books straight away. Anything it already scanned stays."
        confirmLabel="Disconnect"
        destructive
        onConfirm={async () => {
          const target = disconnecting;
          if (!target) return;
          const result = await revokePairingAction(target.pairingId);
          if (result.ok && started?.pairingId === target.pairingId) setStarted(null);
          showSnackbar({ message: result.ok ? "Phone disconnected." : result.message });
        }}
      />
    </div>
  );
}
