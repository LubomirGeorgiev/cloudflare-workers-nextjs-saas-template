import { describe, expect, it } from "vitest";

import { toCsv, toCsvField } from "./csv";

/** Every character a spreadsheet treats as the start of a formula when a cell begins with it. */
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

describe("toCsvField", () => {
  it("quotes every field", () => {
    expect(toCsvField("Acme")).toBe('"Acme"');
    expect(toCsvField(7)).toBe('"7"');
  });

  it("writes an empty field for a missing value", () => {
    expect(toCsvField(null)).toBe('""');
    expect(toCsvField(undefined)).toBe('""');
  });

  it("keeps a comma or a newline inside one field", () => {
    expect(toCsvField("Acme, Inc")).toBe('"Acme, Inc"');
    expect(toCsvField("first\nsecond")).toBe('"first\nsecond"');
  });

  it("doubles an embedded quote so the field cannot be closed early", () => {
    expect(toCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it.each(FORMULA_PREFIXES)("neutralizes a value starting with %j", (prefix) => {
    expect(toCsvField(`${prefix}1+1`)).toBe(`"'${prefix}1+1"`);
  });

  it("neutralizes a command-injection payload a customer-chosen name could carry", () => {
    expect(toCsvField("=cmd|'/c calc'!A1")).toBe("\"'=cmd|'/c calc'!A1\"");
  });

  it("leaves a formula character that is not first alone", () => {
    expect(toCsvField("Acme=1")).toBe('"Acme=1"');
    expect(toCsvField("a@b.com")).toBe('"a@b.com"');
  });
});

describe("toCsv", () => {
  it("writes the header and one quoted row per entry", () => {
    const csv = toCsv({
      header: ["id", "name"],
      rows: [
        ["team_1", "Acme"],
        ["team_2", "Globex"],
      ],
    });

    expect(csv.split("\n")).toEqual(['"id","name"', '"team_1","Acme"', '"team_2","Globex"']);
  });

  it("escapes a header the caller derived from data", () => {
    expect(toCsv({ header: ["=name"], rows: [] })).toBe("\"'=name\"");
  });

  it("neutralizes a formula anywhere in the body", () => {
    const csv = toCsv({ header: ["name"], rows: [["=1+1"]] });

    expect(csv).toContain("\"'=1+1\"");
    expect(csv).not.toContain('"=1+1"');
  });
});
