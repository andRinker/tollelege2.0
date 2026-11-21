import type { LibraryHealth } from "@/lib/health";

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** What is still missing or unsettled across the library, so "perfectly sorted" can be checked. */
export function LibraryHealthCard({ health }: { health: LibraryHealth }) {
  if (health.books === 0) return null;
  const { missing } = health;
  const rows: [string, number | null][] = [
    ["No description", missing.description],
    ["No cover", missing.cover],
    ["No genre", missing.genre],
    ["No tags", missing.tags],
    ["No reading level", missing.readingLevel],
    ["No page count", missing.pages],
    ["No publisher", missing.publisher],
    ["No year", missing.year],
    ["No author", missing.authors],
    ["Series spelled two ways", health.unsettledSeries],
    ["Author spelled two ways", health.unsettledAuthors],
    ["No ISBN", health.noIsbn],
  ];
  const shown = rows.filter((row): row is [string, number] => row[1] !== null && row[1] > 0);
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-surface-container-low p-3" aria-label="Library health">
      <p className="text-title-sm">{`${health.completePercent}% of ${plural(health.books, "book")} complete`}</p>
      {shown.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">Nothing missing, and every series and author is spelled one way.</p>
      ) : (
        <ul className="grid gap-x-6 text-body-sm text-on-surface-variant medium:grid-cols-2">
          {shown.map(([label, count]) => (
            <li key={label}>{`${label}: ${count}`}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
