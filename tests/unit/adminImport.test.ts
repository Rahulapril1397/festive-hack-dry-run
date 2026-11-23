import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "@/domain/admin/csv";
import { validateImport } from "@/domain/admin/import";
import { canonical, argsHash } from "@/lib/assistant/hash";

describe("CSV", () => {
  it("handles BOM, quotes, escaped quotes, commas, CRLF and blank lines", () => {
    expect(parseCsv('﻿name,phone\r\n"Rao, A","98765 00001"\r\n\r\n"Say ""hi""",\n')).toEqual([["name", "phone"], ["Rao, A", "98765 00001"], ['Say "hi"', ""]]);
  });
  it("output guards formulas and quotes cells", () => {
    expect(toCsv(["a", "b"], [["=SUM(A1)", 'x,"y"']])).toBe(`a,b\r\n'=SUM(A1),"x,""y"""\r\n`);
  });
});

describe("family import validation (row errors never fail the batch)", () => {
  const csv = [
    "Name,Phone,Language,headcount_max",
    "Sharma family,+91 98765 11111,hindi,6",
    "Verma family,9876511111,en,", // duplicate phone in file
    "X,9876522222,en,2", // name too short
    "Iyer family,12345,en,2", // bad phone
    "Nair family,,tamil,2", // language
    "Bose family,9876533333,EN,25", // headcount
    "Rao family,,,",
  ].join("\n");
  const { valid, errors, fatal } = validateImport(csv);
  it("keeps good rows, normalising phone and language", () => {
    expect(fatal).toBeUndefined();
    expect(valid).toEqual([
      { row: 2, name: "Sharma family", phone: "9876511111", language: "hi", headcountMax: 6 },
      { row: 8, name: "Rao family", phone: null, language: "en", headcountMax: null },
    ]);
  });
  it("reports each bad row with its line number", () => {
    expect(errors.map((e) => [e.row, e.error.split(" ")[0]])).toEqual([[3, "Same"], [4, "Name"], [5, "Phone"], [6, "Language"], [7, "headcount_max"]]);
  });
  it("missing name column or empty file is fatal", () => {
    expect(validateImport("phone\n9876500001").fatal).toMatch(/name/);
    expect(validateImport("").fatal).toMatch(/empty/);
  });
});

describe("assistant args hash", () => {
  it("is independent of key order and changes with values", () => {
    expect(canonical({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(argsHash({ language: "hi" })).toBe(argsHash({ language: "hi" }));
    expect(argsHash({ language: "hi" })).not.toBe(argsHash({ language: "en" }));
  });
});
