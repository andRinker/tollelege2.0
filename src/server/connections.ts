import { and, count, eq, inArray, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/db/client";
import { shelfLoans, teacherConnections, user } from "@/db/schema";
import { ConflictError, isUniqueViolation, NotFoundError } from "./errors";

/**
 * Connections are stored with the lower teacher ID first, so the same two teachers can
 * only ever produce one row no matter which of them asks. Every read and write goes
 * through this ordering.
 */
function orderedPair(one: string, other: string): { teacherAId: string; teacherBId: string } {
  return one < other ? { teacherAId: one, teacherBId: other } : { teacherAId: other, teacherBId: one };
}

export type Peer = {
  connectionId: string;
  teacherId: string;
  name: string;
  email: string;
  image: string | null;
  connectedAt: Date;
};

export type ConnectionRequest = {
  connectionId: string;
  teacherId: string;
  name: string;
  email: string;
  image: string | null;
  requestedAt: Date;
};

export type ConnectionsView = {
  peers: Peer[];
  incoming: ConnectionRequest[];
  outgoing: ConnectionRequest[];
};

/** Everyone this teacher is connected to, plus invitations waiting in either direction. */
export async function listConnections(db: Database, teacherId: string): Promise<ConnectionsView> {
  const teacherA = alias(user, "teacher_a");
  const teacherB = alias(user, "teacher_b");

  const rows = await db
    .select({
      connectionId: teacherConnections.id,
      status: teacherConnections.status,
      requestedById: teacherConnections.requestedById,
      createdAt: teacherConnections.createdAt,
      respondedAt: teacherConnections.respondedAt,
      aId: teacherA.id,
      aName: teacherA.name,
      aEmail: teacherA.email,
      aImage: teacherA.image,
      bId: teacherB.id,
      bName: teacherB.name,
      bEmail: teacherB.email,
      bImage: teacherB.image,
    })
    .from(teacherConnections)
    .innerJoin(teacherA, eq(teacherA.id, teacherConnections.teacherAId))
    .innerJoin(teacherB, eq(teacherB.id, teacherConnections.teacherBId))
    .where(
      or(eq(teacherConnections.teacherAId, teacherId), eq(teacherConnections.teacherBId, teacherId)),
    );

  const view: ConnectionsView = { peers: [], incoming: [], outgoing: [] };
  for (const row of rows) {
    const other =
      row.aId === teacherId
        ? { teacherId: row.bId, name: row.bName, email: row.bEmail, image: row.bImage }
        : { teacherId: row.aId, name: row.aName, email: row.aEmail, image: row.aImage };

    if (row.status === "accepted") {
      view.peers.push({ ...other, connectionId: row.connectionId, connectedAt: row.respondedAt ?? row.createdAt });
    } else if (row.requestedById === teacherId) {
      view.outgoing.push({ ...other, connectionId: row.connectionId, requestedAt: row.createdAt });
    } else {
      view.incoming.push({ ...other, connectionId: row.connectionId, requestedAt: row.createdAt });
    }
  }

  view.peers.sort((a, b) => a.name.localeCompare(b.name));
  view.incoming.sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
  view.outgoing.sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
  return view;
}

/** True when the two teachers have an accepted connection. */
export async function areConnected(db: Database, one: string, other: string): Promise<boolean> {
  if (one === other) return false;
  const pair = orderedPair(one, other);
  const [row] = await db
    .select({ id: teacherConnections.id })
    .from(teacherConnections)
    .where(
      and(
        eq(teacherConnections.teacherAId, pair.teacherAId),
        eq(teacherConnections.teacherBId, pair.teacherBId),
        eq(teacherConnections.status, "accepted"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function requireConnection(db: Database, one: string, other: string): Promise<void> {
  if (!(await areConnected(db, one, other))) {
    throw new NotFoundError("You aren't connected to that teacher.");
  }
}

export type ConnectionRequestOutcome = "invited" | "accepted_existing";

/**
 * Invites the teacher signed up with `email`. If they have already invited this teacher,
 * the invitation is accepted instead of a second one being created.
 */
export async function requestConnection(
  db: Database,
  teacherId: string,
  email: string,
): Promise<{ outcome: ConnectionRequestOutcome; name: string }> {
  const [target] = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(eq(sql`lower(${user.email})`, email.trim().toLowerCase()))
    .limit(1);
  if (!target) throw new NotFoundError("No teacher is signed up with that email address.");
  if (target.id === teacherId) throw new ConflictError("That's your own account.");

  const pair = orderedPair(teacherId, target.id);
  const [existing] = await db
    .select({ id: teacherConnections.id, status: teacherConnections.status, requestedById: teacherConnections.requestedById })
    .from(teacherConnections)
    .where(
      and(eq(teacherConnections.teacherAId, pair.teacherAId), eq(teacherConnections.teacherBId, pair.teacherBId)),
    );

  if (existing?.status === "accepted") {
    throw new ConflictError(`You're already sharing shelves with ${target.name}.`);
  }
  if (existing?.requestedById === teacherId) {
    throw new ConflictError(`${target.name} hasn't answered your invitation yet.`);
  }
  if (existing) {
    // They invited this teacher first, so asking back is the same as saying yes.
    await db
      .update(teacherConnections)
      .set({ status: "accepted", respondedAt: new Date() })
      .where(eq(teacherConnections.id, existing.id));
    return { outcome: "accepted_existing", name: target.name };
  }

  try {
    await db.insert(teacherConnections).values({ ...pair, requestedById: teacherId });
  } catch (error) {
    if (isUniqueViolation(error, "teacher_connections_pair_unique")) {
      throw new ConflictError(`${target.name} invited you at the same moment. Check your invitations.`);
    }
    throw error;
  }
  return { outcome: "invited", name: target.name };
}

/** Accepts or declines an invitation. Only the teacher who was invited may answer it. */
export async function respondToConnection(
  db: Database,
  teacherId: string,
  connectionId: string,
  accept: boolean,
): Promise<void> {
  const [invitation] = await db
    .select({ id: teacherConnections.id })
    .from(teacherConnections)
    .where(
      and(
        eq(teacherConnections.id, connectionId),
        eq(teacherConnections.status, "pending"),
        // Only the teacher who did NOT send it can answer it.
        or(eq(teacherConnections.teacherAId, teacherId), eq(teacherConnections.teacherBId, teacherId)),
        ne(teacherConnections.requestedById, teacherId),
      ),
    );
  if (!invitation) throw new NotFoundError("That invitation is no longer waiting for you.");

  if (accept) {
    await db
      .update(teacherConnections)
      .set({ status: "accepted", respondedAt: new Date() })
      .where(eq(teacherConnections.id, connectionId));
  } else {
    await db.delete(teacherConnections).where(eq(teacherConnections.id, connectionId));
  }
}

/** Disconnects two teachers. Refused while either still has a book from the other. */
export async function removeConnection(db: Database, teacherId: string, connectionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [connection] = await tx
      .select({ teacherAId: teacherConnections.teacherAId, teacherBId: teacherConnections.teacherBId })
      .from(teacherConnections)
      .where(
        and(
          eq(teacherConnections.id, connectionId),
          or(eq(teacherConnections.teacherAId, teacherId), eq(teacherConnections.teacherBId, teacherId)),
        ),
      )
      .for("update");
    if (!connection) throw new NotFoundError("That connection doesn't exist.");

    const otherId = connection.teacherAId === teacherId ? connection.teacherBId : connection.teacherAId;
    const pairIds = [teacherId, otherId];
    const [{ open }] = await tx
      .select({ open: count() })
      .from(shelfLoans)
      .where(
        and(
          inArray(shelfLoans.ownerTeacherId, pairIds),
          inArray(shelfLoans.borrowerTeacherId, pairIds),
          inArray(shelfLoans.status, ["requested", "active"]),
        ),
      );
    if (open > 0) {
      throw new ConflictError("Return the books you have borrowed from each other before disconnecting.");
    }

    await tx.delete(teacherConnections).where(eq(teacherConnections.id, connectionId));
  });
}
