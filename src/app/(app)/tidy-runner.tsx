"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { startTidyAction, tidyRunStatusAction } from "@/app/(app)/settings/actions";
import type { ActionResult } from "@/lib/action-result";
import { postWithProgress } from "@/lib/gemini-requests";
import type { TidyProgress } from "@/server/tidy";
import type { TidyRunStatus, TidyStep } from "@/server/tidy-run";
import { useSnackbar } from "@/ui/components/snackbar";

/**
 * Keeps "Tidy my library" going from the app's frame, so the teacher can use the rest of the
 * app while it works through every book. It asks the server for one batch after another for
 * as long as any page of the app is open; the server keeps the run, so closing the tab only
 * pauses it. The review happens on Settings once every book has been looked at.
 */

type TidyRun = {
  /** Null when there's no run, or tidying isn't set up here. */
  status: TidyRunStatus | null;
  /** How far Gemini has got through the batch being looked at now. */
  progress: TidyProgress | null;
  /** Set when batches kept failing and the runner stopped trying; `resume` tries again. */
  paused: string | null;
  start: () => Promise<string | null>;
  resume: () => void;
  /** Forget the run here once it has been applied or discarded. */
  clear: () => void;
};

const TidyRunContext = createContext<TidyRun | null>(null);

export function useTidyRun(): TidyRun {
  const run = useContext(TidyRunContext);
  if (!run) throw new Error("useTidyRun needs a TidyRunProvider.");
  return run;
}

/** Failed batches in a row before the runner stops and says so. */
const MAX_FAILURES = 4;
/** How long to wait while another tab is working on a batch. */
const BUSY_WAIT_MS = 20_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export function TidyRunProvider({ initial, children }: { initial: TidyRunStatus | null; children: ReactNode }) {
  const router = useRouter();
  const showSnackbar = useSnackbar();
  const [status, setStatus] = useState(initial);
  const [progress, setProgress] = useState<TidyProgress | null>(null);
  const [paused, setPaused] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const notify = useRef({ router, showSnackbar });
  useEffect(() => {
    notify.current = { router, showSnackbar };
  }, [router, showSnackbar]);

  const running = status?.state === "running" && paused === null;

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    void (async () => {
      let failures = 0;
      while (!cancelled) {
        let result: ActionResult<TidyStep>;
        try {
          result = await postWithProgress<TidyProgress, ActionResult<TidyStep>>("tidy", "/api/tidy", {}, {}, setProgress);
        } catch {
          result = { ok: false, message: "The connection dropped while checking some books." };
        }
        setProgress(null);
        if (cancelled) return;
        if (!result.ok) {
          failures += 1;
          if (failures >= MAX_FAILURES) {
            setPaused(result.message);
            return;
          }
          await sleep(15_000 * 2 ** (failures - 1));
          continue;
        }
        failures = 0;
        const { status: next, busy } = result.data;
        setStatus(next);
        if (next?.state === "ready") {
          notify.current.showSnackbar({
            message: next.found
              ? `Tidy has looked at every book and has ${plural(next.found, "suggestion")} for you to review.`
              : "Tidy has looked at every book and found nothing to change.",
            action: { label: "Review", onAction: () => notify.current.router.push("/settings#tidy") },
            duration: 15_000,
          });
        }
        if (next?.state !== "running") return;
        if (busy) await sleep(BUSY_WAIT_MS);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [running, attempt]);

  const start = useCallback(async () => {
    const result = await startTidyAction();
    if (!result.ok) return result.message;
    setPaused(null);
    setStatus(result.data);
    return null;
  }, []);

  const resume = useCallback(() => {
    setPaused(null);
    setAttempt((count) => count + 1);
    void tidyRunStatusAction().then((result) => result.ok && setStatus(result.data));
  }, []);

  const clear = useCallback(() => {
    setStatus(null);
    setPaused(null);
  }, []);

  return (
    <TidyRunContext value={{ status, progress, paused, start, resume, clear }}>{children}</TidyRunContext>
  );
}

/** A small note in the app's header while a run is going or waiting for review, linking to it. */
export function TidyRunChip() {
  const { status, paused } = useTidyRun();
  if (!status) return null;
  const label =
    status.state === "ready"
      ? status.found
        ? `Tidy: ${plural(status.found, "fix", "fixes")} to review`
        : "Tidy: finished"
      : paused
        ? "Tidy paused"
        : `Tidying: ${status.checked} of ${status.total}`;
  return (
    <Link
      data-tidy-chip
      href="/settings#tidy"
      className="state-layer focus-ring inline-flex h-8 items-center rounded-full bg-secondary-container px-3 text-label-lg text-on-secondary-container"
    >
      {label}
    </Link>
  );
}
