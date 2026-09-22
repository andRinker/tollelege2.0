import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { parseDate } from "@internationalized/date";
import { and, asc, count, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { type ScanEventKind, scanEvents, scanSessions } from "@/db/schema";
import { addDays, todayInTimeZone } from "@/lib/dates";
import { ConflictError, LimitError, NotFoundError } from "./errors";

/** A pairing never outlives the day it was made, whatever the time zone says. */
const MAX_PAIRING_MS = 24 * 60 * 60 * 1000;

/** Enough scanning for a fast hand, and far less than a script wants. */
const ISBN_LIMIT = { perMinute: 60, perDay: 600 };
/** Each shelf photo is a Gemini call, so this one is about money as well as abuse. */
const SHELF_LIMIT = { perHour: 10, perDay: 40 };

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Midnight tonight where the teacher is. Falling back to a flat 24 hours when the time
 * zone is unknown keeps the promise ("a day at a time") rather than quietly extending it.
 */
export function pairingExpiry(timeZone: string | null | undefined, now = new Date()): Date {
  const cap = new Date(now.getTime() + MAX_PAIRING_MS);
  if (!timeZone) return cap;
  try {
    const midnight = parseDate(addDays(todayInTimeZone(timeZone, now), 1)).toDate(timeZone);
    return midnight < cap ? midnight : cap;
  } catch {
    return cap;
  }
}

/**
 * When a pairing runs out, in words, worked out where the teacher is rather than where
 * the server is. Formatted here and passed down as a string: doing it in the browser
 * renders one time on the server and another after hydration.
 */
export function describeExpiry(expiresAt: Date, timeZone: string | null | undefined): string {
  const zone = timeZone || "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(expiresAt);
    const hour = parts.find((part) => part.type === "hour")?.value;
    const minute = parts.find((part) => part.type === "minute")?.value;
    if (hour === "12" && minute === "00") return "It stops working at midnight.";
    const dayPeriod = parts.find((part) => part.type === "dayPeriod")?.value ?? "";
    return `It stops working at ${hour}:${minute} ${dayPeriod}.`.replace("  ", " ");
  } catch {
    return "It stops working within a day.";
  }
}

/** Coarse on purpose: enough to recognise your own phone, not enough to fingerprint it. */
export function describeDevice(userAgent: string | null): string {
  const agent = userAgent ?? "";
  if (/iPad/i.test(agent)) return "iPad";
  if (/iPhone/i.test(agent)) return "iPhone";
  if (/Android/i.test(agent)) return /Mobile/i.test(agent) ? "Android phone" : "Android tablet";
  if (/Macintosh/i.test(agent)) return "Mac";
  if (/Windows/i.test(agent)) return "Windows PC";
  return "Phone";
}

export type NewPairing = { pairingId: string; token: string; expiresAt: Date };

/**
 * Starts a pairing and returns the token exactly once. Only its hash is kept, so a
 * database dump can't be turned back into a working scanner.
 */
export async function createPairing(
  db: Database,
  teacherId: string,
  timeZone: string | null | undefined,
): Promise<NewPairing> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = pairingExpiry(timeZone);
  const [row] = await db
    .insert(scanSessions)
    .values({ teacherId, tokenHash: hashToken(token), expiresAt })
    .returning({ id: scanSessions.id });
  return { pairingId: row.id, token, expiresAt };
}

export type Pairing = {
  pairingId: string;
  teacherId: string;
  deviceLabel: string | null;
};

/**
 * Resolves a token to the teacher whose library it may add to, claiming it for this
 * device the first time. Everything the phone does goes through here.
 */
export async function verifyPairing(
  db: Database,
  input: { token: string; deviceId: string; userAgent: string | null },
): Promise<Pairing> {
  const refused = new NotFoundError("This scanner link has expired. Scan the code on your computer again.");
  if (!input.token || !input.deviceId) throw refused;

  return db.transaction(async (tx) => {
    const [session] = await tx
      .select({
        id: scanSessions.id,
        teacherId: scanSessions.teacherId,
        deviceId: scanSessions.deviceId,
        deviceLabel: scanSessions.deviceLabel,
        expiresAt: scanSessions.expiresAt,
        revokedAt: scanSessions.revokedAt,
      })
      .from(scanSessions)
      .where(eq(scanSessions.tokenHash, hashToken(input.token)))
      .for("update");
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw refused;

    if (session.deviceId === null) {
      const deviceLabel = describeDevice(input.userAgent);
      await tx
        .update(scanSessions)
        .set({ deviceId: input.deviceId, deviceLabel, claimedAt: new Date(), lastUsedAt: new Date() })
        .where(eq(scanSessions.id, session.id));
      return { pairingId: session.id, teacherId: session.teacherId, deviceLabel };
    }

    if (!sameDevice(session.deviceId, input.deviceId)) {
      throw new ConflictError("Another phone is already using this scanner link. Make a new one on your computer.");
    }

    await tx.update(scanSessions).set({ lastUsedAt: new Date() }).where(eq(scanSessions.id, session.id));
    return { pairingId: session.id, teacherId: session.teacherId, deviceLabel: session.deviceLabel };
  });
}

function sameDevice(stored: string, presented: string): boolean {
  const a = Buffer.from(stored);
  const b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Refuses the request when this pairing has already done too much of something. */
export async function assertWithinLimits(db: Database, pairingId: string, action: "isbn" | "shelf"): Promise<void> {
  const limits =
    action === "isbn"
      ? [
          { window: "1 minute", max: ISBN_LIMIT.perMinute },
          { window: "1 day", max: ISBN_LIMIT.perDay },
        ]
      : [
          { window: "1 hour", max: SHELF_LIMIT.perHour },
          { window: "1 day", max: SHELF_LIMIT.perDay },
        ];
  const kinds: ScanEventKind[] = action === "isbn" ? ["book_added", "lookup_failed"] : ["shelf_proposed"];

  for (const limit of limits) {
    const [{ used }] = await db
      .select({ used: count() })
      .from(scanEvents)
      .where(
        and(
          eq(scanEvents.scanSessionId, pairingId),
          inArray(scanEvents.kind, kinds),
          gt(scanEvents.createdAt, sql`now() - ${limit.window}::interval`),
        ),
      );
    if (used >= limit.max) {
      throw new LimitError(
        action === "isbn"
          ? "That's a lot of scanning at once. Wait a moment and carry on."
          : "That's enough shelf photos for now. Try again a little later.",
      );
    }
  }
}

export async function recordScanEvent(
  db: Database,
  pairing: Pairing,
  kind: ScanEventKind,
  payload: unknown,
): Promise<void> {
  await db.insert(scanEvents).values({
    teacherId: pairing.teacherId,
    scanSessionId: pairing.pairingId,
    kind,
    payload,
  });
}

export type ScanEvent = { seq: number; kind: ScanEventKind; payload: unknown; at: Date };

/** The backlog the signed-in browser picks up. Only ever the teacher's own. */
export async function listScanEvents(
  db: Database,
  teacherId: string,
  sinceSeq: number,
  limit = 100,
): Promise<ScanEvent[]> {
  return db
    .select({ seq: scanEvents.seq, kind: scanEvents.kind, payload: scanEvents.payload, at: scanEvents.createdAt })
    .from(scanEvents)
    .where(and(eq(scanEvents.teacherId, teacherId), gt(scanEvents.seq, sinceSeq)))
    .orderBy(asc(scanEvents.seq))
    .limit(limit);
}

/** Where a browser joining late should start reading, so it doesn't replay the day. */
export async function latestScanEventSeq(db: Database, teacherId: string): Promise<number> {
  const [row] = await db
    .select({ seq: scanEvents.seq })
    .from(scanEvents)
    .where(eq(scanEvents.teacherId, teacherId))
    .orderBy(desc(scanEvents.seq))
    .limit(1);
  return row?.seq ?? 0;
}

export type ActivePairing = {
  pairingId: string;
  deviceLabel: string | null;
  claimedAt: Date | null;
  expiresAt: Date;
};

export async function listActivePairings(db: Database, teacherId: string): Promise<ActivePairing[]> {
  return db
    .select({
      pairingId: scanSessions.id,
      deviceLabel: scanSessions.deviceLabel,
      claimedAt: scanSessions.claimedAt,
      expiresAt: scanSessions.expiresAt,
    })
    .from(scanSessions)
    .where(
      and(
        eq(scanSessions.teacherId, teacherId),
        isNull(scanSessions.revokedAt),
        gt(scanSessions.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(scanSessions.createdAt));
}

export async function revokePairing(db: Database, teacherId: string, pairingId: string): Promise<void> {
  const revoked = await db
    .update(scanSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(scanSessions.id, pairingId),
        eq(scanSessions.teacherId, teacherId),
        isNull(scanSessions.revokedAt),
      ),
    )
    .returning({ id: scanSessions.id });
  if (revoked.length === 0) throw new NotFoundError("That phone is already disconnected.");
}

/** Used when a teacher signs out: nothing they paired should outlive the session. */
export async function revokeAllPairings(db: Database, teacherId: string): Promise<void> {
  await db
    .update(scanSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(scanSessions.teacherId, teacherId), isNull(scanSessions.revokedAt)));
}
