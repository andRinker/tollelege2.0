import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { schoolYearLabel, todayInTimeZone } from "@/lib/dates";
import { listClasses } from "@/server/roster";
import { requireTeacher } from "@/server/session";
import { getRequestSettings } from "@/server/theme";
import { EmptyState, PageHeader, Shape } from "@/ui/components/expressive";
import { List, ListItem } from "@/ui/components/list";
import { CardLink } from "@/ui/components/surfaces";
import { iconGroups } from "@/ui/icons/generated";
import type { ShapeName } from "@/ui/shapes/shapes";
import { NewClassButton } from "./classes-actions";

export const metadata: Metadata = { title: "Classes" };

const CLASS_SHAPES: ShapeName[] = ["clover4", "cookie9", "sunny", "flower", "cookie6", "softBurst"];
const CLASS_COLORS = [
  ["fill-primary-container", "text-on-primary-container"],
  ["fill-secondary-container", "text-on-secondary-container"],
  ["fill-tertiary-container", "text-on-tertiary-container"],
] as const;

function classMonogram(name: string) {
  const digits = name.match(/\d+/)?.[0];
  if (digits && digits.length <= 3) return digits;
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export default async function ClassesPage() {
  const { teacherId } = await requireTeacher();
  const settings = await getRequestSettings();
  const today = todayInTimeZone(settings.timeZone);
  const all = await listClasses(getDb(), teacherId, today);
  const active = all.filter((klass) => !klass.archivedAt);
  const archived = all.filter((klass) => klass.archivedAt);
  const studentTotal = active.reduce((sum, klass) => sum + klass.studentCount, 0);
  const defaultSchoolYear = schoolYearLabel(today);

  return (
    <>
      <PageHeader
        title="Classes"
        subtitle={
          active.length > 0
            ? `${active.length} ${active.length === 1 ? "class" : "classes"} · ${studentTotal} ${studentTotal === 1 ? "student" : "students"}`
            : undefined
        }
        actions={active.length > 0 && <NewClassButton defaultSchoolYear={defaultSchoolYear} />}
      />

      {active.length === 0 ? (
        <EmptyState
          icon={iconGroups}
          shape="clover4"
          title="No classes yet"
          description="Create a class, then paste or upload your roster. Students don't need accounts."
          action={<NewClassButton defaultSchoolYear={defaultSchoolYear} size="md" />}
        />
      ) : (
        <ul className="grid gap-3 medium:grid-cols-2 large:grid-cols-3">
          {active.map((klass, index) => {
            const [fill, text] = CLASS_COLORS[index % CLASS_COLORS.length];
            return (
              <li key={klass.id}>
                <CardLink href={`/classes/${klass.id}`} className="flex h-full items-center gap-4 rounded-xl bg-surface-container-low p-5">
                  <Shape shape={CLASS_SHAPES[index % CLASS_SHAPES.length]} size={64} className={fill}>
                    <span className={`text-title-lg-em ${text}`} style={{ fontVariationSettings: '"ROND" 100' }}>
                      {classMonogram(klass.name)}
                    </span>
                  </Shape>
                  <div className="flex min-w-0 grow flex-col gap-1">
                    <span className="truncate text-title-lg-em text-on-surface">{klass.name}</span>
                    <span className="text-body-md text-on-surface-variant">
                      {klass.studentCount} {klass.studentCount === 1 ? "student" : "students"} · {klass.booksOut}{" "}
                      {klass.booksOut === 1 ? "book" : "books"} out
                    </span>
                    <span className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="text-label-md text-on-surface-variant">{klass.schoolYear}</span>
                      {klass.overdue > 0 && (
                        <span className="rounded-full bg-error-container px-2 py-0.5 text-label-md text-on-error-container">
                          {klass.overdue} overdue
                        </span>
                      )}
                    </span>
                  </div>
                </CardLink>
              </li>
            );
          })}
        </ul>
      )}

      {archived.length > 0 && (
        <section className="flex flex-col gap-3 pt-10">
          <h2 className="text-title-lg-em text-on-surface-variant">Archived</h2>
          <List aria-label="Archived classes">
            {archived.map((klass) => (
              <ListItem
                key={klass.id}
                headline={klass.name}
                supporting={`${klass.schoolYear} · ${klass.studentCount} ${klass.studentCount === 1 ? "student" : "students"}`}
                href={`/classes/${klass.id}`}
              />
            ))}
          </List>
        </section>
      )}
    </>
  );
}
