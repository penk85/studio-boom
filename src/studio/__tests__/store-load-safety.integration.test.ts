import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("project load safety source contract", () => {
  it("never deletes or replaces an incompatible stored project", () => {
    const source = readFileSync(join(process.cwd(), "src/studio/store.ts"), "utf8");
    const loadProjectSource = source.slice(
      source.indexOf("  async loadProject(id)"),
      source.indexOf("  async newProject()"),
    );

    expect(loadProjectSource).toContain("requireCurrentProjectShape(storedProject, id)");
    expect(loadProjectSource).not.toContain("db.projects.delete");
    expect(loadProjectSource).not.toContain("get().newProject()");
  });
});
