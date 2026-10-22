import "server-only";
import { and, count, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { books, tidyRuns } from "@/db/schema";
import type { TidySuggestion } from "@/lib/tidy";
import { type AskGemini, applyTidy, suggestTidyBatch, type TidyProgress } from "./tidy";

/**
 * "Tidy my library" run through the whole library at one press. The browser keeps asking for
 * the next batch while any page of the app is open (`stepTidyRun`), and the server keeps where
 * it has got to and every suggestion found, so the tab closing loses nothing. The teacher
 * reviews everything once, at the end, and only what they tick is applied.
 */

/** What the app shows of a run, without its suggestions. */
export type TidyRunStatus = {
  state: "running" | "ready";
  checked: number;
  /** Books in the library when the last batch was looked at: checked plus remaining. */
  total: number;
  found: number;
  /** Why the last batch failed, until one succeeds. */
  error: string | null;
};

/** One batch's outcome: the run as it stands, and whether another tab had the batch. */
export type TidyStep = { status: TidyRunStatus | null; busy: boolean };

/**
 * How long a batch may hold the run before another tab may take it over: longer than the
 * route's 300 seconds, so a batch still going is never asked about twice.
 */
const CLAIM_SECONDS = 330;

function statusOf(run: typeof tidyRuns.$inferSelect): TidyRunStatus {
  return {
    state: run.finishedAt ? "ready" : "running",
    checked: run.checked,
    total: run.checked + run.remaining,
    found: (run.suggestions as TidySuggestion[]).length,
    error: run.lastError,
  };
}

async function readRun(db: Database, teacherId: string) {
  const [run] = await db.select().from(tidyRuns).where(eq(tidyRuns.teacherId, teacherId));
  return run ?? null;
}

export async function getTidyRunStatus(db: Database, teacherId: string): Promise<TidyRunStatus | null> {
  const run = await readRun(db, teacherId);
  return run ? statusOf(run) : null;
}

/** Starts a run from the first book, replacing any run already going or waiting. */
export async function startTidyRun(db: Database, teacherId: string): Promise<TidyRunStatus> {
  const [{ total }] = await db.select({ total: count() }).from(books).where(eq(books.teacherId, teacherId));
  const fresh = {
    after: null,
    checked: 0,
    remaining: total,
    suggestions: [],
    finishedAt: total === 0 ? new Date() : null,
    claimedUntil: null,
    lastError: null,
    startedAt: new Date(),
  };
  const [run] = await db
    .insert(tidyRuns)
    .values({ teacherId, ...fresh })
    .onConflictDoUpdate({ target: tidyRuns.teacherId, set: fresh })
    .returning();
  return statusOf(run);
}

/**
 * Looks at the next batch of a running run and keeps what it finds. Returns the run as it
 * stands, or null when there is none. When another tab is already working on a batch, nothing
 * is asked and the run is returned as it is (`busy`). A batch that fails leaves the run where
 * it was, with the reason, and throws, so the browser can try that batch again.
 */
export async function stepTidyRun(
  db: Database,
  teacherId: string,
  options: { fetchFn?: typeof fetch; askGemini?: AskGemini; onProgress?: (progress: TidyProgress) => void } = {},
): Promise<TidyStep> {
  const [run] = await db
    .update(tidyRuns)
    .set({ claimedUntil: sql`now() + make_interval(secs => ${CLAIM_SECONDS})` })
    .where(
      and(
        eq(tidyRuns.teacherId, teacherId),
        isNull(tidyRuns.finishedAt),
        or(isNull(tidyRuns.claimedUntil), lt(tidyRuns.claimedUntil, sql`now()`)),
      ),
    )
    .returning();
  if (!run) {
    const current = await getTidyRunStatus(db, teacherId);
    return { status: current, busy: current?.state === "running" };
  }

  // Only this run's row: one started again meanwhile has a new start and is left alone.
  const thisRun = and(eq(tidyRuns.teacherId, teacherId), eq(tidyRuns.startedAt, run.startedAt));
  const found = run.suggestions as TidySuggestion[];
  let batch;
  try {
    batch = await suggestTidyBatch(db, teacherId, { after: run.after, pending: found, ...options });
  } catch (error) {
    await db
      .update(tidyRuns)
      .set({ claimedUntil: null, lastError: error instanceof Error ? error.message.slice(0, 500) : "Unknown error" })
      .where(thisRun);
    throw error;
  }

  const [saved] = await db
    .update(tidyRuns)
    .set({
      after: batch.next ?? run.after,
      checked: run.checked + batch.checked,
      remaining: batch.remaining,
      suggestions: [...found, ...batch.suggestions],
      finishedAt: batch.next === null ? new Date() : null,
      claimedUntil: null,
      lastError: null,
    })
    .where(thisRun)
    .returning();
  return { status: saved ? statusOf(saved) : await getTidyRunStatus(db, teacherId), busy: false };
}

/** Everything a finished run found, for the review. Empty while it is still running. */
export async function tidyRunSuggestions(db: Database, teacherId: string): Promise<TidySuggestion[]> {
  const run = await readRun(db, teacherId);
  return run?.finishedAt ? (run.suggestions as TidySuggestion[]) : [];
}

/**
 * Applies the suggestions the teacher ticked, by book, from the run's own record of them, and
 * ends the run. Each is checked again against the book as it is now (`applyTidy`).
 */
export async function applyTidyRun(db: Database, teacherId: string, bookIds: string[]): Promise<number> {
  const run = await readRun(db, teacherId);
  if (!run?.finishedAt) return 0;
  const chosen = new Set(bookIds);
  const changes = (run.suggestions as TidySuggestion[])
    .filter((suggestion) => chosen.has(suggestion.bookId))
    .map(({ bookId, patch }) => ({ bookId, patch }));
  const changed = await applyTidy(db, teacherId, changes);
  await discardTidyRun(db, teacherId);
  return changed;
}

/** Ends a run, finished or not, applying nothing. */
export async function discardTidyRun(db: Database, teacherId: string): Promise<void> {
  await db.delete(tidyRuns).where(eq(tidyRuns.teacherId, teacherId));
}
