"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useRef, useState, useTransition } from "react";
import { Radio as AriaRadio, RadioGroup as AriaRadioGroup } from "react-aria-components";
import { readingLevelSystems, type ReadingLevelSystem, type ThemeContrast, type ThemeMode } from "@/db/schema/enums";
import { authClient } from "@/lib/auth-client";
import type { TeacherSettings } from "@/server/settings";
import { cx } from "@/ui/cx";
import { Button, LinkButton } from "@/ui/components/button";
import { ConnectedButton, ConnectedButtonGroup } from "@/ui/components/button-group";
import { Icon } from "@/ui/components/icon";
import { ListBoxItem } from "@/ui/components/menu";
import { ComboBox, Select } from "@/ui/components/select";
import { useSnackbar } from "@/ui/components/snackbar";
import { TextLink } from "@/ui/components/text-link";
import {
  iconCheck,
  iconContrast,
  iconDarkMode,
  iconLightMode,
  iconLogout,
  iconMoveItem,
  iconPalette,
  iconSync,
} from "@/ui/icons/generated";
import { shapePath } from "@/ui/shapes/shapes";
import { DEFAULT_THEME_SEED, THEME_SWATCHES } from "@/ui/theme/constants";
import { previewTheme } from "@/ui/theme/preview";
import { saveSettings, type SettingsPatch } from "./actions";
import { READING_LEVEL_SYSTEM_LABELS } from "@/lib/reading-levels";

const LOAN_PERIODS = [
  { id: "none", label: "No due dates", days: null },
  { id: "7", label: "1 week", days: 7 },
  { id: "14", label: "2 weeks", days: 14 },
  { id: "21", label: "3 weeks", days: 21 },
  { id: "28", label: "4 weeks", days: 28 },
] as const;

const BOOK_LIMITS = [
  { id: "none", label: "No limit", value: null },
  ...[1, 2, 3, 4, 5, 10].map((value) => ({ id: String(value), label: `${value} ${value === 1 ? "book" : "books"}`, value })),
];

function SettingsSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5 rounded-xl bg-surface-container-low p-5 medium:p-6 [--field-bg:var(--md-sys-color-surface-container-low)]">
      <div className="flex flex-col gap-1">
        <h2 className="text-title-lg-em">{title}</h2>
        {description && <p className="text-body-md text-on-surface-variant">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Swatch({ seed, name }: { seed: string; name: string }) {
  return (
    <AriaRadio value={seed} aria-label={name} className="group grid size-14 cursor-pointer place-items-center rounded-full outline-none">
      {({ isSelected, isFocusVisible, isPressed }) => (
        <span
          className={cx(
            "relative grid size-12 place-items-center transition-transform duration-350 ease-[var(--ease-fast-spatial)]",
            isPressed && "scale-90",
            isFocusVisible && "rounded-full outline-3 outline-offset-2 outline-secondary",
          )}
        >
          <svg viewBox="0 0 48 48" className="absolute inset-0 transition-transform duration-500 ease-[var(--ease-default-spatial)] group-data-[selected]:rotate-45" aria-hidden="true">
            <path d={shapePath(isSelected ? "cookie9" : "circle", 48)} style={{ fill: seed }} />
          </svg>
          {isSelected && <Icon icon={iconCheck} size={24} className="relative text-white drop-shadow" />}
        </span>
      )}
    </AriaRadio>
  );
}

type Props = {
  settings: TeacherSettings;
  teacher: { name: string; email: string };
  timeZones: string[];
};

export function SettingsForm({ settings, teacher, timeZones }: Props) {
  const router = useRouter();
  const showSnackbar = useSnackbar();
  const [, startTransition] = useTransition();
  const [seed, setSeed] = useState(settings.themeSeedColor ?? DEFAULT_THEME_SEED);
  const [mode, setMode] = useState<ThemeMode>(settings.themeMode);
  const [contrast, setContrast] = useState<ThemeContrast>(settings.themeContrast);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isPresetSeed = THEME_SWATCHES.some((swatch) => swatch.seed.toLowerCase() === seed.toLowerCase());

  function save(patch: SettingsPatch) {
    startTransition(async () => {
      const result = await saveSettings(patch);
      if (!result.ok) showSnackbar({ message: result.message });
    });
  }

  function updateTheme(next: { seed?: string; mode?: ThemeMode; contrast?: ThemeContrast }, delay = 0) {
    const theme = { seed: next.seed ?? seed, mode: next.mode ?? mode, contrast: next.contrast ?? contrast };
    setSeed(theme.seed);
    setMode(theme.mode);
    setContrast(theme.contrast);
    previewTheme(theme);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(
      () => save({ themeSeedColor: theme.seed, themeMode: theme.mode, themeContrast: theme.contrast }),
      delay,
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 expanded:grid-cols-2">
      <SettingsSection title="Appearance" description="Your color theme follows you to any device you sign in on.">
        <div className="flex flex-col gap-3">
          <span className="text-title-sm text-on-surface-variant">Theme color</span>
          <div className="flex flex-wrap items-center gap-1">
            <AriaRadioGroup
              aria-label="Theme color"
              orientation="horizontal"
              value={isPresetSeed ? THEME_SWATCHES.find((s) => s.seed.toLowerCase() === seed.toLowerCase())?.seed : null}
              onChange={(value) => updateTheme({ seed: value })}
              className="flex flex-wrap gap-1"
            >
              {THEME_SWATCHES.map((swatch) => (
                <Swatch key={swatch.seed} seed={swatch.seed} name={swatch.name} />
              ))}
            </AriaRadioGroup>
            <label
              className={cx(
                "state-layer relative flex h-10 cursor-pointer items-center gap-2 rounded-full px-4 text-label-lg focus-within:outline-3 focus-within:outline-secondary",
                isPresetSeed ? "border border-outline-variant text-on-surface-variant" : "bg-secondary-container text-on-secondary-container",
              )}
            >
              <Icon icon={iconPalette} size={20} />
              Custom
              <input
                type="color"
                value={seed}
                onChange={(event) => updateTheme({ seed: event.target.value }, 400)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <span className="text-title-sm text-on-surface-variant">Mode</span>
          <ConnectedButtonGroup
            aria-label="Mode"
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[mode]}
            onSelectionChange={(keys) => updateTheme({ mode: [...keys][0] as ThemeMode })}
          >
            <ConnectedButton id="system" icon={iconSync}>System</ConnectedButton>
            <ConnectedButton id="light" icon={iconLightMode}>Light</ConnectedButton>
            <ConnectedButton id="dark" icon={iconDarkMode}>Dark</ConnectedButton>
          </ConnectedButtonGroup>
        </div>
        <div className="flex flex-col gap-3">
          <span className="text-title-sm text-on-surface-variant">Contrast</span>
          <ConnectedButtonGroup
            aria-label="Contrast"
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[contrast]}
            onSelectionChange={(keys) => updateTheme({ contrast: [...keys][0] as ThemeContrast })}
          >
            <ConnectedButton id="standard" icon={iconContrast}>Standard</ConnectedButton>
            <ConnectedButton id="medium">Medium</ConnectedButton>
            <ConnectedButton id="high">High</ConnectedButton>
          </ConnectedButtonGroup>
          <p className="text-body-sm text-on-surface-variant">Higher contrast is easier to read on classroom projectors.</p>
        </div>
      </SettingsSection>

      <div className="flex flex-col gap-4">
        <SettingsSection title="Checkouts" description="Defaults for new checkouts. You can change a due date when checking out.">
          <Select
            label="Loan period"
            defaultSelectedKey={LOAN_PERIODS.find((period) => period.days === settings.loanPeriodDays)?.id ?? "14"}
            onSelectionChange={(key) => {
              const period = LOAN_PERIODS.find((option) => option.id === key);
              if (period) save({ loanPeriodDays: period.days });
            }}
            items={LOAN_PERIODS.map((period) => ({ ...period }))}
          >
            {(item) => <ListBoxItem id={item.id}>{item.label}</ListBoxItem>}
          </Select>
          <Select
            label="Books each student can have out"
            defaultSelectedKey={settings.maxBooksPerStudent === null ? "none" : String(settings.maxBooksPerStudent)}
            onSelectionChange={(key) => {
              const limit = BOOK_LIMITS.find((option) => option.id === key);
              if (limit) save({ maxBooksPerStudent: limit.value });
            }}
            items={BOOK_LIMITS}
          >
            {(item) => <ListBoxItem id={item.id}>{item.label}</ListBoxItem>}
          </Select>
          <ComboBox
            label="Time zone"
            description="Due dates and “overdue” follow this time zone."
            defaultSelectedKey={settings.timeZone ?? undefined}
            defaultItems={timeZones.map((zone) => ({ id: zone, name: zone.replaceAll("_", " ") }))}
            onSelectionChange={(key) => {
              if (typeof key === "string") save({ timeZone: key });
            }}
          >
            {(item: { id: string; name: string }) => <ListBoxItem id={item.id}>{item.name}</ListBoxItem>}
          </ComboBox>
        </SettingsSection>

        <SettingsSection title="Catalog">
          <Select
            label="Reading level system"
            description="Adds a reading level to each book so you can filter by it."
            defaultSelectedKey={settings.readingLevelSystem}
            onSelectionChange={(key) => save({ readingLevelSystem: key as ReadingLevelSystem })}
            items={readingLevelSystems.map((id) => ({ id, name: READING_LEVEL_SYSTEM_LABELS[id] }))}
          >
            {(item) => <ListBoxItem id={item.id}>{item.name}</ListBoxItem>}
          </Select>
        </SettingsSection>

        <SettingsSection
          title="Hand over"
          description="Give classes and books to another teacher. They accept before anything moves, and you stay on as a co-teacher of any class you hand over."
        >
          <LinkButton href="/settings/hand-over" variant="tonal" icon={iconMoveItem} className="self-start">
            Hand over classes or books
          </LinkButton>
        </SettingsSection>

        <SettingsSection title="Account">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-col">
              <span className="text-title-md">{teacher.name}</span>
              <span className="text-body-md text-on-surface-variant">{teacher.email}</span>
              <TextLink href="/privacy" className="mt-2 self-start text-body-md">
                How your data is handled
              </TextLink>
            </div>
            <Button
              variant="outlined"
              icon={iconLogout}
              onPress={async () => {
                await authClient.signOut();
                router.replace("/sign-in");
                router.refresh();
              }}
            >
              Sign out
            </Button>
          </div>
        </SettingsSection>
      </div>
    </div>
  );
}
