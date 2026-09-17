import type { ReactNode } from "react";
import { APP_DESCRIPTION, APP_TAGLINE } from "@/lib/brand";
import { BrandMark } from "@/ui/components/brand";
import { TextLink } from "@/ui/components/text-link";
import { Shape } from "@/ui/components/expressive";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh expanded:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside
        aria-hidden="true"
        className="relative hidden overflow-hidden bg-primary-container text-on-primary-container expanded:flex expanded:flex-col expanded:justify-between expanded:p-12"
      >
        <BrandMark size="lg" />
        <div className="pointer-events-none absolute -right-24 top-1/2 -translate-y-1/2 opacity-90">
          <div className="animate-[spin_60s_linear_infinite]">
            <Shape shape="cookie9" size={520} className="fill-primary/15" />
          </div>
        </div>
        <div className="pointer-events-none absolute left-16 top-40">
          <Shape shape="clover4" size={120} className="fill-tertiary-container" />
        </div>
        <div className="pointer-events-none absolute bottom-48 left-1/3">
          <Shape shape="sunny" size={88} className="fill-secondary-container" />
        </div>
        <div className="relative flex max-w-md flex-col gap-4">
          <p className="text-display-lg-em" style={{ fontVariationSettings: '"ROND" 100' }}>
            Tolle lege.
          </p>
          <p className="text-headline-sm">{APP_TAGLINE}.</p>
          <p className="text-title-md text-on-primary-container">{APP_DESCRIPTION}</p>
        </div>
      </aside>
      <div className="flex flex-col">
        <main className="flex grow items-center justify-center px-4 py-10 medium:px-10">
          <div className="w-full max-w-[420px]">{children}</div>
        </main>
        <footer className="px-4 pb-6 text-center text-body-sm text-on-surface-variant">
          <TextLink href="/privacy">Privacy</TextLink>
        </footer>
      </div>
    </div>
  );
}
