import Papa from "papaparse";

export type ParsedStudent = { firstName: string; lastName: string; studentNumber: string | null };
export type RosterLineError = { line: number; text: string; reason: string };
export type RosterParseResult = { students: ParsedStudent[]; errors: RosterLineError[]; duplicates: number };

export const MAX_IMPORT_ROWS = 300;
const MAX_NAME_LENGTH = 60;

const clean = (value: string | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
const looksLikeId = (value: string) => /^[A-Za-z]?\d{2,}[A-Za-z0-9-]*$/.test(value);

/** "Ada Lovelace", "Lovelace, Ada", "Mary Anne Smith", "Ada Lovelace 10423". */
export function parseNameText(text: string): ParsedStudent | null {
  let value = clean(text);
  if (!value) return null;

  let studentNumber: string | null = null;
  const trailingId = value.match(/^(.*?)[\s,]+(\d{3,}[A-Za-z0-9-]*)$/);
  if (trailingId && trailingId[1].trim()) {
    value = trailingId[1].trim().replace(/,$/, "");
    studentNumber = trailingId[2];
  }

  if (value.includes(",")) {
    const [last, first] = value.split(",").map(clean);
    if (!first) return last ? { firstName: last, lastName: "", studentNumber } : null;
    return { firstName: first, lastName: last, studentNumber };
  }

  const parts = value.split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: "", studentNumber };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1], studentNumber };
}

export type ColumnMapping = { first?: number; last?: number; fullName?: number; id?: number };

export function guessColumnMapping(headers: string[]): ColumnMapping | null {
  const normalized = headers.map((header) => header.toLowerCase().replace(/[^a-z]/g, ""));
  const find = (...names: string[]) => {
    const index = normalized.findIndex((header) => names.includes(header));
    return index === -1 ? undefined : index;
  };
  const mapping: ColumnMapping = {
    first: find("first", "firstname", "given", "givenname", "preferredname"),
    last: find("last", "lastname", "surname", "family", "familyname"),
    fullName: find("name", "fullname", "student", "studentname"),
    id: find("id", "studentid", "number", "studentnumber", "idnumber", "localid"),
  };
  const hasName = mapping.fullName !== undefined || mapping.first !== undefined;
  return hasName ? mapping : null;
}

export function studentFromCells(cells: string[], mapping: ColumnMapping): ParsedStudent | null {
  const id = mapping.id !== undefined ? clean(cells[mapping.id]) || null : null;
  if (mapping.first !== undefined) {
    const firstName = clean(cells[mapping.first]);
    const lastName = mapping.last !== undefined ? clean(cells[mapping.last]) : "";
    if (!firstName && !lastName) return null;
    return firstName ? { firstName, lastName, studentNumber: id } : { firstName: lastName, lastName: "", studentNumber: id };
  }
  if (mapping.fullName !== undefined) {
    const parsed = parseNameText(cells[mapping.fullName] ?? "");
    return parsed ? { ...parsed, studentNumber: id ?? parsed.studentNumber } : null;
  }
  return null;
}

function finalize(candidates: Array<{ line: number; text: string; student: ParsedStudent | null }>): RosterParseResult {
  const students: ParsedStudent[] = [];
  const errors: RosterLineError[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (const { line, text, student } of candidates) {
    if (!student) {
      errors.push({ line, text, reason: "No name found" });
      continue;
    }
    if (student.firstName.length > MAX_NAME_LENGTH || student.lastName.length > MAX_NAME_LENGTH) {
      errors.push({ line, text, reason: "Name is too long" });
      continue;
    }
    const key = `${student.firstName}|${student.lastName}`.toLowerCase();
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    students.push(student);
  }

  if (students.length > MAX_IMPORT_ROWS) {
    errors.push({ line: 0, text: "", reason: `Only the first ${MAX_IMPORT_ROWS} students can be imported at once` });
    students.length = MAX_IMPORT_ROWS;
  }
  return { students, errors, duplicates };
}

/**
 * Pasted names, one per line. Handles "First Last", "Last, First", trailing student IDs, and
 * rows copied from a spreadsheet (tab-separated, with or without a header row).
 */
export function parseRosterText(text: string): RosterParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((raw, index) => ({ raw, line: index + 1 }))
    .filter(({ raw }) => raw.trim());
  if (lines.length === 0) return { students: [], errors: [], duplicates: 0 };

  const tabbed = lines.some(({ raw }) => raw.includes("\t"));
  if (!tabbed) {
    return finalize(lines.map(({ raw, line }) => ({ line, text: raw.trim(), student: parseNameText(raw) })));
  }

  const rows = lines.map(({ raw, line }) => ({ line, text: raw.trim(), cells: raw.split("\t").map(clean) }));
  const headerMapping = guessColumnMapping(rows[0].cells);
  const body = headerMapping ? rows.slice(1) : rows;

  return finalize(
    body.map(({ line, text, cells }) => {
      if (headerMapping) return { line, text, student: studentFromCells(cells, headerMapping) };
      const filled = cells.filter(Boolean);
      if (filled.length === 1) return { line, text, student: parseNameText(filled[0]) };
      if (filled.length === 2 && looksLikeId(filled[1])) {
        const parsed = parseNameText(filled[0]);
        return { line, text, student: parsed && { ...parsed, studentNumber: filled[1] } };
      }
      if (filled.length === 2) return { line, text, student: { firstName: filled[0], lastName: filled[1], studentNumber: null } };
      return { line, text, student: { firstName: filled[0], lastName: filled[1], studentNumber: looksLikeId(filled[2]) ? filled[2] : null } };
    }),
  );
}

export type CsvTable = { headers: string[]; rows: string[][] };

export function readCsv(text: string): CsvTable {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  const [headers = [], ...rows] = parsed.data;
  return { headers: headers.map(clean), rows };
}

export function parseRosterCsv(table: CsvTable, mapping: ColumnMapping): RosterParseResult {
  return finalize(
    table.rows.map((cells, index) => ({
      line: index + 2,
      text: cells.join(", "),
      student: studentFromCells(cells, mapping),
    })),
  );
}
