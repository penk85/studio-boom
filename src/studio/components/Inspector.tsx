// Inspector — edits the currently selected clip's properties.
import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useStudio } from "../store";
import type {
  CharacterCompositionClip,
  CharacterPreset,
  CompositionClip,
  EditorClip,
  TextClip,
} from "../types";
import { deriveEditorClips, isCharacterCompositionClip } from "../types";
import { VoiceLipSyncPanel } from "./VoiceLipSyncPanel";
import { MotionPanel } from "./MotionPanel";
import {
  buildCompositionRepairPrompt,
  validateCompositionSourceHtml,
} from "../hyperframes/composition-source";

export function Inspector() {
  const project = useStudio((s) => s.project);
  const clips = useMemo(() => (project ? deriveEditorClips(project) : []), [project]);
  const tracks = useStudio((s) => s.tracks);
  const id = useStudio((s) => s.selectedClipId);
  const update = useStudio((s) => s.updateClip);
  const updateCompositionHtml = useStudio((s) => s.updateCompositionHtml);
  const remove = useStudio((s) => s.removeClip);
  const registerCharacterPreset = useStudio((s) => s.registerCharacterPreset);
  const clip = clips.find((c) => c.id === id);
  const characterClip = isCharacterCompositionClip(clip) ? clip : null;
  const characterId = characterClip?.character.characterId;
  const character = useLiveQuery<CharacterPreset | undefined>(
    () => (characterId ? db.characters.get(characterId) : Promise.resolve(undefined)),
    [characterId],
  );

  useEffect(() => {
    if (character) registerCharacterPreset(character);
  }, [character, registerCharacterPreset]);

  if (!project) return null;

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Inspector
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!clip && (
          <div className="text-xs text-muted-foreground">
            Select a clip on the stage or timeline to edit its properties.
          </div>
        )}
        {clip && (
          <div className="space-y-3 text-xs">
            <Field label="Name">
              <input
                value={clip.name}
                onChange={(e) => update(clip.id, { name: e.target.value })}
                className="w-full rounded border border-border bg-input px-2 py-1 text-foreground"
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Start (s)">
                <NumberInput
                  value={clip.start}
                  step={0.1}
                  onChange={(v) => update(clip.id, { start: Math.max(0, v) })}
                />
              </Field>
              <Field label="Duration (s)">
                <NumberInput
                  value={clip.duration}
                  step={0.1}
                  onChange={(v) => update(clip.id, { duration: Math.max(0.1, v) })}
                />
              </Field>
              <Field label="X">
                <NumberInput value={clip.x} onChange={(v) => update(clip.id, { x: v })} />
              </Field>
              <Field label="Y">
                <NumberInput value={clip.y} onChange={(v) => update(clip.id, { y: v })} />
              </Field>
              <Field label="Width">
                <NumberInput value={clip.width} onChange={(v) => update(clip.id, { width: v })} />
              </Field>
              <Field label="Height">
                <NumberInput value={clip.height} onChange={(v) => update(clip.id, { height: v })} />
              </Field>
              <Field label="Rotation°">
                <NumberInput
                  value={clip.rotation}
                  onChange={(v) => update(clip.id, { rotation: v })}
                />
              </Field>
              <Field label="Opacity">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={clip.opacity}
                  onChange={(e) => update(clip.id, { opacity: Number(e.target.value) })}
                  className="w-full"
                />
              </Field>
              <Field label="Z-Index">
                <NumberInput value={clip.zIndex} onChange={(v) => update(clip.id, { zIndex: v })} />
              </Field>
              <Field label="Track">
                <select
                  value={clip.trackIndex}
                  onChange={(e) => update(clip.id, { trackIndex: Number(e.target.value) })}
                  className="w-full rounded border border-border bg-input px-2 py-1 text-foreground"
                >
                  {tracks.map((t, i) => (
                    <option key={t.id} value={i}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {clip.kind === "text" && (
              <TextInspector
                clip={clip as TextClip}
                update={(patch) => update(clip.id, patch as Partial<TextClip>)}
              />
            )}
            {clip.kind === "composition" &&
              clip.compositionId &&
              !isCharacterCompositionClip(clip) && (
                <CompositionSourceInspector
                  clip={clip}
                  source={project.hf.compositionHtml[clip.compositionId] ?? ""}
                  projectWidth={project.hf.width}
                  projectHeight={project.hf.height}
                  onApply={(html) => updateCompositionHtml(clip.compositionId!, html)}
                />
              )}
            {isPrimitiveSourceClip(clip) && (
              <RootElementSourceInspector clip={clip} rootHtml={project.hf.rootHtml} />
            )}
            <button
              onClick={() => {
                remove(clip.id);
              }}
              className="w-full rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:opacity-90"
            >
              Delete clip
            </button>
            {characterClip && (
              <>
                <div className="rounded border border-border bg-panel-2 p-3">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={characterClip.character.autoBlink !== false}
                      onChange={(e) =>
                        update(characterClip.id, {
                          character: {
                            ...characterClip.character,
                            autoBlink: e.target.checked,
                          },
                        } as Partial<CompositionClip>)
                      }
                    />
                    Auto blink
                  </label>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    Adds a subtle regular blink during playback when the eyes are otherwise open.
                  </p>
                </div>
                {character && (
                  <MotionPanel
                    clip={characterClip as CharacterCompositionClip}
                    character={character}
                  />
                )}
                <VoiceLipSyncPanel clip={characterClip as CharacterCompositionClip} />
              </>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-border p-3 text-xs">
        <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
          Project
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Name">
            <input
              value={project.name}
              onChange={(e) => useStudio.getState().setProjectMeta({ name: e.target.value })}
              className="w-full rounded border border-border bg-input px-2 py-1 text-foreground"
            />
          </Field>
          <Field label="Duration (s)">
            <NumberInput
              value={project.hf.duration}
              onChange={(v) => useStudio.getState().setProjectMeta({ duration: Math.max(1, v) })}
            />
          </Field>
          <Field label="Width">
            <NumberInput
              value={project.hf.width}
              onChange={(v) => useStudio.getState().setProjectMeta({ width: v })}
            />
          </Field>
          <Field label="Height">
            <NumberInput
              value={project.hf.height}
              onChange={(v) => useStudio.getState().setProjectMeta({ height: v })}
            />
          </Field>
          <Field label="FPS">
            <NumberInput
              value={project.hf.fps}
              onChange={(v) => useStudio.getState().setProjectMeta({ fps: v })}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

function RootElementSourceInspector({ clip, rootHtml }: { clip: EditorClip; rootHtml: string }) {
  const source = useMemo(() => readRootElementSource(rootHtml, clip.id), [rootHtml, clip.id]);

  return (
    <div className="rounded border border-border bg-panel-2 p-3">
      <div className="mb-2 flex items-center gap-2">
        <div className="font-semibold uppercase tracking-wider text-muted-foreground">Source</div>
        <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
          rootHtml element
        </span>
      </div>
      <textarea
        value={source ?? `Element "${clip.id}" was not found in project.hf.rootHtml.`}
        readOnly
        rows={6}
        spellCheck={false}
        className="w-full resize-y rounded border border-border bg-input px-2 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground"
      />
      {source && (
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(source)}
          className="mt-2 rounded border border-border px-2 py-1 text-[10px] text-foreground hover:bg-panel"
        >
          Copy source
        </button>
      )}
    </div>
  );
}

function CompositionSourceInspector({
  clip,
  source,
  projectWidth,
  projectHeight,
  onApply,
}: {
  clip: EditorClip & { kind: "composition"; compositionId: string };
  source: string;
  projectWidth: number;
  projectHeight: number;
  onApply: (html: string) => void;
}) {
  const [draft, setDraft] = useState(source);
  const [errors, setErrors] = useState<string[]>([]);
  const [validatedHtml, setValidatedHtml] = useState<string | null>(null);
  const validationDefaults = useMemo(
    () => ({
      compositionId: clip.compositionId,
      duration: clip.duration,
      width: clip.width || projectWidth,
      height: clip.height || projectHeight,
    }),
    [clip.compositionId, clip.duration, clip.width, clip.height, projectWidth, projectHeight],
  );
  const storedValidation = useMemo(
    () => validateCompositionSourceHtml(source, validationDefaults),
    [source, validationDefaults],
  );
  const isEditingStoredSource = draft === source;

  useEffect(() => {
    setDraft(source);
    setErrors([]);
    setValidatedHtml(null);
  }, [source, clip.compositionId]);

  const validate = () => {
    const result = validateCompositionSourceHtml(draft, validationDefaults);
    setErrors(result.errors);
    setValidatedHtml(result.ok && result.html ? result.html : null);
    return result;
  };

  const apply = () => {
    if (!validatedHtml) return;
    try {
      onApply(validatedHtml);
      setValidatedHtml(null);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
      setValidatedHtml(null);
    }
  };

  return (
    <div className="rounded border border-border bg-panel-2 p-3">
      <div className="mb-2 flex items-center gap-2">
        <div className="font-semibold uppercase tracking-wider text-muted-foreground">Source</div>
        <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
          {clip.compositionId}
        </span>
      </div>
      <textarea
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setErrors([]);
          setValidatedHtml(null);
        }}
        rows={10}
        spellCheck={false}
        className="w-full resize-y rounded border border-border bg-input px-2 py-2 font-mono text-[11px] leading-relaxed text-foreground"
      />
      {!storedValidation.ok && isEditingStoredSource && errors.length === 0 && (
        <div className="mt-2 rounded border border-red-400/60 bg-red-500/10 p-2 text-[11px] text-red-100">
          <div className="font-semibold">Stored source is malformed.</div>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {storedValidation.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard?.writeText(
                buildCompositionRepairPrompt(storedValidation.errors, source),
              )
            }
            className="mt-2 rounded border border-red-300/60 px-2 py-1 text-[10px] hover:bg-red-500/20"
          >
            Copy repair prompt
          </button>
        </div>
      )}
      {errors.length > 0 && (
        <div className="mt-2 rounded border border-destructive/60 bg-destructive/10 p-2 text-[11px] text-destructive-foreground">
          <ul className="list-inside list-disc space-y-0.5">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard?.writeText(buildCompositionRepairPrompt(errors, draft))
            }
            className="mt-2 rounded border border-destructive/60 px-2 py-1 text-[10px] hover:bg-destructive/20"
          >
            Copy repair prompt
          </button>
        </div>
      )}
      {validatedHtml && (
        <div className="mt-2 rounded border border-primary/50 bg-primary/10 px-2 py-1 text-[11px] text-foreground">
          Source is valid. Apply to update project.hf.compositionHtml.
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={validate}
          className="flex-1 rounded border border-border px-2 py-1.5 text-xs text-foreground hover:bg-panel"
        >
          Validate
        </button>
        <button
          type="button"
          onClick={apply}
          disabled={!validatedHtml}
          className="flex-1 rounded bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

function isPrimitiveSourceClip(clip: EditorClip): boolean {
  return (
    clip.kind === "image" || clip.kind === "video" || clip.kind === "audio" || clip.kind === "text"
  );
}

function readRootElementSource(rootHtml: string, elementId: string): string | null {
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(rootHtml, "text/html");
  return doc.getElementById(elementId)?.outerHTML ?? null;
}

function TextInspector({
  clip,
  update,
}: {
  clip: TextClip;
  update: (patch: Partial<TextClip>) => void;
}) {
  return (
    <div className="rounded border border-border bg-panel-2 p-3">
      <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">Text</div>
      <div className="space-y-2">
        <Field label="Content">
          <textarea
            value={clip.content ?? ""}
            rows={3}
            onChange={(e) => update({ content: e.target.value })}
            className="w-full resize-none rounded border border-border bg-input px-2 py-1 text-foreground"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Color">
            <div className="flex gap-1">
              <input
                type="color"
                value={clip.color ?? "#f8fafc"}
                onChange={(e) => update({ color: e.target.value })}
                className="h-7 w-9 shrink-0 rounded border border-border bg-input p-0.5"
              />
              <input
                value={clip.color ?? "#f8fafc"}
                onChange={(e) => update({ color: e.target.value })}
                className="min-w-0 flex-1 rounded border border-border bg-input px-2 py-1 font-mono text-[11px] text-foreground"
              />
            </div>
          </Field>
          <Field label="Size">
            <NumberInput
              value={clip.fontSize ?? 48}
              min={8}
              onChange={(v) => update({ fontSize: Math.max(8, v) })}
            />
          </Field>
          <Field label="Family">
            <select
              value={clip.fontFamily ?? "Inter"}
              onChange={(e) => update({ fontFamily: e.target.value })}
              className="w-full rounded border border-border bg-input px-2 py-1 text-foreground"
            >
              <option value="Inter">Inter</option>
              <option value="Arial">Arial</option>
              <option value="Georgia">Georgia</option>
              <option value="Times New Roman">Times New Roman</option>
              <option value="Courier New">Courier New</option>
            </select>
          </Field>
          <Field label="Weight">
            <select
              value={clip.fontWeight ?? 700}
              onChange={(e) => update({ fontWeight: Number(e.target.value) })}
              className="w-full rounded border border-border bg-input px-2 py-1 text-foreground"
            >
              <option value={400}>Regular</option>
              <option value={500}>Medium</option>
              <option value={600}>Semibold</option>
              <option value={700}>Bold</option>
              <option value={800}>Heavy</option>
            </select>
          </Field>
        </div>
        <label className="flex items-center gap-2 rounded border border-border bg-panel px-2 py-1.5 text-xs text-foreground">
          <input
            type="checkbox"
            checked={clip.fitToBounds === true}
            onChange={(e) => update({ fitToBounds: e.target.checked })}
          />
          Fit to bounds
        </label>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  step = 1,
  disabled = false,
  min,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  disabled?: boolean;
  min?: number;
}) {
  const [draft, setDraft] = useState(formatNumberInputValue(value));

  useEffect(() => {
    setDraft(formatNumberInputValue(value));
  }, [value]);

  const commit = (nextDraft: string) => {
    const trimmed = nextDraft.trim();
    if (trimmed === "" || trimmed === "-" || trimmed === "." || trimmed === "-.") return;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) onChange(parsed);
  };

  return (
    <input
      type="number"
      value={draft}
      step={step}
      min={min}
      disabled={disabled}
      onChange={(e) => {
        setDraft(e.target.value);
        commit(e.target.value);
      }}
      onBlur={() => {
        const trimmed = draft.trim();
        if (trimmed === "" || !Number.isFinite(Number(trimmed))) {
          setDraft(formatNumberInputValue(value));
        }
      }}
      className="w-full rounded border border-border bg-input px-2 py-1 text-foreground disabled:cursor-not-allowed disabled:opacity-60"
    />
  );
}

function formatNumberInputValue(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "";
}
