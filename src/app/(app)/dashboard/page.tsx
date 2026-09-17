import type { Metadata } from "next";
import { requireTeacher } from "@/server/session";
import { LinkButton } from "@/ui/components/button";
import { PageHeader } from "@/ui/components/expressive";
import { iconInput, iconLibraryAdd, iconOutput } from "@/ui/icons/generated";

export const metadata: Metadata = { title: "Home" };

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const teacher = await requireTeacher();
  const firstName = teacher.name.split(/\s+/)[0];

  return (
    <>
      <PageHeader title={`${greeting(new Date().getHours())}, ${firstName}`} subtitle="What would you like to do?" />
      <section aria-label="Quick actions" className="grid gap-3 medium:grid-cols-3">
        <LinkButton href="/checkout" size="lg" shape="square" icon={iconOutput} className="w-full">
          Check out
        </LinkButton>
        <LinkButton href="/checkin" size="lg" shape="square" variant="tonal" icon={iconInput} className="w-full">
          Check in
        </LinkButton>
        <LinkButton href="/library/add" size="lg" shape="square" variant="tonal" icon={iconLibraryAdd} className="w-full">
          Add books
        </LinkButton>
      </section>
    </>
  );
}
