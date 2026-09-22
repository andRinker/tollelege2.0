"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BarcodeCamera } from "@/components/barcode-scanner";
import { preparePhoto } from "@/components/prepare-photo";
import { normalizeIsbn } from "@/lib/isbn";
import { cx } from "@/ui/cx";
import { Button } from "@/ui/components/button";
import { Icon } from "@/ui/components/icon";
import { LoadingIndicator } from "@/ui/components/loading-indicator";
import { TextField } from "@/ui/components/text-field";
import {
  iconCheckCircle,
  iconError,
  iconHourglassEmpty,
  iconLibraryAdd,
  iconPhotoCamera,
} from "@/ui/icons/generated";

const TOKEN_KEY = "tolle-lege.scan.token";
const DEVICE_KEY = "tolle-lege.scan.device";

type Session = { teacherName: string; canSendShelfPhotos: boolean };

type Pairing =
  | { kind: "connecting" }
  | { kind: "ready"; session: Session }
  | { kind: "refused"; message: string };

type Line = {
  id: number;
  isbn13: string;
  state: "sending" | "added" | "failed" | "queued";
  title?: string;
  detail?: string;
};

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing. The page still works for as long as it stays open.
  }
}

/**
 * This device's name to the pairing, so the first phone to open a code keeps it. It is
 * not a secret and proves nothing on its own — the token does that — but it means a code
 * photographed off a teacher's screen is useless once their own phone has claimed it.
 */
function deviceId(): string {
  const existing = readLocal(DEVICE_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  writeLocal(DEVICE_KEY, created);
  return created;
}

export function PhoneScanner() {
  const [pairing, setPairing] = useState<Pairing>({ kind: "connecting" });
  const [lines, setLines] = useState<Line[]>([]);
  const [typed, setTyped] = useState("");
  const [shelfState, setShelfState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [shelfMessage, setShelfMessage] = useState<string | null>(null);
  const token = useRef<string | null>(null);
  const nextId = useRef(1);
  const queue = useRef<string[]>([]);

  const send = useCallback(async (path: string, init: RequestInit) => {
    return fetch(path, {
      ...init,
      headers: {
        ...init.headers,
        "x-scan-token": token.current ?? "",
        "x-scan-device": deviceId(),
      },
    });
  }, []);

  // The token arrives in the URL fragment, which browsers never send to a server. It is
  // stashed and wiped from the address bar straight away, so it survives reopening the
  // page without sitting on screen for anyone standing behind you.
  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    if (fromHash) {
      token.current = fromHash;
      writeLocal(TOKEN_KEY, fromHash);
      history.replaceState(null, "", window.location.pathname);
    } else {
      token.current = readLocal(TOKEN_KEY);
    }

    if (!token.current) {
      setPairing({
        kind: "refused",
        message: "Open this page by scanning the code shown on your computer.",
      });
      return;
    }

    void (async () => {
      try {
        const response = await send("/api/scan/claim", { method: "POST" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          setPairing({ kind: "refused", message: body.message ?? "This scanner link isn't working." });
          return;
        }
        setPairing({ kind: "ready", session: body });
      } catch {
        setPairing({ kind: "refused", message: "Couldn't reach the library. Check your connection and reload." });
      }
    })();
  }, [send]);

  const submit = useCallback(
    async (isbn13: string) => {
      const id = nextId.current++;
      const pending: Line = { id, isbn13, state: "sending" };
      setLines((current) => [pending, ...current].slice(0, 40));
      try {
        const response = await send("/api/scan/isbn", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ isbn13 }),
        });
        const body = await response.json().catch(() => ({}));
        if (response.ok && body.status === "added") {
          setLines((current) =>
            current.map((line) =>
              line.id === id
                ? {
                    ...line,
                    state: "added",
                    title: body.result.title,
                    detail:
                      body.result.outcome === "copy_added"
                        ? `Copy ${body.result.totalCopies}`
                        : "New title",
                  }
                : line,
            ),
          );
          return;
        }
        const detail =
          body.status === "not_found"
            ? "No record of that ISBN"
            : body.status === "unavailable"
              ? "Lookup unavailable"
              : (body.message ?? "Couldn't add that one");
        setLines((current) => current.map((line) => (line.id === id ? { ...line, state: "failed", detail } : line)));
      } catch {
        // Shelves are where wifi goes to die, so a failed send waits rather than vanishing.
        queue.current.push(isbn13);
        setLines((current) =>
          current.map((line) =>
            line.id === id ? { ...line, state: "queued", detail: "Waiting for signal" } : line,
          ),
        );
      }
    },
    [send],
  );

  // Retry anything the network swallowed, quietly, while the teacher keeps scanning.
  useEffect(() => {
    if (pairing.kind !== "ready") return;
    const timer = setInterval(() => {
      const waiting = queue.current.splice(0, queue.current.length);
      if (waiting.length === 0) return;
      setLines((current) => current.filter((line) => line.state !== "queued"));
      for (const isbn13 of waiting) void submit(isbn13);
    }, 8000);
    return () => clearInterval(timer);
  }, [pairing.kind, submit]);

  async function sendShelf(file: File) {
    setShelfState("sending");
    setShelfMessage(null);
    try {
      const data = new FormData();
      data.set("photo", await preparePhoto(file));
      const response = await send("/api/scan/shelf", { method: "POST", body: data });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setShelfState("failed");
        setShelfMessage(body.message ?? "That photo couldn't be read.");
        return;
      }
      setShelfState("sent");
      setShelfMessage(
        body.proposals > 0
          ? `Found ${body.proposals} ${body.proposals === 1 ? "book" : "books"}. Confirm them on your computer.`
          : "No spines could be read. Try a straighter photo of one shelf.",
      );
    } catch {
      setShelfState("failed");
      setShelfMessage("Couldn't send that photo. Check your connection and try again.");
    }
  }

  if (pairing.kind === "connecting") {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <LoadingIndicator contained label="Connecting" />
      </main>
    );
  }

  if (pairing.kind === "refused") {
    return (
      <main className="mx-auto grid min-h-dvh max-w-md place-items-center p-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <Icon icon={iconError} size={44} className="text-error" />
          <h1 className="text-headline-sm text-on-surface">Not connected</h1>
          <p className="text-body-lg text-on-surface-variant">{pairing.message}</p>
        </div>
      </main>
    );
  }

  const added = lines.filter((line) => line.state === "added").length;

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col gap-4 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-title-lg-em text-on-surface">Scanning</h1>
        <p className="text-body-sm text-on-surface-variant">{pairing.session.teacherName}</p>
      </header>

      <BarcodeCamera
        onDetected={(isbn13) => void submit(isbn13)}
        status={
          <p className="text-center text-title-sm text-on-surface">
            {added === 0 ? "Point at a barcode" : `${added} added`}
          </p>
        }
      />

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const isbn13 = normalizeIsbn(typed);
          if (!isbn13) return;
          setTyped("");
          void submit(isbn13);
        }}
      >
        <TextField
          label="Or type an ISBN"
          value={typed}
          onChange={setTyped}
          inputMode="numeric"
          autoComplete="off"
          className="grow"
          inputClassName="tabular-nums"
        />
        <Button type="submit" size="md" icon={iconLibraryAdd} isDisabled={!normalizeIsbn(typed)}>
          Add
        </Button>
      </form>

      {pairing.session.canSendShelfPhotos && (
        <div className="flex flex-col gap-2 rounded-xl bg-surface-container-low p-4">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-secondary-container px-5 py-3 text-label-lg text-on-secondary-container">
            <Icon icon={iconPhotoCamera} size={20} />
            {shelfState === "sending" ? "Sending…" : "Photograph a shelf"}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={shelfState === "sending"}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void sendShelf(file);
              }}
            />
          </label>
          <p className={cx("text-body-sm", shelfState === "failed" ? "text-error" : "text-on-surface-variant")}>
            {shelfMessage ?? "Every book it finds is confirmed on your computer before it's added."}
          </p>
        </div>
      )}

      {lines.length > 0 && (
        <ul className="flex flex-col gap-1">
          {lines.map((line) => (
            <li
              key={line.id}
              className="flex items-center gap-3 rounded-lg bg-surface-container-low px-3 py-2"
            >
              <Icon
                icon={
                  line.state === "added"
                    ? iconCheckCircle
                    : line.state === "failed"
                      ? iconError
                      : iconHourglassEmpty
                }
                size={20}
                className={cx(
                  line.state === "added" && "text-primary",
                  line.state === "failed" && "text-error",
                  (line.state === "sending" || line.state === "queued") && "text-on-surface-variant",
                )}
              />
              <span className="flex min-w-0 grow flex-col">
                <span className="truncate text-body-md text-on-surface">{line.title ?? line.isbn13}</span>
                {line.detail && <span className="truncate text-body-sm text-on-surface-variant">{line.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
