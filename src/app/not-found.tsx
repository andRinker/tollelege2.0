import { LinkButton } from "@/ui/components/button";
import { EmptyState } from "@/ui/components/expressive";
import { iconHome, iconMenuBook } from "@/ui/icons/generated";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <EmptyState
        icon={iconMenuBook}
        shape="clover8"
        title="We couldn't find that page"
        description="It may have been moved or deleted, or the link has a typo."
        action={
          <LinkButton href="/dashboard" icon={iconHome}>
            Go home
          </LinkButton>
        }
      />
    </main>
  );
}
