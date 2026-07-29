import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("project lock wiring", () => {
  const storeSource = readFileSync(join(process.cwd(), "src/studio/store.ts"), "utf8");
  const appSource = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
  const projectPersistenceSource = readFileSync(
    join(process.cwd(), "src/studio/project-persistence.ts"),
    "utf8",
  );
  const dashboardSource = readFileSync(
    join(process.cwd(), "src/studio/components/ProjectDashboard.tsx"),
    "utf8",
  );

  it("acquires ownership before load-time project writes and releases failed loads", () => {
    const loadProjectSource = storeSource.slice(
      storeSource.indexOf("  async loadProject(id)"),
      storeSource.indexOf("  async newProject()"),
    );

    expect(loadProjectSource.indexOf("await projectEditLock.acquire(id)")).toBeLessThan(
      loadProjectSource.indexOf("await db.projects.put(project)"),
    );
    expect(loadProjectSource).toContain("await projectEditLock.release(id)");
  });

  it("saves and releases ownership before returning to the dashboard", () => {
    const closeProjectSource = storeSource.slice(
      storeSource.indexOf("  async closeProject()"),
      storeSource.indexOf("  refreshCharacterCompositions(options)"),
    );

    expect(closeProjectSource.indexOf("await get().saveProject()")).toBeLessThan(
      closeProjectSource.indexOf("await projectEditLock.release(projectId)"),
    );
    expect(closeProjectSource).toContain("revokeAllMediaUrls()");
    expect(appSource).toContain("await closeProject()");
    expect(appSource).not.toContain('await saveProject();\n    setView("dashboard")');
  });

  it("routes destructive dashboard actions through the same project lock", () => {
    expect(
      projectPersistenceSource.match(/projectEditLock\.runExclusive\(projectId/g),
    ).toHaveLength(3);
    expect(projectPersistenceSource).toContain(
      "const current = await readStoredProject(projectId)",
    );
    expect(dashboardSource).not.toMatch(/db\.(projects|projectThumbnails)\.(put|add|delete)/);
    expect(dashboardSource).not.toContain("projectEditLock");
  });
});
