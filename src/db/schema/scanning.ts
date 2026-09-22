import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { scanEventKinds, sqlList } from "./enums";

/**
 * A phone borrowed as a barcode scanner for the day.
 *
 * The phone never signs in. It holds a pairing token that can do three things — add a
 * book by ISBN, send a shelf photo, and nothing else — and it stops working at midnight.
 * That is the whole point: a teacher whose school account won't sign in on their phone
 * can still scan a shelf, and a teacher who simply doesn't want their library on a
 * personal device doesn't have to put it there.
 */
export const scanSessions = pgTable(
  "scan_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teacherId: text("teacher_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /**
     * SHA-256 of the pairing token. The token itself is high-entropy random and is never
     * stored, logged, or put in a URL path — it travels in the QR code's fragment, which
     * browsers don't send to servers.
     */
    tokenHash: text("token_hash").notNull(),
    /**
     * The first phone to present the token claims it, and every later request must carry
     * the same id. A token photographed off the teacher's screen is then useless once
     * their own phone has paired — and if it is grabbed first, their phone is refused and
     * they find out immediately, which is the failure worth having.
     */
    deviceId: text("device_id"),
    /** Coarse description of that phone, for the "paired with" line on the laptop. */
    deviceLabel: text("device_label"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    /** Local midnight in the teacher's time zone, capped a day out. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("scan_sessions_id_teacher_unique").on(t.id, t.teacherId),
    unique("scan_sessions_token_unique").on(t.tokenHash),
    index("scan_sessions_teacher_idx").on(t.teacherId, t.expiresAt),
    check(
      "scan_sessions_claim_consistency",
      sql`(${t.claimedAt} is null) = (${t.deviceId} is null)`,
    ),
  ],
);

/**
 * What the phone did, for the signed-in browser to pick up.
 *
 * The phone's request is what performs the add, so the laptop can sleep in the middle of
 * a shelf and lose nothing; it reads the backlog when it wakes. `seq` is the cursor —
 * timestamps tie under a fast scanner.
 */
export const scanEvents = pgTable(
  "scan_events",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    teacherId: text("teacher_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    scanSessionId: uuid("scan_session_id").notNull(),
    kind: text("kind", { enum: scanEventKinds }).notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "scan_events_session_fk",
      columns: [t.scanSessionId, t.teacherId],
      foreignColumns: [scanSessions.id, scanSessions.teacherId],
    }).onDelete("cascade"),
    index("scan_events_teacher_idx").on(t.teacherId, t.seq),
    check("scan_events_kind_check", sql.raw(`kind in ${sqlList(scanEventKinds)}`)),
  ],
);
