"use client";

import { useState } from "react";
import type { MetadataSource, ReadingLevelSystem } from "@/db/schema/enums";
import type { BookDetailsInput } from "@/server/catalog";
import type { BookMetadata } from "@/server/isbn-lookup";
import { cx } from "@/ui/cx";
import { AssistChip, InputChipGroup } from "@/ui/components/chip";
import { IconButton } from "@/ui/components/icon-button";
import { ListBoxItem } from "@/ui/components/menu";
import { ComboBox } from "@/ui/components/select";
import { TextField } from "@/ui/components/text-field";
import { iconAdd, iconLabel, iconRemove, iconShelves } from "@/ui/icons/generated";

export type BookFormValue = {
  isbn: string;
  title: string;
  subtitle: string;
  authors: string;
  publisher: string;
  publishedYear: string;
  pageCount: string;
  readingLevel: string;
  location: string;
  tags: string[];
  notes: string;
  description: string;
  coverUrl: string | null;
  metadataSource: MetadataSource;
};

export const EMPTY_BOOK: BookFormValue = {
  isbn: "",
  title: "",
  subtitle: "",
  authors: "",
  publisher: "",
  publishedYear: "",
  pageCount: "",
  readingLevel: "",
  location: "",
  tags: [],
  notes: "",
  description: "",
  coverUrl: null,
  metadataSource: "manual",
};

export function bookFormFromMetadata(metadata: BookMetadata): BookFormValue {
  return {
    ...EMPTY_BOOK,
    isbn: metadata.isbn13,
    title: metadata.title,
    subtitle: metadata.subtitle ?? "",
    authors: metadata.authors.join(", "),
    publisher: metadata.publisher ?? "",
    publishedYear: metadata.publishedYear ? String(metadata.publishedYear) : "",
    pageCount: metadata.pageCount ? String(metadata.pageCount) : "",
    description: metadata.description ?? "",
    coverUrl: metadata.coverUrl,
    metadataSource: metadata.source,
  };
}

export function bookFormFromBook(book: {
  isbn13: string | null;
  title: string;
  subtitle: string | null;
  authors: string[];
  publisher: string | null;
  publishedYear: number | null;
  pageCount: number | null;
  readingLevel: string | null;
  location: string | null;
  tags: string[];
  notes: string | null;
  description: string | null;
  coverUrl: string | null;
  metadataSource: MetadataSource;
}): BookFormValue {
  return {
    isbn: book.isbn13 ?? "",
    title: book.title,
    subtitle: book.subtitle ?? "",
    authors: book.authors.join(", "),
    publisher: book.publisher ?? "",
    publishedYear: book.publishedYear ? String(book.publishedYear) : "",
    pageCount: book.pageCount ? String(book.pageCount) : "",
    readingLevel: book.readingLevel ?? "",
    location: book.location ?? "",
    tags: book.tags,
    notes: book.notes ?? "",
    description: book.description ?? "",
    coverUrl: book.coverUrl,
    metadataSource: book.metadataSource,
  };
}

const toInt = (value: string) => {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
};

export function bookInputFromForm(value: BookFormValue): BookDetailsInput {
  return {
    isbn13: value.isbn.trim() || null,
    title: value.title.trim(),
    subtitle: value.subtitle.trim() || null,
    authors: value.authors
      .split(/[,;\n]/)
      .map((author) => author.trim())
      .filter(Boolean),
    description: value.description.trim() || null,
    coverUrl: value.coverUrl,
    publisher: value.publisher.trim() || null,
    publishedYear: toInt(value.publishedYear),
    pageCount: toInt(value.pageCount),
    readingLevel: value.readingLevel.trim() || null,
    tags: value.tags,
    location: value.location.trim() || null,
    notes: value.notes.trim() || null,
    metadataSource: value.metadataSource,
  };
}

export const READING_LEVEL_FIELD_LABELS: Record<ReadingLevelSystem, string> = {
  none: "Reading level",
  lexile: "Lexile level",
  guided_reading: "Guided Reading level",
  atos: "ATOS book level",
  grade_level: "Grade level",
  other: "Reading level",
};

type Suggestions = { tags: string[]; locations: string[] };

type FieldProps = {
  value: BookFormValue;
  onChange: (value: BookFormValue) => void;
  readingLevelSystem: ReadingLevelSystem;
  suggestions: Suggestions;
};

/** Tags as removable chips, with a field to add more and one-tap suggestions. */
export function TagEditor({ tags, onChange, suggestions }: { tags: string[]; onChange: (tags: string[]) => void; suggestions: string[] }) {
  const [draft, setDraft] = useState("");
  const lower = new Set(tags.map((tag) => tag.toLowerCase()));
  const unused = suggestions.filter((tag) => !lower.has(tag.toLowerCase())).slice(0, 8);

  function add(tag: string) {
    const clean = tag.replace(/\s+/g, " ").trim().slice(0, 30);
    if (clean && !lower.has(clean.toLowerCase())) onChange([...tags, clean]);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-2">
      <TextField
        label="Add a tag"
        leadingIcon={iconLabel}
        value={draft}
        onChange={setDraft}
        description="Press Enter to add, like “Animals” or “Graphic novel”"
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add(draft);
          }
        }}
        trailing={draft.trim() ? <IconButton icon={iconAdd} label="Add tag" onPress={() => add(draft)} tooltip={false} /> : undefined}
      />
      {tags.length > 0 && (
        <InputChipGroup
          label="Tags"
          items={tags.map((tag) => ({ id: tag, name: tag }))}
          onRemove={(keys) => onChange(tags.filter((tag) => !keys.has(tag)))}
        />
      )}
      {unused.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {unused.map((tag) => (
            <AssistChip key={tag} icon={iconAdd} onPress={() => add(tag)}>
              {tag}
            </AssistChip>
          ))}
        </div>
      )}
    </div>
  );
}

/** Fields a teacher adds on top of looked-up metadata: level, bin, tags. */
export function ShelvingFields({ value, onChange, readingLevelSystem, suggestions }: FieldProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className={cx("grid gap-4", readingLevelSystem !== "none" && "medium:grid-cols-2")}>
        {readingLevelSystem !== "none" && (
          <TextField
            label={READING_LEVEL_FIELD_LABELS[readingLevelSystem]}
            value={value.readingLevel}
            onChange={(readingLevel) => onChange({ ...value, readingLevel })}
            maxLength={20}
          />
        )}
        <ComboBox
          label="Bin or shelf"
          leadingIcon={iconShelves}
          allowsCustomValue
          inputValue={value.location}
          onInputChange={(location) => onChange({ ...value, location })}
          defaultItems={suggestions.locations.map((location) => ({ id: location, name: location }))}
          menuTrigger="focus"
        >
          {(item: { id: string; name: string }) => <ListBoxItem id={item.id}>{item.name}</ListBoxItem>}
        </ComboBox>
      </div>
      <TagEditor tags={value.tags} onChange={(tags) => onChange({ ...value, tags })} suggestions={suggestions.tags} />
    </div>
  );
}

/** Every editable book field, for manual entry and editing. */
export function BookFields({ value, onChange, readingLevelSystem, suggestions }: FieldProps) {
  const set = (patch: Partial<BookFormValue>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-col gap-4">
      <TextField label="Title" isRequired value={value.title} onChange={(title) => set({ title })} maxLength={300} autoFocus />
      <TextField label="Subtitle" value={value.subtitle} onChange={(subtitle) => set({ subtitle })} maxLength={300} />
      <TextField
        label="Authors"
        value={value.authors}
        onChange={(authors) => set({ authors })}
        description="Separate names with commas"
      />
      <div className="grid gap-4 medium:grid-cols-2">
        <TextField label="ISBN" value={value.isbn} onChange={(isbn) => set({ isbn })} inputMode="numeric" />
        <TextField label="Publisher" value={value.publisher} onChange={(publisher) => set({ publisher })} />
        <TextField
          label="Year published"
          value={value.publishedYear}
          onChange={(publishedYear) => set({ publishedYear: publishedYear.replace(/\D/g, "").slice(0, 4) })}
          inputMode="numeric"
        />
        <TextField
          label="Pages"
          value={value.pageCount}
          onChange={(pageCount) => set({ pageCount: pageCount.replace(/\D/g, "").slice(0, 5) })}
          inputMode="numeric"
        />
      </div>
      <ShelvingFields value={value} onChange={onChange} readingLevelSystem={readingLevelSystem} suggestions={suggestions} />
      <TextField label="Notes for you" value={value.notes} onChange={(notes) => set({ notes })} multiline rows={2} maxLength={2000} />
    </div>
  );
}

export function CopyCountStepper({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-title-sm text-on-surface-variant">Copies</span>
      <div role="group" aria-label="Number of copies" className="flex items-center gap-1 rounded-full bg-surface-container-high p-1">
        <IconButton icon={iconRemove} label="One fewer copy" size="sm" tooltip={false} isDisabled={value <= 1} onPress={() => onChange(value - 1)} />
        <output aria-live="polite" className="min-w-8 text-center text-title-md-em tabular-nums">
          {value}
        </output>
        <IconButton icon={iconAdd} label="One more copy" size="sm" variant="tonal" tooltip={false} isDisabled={value >= 100} onPress={() => onChange(value + 1)} />
      </div>
    </div>
  );
}
