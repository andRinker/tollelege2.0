import { describe, expect, it } from "vitest";
import { guessColumnMapping, parseNameText, parseRosterCsv, parseRosterText, readCsv } from "@/lib/roster-parse";

describe("roster parsing", () => {
  it("parses common name formats", () => {
    expect(parseNameText("Ada Lovelace")).toEqual({ firstName: "Ada", lastName: "Lovelace", studentNumber: null });
    expect(parseNameText("Lovelace, Ada")).toEqual({ firstName: "Ada", lastName: "Lovelace", studentNumber: null });
    expect(parseNameText("  Mary  Anne Smith ")).toEqual({ firstName: "Mary Anne", lastName: "Smith", studentNumber: null });
    expect(parseNameText("Zendaya")).toEqual({ firstName: "Zendaya", lastName: "", studentNumber: null });
    expect(parseNameText("Ada Lovelace 10423")).toEqual({ firstName: "Ada", lastName: "Lovelace", studentNumber: "10423" });
    expect(parseNameText("Lovelace, Ada, 10423")).toEqual({ firstName: "Ada", lastName: "Lovelace", studentNumber: "10423" });
    expect(parseNameText("   ")).toBeNull();
  });

  it("parses pasted lines, skipping blanks and duplicates", () => {
    const result = parseRosterText("Ada Lovelace\n\nGrace Hopper\r\nada lovelace\nKatherine Johnson");
    expect(result.students.map((s) => `${s.firstName} ${s.lastName}`)).toEqual(["Ada Lovelace", "Grace Hopper", "Katherine Johnson"]);
    expect(result.duplicates).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("parses spreadsheet paste with a header row", () => {
    const result = parseRosterText("First Name\tLast Name\tStudent ID\nAda\tLovelace\t1001\nGrace\tHopper\t1002");
    expect(result.students).toEqual([
      { firstName: "Ada", lastName: "Lovelace", studentNumber: "1001" },
      { firstName: "Grace", lastName: "Hopper", studentNumber: "1002" },
    ]);
  });

  it("parses spreadsheet paste without a header row", () => {
    expect(parseRosterText("Ada\tLovelace\nGrace\tHopper\t20455").students).toEqual([
      { firstName: "Ada", lastName: "Lovelace", studentNumber: null },
      { firstName: "Grace", lastName: "Hopper", studentNumber: "20455" },
    ]);
    expect(parseRosterText("Lovelace, Ada\t1001").students).toEqual([{ firstName: "Ada", lastName: "Lovelace", studentNumber: "1001" }]);
  });

  it("reports names that are too long", () => {
    const result = parseRosterText(`${"A".repeat(61)} Smith\nGrace Hopper`);
    expect(result.students).toHaveLength(1);
    expect(result.errors).toEqual([expect.objectContaining({ line: 1, reason: "Name is too long" })]);
  });

  it("reads CSV files and guesses columns from headers", () => {
    const table = readCsv('﻿Student ID,Last Name,First Name,Grade\n1001,Lovelace,Ada,4\n1002,"Hopper, Jr.",Grace,4\n,,,\n');
    expect(table.headers).toEqual(["Student ID", "Last Name", "First Name", "Grade"]);
    const mapping = guessColumnMapping(table.headers);
    expect(mapping).toEqual({ first: 2, last: 1, fullName: undefined, id: 0 });
    expect(parseRosterCsv(table, mapping!).students).toEqual([
      { firstName: "Ada", lastName: "Lovelace", studentNumber: "1001" },
      { firstName: "Grace", lastName: "Hopper, Jr.", studentNumber: "1002" },
    ]);
  });

  it("handles a single full-name column", () => {
    const table = readCsv("Name,ID\nLovelace, Ada,7\n\"Hopper, Grace\",8");
    const mapping = guessColumnMapping(table.headers)!;
    const result = parseRosterCsv(table, mapping);
    expect(result.students[1]).toEqual({ firstName: "Grace", lastName: "Hopper", studentNumber: "8" });
  });

  it("returns null when no name column can be found", () => {
    expect(guessColumnMapping(["Grade", "Homeroom"])).toBeNull();
  });
});
