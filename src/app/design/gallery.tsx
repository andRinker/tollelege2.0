"use client";

import { parseDate } from "@internationalized/date";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Button, type ButtonSize, type ButtonVariant, LinkButton, ToggleButton } from "@/ui/components/button";
import { ButtonGroup, ConnectedButton, ConnectedButtonGroup } from "@/ui/components/button-group";
import { AssistChip, FilterChip, InputChipGroup } from "@/ui/components/chip";
import { DatePicker } from "@/ui/components/date-picker";
import { ConfirmDialog, Dialog, DialogTrigger } from "@/ui/components/dialog";
import { Avatar, EmptyState } from "@/ui/components/expressive";
import { ExtendedFab, Fab, FabMenu } from "@/ui/components/fab";
import { Icon } from "@/ui/components/icon";
import { IconButton, type IconButtonVariant, ToggleIconButton } from "@/ui/components/icon-button";
import { List, ListItem } from "@/ui/components/list";
import { LoadingIndicator } from "@/ui/components/loading-indicator";
import { ListBoxItem, Menu, MenuDivider, MenuItem, MenuTrigger } from "@/ui/components/menu";
import { CircularProgress, LinearProgress } from "@/ui/components/progress";
import { ComboBox, Select } from "@/ui/components/select";
import { Checkbox, Radio, RadioGroup, Switch } from "@/ui/components/selection-controls";
import { useSnackbar } from "@/ui/components/snackbar";
import { Badge, Card } from "@/ui/components/surfaces";
import { Tab, TabList, TabPanel, Tabs } from "@/ui/components/tabs";
import { SearchField, TextField } from "@/ui/components/text-field";
import {
  iconAdd,
  iconBarcodeScanner,
  iconChevronRight,
  iconDelete,
  iconEdit,
  iconFavorite,
  iconGroups,
  iconInput,
  iconLabel,
  iconLibraryAdd,
  iconLocalLibrary,
  iconMoreVert,
  iconOutput,
  iconPerson,
  iconSchool,
  iconSearch,
  iconShelves,
  iconStar,
} from "@/ui/icons/generated";
import { SHAPE_NAMES, shapePath } from "@/ui/shapes/shapes";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-surface-container-low p-4 medium:p-6 [--field-bg:var(--md-sys-color-surface-container-low)]">
      <h2 className="text-title-lg-em text-on-surface">{title}</h2>
      {children}
    </section>
  );
}

const VARIANTS: ButtonVariant[] = ["filled", "tonal", "outlined", "elevated", "text"];
const SIZES: ButtonSize[] = ["xs", "sm", "md", "lg", "xl"];
const ICON_VARIANTS: IconButtonVariant[] = ["standard", "filled", "tonal", "outlined"];

// Full class names so Tailwind can find them.
const TYPE_STYLES = [
  ["display-lg", "text-display-lg", "text-display-lg-em"],
  ["display-md", "text-display-md", "text-display-md-em"],
  ["display-sm", "text-display-sm", "text-display-sm-em"],
  ["headline-lg", "text-headline-lg", "text-headline-lg-em"],
  ["headline-md", "text-headline-md", "text-headline-md-em"],
  ["headline-sm", "text-headline-sm", "text-headline-sm-em"],
  ["title-lg", "text-title-lg", "text-title-lg-em"],
  ["title-md", "text-title-md", "text-title-md-em"],
  ["title-sm", "text-title-sm", "text-title-sm-em"],
  ["body-lg", "text-body-lg", "text-body-lg-em"],
  ["body-md", "text-body-md", "text-body-md-em"],
  ["body-sm", "text-body-sm", "text-body-sm-em"],
  ["label-lg", "text-label-lg", "text-label-lg-em"],
  ["label-md", "text-label-md", "text-label-md-em"],
  ["label-sm", "text-label-sm", "text-label-sm-em"],
];

const COLOR_PAIRS = [
  ["bg-primary text-on-primary", "primary"],
  ["bg-primary-container text-on-primary-container", "primary-container"],
  ["bg-secondary text-on-secondary", "secondary"],
  ["bg-secondary-container text-on-secondary-container", "secondary-container"],
  ["bg-tertiary text-on-tertiary", "tertiary"],
  ["bg-tertiary-container text-on-tertiary-container", "tertiary-container"],
  ["bg-error text-on-error", "error"],
  ["bg-error-container text-on-error-container", "error-container"],
  ["bg-surface-container-lowest text-on-surface", "surface-container-lowest"],
  ["bg-surface-container-low text-on-surface", "surface-container-low"],
  ["bg-surface-container text-on-surface", "surface-container"],
  ["bg-surface-container-high text-on-surface", "surface-container-high"],
  ["bg-surface-container-highest text-on-surface", "surface-container-highest"],
  ["bg-inverse-surface text-inverse-on-surface", "inverse-surface"],
];

const STUDENTS = ["Ada Lovelace", "Grace Hopper", "Katherine Johnson", "Mae Jemison", "Rosalind Franklin", "Marie Curie"];

export function DesignGallery() {
  const showSnackbar = useSnackbar();
  // ?static stops animations so screenshots can settle.
  const isStatic = useSearchParams().has("static");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tags, setTags] = useState([
    { id: "animals", name: "Animals" },
    { id: "friendship", name: "Friendship" },
    { id: "series", name: "Series" },
  ]);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-4 medium:p-6">
      {isStatic && <style>{"*,*::before,*::after{animation:none!important;transition:none!important}"}</style>}
      <header className="flex flex-col gap-2 py-6">
        <p className="text-label-lg text-primary">Tolle Lege</p>
        <h1 className="text-display-sm-em">Material 3 Expressive</h1>
        <p className="text-body-lg text-on-surface-variant">Every component in every state, using the current theme.</p>
      </header>

      <Section title="Color roles">
        <div className="grid grid-cols-2 gap-2 medium:grid-cols-4 expanded:grid-cols-7">
          {COLOR_PAIRS.map(([classes, name]) => (
            <div key={name} className={`flex h-20 items-end rounded-md p-2 text-label-md ${classes}`}>
              {name}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type scale">
        <div className="flex flex-col gap-3">
          {TYPE_STYLES.map(([name, baseline, emphasized]) => (
            <div key={name} className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <span className="w-28 shrink-0 text-label-md text-on-surface-variant">{name}</span>
              <span className={baseline}>Frog and Toad</span>
              <span className={`${emphasized} text-primary`}>Emphasized</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        {VARIANTS.map((variant) => (
          <div key={variant} className="flex flex-wrap items-center gap-3">
            <span className="w-20 text-label-md text-on-surface-variant">{variant}</span>
            <Button variant={variant} size="xs">Extra small</Button>
            <Button variant={variant} icon={iconAdd}>Small</Button>
            <Button variant={variant} shape="square" icon={iconEdit}>Square</Button>
            <Button variant={variant} isDisabled>Disabled</Button>
          </div>
        ))}
        <div className="flex flex-wrap items-end gap-3">
          {SIZES.map((size) => (
            <Button key={size} size={size} icon={iconLibraryAdd}>
              {size.toUpperCase()}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ToggleButton variant="filled" icon={iconStar}>Filled toggle</ToggleButton>
          <ToggleButton variant="tonal" defaultSelected>Tonal toggle</ToggleButton>
          <ToggleButton variant="outlined">Outlined toggle</ToggleButton>
          <ToggleButton variant="elevated" shape="square">Elevated toggle</ToggleButton>
          <Button isPending>Saving</Button>
          <LinkButton variant="text" href="#icon-buttons">Link button</LinkButton>
        </div>
      </Section>

      <Section title="Icon buttons">
        <div id="icon-buttons" className="flex flex-col gap-3">
          {ICON_VARIANTS.map((variant) => (
            <div key={variant} className="flex flex-wrap items-center gap-3">
              <span className="w-20 text-label-md text-on-surface-variant">{variant}</span>
              <IconButton variant={variant} size="xs" icon={iconSearch} label="Search" />
              <IconButton variant={variant} icon={iconEdit} label="Edit" />
              <IconButton variant={variant} icon={iconEdit} width="wide" label="Edit (wide)" />
              <IconButton variant={variant} size="md" shape="square" icon={iconBarcodeScanner} label="Scan" />
              <ToggleIconButton variant={variant} icon={iconFavorite} label="Favorite" />
              <IconButton variant={variant} icon={iconEdit} label="Disabled" isDisabled />
            </div>
          ))}
          <div className="flex flex-wrap items-end gap-3">
            <IconButton variant="tonal" size="lg" icon={iconBarcodeScanner} label="Scan large" />
            <IconButton variant="filled" size="xl" width="wide" icon={iconBarcodeScanner} label="Scan extra large" />
          </div>
        </div>
      </Section>

      <Section title="Button groups and FABs">
        <ButtonGroup aria-label="Add books">
          <Button variant="filled" icon={iconBarcodeScanner}>Scan</Button>
          <Button variant="tonal">Type ISBN</Button>
          <Button variant="tonal">Add manually</Button>
        </ButtonGroup>
        <ConnectedButtonGroup aria-label="Availability" selectionMode="single" disallowEmptySelection defaultSelectedKeys={["all"]}>
          <ConnectedButton id="all">All</ConnectedButton>
          <ConnectedButton id="available">Available</ConnectedButton>
          <ConnectedButton id="out">Checked out</ConnectedButton>
        </ConnectedButtonGroup>
        <div className="flex flex-wrap items-end gap-4">
          <Fab icon={iconAdd} label="Add book" />
          <Fab icon={iconAdd} label="Add book" size="medium" color="secondary-container" />
          <Fab icon={iconAdd} label="Add book" size="large" color="tertiary-container" />
          <ExtendedFab icon={iconLibraryAdd}>Add books</ExtendedFab>
          <FabMenu
            label="Quick actions"
            items={[
              { id: "add", label: "Add books", icon: iconLibraryAdd, href: "#" },
              { id: "out", label: "Check out", icon: iconOutput, href: "#" },
              { id: "in", label: "Check in", icon: iconInput, href: "#" },
            ]}
          />
        </div>
      </Section>

      <Section title="Text fields">
        <div className="grid gap-4 expanded:grid-cols-2">
          <TextField label="Title" description="As printed on the cover" />
          <TextField label="ISBN" variant="outlined" leadingIcon={iconBarcodeScanner} defaultValue="9780064440202" />
          <TextField label="Student ID" isInvalid errorMessage="That student ID is already in use." defaultValue="1042" />
          <TextField label="Notes" multiline />
          <TextField label="Disabled" isDisabled />
          <SearchField placeholder="Search your library" trailing={<IconButton icon={iconBarcodeScanner} label="Scan a barcode" />} />
        </div>
      </Section>

      <Section title="Selection controls">
        <div className="flex flex-wrap gap-8">
          <div className="flex flex-col">
            <Checkbox defaultSelected>Due dates</Checkbox>
            <Checkbox>Limit books per student</Checkbox>
            <Checkbox isIndeterminate>Select all</Checkbox>
            <Checkbox isDisabled>Disabled</Checkbox>
          </div>
          <RadioGroup label="Reading level" defaultValue="lexile">
            <Radio value="none">None</Radio>
            <Radio value="lexile">Lexile</Radio>
            <Radio value="guided">Guided Reading</Radio>
          </RadioGroup>
          <div className="flex w-72 flex-col gap-4">
            <Switch defaultSelected>Rapid scan</Switch>
            <Switch>Show covers</Switch>
            <Switch isDisabled>Disabled</Switch>
          </div>
        </div>
      </Section>

      <Section title="Menus, selects, and dates">
        <div className="grid gap-4 expanded:grid-cols-3">
          <Select label="Class" defaultSelectedKey="room12">
            <ListBoxItem id="room12">Room 12</ListBoxItem>
            <ListBoxItem id="period3" description="24 students">Period 3</ListBoxItem>
            <ListBoxItem id="period5">Period 5</ListBoxItem>
          </Select>
          <ComboBox label="Student" leadingIcon={iconPerson}>
            <ListBoxItem id="ada">Ada Lovelace</ListBoxItem>
            <ListBoxItem id="grace">Grace Hopper</ListBoxItem>
            <ListBoxItem id="katherine">Katherine Johnson</ListBoxItem>
          </ComboBox>
          <DatePicker label="Due date" defaultValue={parseDate("2026-09-30")} />
        </div>
        <MenuTrigger>
          <IconButton icon={iconMoreVert} label="More options" />
          <Menu>
            <MenuItem icon={iconEdit}>Edit details</MenuItem>
            <MenuItem icon={iconLibraryAdd}>Add a copy</MenuItem>
            <MenuDivider />
            <MenuItem icon={iconDelete} destructive>Delete book</MenuItem>
          </Menu>
        </MenuTrigger>
      </Section>

      <Section title="Cards, lists, and chips">
        <div className="grid gap-4 expanded:grid-cols-3">
          <Card variant="elevated" className="p-4">
            <p className="text-title-md">Elevated</p>
            <p className="text-body-md text-on-surface-variant">12 titles · 3 out</p>
          </Card>
          <Card variant="filled" className="p-4">
            <p className="text-title-md">Filled</p>
            <p className="text-body-md text-on-surface-variant">12 titles · 3 out</p>
          </Card>
          <Card variant="outlined" className="p-4">
            <p className="text-title-md">Outlined</p>
            <p className="text-body-md text-on-surface-variant">12 titles · 3 out</p>
          </Card>
        </div>
        <List aria-label="Students">
          <ListItem leading={<Avatar name="Ada Lovelace" />} headline="Ada Lovelace" supporting="2 books out" trailing={<Icon icon={iconChevronRight} />} href="#" />
          <ListItem leading={<Avatar name="Grace Hopper" />} headline="Grace Hopper" supporting="1 overdue" trailing={<Badge count={1} label="1 overdue" />} href="#" />
          <ListItem
            leading={<Avatar name="Katherine Johnson" />}
            headline="Katherine Johnson"
            supporting="No books out"
            actions={<IconButton icon={iconMoreVert} label="Options" />}
          />
        </List>
        <div className="flex flex-wrap gap-2">
          <AssistChip icon={iconShelves}>Bin 4</AssistChip>
          <FilterChip defaultSelected>Available</FilterChip>
          <FilterChip>Graphic novels</FilterChip>
          <AssistChip icon={iconLabel} elevated>Add tag</AssistChip>
        </div>
        <InputChipGroup
          label="Tags"
          items={tags}
          onRemove={(keys) => setTags((current) => current.filter((tag) => !keys.has(tag.id)))}
        />
      </Section>

      <Section title="Tabs, dialogs, and empty states">
        <Tabs>
          <TabList aria-label="Import students">
            <Tab id="paste">Paste names</Tab>
            <Tab id="csv">Upload CSV</Tab>
          </TabList>
          <TabPanel id="paste" className="py-4 text-body-md">One student per line.</TabPanel>
          <TabPanel id="csv" className="py-4 text-body-md">Columns: first name, last name, student ID.</TabPanel>
        </Tabs>
        <div className="flex flex-wrap gap-3">
          <DialogTrigger>
            <Button variant="tonal">Open dialog</Button>
            <Dialog
              title="New class"
              fullScreenOnCompact
              actions={(close) => (
                <>
                  <Button variant="text" onPress={close}>Cancel</Button>
                  <Button variant="text" onPress={close}>Create</Button>
                </>
              )}
            >
              <div className="flex flex-col gap-4 pt-1">
                <TextField label="Class name" autoFocus />
                <TextField label="School year" defaultValue="2026–27" />
              </div>
            </Dialog>
          </DialogTrigger>
          <Button variant="outlined" icon={iconDelete} onPress={() => setConfirmOpen(true)}>Confirm dialog</Button>
          <ConfirmDialog
            isOpen={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Delete this book?"
            message="Frog and Toad and its 2 copies will be removed from your library."
            confirmLabel="Delete"
            destructive
            onConfirm={() => showSnackbar({ message: "Book deleted" })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {STUDENTS.map((name) => (
            <Avatar key={name} name={name} size={56} />
          ))}
        </div>
        <div className="grid expanded:grid-cols-2">
          <EmptyState
            icon={iconLocalLibrary}
            title="Your library is empty"
            description="Scan a barcode or type an ISBN to add your first book."
            action={<Button icon={iconBarcodeScanner}>Add books</Button>}
          />
          <EmptyState icon={iconGroups} shape="clover4" title="No classes yet" action={<Button variant="tonal" icon={iconSchool}>New class</Button>} />
        </div>
      </Section>

      <Section title="Loading and progress">
        <div className="flex flex-wrap items-center gap-6">
          <LoadingIndicator paused={isStatic} />
          <LoadingIndicator contained paused={isStatic} />
          <LoadingIndicator size={96} paused={isStatic} />
          <CircularProgress size={40} />
        </div>
        <LinearProgress label="Import progress" value={0.62} />
        <LinearProgress label="Import progress flat" value={0.35} wavy={false} />
        <LinearProgress label="Looking up book" />
      </Section>

      <Section title="Shapes">
        <div className="grid grid-cols-3 gap-4 medium:grid-cols-6 expanded:grid-cols-9">
          {SHAPE_NAMES.map((name, index) => (
            <figure key={name} className="flex flex-col items-center gap-1">
              <svg viewBox="0 0 72 72" width={72} height={72} aria-hidden="true">
                <path
                  d={shapePath(name, 72)}
                  className={["fill-primary-container", "fill-secondary-container", "fill-tertiary-container"][index % 3]}
                />
              </svg>
              <figcaption className="text-label-sm text-on-surface-variant">{name}</figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <Section title="Snackbar">
        <div className="flex flex-wrap gap-3">
          <Button variant="tonal" onPress={() => showSnackbar({ message: "Frog and Toad checked out to Ada L." })}>
            Show snackbar
          </Button>
          <Button
            variant="outlined"
            onPress={() =>
              showSnackbar({
                message: "Returned Frog and Toad",
                action: { label: "Undo", onAction: () => showSnackbar({ message: "Return undone" }) },
              })
            }
          >
            With action
          </Button>
        </div>
      </Section>
    </main>
  );
}
