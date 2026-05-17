import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const inspectorPath = join(process.cwd(), "src/studio/components/Inspector.tsx");

describe("Inspector source integration", () => {
  it("shows editable composition source and read-only primitive root source", () => {
    const source = readFileSync(inspectorPath, "utf8");

    expect(source).toContain("<CompositionSourceInspector");
    expect(source).toContain("onApply={(html) => updateCompositionHtml");
    expect(source).toContain("<RootElementSourceInspector");
    expect(source).toContain("readRootElementSource(rootHtml, clip.id)");
    expect(source).toContain("readOnly");
  });
});
