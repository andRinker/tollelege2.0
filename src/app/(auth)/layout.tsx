import type { ReactNode } from "react";
import { APP_CATCHPHRASE, APP_DESCRIPTION, AUGUSTINE } from "@/lib/brand";
import { BrandMark } from "@/ui/components/brand";
import { TextLink } from "@/ui/components/text-link";
import { Shape } from "@/ui/components/expressive";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh expanded:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-primary-container text-on-primary-container expanded:flex expanded:flex-col expanded:justify-between expanded:p-12">
        <BrandMark size="lg" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 top-1/2 -translate-y-1/2 opacity-90">
          <div className="animate-[spin_60s_linear_infinite]">
            <Shape shape="cookie9" size={520} className="fill-primary/15" />
          </div>
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute left-16 top-40">
          <Shape shape="clover4" size={120} className="fill-tertiary-container" />
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute right-16 top-16">
          <Shape shape="sunny" size={88} className="fill-secondary-container" />
        </div>
        <div className="relative flex max-w-md flex-col gap-6">
          <p className="text-display-lg-em" style={{ fontVariationSettings: '"ROND" 100' }}>
            Tolle lege.
          </p>
          <figure className="flex flex-col gap-2 border-l-4 border-on-primary-container/30 pl-4">
            <blockquote className="text-title-lg italic">{AUGUSTINE.text}</blockquote>
            <figcaption className="text-label-lg">{`— ${AUGUSTINE.source}`}</figcaption>
          </figure>
          <div className="flex flex-col gap-2">
            <p className="text-headline-sm-em">{APP_CATCHPHRASE}</p>
            <p className="text-title-md">{APP_DESCRIPTION}</p>
          </div>
        </div>
      </aside>
      <div className="flex flex-col">
        <main className="flex grow items-center justify-center px-4 py-10 medium:px-10">
          <div className="w-full max-w-[420px]">{children}</div>
        </main>
        <footer className="flex flex-col items-center gap-3 px-4 pb-6 text-center text-body-sm text-on-surface-variant">
          {/* The side panel is for wide screens; a phone gets the same words, smaller, here. */}
          <div className="flex flex-col gap-1 expanded:hidden">
            <p className="text-title-sm text-primary">{APP_CATCHPHRASE}</p>
            <p>
              <span className="italic">&ldquo;Take up and read; take up and read.&rdquo;</span> — {AUGUSTINE.source}
            </p>
          </div>
          <TextLink href="/privacy">Privacy</TextLink>
        </footer>
      </div>
    </div>
  );
}
