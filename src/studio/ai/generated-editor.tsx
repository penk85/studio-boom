import type { PointerEventHandler, ReactNode, Ref } from "react";
import { ClipboardCheck, Copy, FileJson, Sparkles } from "lucide-react";
import type { AiGeneratedArtifactSummary, AiGeneratedEditorStatus } from "./external-ai";

export interface GeneratedEditorShellProps {
  placement?: "modal" | "embedded";
  title: ReactNode;
  headerControls?: ReactNode;
  actions?: ReactNode;
  leftPanel?: ReactNode;
  leftPanelClassName?: string;
  previewRef?: Ref<HTMLElement>;
  previewPane: ReactNode;
  previewPaneClassName?: string;
  onPreviewPointerDown?: PointerEventHandler<HTMLElement>;
  inspectorPanel: ReactNode;
  inspectorPanelClassName?: string;
  maxWidthClassName?: string;
  rootClassName?: string;
}

export function GeneratedEditorShell({
  placement = "modal",
  title,
  headerControls,
  actions,
  leftPanel,
  leftPanelClassName = "w-44 shrink-0 overflow-auto border-r border-border bg-panel p-2 text-xs",
  previewRef,
  previewPane,
  previewPaneClassName = "relative flex min-w-0 flex-1 items-center justify-center overflow-auto bg-stage-bg p-4",
  onPreviewPointerDown,
  inspectorPanel,
  inspectorPanelClassName = "w-72 shrink-0 overflow-auto border-l border-border bg-panel p-3 text-xs",
  maxWidthClassName = "max-w-7xl",
  rootClassName,
}: GeneratedEditorShellProps) {
  const rootClass =
    rootClassName ??
    (placement === "modal"
      ? "fixed inset-0 z-50 flex items-stretch justify-center bg-background/90 p-6"
      : "flex min-h-0 h-full items-stretch justify-center bg-background");

  return (
    <div className={rootClass}>
      <div
        className={`flex w-full ${maxWidthClassName} flex-col overflow-hidden rounded-lg border border-border bg-panel`}
      >
        <header className="flex items-center gap-3 border-b border-border bg-panel-2 px-4 py-2">
          <span className="text-sm font-semibold">{title}</span>
          {headerControls}
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </header>

        <div className="flex min-h-0 flex-1">
          {leftPanel && <aside className={leftPanelClassName}>{leftPanel}</aside>}
          <main
            ref={previewRef}
            className={previewPaneClassName}
            onPointerDown={onPreviewPointerDown}
          >
            {previewPane}
          </main>
          <aside className={inspectorPanelClassName}>{inspectorPanel}</aside>
        </div>
      </div>
    </div>
  );
}

export interface AiAddonPromptPanelProps {
  open: boolean;
  title: string;
  intro: ReactNode;
  requestLabel: string;
  request: string;
  requestRows?: number;
  pasteLabel: string;
  paste: string;
  pasteRows?: number;
  pastePlaceholder?: string;
  status: AiGeneratedEditorStatus;
  promptText?: string;
  promptOpen?: boolean;
  repairPrompt?: string;
  summary?: AiGeneratedArtifactSummary | null;
  copyButtonLabel?: string;
  showPromptLabel?: string;
  loadButtonLabel?: string;
  onOpenChange: (open: boolean) => void;
  onRequestChange: (value: string) => void;
  onPasteChange: (value: string) => void;
  onCopyPrompt: () => void;
  onShowPrompt: () => void;
  onPromptOpenChange?: (open: boolean) => void;
  onCopyRepairPrompt?: () => void;
  onLoadSuggestion: () => void;
}

export function AiAddonPromptPanel({
  open,
  title,
  intro,
  requestLabel,
  request,
  requestRows = 3,
  pasteLabel,
  paste,
  pasteRows = 5,
  pastePlaceholder,
  status,
  promptText = "",
  promptOpen = false,
  repairPrompt = "",
  summary,
  copyButtonLabel = "Copy AI prompt package",
  showPromptLabel = "Show prompt",
  loadButtonLabel = "Load into preview",
  onOpenChange,
  onRequestChange,
  onPasteChange,
  onCopyPrompt,
  onShowPrompt,
  onPromptOpenChange,
  onCopyRepairPrompt,
  onLoadSuggestion,
}: AiAddonPromptPanelProps) {
  return (
    <div className="mb-3 rounded border border-border bg-panel-2 p-3">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-1 font-semibold uppercase tracking-wider text-muted-foreground">
          <Sparkles size={12} />
          {title}
        </span>
        <span className="text-[10px] text-muted-foreground">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="rounded border border-border bg-panel p-2 text-[10px] text-muted-foreground">
            {intro}
          </div>
          <div className="grid grid-cols-3 gap-1 text-[10px] text-muted-foreground">
            <StepChip index={1} label="Copy prompt" />
            <StepChip index={2} label="Paste JSON" />
            <StepChip index={3} label="Load preview" />
          </div>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
              {requestLabel}
            </span>
            <textarea
              value={request}
              onChange={(event) => onRequestChange(event.target.value)}
              rows={requestRows}
              className="w-full resize-y rounded border border-border bg-input px-2 py-1"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onCopyPrompt}
              className="flex items-center justify-center gap-1 rounded bg-primary/30 px-2 py-1 text-foreground hover:bg-primary/50"
            >
              <Copy size={13} />
              {copyButtonLabel}
            </button>
            <button
              type="button"
              onClick={promptOpen ? () => onPromptOpenChange?.(false) : onShowPrompt}
              className="flex items-center justify-center gap-1 rounded border border-border bg-panel px-2 py-1 hover:bg-panel-2"
            >
              <ClipboardCheck size={13} />
              {promptOpen ? "Hide prompt" : showPromptLabel}
            </button>
          </div>
          {promptOpen && promptText && (
            <textarea
              readOnly
              value={promptText}
              rows={6}
              spellCheck={false}
              className="w-full resize-y rounded border border-border bg-input px-2 py-1 font-mono text-[10px]"
            />
          )}
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
              {pasteLabel}
            </span>
            <textarea
              value={paste}
              onChange={(event) => onPasteChange(event.target.value)}
              rows={pasteRows}
              spellCheck={false}
              placeholder={pastePlaceholder}
              className="w-full resize-y rounded border border-border bg-input px-2 py-1 font-mono text-[10px]"
            />
          </label>
          <button
            type="button"
            onClick={onLoadSuggestion}
            className="flex w-full items-center justify-center gap-1 rounded border border-border bg-panel px-2 py-1 hover:bg-panel-2"
          >
            <FileJson size={13} />
            {loadButtonLabel}
          </button>
          {summary && <ArtifactSummary summary={summary} />}
          {status.message && (
            <div
              className={`whitespace-pre-wrap rounded border px-2 py-1 text-[10px] ${
                status.kind === "error"
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : status.kind === "info"
                    ? "border-border bg-panel text-muted-foreground"
                    : "border-primary/30 bg-primary/10 text-foreground"
              }`}
            >
              {status.message}
            </div>
          )}
          {repairPrompt && (
            <div className="rounded border border-destructive/40 bg-destructive/10 p-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-destructive">
                  Repair prompt
                </span>
                <button
                  type="button"
                  onClick={onCopyRepairPrompt}
                  className="rounded border border-destructive/50 px-2 py-0.5 text-[10px] text-destructive hover:bg-destructive/20"
                >
                  Copy repair prompt
                </button>
              </div>
              <textarea
                readOnly
                value={repairPrompt}
                rows={5}
                spellCheck={false}
                className="w-full resize-y rounded border border-destructive/30 bg-input px-2 py-1 font-mono text-[10px]"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StepChip({ index, label }: { index: number; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1 rounded border border-border bg-panel px-1.5 py-1">
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded bg-primary/20 text-[9px] text-foreground">
        {index}
      </span>
      <span className="truncate">{label}</span>
    </div>
  );
}

function ArtifactSummary({ summary }: { summary: AiGeneratedArtifactSummary }) {
  return (
    <div className="rounded border border-primary/30 bg-primary/10 p-2 text-[10px] text-foreground">
      <div className="font-medium">{summary.title}</div>
      {summary.detail && <div className="mt-1 text-muted-foreground">{summary.detail}</div>}
      {summary.items && summary.items.length > 0 && (
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-muted-foreground">
          {summary.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
