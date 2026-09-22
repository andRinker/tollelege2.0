"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Button as AriaButton, Header, MenuSection } from "react-aria-components";
import { authClient } from "@/lib/auth-client";
import { cx } from "@/ui/cx";
import { BrandMark } from "@/ui/components/brand";
import { Avatar } from "@/ui/components/expressive";
import { Menu, MenuItem, MenuTrigger } from "@/ui/components/menu";
import { type NavDestination, NavigationBar, NavigationRail } from "@/ui/components/navigation";
import {
  iconGroups,
  iconHome,
  iconInput,
  iconLocalLibrary,
  iconLogout,
  iconOutput,
  iconSettings,
  iconSwapVert,
} from "@/ui/icons/generated";

function destinations(lendingWaiting: number): NavDestination[] {
  return [
    { href: "/dashboard", label: "Home", icon: iconHome },
    { href: "/library", label: "Library", icon: iconLocalLibrary },
    { href: "/checkout", label: "Check out", icon: iconOutput },
    { href: "/checkin", label: "Check in", icon: iconInput },
    { href: "/classes", label: "Classes", icon: iconGroups },
    {
      href: "/lending",
      label: "Lending",
      icon: iconSwapVert,
      badge: { count: lendingWaiting, label: `${lendingWaiting} waiting for you` },
    },
  ];
}

const FOOTER_DESTINATIONS: NavDestination[] = [{ href: "/settings", label: "Settings", icon: iconSettings }];

type Teacher = { name: string; email: string };

function AccountMenu({ teacher }: { teacher: Teacher }) {
  const router = useRouter();
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
          if (key !== "sign-out") return;
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
          <MenuItem id="settings" href="/settings" icon={iconSettings}>
            Settings
          </MenuItem>
          <MenuItem id="sign-out" icon={iconLogout}>
            Sign out
          </MenuItem>
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
  children: ReactNode;
};

export function AppShell({ teacher, railExpanded, lendingWaiting, children }: AppShellProps) {
  const [expanded, setExpanded] = useState(railExpanded);
  const DESTINATIONS = destinations(lendingWaiting);

  function toggleRail() {
    const next = !expanded;
    setExpanded(next);
    document.cookie = `rail=${next ? "expanded" : "collapsed"};path=/;max-age=31536000;samesite=lax`;
  }

  return (
    <div className="min-h-dvh">
      <NavigationRail
        destinations={DESTINATIONS}
        footerDestinations={FOOTER_DESTINATIONS}
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
          <span className="medium:pointer-events-auto medium:pt-4">
            <AccountMenu teacher={teacher} />
          </span>
        </header>
        <main className="mx-auto w-full max-w-[1280px] grow px-4 pb-[calc(96px+env(safe-area-inset-bottom))] medium:-mt-16 medium:px-8 medium:pb-12 expanded:px-12">
          {children}
        </main>
      </div>
      <NavigationBar destinations={DESTINATIONS} />
    </div>
  );
}
