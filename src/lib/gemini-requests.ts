"use client";

import { useCallback, useRef } from "react";
import { readProgress } from "./progress-stream";

/**
 * The browser's side of every request that ends in a Gemini call: one at a time, logged.
 *
 * Each Gemini call is slow and counts against a quota, so a second press, a remount or a
 * retry that fires one more is worth catching. Every outbound request is logged to the
 * console with its payload (`[gemini] → #n`), each step of its progress, and how it ended,
 * so the volume a page sends can be read straight off the browser's console.
 */

let sent = 0;

/** What a request carried, summarised for the log: a photo is described, never dumped. */
export type PayloadSummary = Record<string, string | number | boolean | null>;

/**
 * Logs one outbound request that leads to a Gemini call, and returns how to log its steps and
 * its end. Only the summary given is logged: never a header, which may carry a scan token.
 */
export function logGeminiRequest(feature: string, url: string, payload: PayloadSummary) {
  const id = ++sent;
  const started = performance.now();
  const since = () => `${Math.round(performance.now() - started)}ms`;
  console.info(`[gemini] → #${id} ${feature} POST ${url}`, payload);
  return {
    step: (progress: unknown) => console.debug(`[gemini] … #${id} ${feature} ${since()}`, progress),
    done: (result: unknown) => console.info(`[gemini] ← #${id} ${feature} done in ${since()}`, result),
    failed: (error: unknown) => console.warn(`[gemini] ✕ #${id} ${feature} failed after ${since()}`, error),
  };
}

/**
 * POSTs to a progress-streaming route and reads it to its result, logging the request,
 * each progress step and the outcome. `body` is sent as is: FormData, or JSON for an object.
 */
export async function postWithProgress<P, R>(
  feature: string,
  url: string,
  body: FormData | Record<string, unknown>,
  payload: PayloadSummary,
  onProgress: (progress: P) => void,
): Promise<R> {
  const log = logGeminiRequest(feature, url, payload);
  try {
    const response = await fetch(url, {
      method: "POST",
      ...(body instanceof FormData
        ? { body }
        : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    });
    const result = await readProgress<P, R>(response, (progress) => {
      log.step(progress);
      onProgress(progress);
    });
    log.done(result);
    return result;
  } catch (error) {
    log.failed(error);
    throw error;
  }
}

/** How long after one request ends before another is let through: a double press, not a retry. */
const COOLDOWN_MS = 300;

/**
 * Wraps a request so only one runs at a time. A call made while one is in flight, or within a
 * moment of it ending, is dropped (and logged) rather than queued: buttons are disabled while
 * a request runs, and this is the guard for the presses that land before the re-render does.
 */
export function useSingleFlight(feature: string) {
  const inFlight = useRef(false);
  const endedAt = useRef(0);
  return useCallback(
    async (run: () => Promise<void>) => {
      if (inFlight.current || performance.now() - endedAt.current < COOLDOWN_MS) {
        console.info(`[gemini] ⊘ ${feature}: dropped a repeat request while one was ${inFlight.current ? "in flight" : "just finished"}`);
        return;
      }
      inFlight.current = true;
      try {
        await run();
      } finally {
        inFlight.current = false;
        endedAt.current = performance.now();
      }
    },
    [feature],
  );
}
