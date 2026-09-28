"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ConnectedButton, ConnectedButtonGroup } from "@/ui/components/button-group";
import { FilterChip } from "@/ui/components/chip";
import { IconButton } from "@/ui/components/icon-button";
import { Menu, MenuDivider, MenuItem, MenuTrigger } from "@/ui/components/menu";
import { LinearProgress } from "@/ui/components/progress";
import { SearchField } from "@/ui/components/text-field";
import { iconGridView, iconSort, iconViewList } from "@/ui/icons/generated";
import { type GenreOption, GenreLabel } from "@/components/genre";
import { LIBRARY_GROUP_COOKIE, LIBRARY_VIEW_COOKIE, type LibraryView } from "./filters";

type Props = {
  query: string;
  availability: string;
  tag?: string;
  level?: string;
  bin?: string;
  genre?: string;
  sort: string;
  view: LibraryView;
  /** Whether each series shows as one stack. */
  group: boolean;
  tags: string[];
  readingLevels: string[];
  locations: string[];
  /** Genres with at least one book, in the teacher's order. */
  genres: GenreOption[];
};

const SORTS = [
  { id: "title", label: "Title" },
  { id: "author", label: "Author" },
  { id: "recent", label: "Recently added" },
];

export function LibraryFilters({ query, availability, tag, level, bin, genre, sort, view, group, tags, readingLevels, locations, genres }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(query);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  function update(changes: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page");
    const queryString = next.toString();
    startTransition(() => router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false }));
  }

  function changeGroup(next: boolean) {
    document.cookie = `${LIBRARY_GROUP_COOKIE}=${next ? "on" : "off"};path=/;max-age=31536000;samesite=lax`;
    startTransition(() => router.refresh());
  }

  function changeView(next: LibraryView) {
    // A cookie rather than the URL, so the library opens the way it was left on this device.
    document.cookie = `${LIBRARY_VIEW_COOKIE}=${next};path=/;max-age=31536000;samesite=lax`;
    startTransition(() => router.refresh());
  }

  useEffect(() => () => clearTimeout(debounce.current), []);

  return (
    <div className="flex flex-col gap-3 pb-4">
      <div className="flex items-center gap-2">
        <SearchField
          placeholder="Search your library"
          aria-label="Search your library"
          value={search}
          onChange={(value) => {
            setSearch(value);
            clearTimeout(debounce.current);
            debounce.current = setTimeout(() => update({ q: value.trim() || undefined }), 300);
          }}
          onClear={() => update({ q: undefined })}
          className="grow"
        />
        <MenuTrigger>
          <IconButton icon={iconSort} label="Sort" variant="tonal" size="md" />
          {/* Multiple, so the sort and the series switch can both show a tick. */}
          <Menu
            selectionMode="multiple"
            selectedKeys={group ? [sort, "group"] : [sort]}
            onAction={(key) => {
              if (key === "group") changeGroup(!group);
              else update({ sort: key === "title" ? undefined : String(key) });
            }}
          >
            {[
              ...SORTS.map((option) => (
                <MenuItem key={option.id} id={option.id}>
                  {option.label}
                </MenuItem>
              )),
              <MenuDivider key="divider" />,
              <MenuItem key="group" id="group">
                Stack each series
              </MenuItem>,
            ]}
          </Menu>
        </MenuTrigger>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ConnectedButtonGroup
          aria-label="Availability"
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[availability]}
          onSelectionChange={(keys) => {
            const value = [...keys][0];
            update({ availability: value === "all" ? undefined : String(value) });
          }}
        >
          <ConnectedButton id="all">All</ConnectedButton>
          <ConnectedButton id="available">Available</ConnectedButton>
          <ConnectedButton id="out">Checked out</ConnectedButton>
        </ConnectedButtonGroup>
        <ConnectedButtonGroup
          aria-label="Layout"
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[view]}
          onSelectionChange={(keys) => {
            const next = [...keys][0];
            if (next === "grid" || next === "list") changeView(next);
          }}
          className="ml-auto"
        >
          <ConnectedButton id="grid" icon={iconGridView}>
            Grid
          </ConnectedButton>
          <ConnectedButton id="list" icon={iconViewList}>
            List
          </ConnectedButton>
        </ConnectedButtonGroup>
      </div>

      {(genres.length > 0 || tags.length > 0 || readingLevels.length > 0 || locations.length > 0) && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] medium:mx-0 medium:flex-wrap medium:px-0">
          {genres.map((option) => (
            <FilterChip
              key={`genre-${option.id}`}
              isSelected={genre === option.id}
              onChange={(selected) => update({ genre: selected ? option.id : undefined })}
            >
              <GenreLabel genre={option} />
            </FilterChip>
          ))}
          {readingLevels.map((value) => (
            <FilterChip key={`level-${value}`} isSelected={level === value} onChange={(selected) => update({ level: selected ? value : undefined })}>
              {`Level ${value}`}
            </FilterChip>
          ))}
          {locations.map((value) => (
            <FilterChip key={`bin-${value}`} isSelected={bin === value} onChange={(selected) => update({ bin: selected ? value : undefined })}>
              {value}
            </FilterChip>
          ))}
          {tags.map((value) => (
            <FilterChip key={`tag-${value}`} isSelected={tag === value} onChange={(selected) => update({ tag: selected ? value : undefined })}>
              {value}
            </FilterChip>
          ))}
        </div>
      )}

      <div className="h-2.5" aria-hidden={!pending}>
        {pending && <LinearProgress label="Updating results" />}
      </div>
    </div>
  );
}
