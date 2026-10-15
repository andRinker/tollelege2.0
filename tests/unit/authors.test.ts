import { describe, expect, it } from "vitest";
import { librarySpelling, samePerson, sameSpelling, unifyAuthors } from "@/lib/authors";

describe("samePerson", () => {
  it.each([
    ["Clive Staples Lewis", "C. S. Lewis"],
    ["C.S. Lewis", "C. S. Lewis"],
    ["J.K. Rowling", "Joanne Kathleen Rowling"],
    ["Martin Luther King Jr.", "Martin Luther King"],
    ["R. J. Palacio", "r j palacio"],
  ])("%j is %j", (a, b) => {
    expect(samePerson(a, b)).toBe(true);
  });

  it.each([
    ["C. Lewis", "C. S. Lewis"],
    ["Lewis Carroll", "C. S. Lewis"],
    ["Rick Riordan", "Rick Riordon"],
    ["Mary Pope Osborne", "Will Osborne"],
  ])("%j is not %j", (a, b) => {
    expect(samePerson(a, b)).toBe(false);
  });
});

describe("sameSpelling", () => {
  it("ignores case, spaces and full stops only", () => {
    expect(sameSpelling("C.S. Lewis", "C. S. Lewis")).toBe(true);
    expect(sameSpelling("c s lewis", "C. S. Lewis")).toBe(true);
    expect(sameSpelling("Clive Staples Lewis", "C. S. Lewis")).toBe(false);
  });
});

describe("unifyAuthors", () => {
  const known = ["C. S. Lewis", "Clive Staples Lewis", "Louis Sachar"];

  it("takes the library's commonest spelling of the same person", () => {
    expect(librarySpelling("C.S. Lewis", known)).toBe("C. S. Lewis");
    expect(unifyAuthors(["Clive Staples Lewis", "Pauline Baynes"], known)).toEqual(["C. S. Lewis", "Pauline Baynes"]);
  });

  it("lists a person once", () => {
    expect(unifyAuthors(["C. S. Lewis", "Clive Staples Lewis"], known)).toEqual(["C. S. Lewis"]);
  });

  it("leaves a library with no match alone", () => {
    expect(unifyAuthors(["Kate DiCamillo"], [])).toEqual(["Kate DiCamillo"]);
  });
});
