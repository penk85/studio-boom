// The studio's AI pane: copy a prompt, paste the reply, review it, approve it.
//
// The paste-JSON workflow already existed but only inside the action recorder,
// four clicks deep. AI control is half of what Studio Boom is for, so it belongs
// at the top level — and crucially, a suggestion is never applied wholesale. Each
// operation is a row you approve or skip, showing what it changes from and to,
// because "the human tweaks and approves" is the whole point.
import { useCallback, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ClipboardCheck, Copy, FileJson, Sparkles, X } from "lucide-react";
import { db, uid } from "../db";
import { useStudio } from "../store";
import { deriveProjectTimelineClips } from "../scenes";
import { copyExternalAiPrompt } from "../ai/external-ai";
import { buildProjectAiPrompt, buildProjectContextAiOut } from "../ai/project-control-surface";
import {
  applyProjectOperations,
  parseProjectSuggestion,
  type ReviewedOperation,
} from "../ai/project-suggestions";

export function AiPanel({ onClose }: { onClose: () => void }) {
  const project = useStudio((s) => s.project);
  const queriedActions = useLiveQuery(() => db.motionPresets.toArray(), []);
  const actions = useMemo(() => queriedActions ?? [], [queriedActions]);

  const [request, setRequest] = useState("");
  const [paste, setPaste] = useState("");
  const [reviewed, setReviewed] = useState<ReviewedOperation[] | null>(null);
  const [documentErrors, setDocumentErrors] = useState<string[]>([]);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string>("");
  const [showPrompt, setShowPrompt] = useState(false);

  const context = useMemo(
    () => (project ? buildProjectContextAiOut(project, actions) : null),
    [project, actions],
  );
  const prompt = useMemo(
    () => (context ? buildProjectAiPrompt(context, request) : ""),
    [context, request],
  );

  const review = useCallback(() => {
    if (!project) return;
    const result = parseProjectSuggestion(paste, project, actions);
    setReviewed(result.reviewed);
    setDocumentErrors(result.errors);
    // Everything applicable starts approved — reviewing means removing what you
    // disagree with, which is faster than opting in one at a time.
    setApproved(new Set(result.reviewed.filter((row) => !row.error).map((row) => row.id)));
    setStatus("");
  }, [actions, paste, project]);

  const applyApproved = useCallback(async () => {
    if (!project || !reviewed) return;
    const operations = reviewed
      .filter((row) => !row.error && approved.has(row.id))
      .map((row) => row.operation);
    if (operations.length === 0) return;

    const store = useStudio.getState();
    await applyProjectOperations(operations, {
      project,
      createId: uid,
      updateClip: (clipId, patch) => store.updateClip(clipId, patch),
      applyEffectPreset: (clipId, presetId) =>
        void useStudio.getState().applyEffectPreset(clipId, presetId),
      // Matching the new clip by start time picked the wrong one whenever two
      // text clips shared a start — the default case, since clicking adds at 0.
      // addLibraryItem returns the id it minted, so act on exactly that clip.
      addTextBlock: async (blockId, content, start) => {
        const clipId = await store.addLibraryItem(
          { kind: "text", presetId: blockId as never },
          { start },
        );
        if (clipId && content !== undefined) {
          useStudio.getState().updateClip(clipId, { content });
        }
      },
      activateClipScene: (clipId) => {
        const current = useStudio.getState();
        const clip = current.project
          ? deriveProjectTimelineClips(current.project).find((candidate) => candidate.id === clipId)
          : null;
        if (clip && current.activeSceneId !== clip.sceneId) current.setActiveScene(clip.sceneId);
      },
    });

    setStatus(
      `Applied ${operations.length} change${operations.length === 1 ? "" : "s"}. Undo reverses them.`,
    );
    setReviewed(null);
    setApproved(new Set());
    setPaste("");
  }, [approved, project, reviewed]);

  const applicable = reviewed?.filter((row) => !row.error) ?? [];
  const approvedCount = applicable.filter((row) => approved.has(row.id)).length;

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-primary/35 bg-primary/15 text-primary">
          <Sparkles size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-ui-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Assistant
          </div>
          <div className="truncate text-sm font-semibold text-foreground">Ask AI for changes</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close assistant"
          title="Close assistant"
          className="rounded border border-border p-1 text-muted-foreground hover:bg-panel-2 hover:text-foreground"
        >
          <X size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3 text-ui">
        <ol className="grid grid-cols-3 gap-1 text-ui-sm text-muted-foreground">
          {["Copy prompt", "Paste reply", "Approve"].map((label, index) => (
            <li
              key={label}
              className="flex min-w-0 items-center gap-1 rounded border border-border bg-panel-2 px-1.5 py-1"
            >
              <span className="grid h-4 w-4 shrink-0 place-items-center rounded bg-primary/20 text-[0.625rem] text-foreground">
                {index + 1}
              </span>
              <span className="truncate">{label}</span>
            </li>
          ))}
        </ol>

        <label className="block">
          <span className="mb-1 block text-ui-sm uppercase tracking-wider text-muted-foreground">
            What do you want changed?
          </span>
          <textarea
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            rows={3}
            placeholder="Make the intro punchier and have Alex wave when the title appears."
            className="w-full resize-y rounded border border-border bg-input px-2 py-1 text-ui text-foreground"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!context}
            onClick={() => {
              void copyExternalAiPrompt(prompt).then((result) =>
                setStatus(
                  result.ok
                    ? "Prompt copied. Paste it into your AI chat."
                    : (result.error ?? "Could not copy the prompt."),
                ),
              );
            }}
            className="flex items-center justify-center gap-1 rounded bg-primary px-2 py-1.5 text-ui font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Copy size={13} />
            Copy prompt
          </button>
          <button
            type="button"
            onClick={() => setShowPrompt((open) => !open)}
            className="flex items-center justify-center gap-1 rounded border border-border bg-panel-2 px-2 py-1.5 text-ui hover:bg-panel"
          >
            <ClipboardCheck size={13} />
            {showPrompt ? "Hide prompt" : "Show prompt"}
          </button>
        </div>

        {showPrompt && (
          <textarea
            readOnly
            value={prompt}
            rows={8}
            spellCheck={false}
            className="w-full resize-y rounded border border-border bg-input px-2 py-1 font-mono text-ui-sm text-muted-foreground"
          />
        )}

        <label className="block">
          <span className="mb-1 block text-ui-sm uppercase tracking-wider text-muted-foreground">
            Paste the reply
          </span>
          <textarea
            value={paste}
            onChange={(event) => {
              setPaste(event.target.value);
              setReviewed(null);
              setDocumentErrors([]);
            }}
            rows={6}
            spellCheck={false}
            placeholder='{ "kind": "studioBoom.projectSuggestion.v1", "operations": [ ... ] }'
            className="w-full resize-y rounded border border-border bg-input px-2 py-1 font-mono text-ui-sm text-foreground"
          />
        </label>

        <button
          type="button"
          onClick={review}
          disabled={!paste.trim()}
          className="flex w-full items-center justify-center gap-1 rounded border border-border bg-panel-2 px-2 py-1.5 text-ui hover:bg-panel disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FileJson size={13} />
          Review changes
        </button>

        {documentErrors.length > 0 && (
          <div className="rounded border border-destructive/50 bg-destructive/10 p-2 text-ui-sm text-destructive">
            <ul className="list-inside list-disc space-y-0.5">
              {documentErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        {reviewed && reviewed.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-ui-sm text-muted-foreground">
              <span>
                {approvedCount} of {applicable.length} selected
              </span>
              {applicable.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setApproved((current) =>
                      current.size === applicable.length
                        ? new Set()
                        : new Set(applicable.map((row) => row.id)),
                    )
                  }
                  className="rounded border border-border px-2 py-0.5 hover:bg-panel-2 hover:text-foreground"
                >
                  {approvedCount === applicable.length ? "Clear all" : "Select all"}
                </button>
              )}
            </div>

            <ul className="space-y-1">
              {reviewed.map((row) => (
                <OperationRow
                  key={row.id}
                  row={row}
                  approved={approved.has(row.id)}
                  onToggle={() =>
                    setApproved((current) => {
                      const next = new Set(current);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      return next;
                    })
                  }
                />
              ))}
            </ul>

            <button
              type="button"
              onClick={() => void applyApproved()}
              disabled={approvedCount === 0}
              className="w-full rounded bg-primary px-3 py-2 text-ui font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply {approvedCount} change{approvedCount === 1 ? "" : "s"}
            </button>
          </div>
        )}

        {status && (
          <div className="rounded border border-primary/30 bg-primary/10 px-2 py-1 text-ui-sm text-foreground">
            {status}
          </div>
        )}
      </div>
    </div>
  );
}

function OperationRow({
  row,
  approved,
  onToggle,
}: {
  row: ReviewedOperation;
  approved: boolean;
  onToggle: () => void;
}) {
  if (row.error) {
    return (
      <li className="rounded border border-destructive/40 bg-destructive/5 p-2">
        <div className="font-medium text-foreground">{row.summary}</div>
        <div className="mt-0.5 text-ui-sm text-destructive">{row.error}</div>
      </li>
    );
  }

  return (
    <li
      className={`rounded border p-2 ${approved ? "border-primary bg-primary/10" : "border-border bg-panel-2"}`}
    >
      <label className="flex cursor-pointer items-start gap-2">
        <input type="checkbox" checked={approved} onChange={onToggle} className="mt-0.5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-foreground">{row.summary}</span>
          {(row.before || row.after) && (
            <span className="mt-0.5 block text-ui-sm text-muted-foreground">
              {row.before && <span className="line-through">{row.before}</span>}
              {row.before && row.after && <span> → </span>}
              {row.after && <span className="text-foreground">{row.after}</span>}
            </span>
          )}
          {row.why && (
            <span className="mt-1 block text-ui-sm italic text-muted-foreground">{row.why}</span>
          )}
        </span>
      </label>
    </li>
  );
}
