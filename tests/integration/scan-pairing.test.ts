import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { scanEvents, scanSessions } from "@/db/schema";
import { ConflictError, LimitError, NotFoundError } from "@/server/errors";
import {
  assertWithinLimits,
  createPairing,
  describeDevice,
  latestScanEventSeq,
  listActivePairings,
  listScanEvents,
  pairingExpiry,
  recordScanEvent,
  revokeAllPairings,
  revokePairing,
  verifyPairing,
} from "@/server/scan-pairing";
import { createTeacher, createTestDb, type TestDatabase } from "../helpers/test-db";

const PHONE = { deviceId: "device-aaa", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" };
const OTHER_PHONE = { deviceId: "device-bbb", userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile" };

describe("phone pairing", () => {
  let testDb: TestDatabase;
  let db: Database;
  let teacher: string;
  let other: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    db = testDb.db;
    teacher = await createTeacher(db, "Rae Delgado");
    other = await createTeacher(db, "Sam Chen");
    return () => testDb.close();
  });

  describe("the token", () => {
    it("is never stored, only its hash", async () => {
      const { token } = await createPairing(db, teacher, "America/Chicago");

      const [row] = await db.select().from(scanSessions);
      expect(row.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
      expect(JSON.stringify(row)).not.toContain(token);
      expect(token.length).toBeGreaterThanOrEqual(43);
    });

    it("resolves to its own teacher and nobody else's library", async () => {
      const mine = await createPairing(db, teacher, "America/Chicago");
      const theirs = await createPairing(db, other, "America/Chicago");

      expect((await verifyPairing(db, { token: mine.token, ...PHONE })).teacherId).toBe(teacher);
      expect((await verifyPairing(db, { token: theirs.token, ...PHONE })).teacherId).toBe(other);
    });

    it("refuses a token that was never issued", async () => {
      await expect(verifyPairing(db, { token: "not-a-real-token", ...PHONE })).rejects.toThrow(NotFoundError);
    });

    it("refuses a request with no token or no device", async () => {
      const { token } = await createPairing(db, teacher, "America/Chicago");
      await expect(verifyPairing(db, { token: "", ...PHONE })).rejects.toThrow(NotFoundError);
      await expect(verifyPairing(db, { token, deviceId: "", userAgent: null })).rejects.toThrow(NotFoundError);
    });
  });

  describe("the first phone keeps it", () => {
    it("claims on first use and records what claimed it", async () => {
      const { token } = await createPairing(db, teacher, "America/Chicago");

      const claimed = await verifyPairing(db, { token, ...PHONE });
      expect(claimed.deviceLabel).toBe("iPhone");

      const [row] = await db.select().from(scanSessions);
      expect(row.deviceId).toBe(PHONE.deviceId);
      expect(row.claimedAt).not.toBeNull();
    });

    it("keeps working for that phone, and refuses any other", async () => {
      const { token } = await createPairing(db, teacher, "America/Chicago");
      await verifyPairing(db, { token, ...PHONE });

      await expect(verifyPairing(db, { token, ...PHONE })).resolves.toBeDefined();
      await expect(verifyPairing(db, { token, ...OTHER_PHONE })).rejects.toThrow(ConflictError);
    });
  });

  describe("it stops working", () => {
    it("once it has expired", async () => {
      const { token } = await createPairing(db, teacher, "America/Chicago");
      await db.update(scanSessions).set({ expiresAt: new Date(Date.now() - 1000) });

      await expect(verifyPairing(db, { token, ...PHONE })).rejects.toThrow(NotFoundError);
    });

    it("once the teacher disconnects it", async () => {
      const { token, pairingId } = await createPairing(db, teacher, "America/Chicago");
      await verifyPairing(db, { token, ...PHONE });

      await revokePairing(db, teacher, pairingId);
      await expect(verifyPairing(db, { token, ...PHONE })).rejects.toThrow(NotFoundError);
      await expect(revokePairing(db, teacher, pairingId)).rejects.toThrow(NotFoundError);
    });

    it("and one teacher can't disconnect another's phone", async () => {
      const { pairingId } = await createPairing(db, teacher, "America/Chicago");
      await expect(revokePairing(db, other, pairingId)).rejects.toThrow(NotFoundError);
      expect(await listActivePairings(db, teacher)).toHaveLength(1);
    });

    it("when the teacher signs out, taking every phone with it", async () => {
      const first = await createPairing(db, teacher, "America/Chicago");
      const second = await createPairing(db, teacher, "America/Chicago");
      const untouched = await createPairing(db, other, "America/Chicago");

      await revokeAllPairings(db, teacher);

      await expect(verifyPairing(db, { token: first.token, ...PHONE })).rejects.toThrow(NotFoundError);
      await expect(verifyPairing(db, { token: second.token, ...PHONE })).rejects.toThrow(NotFoundError);
      await expect(verifyPairing(db, { token: untouched.token, ...PHONE })).resolves.toBeDefined();
      expect(await listActivePairings(db, teacher)).toHaveLength(0);
    });
  });

  describe("a day at a time", () => {
    it("ends at the next local midnight, not a rolling day", () => {
      // Late morning in Chicago: expiry is tonight, not this time tomorrow.
      const morning = new Date("2026-09-22T15:00:00Z");
      const expires = pairingExpiry("America/Chicago", morning);
      expect(expires.toISOString()).toBe("2026-09-23T05:00:00.000Z");
      expect(expires.getTime() - morning.getTime()).toBeLessThan(24 * 60 * 60 * 1000);
    });

    it("falls back to a flat day when the time zone is unknown or nonsense", () => {
      const now = new Date("2026-09-22T15:00:00Z");
      for (const zone of [null, undefined, "Not/AZone"]) {
        const expires = pairingExpiry(zone, now);
        expect(expires.getTime() - now.getTime()).toBe(24 * 60 * 60 * 1000);
      }
    });

    it("never runs past a day even where midnight is far away", () => {
      const justAfterMidnight = new Date("2026-09-22T05:30:00Z");
      const expires = pairingExpiry("America/Chicago", justAfterMidnight);
      expect(expires.getTime() - justAfterMidnight.getTime()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    });
  });

  describe("limits", () => {
    it("stops a runaway scanner but not a fast one", async () => {
      const { token, pairingId } = await createPairing(db, teacher, "America/Chicago");
      const pairing = await verifyPairing(db, { token, ...PHONE });

      for (let i = 0; i < 60; i++) {
        await assertWithinLimits(db, pairingId, "isbn");
        await recordScanEvent(db, pairing, "book_added", { isbn13: "9780064440202" });
      }
      await expect(assertWithinLimits(db, pairingId, "isbn")).rejects.toThrow(LimitError);
      // Shelf photos are counted separately, and cost real money, so they run out sooner.
      await expect(assertWithinLimits(db, pairingId, "shelf")).resolves.toBeUndefined();
    });

    it("counts shelf photos against their own, much tighter, allowance", async () => {
      const { token, pairingId } = await createPairing(db, teacher, "America/Chicago");
      const pairing = await verifyPairing(db, { token, ...PHONE });

      for (let i = 0; i < 10; i++) {
        await assertWithinLimits(db, pairingId, "shelf");
        await recordScanEvent(db, pairing, "shelf_proposed", { slots: [], needsAttention: 0 });
      }
      await expect(assertWithinLimits(db, pairingId, "shelf")).rejects.toThrow(LimitError);
      await expect(assertWithinLimits(db, pairingId, "isbn")).resolves.toBeUndefined();
    });

    it("counts each pairing on its own", async () => {
      const first = await createPairing(db, teacher, "America/Chicago");
      const second = await createPairing(db, teacher, "America/Chicago");
      const pairing = await verifyPairing(db, { token: first.token, ...PHONE });

      for (let i = 0; i < 10; i++) {
        await recordScanEvent(db, pairing, "shelf_proposed", { slots: [], needsAttention: 0 });
      }
      await expect(assertWithinLimits(db, first.pairingId, "shelf")).rejects.toThrow(LimitError);
      await expect(assertWithinLimits(db, second.pairingId, "shelf")).resolves.toBeUndefined();
    });
  });

  describe("the feed", () => {
    it("only ever hands a teacher their own events", async () => {
      const mine = await verifyPairing(db, {
        token: (await createPairing(db, teacher, "America/Chicago")).token,
        ...PHONE,
      });
      const theirs = await verifyPairing(db, {
        token: (await createPairing(db, other, "America/Chicago")).token,
        ...PHONE,
      });
      await recordScanEvent(db, mine, "book_added", { isbn13: "9780064440202" });
      await recordScanEvent(db, theirs, "book_added", { isbn13: "9780062315007" });

      const events = await listScanEvents(db, teacher, 0);
      expect(events).toHaveLength(1);
      expect(events[0].payload).toEqual({ isbn13: "9780064440202" });
      expect(await listScanEvents(db, other, 0)).toHaveLength(1);
    });

    it("reads forward from a cursor, so a page never replays what it has seen", async () => {
      const pairing = await verifyPairing(db, {
        token: (await createPairing(db, teacher, "America/Chicago")).token,
        ...PHONE,
      });
      for (const isbn13 of ["9780064440202", "9780062315007", "9780545010221"]) {
        await recordScanEvent(db, pairing, "book_added", { isbn13 });
      }

      const all = await listScanEvents(db, teacher, 0);
      expect(all).toHaveLength(3);
      expect(await listScanEvents(db, teacher, all[0].seq)).toHaveLength(2);
      expect(await listScanEvents(db, teacher, all[2].seq)).toHaveLength(0);
      expect(await latestScanEventSeq(db, teacher)).toBe(all[2].seq);
    });

    it("starts a fresh page at the end, so pairing at four o'clock replays nothing", async () => {
      expect(await latestScanEventSeq(db, teacher)).toBe(0);
      const pairing = await verifyPairing(db, {
        token: (await createPairing(db, teacher, "America/Chicago")).token,
        ...PHONE,
      });
      await recordScanEvent(db, pairing, "book_added", { isbn13: "9780064440202" });

      const cursor = await latestScanEventSeq(db, teacher);
      expect(await listScanEvents(db, teacher, cursor)).toHaveLength(0);
    });

    it("goes when its pairing does", async () => {
      const { token, pairingId } = await createPairing(db, teacher, "America/Chicago");
      const pairing = await verifyPairing(db, { token, ...PHONE });
      await recordScanEvent(db, pairing, "book_added", { isbn13: "9780064440202" });

      await db.delete(scanSessions).where(eq(scanSessions.id, pairingId));
      expect(await db.select().from(scanEvents)).toHaveLength(0);
    });
  });

  it("describes a phone coarsely, without fingerprinting it", () => {
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("iPhone");
    expect(describeDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari")).toBe("Android phone");
    expect(describeDevice("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)")).toBe("iPad");
    expect(describeDevice(null)).toBe("Phone");
  });
});
