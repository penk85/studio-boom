import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Code2,
  Clock3,
  Copy,
  Download,
  Film,
  FolderOpen,
  Globe2,
  Loader2,
  Pencil,
  Plus,
  Search,
  Shapes,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { db, isCurrentProjectShape } from "../db";
import { renderProjectThumbnail, renderProjectToMp4 } from "../export/render-client";
import { createDuplicatedProject, createUniqueProjectName } from "../project-actions";
import {
  createProjectFromHyperframesHtml,
  createProjectFromHyperframesZip,
  type ImportedHyperframesProject,
} from "../project-import";
import { getProjectThumbnailCacheKey } from "../project-thumbnail-cache";
import type { Project } from "../types";

interface ProjectDashboardProps {
  onCreateBlankProject: () => Promise<void>;
  onOpenProject: (projectId: string) => Promise<void>;
}

type ProjectRenderState = Record<string, "idle" | "rendering" | "error">;
type ProjectActionState = Record<string, "renaming" | "duplicating" | "deleting">;

export function ProjectDashboard({ onCreateBlankProject, onOpenProject }: ProjectDashboardProps) {
  const storedProjects = useLiveQuery(() => db.projects.orderBy("updatedAt").reverse().toArray());
  const [query, setQuery] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renderState, setRenderState] = useState<ProjectRenderState>({});
  const [renderErrors, setRenderErrors] = useState<Record<string, string>>({});
  const [actionState, setActionState] = useState<ProjectActionState>({});
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [creatingBlankProject, setCreatingBlankProject] = useState(false);
  const [importingProject, setImportingProject] = useState(false);
  const [importName, setImportName] = useState("Imported HyperFrames");
  const [importSource, setImportSource] = useState("");
  const [importZipFile, setImportZipFile] = useState<File | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const projects = useMemo(
    () => (storedProjects ?? []).filter(isCurrentProjectShape),
    [storedProjects],
  );
  const incompatibleProjectCount = (storedProjects?.length ?? 0) - projects.length;
  const filteredProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter((project) => project.name.toLowerCase().includes(needle));
  }, [projects, query]);

  const openProject = async (projectId: string) => {
    setOpeningId(projectId);
    setOpenError(null);
    try {
      await onOpenProject(projectId);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpeningId(null);
    }
  };

  const downloadMp4 = async (project: Project) => {
    setRenderState((state) => ({ ...state, [project.id]: "rendering" }));
    setRenderErrors((state) => {
      const next = { ...state };
      delete next[project.id];
      return next;
    });

    try {
      await renderProjectToMp4(project);
      setRenderState((state) => ({ ...state, [project.id]: "idle" }));
    } catch (error) {
      setRenderState((state) => ({ ...state, [project.id]: "error" }));
      setRenderErrors((state) => ({
        ...state,
        [project.id]: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  const setProjectAction = (projectId: string, action: ProjectActionState[string] | null) => {
    setActionState((state) => {
      const next = { ...state };
      if (action) {
        next[projectId] = action;
      } else {
        delete next[projectId];
      }
      return next;
    });
  };

  const startRename = (project: Project) => {
    setRenamingId(project.id);
    setRenameValue(project.name);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue("");
  };

  const renameProject = async (project: Project) => {
    const name = renameValue.trim();
    if (!name || name === project.name) {
      cancelRename();
      return;
    }

    setProjectAction(project.id, "renaming");
    try {
      await db.projects.put({
        ...project,
        name,
        updatedAt: Date.now(),
        hf: { ...project.hf, name },
      });
      cancelRename();
    } finally {
      setProjectAction(project.id, null);
    }
  };

  const duplicateProject = async (project: Project) => {
    setProjectAction(project.id, "duplicating");
    try {
      const name = createUniqueProjectName(
        `${project.name} Copy`,
        projects.map((existing) => existing.name),
      );
      const duplicate = createDuplicatedProject(project, { name });
      const sourceCacheKey = getProjectThumbnailCacheKey(project);
      const duplicateCacheKey = getProjectThumbnailCacheKey(duplicate);

      await db.transaction("rw", db.projects, db.projectThumbnails, async () => {
        await db.projects.add(duplicate);
        const cachedThumbnail = await db.projectThumbnails.get(project.id);
        if (cachedThumbnail?.cacheKey === sourceCacheKey) {
          await db.projectThumbnails.put({
            projectId: duplicate.id,
            cacheKey: duplicateCacheKey,
            blob: cachedThumbnail.blob,
            mimeType: cachedThumbnail.mimeType,
            generatedAt: Date.now(),
          });
        }
      });
    } finally {
      setProjectAction(project.id, null);
    }
  };

  const deleteProject = async (project: Project) => {
    if (!window.confirm(`Delete "${project.name}"? This cannot be undone.`)) return;

    setProjectAction(project.id, "deleting");
    try {
      await db.transaction("rw", db.projects, db.projectThumbnails, async () => {
        await db.projects.delete(project.id);
        await db.projectThumbnails.delete(project.id);
      });
      setRenderErrors((state) => {
        const next = { ...state };
        delete next[project.id];
        return next;
      });
      if (renamingId === project.id) cancelRename();
    } finally {
      setProjectAction(project.id, null);
    }
  };

  const createBlankProject = async () => {
    setCreatingBlankProject(true);
    try {
      await onCreateBlankProject();
      setNewProjectOpen(false);
    } finally {
      setCreatingBlankProject(false);
    }
  };

  const importHyperframesProject = async () => {
    setImportingProject(true);
    setImportError(null);
    try {
      const imported = createProjectFromHyperframesHtml(importSource, {
        name: importName,
      });
      await persistImportedProject(imported);
      await onOpenProject(imported.project.id);
      setNewProjectOpen(false);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setImportingProject(false);
    }
  };

  const importHyperframesZipProject = async () => {
    if (!importZipFile) return;
    setImportingProject(true);
    setImportError(null);
    try {
      const imported = await createProjectFromHyperframesZip(importZipFile, {
        name: importName,
      });
      await persistImportedProject(imported);
      await onOpenProject(imported.project.id);
      setNewProjectOpen(false);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setImportingProject(false);
    }
  };

  const setZipFile = (file: File | null) => {
    setImportZipFile(file);
    setImportError(null);
    if (file && (!importName.trim() || importName === "Imported HyperFrames")) {
      setImportName(file.name.replace(/\.[^/.]+$/, "") || "Imported HyperFrames");
    }
  };

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border bg-panel px-5 py-4">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="h-8 w-8 shrink-0 rounded-md"
              style={{ background: "var(--gradient-primary)" }}
              aria-hidden
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-tight">Studio Boom</div>
              <div className="text-xs text-muted-foreground">Projects</div>
            </div>
          </div>
          <div className="relative ml-auto hidden w-72 sm:block">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-8 pl-8 text-xs"
              placeholder="Search projects"
            />
          </div>
          <Button size="sm" onClick={() => setNewProjectOpen(true)}>
            <Plus size={14} />
            New project
          </Button>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-5 py-6">
        <div className="mb-5 flex items-center justify-between gap-3 sm:hidden">
          <div className="relative w-full">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-8 pl-8 text-xs"
              placeholder="Search projects"
            />
          </div>
        </div>

        {(openError || incompatibleProjectCount > 0) && (
          <div className="space-y-2" role="alert">
            {openError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/45 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{openError}</span>
              </div>
            )}
            {incompatibleProjectCount > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-xs text-secondary-foreground">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>
                  {incompatibleProjectCount} incompatible project
                  {incompatibleProjectCount === 1 ? " is" : "s are"} hidden but preserved for
                  recovery.
                </span>
              </div>
            )}
          </div>
        )}

        {storedProjects === undefined ? (
          <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
            Loading projects...
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="grid flex-1 place-items-center">
            <button
              type="button"
              onClick={() => setNewProjectOpen(true)}
              className="flex w-full max-w-sm flex-col items-center gap-4 rounded-lg border border-dashed border-border bg-panel/60 px-8 py-10 text-center hover:border-primary/70 hover:bg-panel"
            >
              <span className="grid h-12 w-12 place-items-center rounded-md bg-secondary text-secondary-foreground">
                <Plus size={22} />
              </span>
              <span className="text-sm font-medium">New project</span>
              <span className="text-xs text-muted-foreground">Blank 1920x1080 movie</span>
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredProjects.map((project) => {
              const state = renderState[project.id] ?? "idle";
              const rendering = state === "rendering";
              const opening = openingId === project.id;
              const error = renderErrors[project.id];
              const projectAction = actionState[project.id];
              const renaming = renamingId === project.id;

              return (
                <article
                  key={project.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => void openProject(project.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void openProject(project.id);
                    }
                  }}
                  className="group overflow-hidden rounded-lg border border-border bg-panel shadow-[var(--shadow-panel)] outline-none transition-colors hover:border-primary/60 focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <ProjectPreviewThumbnail project={project} />
                  <div className="space-y-3 p-4">
                    <div className="flex items-start gap-3">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-secondary text-secondary-foreground">
                        <Film size={17} />
                      </div>
                      <div className="min-w-0 flex-1">
                        {renaming ? (
                          <form
                            className="flex items-center gap-1"
                            onClick={(event) => event.stopPropagation()}
                            onSubmit={(event) => {
                              event.preventDefault();
                              void renameProject(project);
                            }}
                          >
                            <Input
                              value={renameValue}
                              onChange={(event) => setRenameValue(event.target.value)}
                              onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  cancelRename();
                                }
                              }}
                              className="h-7 min-w-0 px-2 text-xs"
                              aria-label="Project name"
                              autoFocus
                              disabled={projectAction === "renaming"}
                            />
                            <Button
                              type="submit"
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              title="Save name"
                              aria-label="Save name"
                              disabled={projectAction === "renaming"}
                            >
                              {projectAction === "renaming" ? (
                                <Loader2 className="animate-spin" size={13} />
                              ) : (
                                <Check size={13} />
                              )}
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              title="Cancel rename"
                              aria-label="Cancel rename"
                              onClick={cancelRename}
                              disabled={projectAction === "renaming"}
                            >
                              <X size={13} />
                            </Button>
                          </form>
                        ) : (
                          <h2 className="truncate text-sm font-semibold">{project.name}</h2>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Clock3 size={12} />
                            {formatEditedTime(project.updatedAt)}
                          </span>
                          <span>{formatDuration(project.hf.duration)}</span>
                          <span>
                            {project.hf.width}x{project.hf.height}
                          </span>
                        </div>
                      </div>
                      {!renaming && (
                        <div
                          className="flex shrink-0 items-center gap-1"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="Rename project"
                            aria-label="Rename project"
                            onClick={() => startRename(project)}
                          >
                            <Pencil size={13} />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="Duplicate project"
                            aria-label="Duplicate project"
                            disabled={projectAction === "duplicating"}
                            onClick={() => void duplicateProject(project)}
                          >
                            {projectAction === "duplicating" ? (
                              <Loader2 className="animate-spin" size={13} />
                            ) : (
                              <Copy size={13} />
                            )}
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            title="Delete project"
                            aria-label="Delete project"
                            disabled={projectAction === "deleting"}
                            onClick={() => void deleteProject(project)}
                          >
                            {projectAction === "deleting" ? (
                              <Loader2 className="animate-spin" size={13} />
                            ) : (
                              <Trash2 size={13} />
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                    {error && (
                      <div
                        className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive-foreground"
                        title={error}
                      >
                        <AlertCircle size={13} className="mt-0.5 shrink-0" />
                        <span className="line-clamp-2">{error}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="flex-1"
                        disabled={opening}
                        onClick={(event) => {
                          event.stopPropagation();
                          void openProject(project.id);
                        }}
                      >
                        {opening ? (
                          <Loader2 className="animate-spin" size={14} />
                        ) : (
                          <FolderOpen size={14} />
                        )}
                        Open
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={rendering}
                        onClick={(event) => {
                          event.stopPropagation();
                          void downloadMp4(project);
                        }}
                      >
                        {rendering ? (
                          <Loader2 className="animate-spin" size={14} />
                        ) : (
                          <Download size={14} />
                        )}
                        {rendering ? "Rendering" : "MP4"}
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      <NewProjectDialog
        open={newProjectOpen}
        creatingBlankProject={creatingBlankProject}
        onOpenChange={setNewProjectOpen}
        onCreateBlankProject={createBlankProject}
        importingProject={importingProject}
        importName={importName}
        importSource={importSource}
        importZipFile={importZipFile}
        importError={importError}
        onImportNameChange={setImportName}
        onImportSourceChange={(source) => {
          setImportSource(source);
          setImportError(null);
        }}
        onImportZipFileChange={setZipFile}
        onImportHyperframesProject={importHyperframesProject}
        onImportHyperframesZipProject={importHyperframesZipProject}
      />
    </main>
  );
}

async function persistImportedProject(imported: ImportedHyperframesProject): Promise<void> {
  await db.transaction("rw", db.projects, db.media, db.mediaBlobs, async () => {
    await db.projects.add(imported.project);
    if (imported.mediaFiles.length > 0) {
      await db.media.bulkAdd(imported.mediaFiles.map(({ asset }) => asset));
      await db.mediaBlobs.bulkAdd(imported.mediaFiles.map(({ mediaBlob }) => mediaBlob));
    }
  });
}

function NewProjectDialog({
  open,
  creatingBlankProject,
  importingProject,
  importName,
  importSource,
  importZipFile,
  importError,
  onOpenChange,
  onCreateBlankProject,
  onImportNameChange,
  onImportSourceChange,
  onImportZipFileChange,
  onImportHyperframesProject,
  onImportHyperframesZipProject,
}: {
  open: boolean;
  creatingBlankProject: boolean;
  importingProject: boolean;
  importName: string;
  importSource: string;
  importZipFile: File | null;
  importError: string | null;
  onOpenChange: (open: boolean) => void;
  onCreateBlankProject: () => Promise<void>;
  onImportNameChange: (name: string) => void;
  onImportSourceChange: (source: string) => void;
  onImportZipFileChange: (file: File | null) => void;
  onImportHyperframesProject: () => Promise<void>;
  onImportHyperframesZipProject: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"choose" | "zip" | "paste">("choose");

  useEffect(() => {
    if (!open) setMode("choose");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {mode === "choose" ? (
          <>
            <DialogHeader>
              <DialogTitle>New project</DialogTitle>
              <DialogDescription>Choose how this movie should begin.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <ProjectStarterButton
                icon={<Plus size={18} />}
                title="Blank movie"
                description="1920x1080, 30 seconds"
                actionLabel={creatingBlankProject ? "Creating" : "Create"}
                loading={creatingBlankProject}
                onClick={() => void onCreateBlankProject()}
              />
              <ProjectStarterButton
                icon={<Upload size={18} />}
                title="Import ZIP"
                description="Project bundle with HTML and assets"
                actionLabel="Import"
                onClick={() => setMode("zip")}
              />
              <ProjectStarterButton
                icon={<Code2 size={18} />}
                title="Paste HTML"
                description="Advanced root composition import"
                actionLabel="Paste"
                onClick={() => setMode("paste")}
              />
              <ProjectStarterButton
                icon={<Globe2 size={18} />}
                title="Website-to-video"
                description="Generated HyperFrames video starter"
                actionLabel="Later"
                disabled
              />
              <ProjectStarterButton
                icon={<Shapes size={18} />}
                title="Template or effect"
                description="Reusable starters from a catalog"
                actionLabel="Later"
                disabled
              />
            </div>
          </>
        ) : mode === "zip" ? (
          <ImportZipPanel
            projectName={importName}
            file={importZipFile}
            error={importError}
            importing={importingProject}
            onBack={() => setMode("choose")}
            onNameChange={onImportNameChange}
            onFileChange={onImportZipFileChange}
            onImport={() => void onImportHyperframesZipProject()}
          />
        ) : (
          <PasteHyperframesPanel
            projectName={importName}
            source={importSource}
            error={importError}
            importing={importingProject}
            onBack={() => setMode("choose")}
            onNameChange={onImportNameChange}
            onSourceChange={onImportSourceChange}
            onImport={() => void onImportHyperframesProject()}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImportZipPanel({
  projectName,
  file,
  error,
  importing,
  onBack,
  onNameChange,
  onFileChange,
  onImport,
}: {
  projectName: string;
  file: File | null;
  error: string | null;
  importing: boolean;
  onBack: () => void;
  onNameChange: (name: string) => void;
  onFileChange: (file: File | null) => void;
  onImport: () => void;
}) {
  return (
    <div className="space-y-4">
      <DialogHeader>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={onBack}
            aria-label="Back to project starters"
            title="Back"
          >
            <ArrowLeft size={14} />
          </Button>
          <div>
            <DialogTitle>Import ZIP</DialogTitle>
            <DialogDescription>
              Import a packaged HyperFrames project with index.html, compositions, and media.
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>
      <div className="space-y-3">
        <Input
          value={projectName}
          onChange={(event) => onNameChange(event.target.value)}
          className="h-8 text-xs"
          placeholder="Project name"
          aria-label="Imported project name"
        />
        <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-panel/60 px-4 py-6 text-center text-xs transition-colors hover:border-primary/70 hover:bg-panel">
          <span className="grid h-10 w-10 place-items-center rounded-md bg-secondary text-secondary-foreground">
            <Upload size={18} />
          </span>
          <span className="font-medium text-foreground">
            {file ? file.name : "Choose a HyperFrames ZIP"}
          </span>
          <span className="text-muted-foreground">
            {file ? formatFileSize(file.size) : "Looks for index.html and compositions/*.html"}
          </span>
          <input
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            className="sr-only"
            aria-label="HyperFrames ZIP file"
            onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
          />
        </label>
        {error && (
          <div className="max-h-32 overflow-auto rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
            <pre className="whitespace-pre-wrap font-sans">{error}</pre>
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-3">
        <Button type="button" size="sm" disabled={importing || !file} onClick={onImport}>
          {importing ? <Loader2 className="animate-spin" size={14} /> : <Upload size={14} />}
          Import ZIP
        </Button>
      </div>
    </div>
  );
}

function PasteHyperframesPanel({
  projectName,
  source,
  error,
  importing,
  onBack,
  onNameChange,
  onSourceChange,
  onImport,
}: {
  projectName: string;
  source: string;
  error: string | null;
  importing: boolean;
  onBack: () => void;
  onNameChange: (name: string) => void;
  onSourceChange: (source: string) => void;
  onImport: () => void;
}) {
  return (
    <div className="space-y-4">
      <DialogHeader>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={onBack}
            aria-label="Back to project starters"
            title="Back"
          >
            <ArrowLeft size={14} />
          </Button>
          <div>
            <DialogTitle>Import HyperFrames</DialogTitle>
            <DialogDescription>Paste a root composition HTML document.</DialogDescription>
          </div>
        </div>
      </DialogHeader>
      <div className="space-y-3">
        <Input
          value={projectName}
          onChange={(event) => onNameChange(event.target.value)}
          className="h-8 text-xs"
          placeholder="Project name"
          aria-label="Imported project name"
        />
        <textarea
          value={source}
          onChange={(event) => onSourceChange(event.target.value)}
          className="min-h-64 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder="<!DOCTYPE html>..."
          aria-label="HyperFrames HTML source"
          spellCheck={false}
        />
        {error && (
          <div className="max-h-32 overflow-auto rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
            <pre className="whitespace-pre-wrap font-sans">{error}</pre>
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-3">
        <Button type="button" size="sm" disabled={importing || !source.trim()} onClick={onImport}>
          {importing ? <Loader2 className="animate-spin" size={14} /> : <Code2 size={14} />}
          Import
        </Button>
      </div>
    </div>
  );
}

function ProjectStarterButton({
  icon,
  title,
  description,
  actionLabel,
  loading = false,
  disabled = false,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={onClick}
      className="flex min-h-28 flex-col items-start justify-between rounded-lg border border-border bg-panel p-4 text-left transition-colors hover:border-primary/70 hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-55"
    >
      <span className="flex w-full items-start justify-between gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-secondary text-secondary-foreground">
          {icon}
        </span>
        <span className="rounded border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {loading ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="animate-spin" size={10} />
              {actionLabel}
            </span>
          ) : (
            actionLabel
          )}
        </span>
      </span>
      <span className="mt-4 block">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

function ProjectPreviewThumbnail({ project }: { project: Project }) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const cacheKey = getProjectThumbnailCacheKey(project);

    const showBlob = (blob: Blob) => {
      objectUrl = URL.createObjectURL(blob);
      setThumbnailUrl(objectUrl);
    };

    setThumbnailUrl(null);
    setFailed(false);

    void db.projectThumbnails
      .get(project.id)
      .then(async (cached) => {
        if (cancelled) return;
        if (cached?.cacheKey === cacheKey) {
          showBlob(cached.blob);
          return;
        }

        const blob = await renderProjectThumbnail(project);
        if (cancelled) return;
        showBlob(blob);
        await db.projectThumbnails.put({
          projectId: project.id,
          cacheKey,
          blob,
          mimeType: blob.type || "image/png",
          generatedAt: Date.now(),
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [project]);

  return (
    <div className="relative aspect-video overflow-hidden bg-stage-bg">
      {thumbnailUrl && !failed ? (
        <img
          src={thumbnailUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_30%_20%,oklch(0.35_0.08_285),transparent_36%),linear-gradient(135deg,var(--stage-bg),var(--panel-2))]">
          <div className="grid h-14 w-14 place-items-center rounded-lg border border-border bg-background/50 text-muted-foreground">
            <Film size={24} />
          </div>
        </div>
      )}
      {!thumbnailUrl && !failed && (
        <div className="absolute bottom-2 right-2 rounded bg-background/80 px-2 py-1 text-[10px] text-muted-foreground">
          Thumbnail
        </div>
      )}
    </div>
  );
}

function formatDuration(duration: number): string {
  const total = Math.max(0, Math.round(duration || 0));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatEditedTime(timestamp: number): string {
  if (!timestamp) return "Never";
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return formatter.format(new Date(timestamp));
}
