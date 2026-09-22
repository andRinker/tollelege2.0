import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BookCover } from "@/components/book-cover";
import { getDb } from "@/db/client";
import { describeDueDate, todayInTimeZone } from "@/lib/dates";
import { listConnections } from "@/server/connections";
import { type ActiveShelfLoan, listShelfLoans, type ShelfLoanRequest } from "@/server/lending";
import { requireTeacher } from "@/server/session";
import { getRequestSettings } from "@/server/theme";
import { LinkButton } from "@/ui/components/button";
import { Avatar, EmptyState, PageHeader } from "@/ui/components/expressive";
import { Card, SectionHeader } from "@/ui/components/surfaces";
import { iconGroupAdd, iconShelves } from "@/ui/icons/generated";
import {
  CancelRequestButton,
  DisconnectButton,
  InvitationActions,
  InviteTeacherButton,
  RequestActions,
  ReturnLoanButton,
} from "./lending-actions";

export const metadata: Metadata = { title: "Lending" };

function Row({ children, actions }: { children: ReactNode; actions: ReactNode }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="flex min-w-0 grow items-center gap-3">{children}</div>
      <div className="shrink-0">{actions}</div>
    </li>
  );
}

function BookRow({
  loan,
  detail,
  actions,
}: {
  loan: ShelfLoanRequest | ActiveShelfLoan;
  detail: ReactNode;
  actions: ReactNode;
}) {
  return (
    <Row actions={actions}>
      {/* BookCover is `w-full`, so its width has to come from a wrapper, not a class on it. */}
      <span className="w-10 shrink-0">
        <BookCover title={loan.title} coverUrl={loan.coverUrl} size="sm" />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-title-sm text-on-surface">{loan.title}</span>
        <span className="truncate text-body-sm text-on-surface-variant">{detail}</span>
      </div>
    </Row>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <SectionHeader title={title} />
      <Card variant="filled" className="bg-surface-container-low p-0">
        <ul className="divide-y divide-outline-variant">{children}</ul>
      </Card>
    </section>
  );
}

function dueText(dueOn: string | null, today: string, prefix: string) {
  if (!dueOn) return `${prefix} · no date agreed`;
  return `${prefix} · ${describeDueDate(dueOn, today)}`;
}

export default async function LendingPage() {
  const { teacherId } = await requireTeacher();
  const settings = await getRequestSettings();
  const today = todayInTimeZone(settings.timeZone);
  const db = getDb();
  const [loans, connections] = await Promise.all([
    listShelfLoans(db, teacherId, today),
    listConnections(db, teacherId),
  ]);

  const hasAnyone = connections.peers.length + connections.incoming.length + connections.outgoing.length > 0;
  const waiting = loans.incoming.length + connections.incoming.length;

  return (
    <>
      <PageHeader
        title="Lending"
        subtitle={
          connections.peers.length > 0
            ? `${connections.peers.length} ${connections.peers.length === 1 ? "teacher" : "teachers"} · ${loans.borrowed.length} borrowed · ${loans.lentOut.length} out`
            : undefined
        }
        actions={hasAnyone && <InviteTeacherButton variant="tonal" />}
      />

      {!hasAnyone ? (
        <EmptyState
          icon={iconGroupAdd}
          title="Share shelves with another teacher"
          description="Invite a colleague by email. Once you're connected you can browse each other's libraries and borrow the books your own shelves are missing."
          action={<InviteTeacherButton />}
        />
      ) : (
        <div className="flex flex-col gap-8 pb-8">
          {waiting > 0 && (
            <Section title={waiting === 1 ? "Waiting for you" : `Waiting for you (${waiting})`}>
              {connections.incoming.map((invitation) => (
                <Row
                  key={invitation.connectionId}
                  actions={<InvitationActions connectionId={invitation.connectionId} name={invitation.name} />}
                >
                  <Avatar name={invitation.name} size={40} />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-title-sm text-on-surface">{invitation.name}</span>
                    <span className="truncate text-body-sm text-on-surface-variant">
                      Wants to share shelves with you
                    </span>
                  </div>
                </Row>
              ))}
              {loans.incoming.map((request) => (
                <BookRow
                  key={request.id}
                  loan={request}
                  detail={request.message ? `${request.peerName} — “${request.message}”` : `${request.peerName} asked to borrow this`}
                  actions={
                    <RequestActions
                      shelfLoanId={request.id}
                      title={request.title}
                      borrowerName={request.peerName}
                      today={today}
                    />
                  }
                />
              ))}
            </Section>
          )}

          {loans.borrowed.length > 0 && (
            <Section title="On your shelf">
              {loans.borrowed.map((loan) => (
                <BookRow
                  key={loan.id}
                  loan={loan}
                  detail={dueText(loan.dueOn, today, `From ${loan.peerName}`)}
                  actions={<ReturnLoanButton shelfLoanId={loan.id} title={loan.title} isOwner={false} />}
                />
              ))}
            </Section>
          )}

          {loans.lentOut.length > 0 && (
            <Section title="Out with other teachers">
              {loans.lentOut.map((loan) => (
                <BookRow
                  key={loan.id}
                  loan={loan}
                  detail={dueText(loan.dueOn, today, `With ${loan.peerName}`)}
                  actions={<ReturnLoanButton shelfLoanId={loan.id} title={loan.title} isOwner />}
                />
              ))}
            </Section>
          )}

          {loans.outgoing.length > 0 && (
            <Section title="Your requests">
              {loans.outgoing.map((request) => (
                <BookRow
                  key={request.id}
                  loan={request}
                  detail={`Waiting on ${request.peerName}`}
                  actions={<CancelRequestButton shelfLoanId={request.id} title={request.title} />}
                />
              ))}
            </Section>
          )}

          {(connections.peers.length > 0 || connections.outgoing.length > 0) && (
            <Section title="Teachers">
              {connections.peers.map((peer) => (
                <Row
                  key={peer.connectionId}
                  actions={
                    <div className="flex items-center gap-1">
                      <LinkButton
                        variant="text"
                        size="sm"
                        icon={iconShelves}
                        href={`/lending/shelf/${peer.teacherId}`}
                      >
                        Shelves
                      </LinkButton>
                      <DisconnectButton connectionId={peer.connectionId} name={peer.name} />
                    </div>
                  }
                >
                  <Avatar name={peer.name} size={40} />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-title-sm text-on-surface">{peer.name}</span>
                    <span className="truncate text-body-sm text-on-surface-variant">{peer.email}</span>
                  </div>
                </Row>
              ))}
              {connections.outgoing.map((invitation) => (
                <Row
                  key={invitation.connectionId}
                  actions={<span className="pr-2 text-label-md text-on-surface-variant">Invited</span>}
                >
                  <Avatar name={invitation.name} size={40} />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-title-sm text-on-surface">{invitation.name}</span>
                    <span className="truncate text-body-sm text-on-surface-variant">
                      Hasn&rsquo;t answered yet
                    </span>
                  </div>
                </Row>
              ))}
            </Section>
          )}
        </div>
      )}
    </>
  );
}
