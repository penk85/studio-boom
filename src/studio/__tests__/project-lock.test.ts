import { describe, expect, it, vi } from "vitest";
import {
  ProjectAlreadyOpenError,
  createProjectLockCoordinator,
  type StudioBrowserLockManager,
} from "../project-lock";

class FakeBrowserLockManager implements StudioBrowserLockManager {
  private readonly heldNames = new Set<string>();

  async request<T>(
    name: string,
    _options: { mode: "exclusive"; ifAvailable: true },
    callback: (lock: { name: string } | null) => T | PromiseLike<T>,
  ): Promise<T> {
    if (this.heldNames.has(name)) return await callback(null);
    this.heldNames.add(name);
    try {
      return await callback({ name });
    } finally {
      this.heldNames.delete(name);
    }
  }
}

describe("project edit locks", () => {
  it("allows only one tab to own a project until the owner releases it", async () => {
    const browserLocks = new FakeBrowserLockManager();
    const firstTab = createProjectLockCoordinator(browserLocks);
    const secondTab = createProjectLockCoordinator(browserLocks);

    await firstTab.acquire("project-1");
    expect(firstTab.owns("project-1")).toBe(true);
    await expect(secondTab.acquire("project-1")).rejects.toBeInstanceOf(ProjectAlreadyOpenError);

    await firstTab.release("project-1");
    await secondTab.acquire("project-1");
    expect(secondTab.owns("project-1")).toBe(true);
    await secondTab.release("project-1");
  });

  it("blocks dashboard writes while another tab owns the edit lock", async () => {
    const browserLocks = new FakeBrowserLockManager();
    const editorTab = createProjectLockCoordinator(browserLocks);
    const dashboardTab = createProjectLockCoordinator(browserLocks);
    let writes = 0;

    await editorTab.acquire("project-1");
    await expect(
      dashboardTab.runExclusive("project-1", () => {
        writes += 1;
      }),
    ).rejects.toBeInstanceOf(ProjectAlreadyOpenError);
    expect(writes).toBe(0);

    await editorTab.release("project-1");
    await dashboardTab.runExclusive("project-1", () => {
      writes += 1;
    });
    expect(writes).toBe(1);
  });

  it("does not let one tab switch projects without closing its current project", async () => {
    const coordinator = createProjectLockCoordinator(new FakeBrowserLockManager());

    await coordinator.acquire("project-1");
    await expect(coordinator.acquire("project-2")).rejects.toThrow(
      "Close the current project before opening another one.",
    );
    await coordinator.release("project-1");
  });

  it("shares one pending browser request across duplicate open events", async () => {
    let allowBrowserRequest: () => void = () => undefined;
    const browserRequestGate = new Promise<void>((resolve) => {
      allowBrowserRequest = resolve;
    });
    let requestCount = 0;
    const browserLocks: StudioBrowserLockManager = {
      async request(name, _options, callback) {
        requestCount += 1;
        await browserRequestGate;
        return await callback({ name });
      },
    };
    const coordinator = createProjectLockCoordinator(browserLocks);

    const firstOpen = coordinator.acquire("project-1");
    const duplicateOpen = coordinator.acquire("project-1");
    expect(requestCount).toBe(1);
    allowBrowserRequest();
    await Promise.all([firstOpen, duplicateOpen]);
    expect(coordinator.owns("project-1")).toBe(true);
    await coordinator.release("project-1");
  });

  it("keeps editing available with a console warning when Web Locks are unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const coordinator = createProjectLockCoordinator(null);

    await coordinator.acquire("project-1");
    expect(coordinator.crossTabSupported).toBe(false);
    expect(coordinator.owns("project-1")).toBe(true);
    expect(warn).toHaveBeenCalledOnce();

    await coordinator.release("project-1");
    warn.mockRestore();
  });
});
