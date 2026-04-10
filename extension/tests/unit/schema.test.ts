import { describe, it, expect } from "vitest";
import { migrateStoredData } from "../../src/content-script/annotations";

describe("migrateStoredData", () => {
  it("migrates bare array to versioned format", () => {
    const annotations = [{ id: "test-1", type: "free", note: "hello" }];
    const result = migrateStoredData(annotations as any);
    expect(result.schemaVersion).toBe(1);
    expect(result.annotations).toEqual(annotations);
  });

  it("passes through versioned data unchanged", () => {
    const data = { schemaVersion: 1, annotations: [{ id: "test-1" }] };
    const result = migrateStoredData(data as any);
    expect(result).toEqual(data);
  });

  it("returns empty for null/undefined", () => {
    expect(migrateStoredData(null as any).annotations).toEqual([]);
    expect(migrateStoredData(undefined as any).annotations).toEqual([]);
  });

  it("returns empty for unknown format", () => {
    expect(migrateStoredData("garbage" as any).annotations).toEqual([]);
    expect(migrateStoredData(42 as any).annotations).toEqual([]);
  });
});
