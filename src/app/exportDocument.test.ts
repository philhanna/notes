import { describe, expect, it } from "vitest";
import { exportDocument } from "./exportDocument.ts";
import { parseDocument } from "../domain/serialize.ts";

describe("exportDocument", () => {
  it("serializes exactly the active tree, deterministically", () => {
    const document = { hardinfo: "system info", list: [1, 2, 3] };
    const result = exportDocument(document, new Date("2026-07-14T09:30:00Z"));
    expect(result.content).toBe(JSON.stringify(document, null, 2) + "\n");
    expect(result.mimeType).toBe("application/json");
  });

  it("produces content that parses successfully back to the same document", () => {
    const document = { a: { b: [1, "two", null, true] } };
    const result = exportDocument(document);
    const parsed = parseDocument(result.content);
    expect(parsed).toEqual({ ok: true, value: document });
  });

  it("names the file with a timestamp, so repeated exports do not collide", () => {
    const document = {};
    const result = exportDocument(document, new Date("2026-07-14T09:30:05Z"));
    expect(result.filename).toBe("notes-export-2026-07-14-09-30-05.json");
  });

  it("never includes trash, since it only ever receives the document", () => {
    const document = { note: "hello" };
    const result = exportDocument(document);
    expect(result.content).not.toContain("trash");
  });
});
