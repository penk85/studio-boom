// Cross-tab project ownership built on the browser Web Locks API.
// One tab may hold a project's edit lock; short dashboard writes use the same boundary.

const PROJECT_LOCK_PREFIX = "studio-boom:project:";

interface StudioBrowserLock {
  name: string;
}

export interface StudioBrowserLockManager {
  request<T>(
    name: string,
    options: { mode: "exclusive"; ifAvailable: true },
    callback: (lock: StudioBrowserLock | null) => T | PromiseLike<T>,
  ): Promise<T>;
}

interface HeldProjectLock {
  projectId: string;
  release: () => void;
  finished: Promise<void>;
}

export class ProjectAlreadyOpenError extends Error {
  constructor(public readonly projectId: string) {
    super(
      `This project is already open for editing in another tab. Close it there, then try again.`,
    );
    this.name = "ProjectAlreadyOpenError";
  }
}

export interface ProjectLockCoordinator {
  readonly crossTabSupported: boolean;
  acquire: (projectId: string) => Promise<void>;
  release: (projectId?: string) => Promise<void>;
  runExclusive: <T>(projectId: string, task: () => T | Promise<T>) => Promise<T>;
  owns: (projectId: string) => boolean;
  assertCanWrite: (projectId: string) => void;
}

/** Create one project-lock owner. Each browser tab gets one production instance. */
export function createProjectLockCoordinator(
  lockManager: StudioBrowserLockManager | null,
): ProjectLockCoordinator {
  let held: HeldProjectLock | null = null;
  let pendingAcquisition: { projectId: string; promise: Promise<void> } | null = null;
  let warnedAboutFallback = false;

  const ensureNoDifferentProject = (projectId: string) => {
    if (held && held.projectId !== projectId) {
      throw new Error("Close the current project before opening another one.");
    }
  };

  return {
    crossTabSupported: lockManager !== null,

    async acquire(projectId) {
      ensureNoDifferentProject(projectId);
      if (held?.projectId === projectId) return;
      if (pendingAcquisition) {
        if (pendingAcquisition.projectId !== projectId) {
          throw new Error("Wait for the current project to finish opening before opening another.");
        }
        await pendingAcquisition.promise;
        return;
      }

      const promise = acquireUnheldProject(projectId);
      pendingAcquisition = { projectId, promise };
      try {
        await promise;
      } finally {
        if (pendingAcquisition?.promise === promise) pendingAcquisition = null;
      }
    },

    async release(projectId) {
      if (!held) return;
      if (projectId && held.projectId !== projectId) {
        throw new Error(`Cannot release project "${projectId}" because it is not open here.`);
      }
      const current = held;
      current.release();
      await current.finished;
      if (held === current) held = null;
    },

    async runExclusive<T>(projectId: string, task: () => T | Promise<T>): Promise<T> {
      ensureNoDifferentProject(projectId);
      if (held?.projectId === projectId || !lockManager) return await task();

      let ran = false;
      let result: T | undefined;
      await lockManager.request(
        projectLockName(projectId),
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (!lock) return;
          ran = true;
          result = await task();
        },
      );
      if (!ran) throw new ProjectAlreadyOpenError(projectId);
      return result as T;
    },

    owns(projectId) {
      return held?.projectId === projectId;
    },

    assertCanWrite(projectId) {
      if (lockManager && held?.projectId !== projectId) {
        throw new ProjectAlreadyOpenError(projectId);
      }
    },
  };

  async function acquireUnheldProject(projectId: string): Promise<void> {
    if (!lockManager) {
      if (!warnedAboutFallback) {
        warnedAboutFallback = true;
        console.warn(
          "Web Locks API is unavailable; project editing cannot be coordinated across tabs.",
        );
      }
      held = { projectId, release: () => undefined, finished: Promise.resolve() };
      return;
    }

    let resolveAcquired: (acquired: boolean) => void = () => undefined;
    let rejectAcquired: (error: unknown) => void = () => undefined;
    const acquired = new Promise<boolean>((resolve, reject) => {
      resolveAcquired = resolve;
      rejectAcquired = reject;
    });
    let releaseBrowserLock: () => void = () => undefined;
    const holdBrowserLock = new Promise<void>((resolve) => {
      releaseBrowserLock = resolve;
    });
    let resolveFinished: () => void = () => undefined;
    let rejectFinished: (error: unknown) => void = () => undefined;
    const finished = new Promise<void>((resolve, reject) => {
      resolveFinished = resolve;
      rejectFinished = reject;
    });
    const pendingLock: HeldProjectLock = {
      projectId,
      release: releaseBrowserLock,
      finished,
    };

    try {
      void lockManager
        .request(
          projectLockName(projectId),
          { mode: "exclusive", ifAvailable: true },
          async (lock) => {
            if (!lock) {
              resolveAcquired(false);
              return;
            }
            held = pendingLock;
            resolveAcquired(true);
            await holdBrowserLock;
          },
        )
        .then(resolveFinished, (error) => {
          rejectAcquired(error);
          rejectFinished(error);
        });
    } catch (error) {
      rejectAcquired(error);
      rejectFinished(error);
    }

    // The release path observes this error; this handler also prevents a rejected
    // lock request from becoming an unhandled promise while the project is open.
    void finished.catch(() => undefined);

    if (!(await acquired)) {
      await finished;
      throw new ProjectAlreadyOpenError(projectId);
    }
  }
}

function projectLockName(projectId: string): string {
  return `${PROJECT_LOCK_PREFIX}${projectId}`;
}

function getBrowserLockManager(): StudioBrowserLockManager | null {
  if (typeof navigator === "undefined" || !navigator.locks) return null;
  return navigator.locks as unknown as StudioBrowserLockManager;
}

type ProjectLockGlobal = typeof globalThis & {
  __studioBoomProjectLockCoordinator?: ProjectLockCoordinator;
};

const projectLockGlobal = globalThis as ProjectLockGlobal;

// Keep the held lock reachable across Vite hot-module replacement.
export const projectEditLock =
  projectLockGlobal.__studioBoomProjectLockCoordinator ??
  createProjectLockCoordinator(getBrowserLockManager());
projectLockGlobal.__studioBoomProjectLockCoordinator = projectEditLock;
