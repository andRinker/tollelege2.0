"use client";

import { useMemo, useRef, useState } from "react";
import {
  type ColumnMapping,
  type CsvTable,
  guessColumnMapping,
  parseRosterCsv,
  parseRosterText,
  readCsv,
  type RosterParseResult,
} from "@/lib/roster-parse";
import { Button } from "@/ui/components/button";
import { Dialog } from "@/ui/components/dialog";
import { Avatar } from "@/ui/components/expressive";
import { Icon } from "@/ui/components/icon";
import { ListBoxItem } from "@/ui/components/menu";
import { Select } from "@/ui/components/select";
import { useSnackbar } from "@/ui/components/snackbar";
import { Tab, TabList, TabPanel, Tabs } from "@/ui/components/tabs";
import { TextField } from "@/ui/components/text-field";
import { iconContentPaste, iconUploadFile, iconWarning } from "@/ui/icons/generated";
import { importStudentsAction } from "./actions";

const EMPTY: RosterParseResult = { students: [], errors: [], duplicates: 0 };

function Preview({ result }: { result: RosterParseResult }) {
  if (result.students.length === 0 && result.errors.length === 0) return null;
  const shown = result.students.slice(0, 12);
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface-container px-4 py-3">
      <p className="text-title-sm text-on-surface">
        {result.students.length} {result.students.length === 1 ? "student" : "students"} ready
        {result.duplicates > 0 && (
          <span className="text-on-surface-variant"> · {result.duplicates} repeated {result.duplicates === 1 ? "name" : "names"} skipped</span>
        )}
      </p>
      {shown.length > 0 && (
        <ul className="grid gap-2 medium:grid-cols-2">
          {shown.map((student) => {
            const fullName = `${student.firstName} ${student.lastName}`.trim();
            return (
              <li key={`${student.firstName}|${student.lastName}`} className="flex min-w-0 items-center gap-2">
                <Avatar name={fullName} size={28} />
                <span className="truncate text-body-md text-on-surface">
                  <span className="font-medium">{student.lastName ? `${student.lastName}, ` : ""}</span>
                  {student.firstName}
                </span>
                {student.studentNumber && <span className="shrink-0 text-label-sm text-on-surface-variant">#{student.studentNumber}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {result.students.length > shown.length && (
        <p className="text-body-sm text-on-surface-variant">and {result.students.length - shown.length} more</p>
      )}
      {result.errors.length > 0 && (
        <ul className="flex flex-col gap-1 text-body-sm text-error">
          {result.errors.slice(0, 5).map((error) => (
            <li key={`${error.line}-${error.reason}`} className="flex items-start gap-1.5">
              <Icon icon={iconWarning} size={16} className="mt-0.5" />
              {error.line > 0 ? `Line ${error.line}: ${error.reason}` : error.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const NONE = "none";

function ColumnSelect({ label, headers, value, onChange }: { label: string; headers: string[]; value: number | undefined; onChange: (value: number | undefined) => void }) {
  const items = [{ id: NONE, name: "Not in this file" }, ...headers.map((header, index) => ({ id: String(index), name: header || `Column ${index + 1}` }))];
  return (
    <Select
      label={label}
      items={items}
      selectedKey={value === undefined ? NONE : String(value)}
      onSelectionChange={(key) => onChange(key === NONE ? undefined : Number(key))}
    >
      {(item) => <ListBoxItem id={item.id}>{item.name}</ListBoxItem>}
    </Select>
  );
}

type Props = {
  classId: string;
  className: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ImportStudentsDialog({ classId, className, isOpen, onOpenChange }: Props) {
  const showSnackbar = useSnackbar();
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"paste" | "csv">("paste");
  const [text, setText] = useState("");
  const [table, setTable] = useState<CsvTable | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const result = useMemo(() => {
    if (mode === "paste") return text.trim() ? parseRosterText(text) : EMPTY;
    return table ? parseRosterCsv(table, mapping) : EMPTY;
  }, [mode, text, table, mapping]);

  function reset() {
    setText("");
    setTable(null);
    setFileName(null);
    setMapping({});
    setError(null);
  }

  async function readFile(file: File) {
    if (file.size > 2_000_000) {
      setError("That file is too large. Rosters should be under 2 MB.");
      return;
    }
    const parsed = readCsv(await file.text());
    setFileName(file.name);
    setTable(parsed);
    const guessed = guessColumnMapping(parsed.headers);
    setMapping(guessed ?? { fullName: 0 });
    setError(guessed ? null : "We couldn't tell which column has names. Choose the columns below.");
  }

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        onOpenChange(open);
        if (!open) reset();
      }}
      title="Import students"
      fullScreenOnCompact
      className="max-w-[640px]"
      actions={(close) => (
        <>
          <Button variant="text" onPress={close}>
            Cancel
          </Button>
          <Button
            isDisabled={result.students.length === 0}
            isPending={pending}
            onPress={async () => {
              setPending(true);
              const response = await importStudentsAction(classId, result.students);
              setPending(false);
              if (!response.ok) {
                setError(response.message);
                return;
              }
              const { added, skipped } = response.data;
              showSnackbar({
                message: `Added ${added} ${added === 1 ? "student" : "students"}${skipped ? `. ${skipped} ${skipped === 1 ? "was" : "were"} already on the roster.` : ""}`,
              });
              reset();
              close();
            }}
          >
            {result.students.length > 0 ? `Add ${result.students.length}` : "Add students"}
          </Button>
        </>
      )}
    >
      <div className="flex flex-col gap-4 pt-1">
        <p className="text-body-md text-on-surface-variant">New students are added to {className}.</p>
        <Tabs selectedKey={mode} onSelectionChange={(key) => setMode(key as "paste" | "csv")}>
          <TabList aria-label="How to import">
            <Tab id="paste" icon={iconContentPaste}>
              Paste names
            </Tab>
            <Tab id="csv" icon={iconUploadFile}>
              Upload a file
            </Tab>
          </TabList>
          <TabPanel id="paste" className="flex flex-col gap-4 pt-4">
            <TextField
              label="Student names"
              multiline
              rows={8}
              value={text}
              onChange={setText}
              description="One student per line, like “Ada Lovelace” or “Lovelace, Ada”. You can paste columns from a spreadsheet too."
            />
          </TabPanel>
          <TabPanel id="csv" className="flex flex-col gap-4 pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="tonal" icon={iconUploadFile} onPress={() => fileInput.current?.click()}>
                {fileName ? "Choose a different file" : "Choose a CSV file"}
              </Button>
              {fileName && <span className="text-body-md text-on-surface-variant">{fileName}</span>}
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv,.txt,text/plain"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void readFile(file);
                  event.target.value = "";
                }}
              />
            </div>
            <p className="text-body-sm text-on-surface-variant">
              Export a roster from your student information system or a spreadsheet. The first row should have column names.
            </p>
            {table && (
              <div className="grid gap-4 medium:grid-cols-2">
                <ColumnSelect label="First name column" headers={table.headers} value={mapping.first} onChange={(first) => setMapping({ ...mapping, first })} />
                <ColumnSelect label="Last name column" headers={table.headers} value={mapping.last} onChange={(last) => setMapping({ ...mapping, last })} />
                <ColumnSelect label="Full name column" headers={table.headers} value={mapping.fullName} onChange={(fullName) => setMapping({ ...mapping, fullName })} />
                <ColumnSelect label="Student ID column" headers={table.headers} value={mapping.id} onChange={(id) => setMapping({ ...mapping, id })} />
              </div>
            )}
          </TabPanel>
        </Tabs>
        {error && (
          <p role="alert" className="rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container">
            {error}
          </p>
        )}
        <Preview result={result} />
      </div>
    </Dialog>
  );
}
