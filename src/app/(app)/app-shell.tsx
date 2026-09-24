"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Button as AriaButton, Header, MenuSection } from "react-aria-components";
import { authClient } from "@/lib/auth-client";
import { switchClassroomAction } from "@/app/(app)/classes/coteacher-actions";
import { revokeAllPairingsAction } from "@/app/(app)/library/add/pairing-actions";
import { cx } from "@/ui/cx";
import { BrandMark } from "@/ui/components/brand";
import { Avatar } from "@/ui/components/expressive";
import { Button } from "@/ui/components/button";
import { Menu, MenuItem, MenuTrigger } from "@/ui/components/menu";
import { useSnackbar } from "@/ui/components/snackbar";
import { type NavDestination, NavigationBar, NavigationRail } from "@/ui/components/navigation";
import {
  iconAdminPanelSettings,
  iconGroups,
  iconHome,
  iconInput,
  iconLocalLibrary,
  iconLogout,
  iconOutput,
  iconSettings,
  iconSwapVert,
} from "@/ui/icons/generated";

function destinations(lendingWaiting: number, coTeaching: boolean): NavDestination[] {
  return [
    { href: "/dashboard", label: "Home", icon: iconHome },
    { href: "/library", label: "Library", icon: iconLocalLibrary },
    { href: "/checkout", label: "Check out", icon: iconOutput },
    { href: "/checkin", label: "Check in", icon: iconInput },
    { href: "/classes", label: "Classes", icon: iconGroups },
    // Lending between teachers is the classroom owner's to manage, so it isn't offered in
    // a classroom you only co-teach.
    ...(coTeaching
      ? []
      : [
          {
            href: "/lending",
            label: "Lending",
            icon: iconSwapVert,
            badge: { count: lendingWaiting, label: `${lendingWaiting} waiting for you` },
          },
        ]),
  ];
}

export type ClassroomChoice = { ownerId: string; ownerName: string; classNames: string[] };

function possessive(name: string) {
  return name.endsWith("s") ? `${name}\u2019` : `${name}\u2019s`;
}

/** Moves this browser between your own classroom and ones shared with you. */
function useSwitchClassroom() {
  const router = useRouter();
  const showSnackbar = useSnackbar();
  return async (ownerId: string | null) => {
    const result = await switchClassroomAction(ownerId);
    if (!result.ok) showSnackbar({ message: result.message });
    router.replace("/dashboard");
    router.refresh();
  };
}

function ClassroomSwitcher({ classrooms, current }: { classrooms: ClassroomChoice[]; current: string | null }) {
  const switchTo = useSwitchClassroom();
  const here = classrooms.find((room) => room.ownerId === current);
  return (
    <MenuTrigger>
      <Button variant="tonal" size="xs" icon={iconGroups}>
        {here ? `${possessive(here.ownerName)} classroom` : "Your classroom"}
      </Button>
      <Menu
        selectionMode="single"
        selectedKeys={[current ?? "own"]}
        onAction={(key) => void switchTo(key === "own" ? null : String(key))}
      >
        <MenuItem id="own">Your classroom</MenuItem>
        {classrooms.map((room) => (
          <MenuItem key={room.ownerId} id={room.ownerId}>
            {`${possessive(room.ownerName)} classroom \u00b7 ${room.classNames.join(", ")}`}
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  );
}

/** On screen whenever you're working in someone else's classroom. */
function ClassroomStrip({ room }: { room: ClassroomChoice }) {
  const switchTo = useSwitchClassroom();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-secondary-container px-4 py-2 text-on-secondary-container">
      <span className="grow text-body-md">
        {`You're working in ${possessive(room.ownerName)} classroom: ${room.classNames.join(", ")}. What you add or change is theirs.`}
      </span>
      <Button variant="text" size="xs" onPress={() => void switchTo(null)}>
        Back to your classroom
      </Button>
    </div>
  );
}

function footerDestinations(isAdmin: boolean): NavDestination[] {
  // Beside Settings rather than in the phone's bottom bar, which has no room for a seventh.
  return [
    ...(isAdmin ? [{ href: "/admin", label: "Admin", icon: iconAdminPanelSettings }] : []),
    { href: "/settings", label: "Settings", icon: iconSettings },
  ];
}

/** Ends acting-as and returns to the admin's own account, back on the page they came from. */
async function stopActing(): Promise<string | null> {
  const response = await fetch("/api/auth/act-as/stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (response.ok) return null;
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return body?.message ?? "Couldn't get back to your account.";
}

type Teacher = { name: string; email: string };

function AccountMenu({ teacher, isAdmin, acting }: { teacher: Teacher; isAdmin: boolean; acting: boolean }) {
  const router = useRouter();
  const showSnackbar = useSnackbar();
  return (
    <MenuTrigger>
      <AriaButton
        aria-label="Account"
        className="state-layer focus-ring grid size-12 cursor-pointer place-items-center rounded-full"
      >
        <Avatar name={teacher.name} size={36} />
      </AriaButton>
      <Menu
        onAction={async (key) => {
          if (key === "stop-acting") {
            const problem = await stopActing();
            if (problem) showSnackbar({ message: problem });
            router.replace("/admin");
            router.refresh();
            return;
          }
          if (key !== "sign-out") return;
          await revokeAllPairingsAction();
          await authClient.signOut();
          router.replace("/sign-in");
          router.refresh();
        }}
      >
        <MenuSection>
          <Header className="flex flex-col px-3 pt-2 pb-3">
            <span className="text-title-sm text-on-surface">{teacher.name}</span>
            <span className="text-body-sm text-on-surface-variant">{teacher.email}</span>
          </Header>
          {isAdmin && (
            <MenuItem id="admin" href="/admin" icon={iconAdminPanelSettings}>
              Admin
            </MenuItem>
          )}
          <MenuItem id="settings" href="/settings" icon={iconSettings}>
            Settings
          </MenuItem>
          {/* Signing out while acting would end the teacher's pairings and strand the admin. */}
          {acting ? (
            <MenuItem id="stop-acting" icon={iconLogout}>
              Back to your account
            </MenuItem>
          ) : (
            <MenuItem id="sign-out" icon={iconLogout}>
              Sign out
            </MenuItem>
          )}
        </MenuSection>
      </Menu>
    </MenuTrigger>
  );
}

type AppShellProps = {
  teacher: Teacher;
  railExpanded: boolean;
  /** Lending requests and invitations waiting on this teacher. */
  lendingWaiting: number;
  isAdmin: boolean;
  /** Classrooms shared with this teacher, for the switcher. Empty hides it. */
  classrooms: ClassroomChoice[];
  /** The owner whose classroom this browser is in, or null for your own. */
  currentClassroom: string | null;
  /** When an admin is acting as this teacher, the time it lapses, already formatted. */
  actingUntil: string | null;
  children: ReactNode;
};

/**
 * Always on screen while an admin is inside someone else's account, so nobody forgets
 * whose library they're changing.
 */
function ActingBanner({ teacher, until }: { teacher: Teacher; until: string }) {
  const router = useRouter();
  const showSnackbar = useSnackbar();
  const [pending, setPending] = useState(false);
  return (
    <div
      role="status"
      className="sticky top-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-1 bg-tertiary-container px-4 py-2 text-on-tertiary-container medium:pl-28"
    >
      <span className="grow text-body-md">
        {`You're working in ${teacher.name}'s account (${teacher.email}). Changes are theirs. Ends at ${until}.`}
      </span>
      <Button
        variant="filled"
        size="xs"
        isPending={pending}
        onPress={async () => {
          setPending(true);
          const problem = await stopActing();
          setPending(false);
          if (problem) showSnackbar({ message: problem });
          router.replace("/admin");
          router.refresh();
        }}
      >
        Back to your account
      </Button>
    </div>
  );
}

export function AppShell({
  teacher,
  railExpanded,
  lendingWaiting,
  isAdmin,
  classrooms,
  currentClassroom,
  actingUntil,
  children,
}: AppShellProps) {
  const [expanded, setExpanded] = useState(railExpanded);
  const DESTINATIONS = destinations(lendingWaiting, currentClassroom !== null);
  const room = classrooms.find((choice) => choice.ownerId === currentClassroom);

  function toggleRail() {
    const next = !expanded;
    setExpanded(next);
    document.cookie = `rail=${next ? "expanded" : "collapsed"};path=/;max-age=31536000;samesite=lax`;
  }

  return (
    <div className="min-h-dvh">
      {actingUntil && <ActingBanner teacher={teacher} until={actingUntil} />}
      <NavigationRail
        destinations={DESTINATIONS}
        footerDestinations={footerDestinations(isAdmin)}
        expanded={expanded}
        onToggle={toggleRail}
      />
      <div
        className={cx(
          "flex min-h-dvh flex-col transition-[padding] duration-350 ease-[var(--ease-default-spatial)]",
          expanded ? "medium:pl-[280px]" : "medium:pl-24",
        )}
      >
        <header className="sticky top-0 z-20 flex h-16 items-center gap-2 bg-surface/95 pr-2 pl-4 backdrop-blur medium:bg-transparent medium:backdrop-blur-none medium:pointer-events-none">
          <BrandMark className="text-primary medium:hidden" />
          <span className="grow" />
          {classrooms.length > 0 && (
            <span className="medium:pointer-events-auto medium:pt-4">
              <ClassroomSwitcher classrooms={classrooms} current={currentClassroom} />
            </span>
          )}
          <span className="medium:pointer-events-auto medium:pt-4">
            <AccountMenu teacher={teacher} isAdmin={isAdmin} acting={actingUntil !== null} />
          </span>
        </header>
        <main className="mx-auto w-full max-w-[1280px] grow px-4 pb-[calc(96px+env(safe-area-inset-bottom))] medium:-mt-16 medium:px-8 medium:pb-12 expanded:px-12">
          {room && (
            <div className="pb-2 medium:pt-20">
              <ClassroomStrip room={room} />
            </div>
          )}
          {children}
        </main>
      </div>
      <NavigationBar destinations={DESTINATIONS} />
    </div>
  );
}
