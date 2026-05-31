// Inspector — edits the currently selected clip's properties.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { usePlayerStore } from "@hyperframes/studio";
import { Plus } from "lucide-react";
import { db } from "../db";
import { useStudio } from "../store";
import type {
  CharacterCompositionClip,
  ClipKeyframeSelection,
  CharacterPreset,
  CompositionClip,
  EditorClip,
  Project,
  TextClip,
} from "../types";
import { deriveEditorClips, isCharacterCompositionClip } from "../types";
import { VoiceLipSyncPanel } from "./VoiceLipSyncPanel";
import { MotionPanel } from "./MotionPanel";
import {
  buildCompositionRepairPrompt,
  validateCompositionSourceHtml,
} from "../hyperframes/composition-source";
import { buildCompositionPreviewProject } from "../hyperframes/composition-preview-project";
import {
  keyframeDisplayValues,
  sampleClipKeyframedState,
  type ClipKeyframeDisplayValues,
  type ClipKeyframeProperty,
  type ClipMotionCheckpoint,
} from "../hyperframes/keyframes";
import { HyperFramesPreviewPanel } from "./HyperFramesPreviewPanel";

export function Inspector({ seek }: { seek?: (time: number) => void }) {
  const project = useStudio((s) => s.project);
  const clips = useMemo(() => (project ? deriveEditorClips(project) : []), [project]);
  const tracks = useStudio((s) => s.tracks);
  const id = useStudio((s) => s.selectedClipId);
  const update = useStudio((s) => s.updateClip);
  const updateCompositionHtml = useStudio((s) => s.updateCompositionHtml);
  const selectedKeyframe = useStudio((s) => s.selectedKeyframe);
  const selectKeyframe = useStudio((s) => s.selectKeyframe);
  const addClipMotionStep = useStudio((s) => s.addClipMotionStep);
  const addClipMotionCheckpoint = useStudio((s) => s.addClipMotionCheckpoint);
  const updateClipKeyframe = useStudio((s) => s.updateClipKeyframe);
  const moveClipMotionCheckpoint = useStudio((s) => s.moveClipMotionCheckpoint);
  const renameClipMotionStep = useStudio((s) => s.renameClipMotionStep);
  const removeClipMotionCheckpoint = useStudio((s) => s.removeClipMotionCheckpoint);
  const removeClipMotionStep = useStudio((s) => s.removeClipMotionStep);
  const remove = useStudio((s) => s.removeClip);
  const registerCharacterPreset = useStudio((s) => s.registerCharacterPreset);
  const clip = clips.find((c) => c.id === id);
  const characterClip = isCharacterCompositionClip(clip) ? clip : null;
  const currentTime = usePlayerStore((s) => s.currentTime);
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
            {clip.kind !== "audio" && (
              <MotionInspector
                clip={clip}
                currentTime={currentTime}
                selectedKeyframe={selectedKeyframe?.clipId === clip.id ? selectedKeyframe : null}
                onSelectKeyframe={selectKeyframe}
                onSeek={(time) => seek?.(clip.start + time)}
                onAddMotion={(time) => {
                  const selection = addClipMotionStep(clip.id, time);
                  if (selection) selectKeyframe(selection);
                }}
                onAddCheckpoint={(motionId, time) => {
                  const selection = addClipMotionCheckpoint(clip.id, motionId, time);
                  if (selection) selectKeyframe(selection);
                  return selection;
                }}
                onUpdateKeyframe={updateClipKeyframe}
                onMoveCheckpoint={moveClipMotionCheckpoint}
                onRenameMotion={renameClipMotionStep}
                onRemoveCheckpoint={removeClipMotionCheckpoint}
                onRemoveMotion={removeClipMotionStep}
              />
            )}
            {(() => {
              if (clip.kind !== "composition" || !clip.compositionId) return null;
              if (isCharacterCompositionClip(clip)) return null;
              const compositionClip = clip as EditorClip & {
                kind: "composition";
                compositionId: string;
              };
              return (
                <CompositionSourceInspector
                  project={project}
                  clip={compositionClip}
                  source={project.hf.compositionHtml[compositionClip.compositionId] ?? ""}
                  projectWidth={project.hf.width}
                  projectHeight={project.hf.height}
                  onApply={(html) => updateCompositionHtml(compositionClip.compositionId, html)}
                />
              );
            })()}
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

const MOTION_FEELS = [
  { id: "gentle", label: "Gentle", ease: "power2.out" },
  { id: "smooth", label: "Smooth", ease: "power2.inOut" },
  { id: "steady", label: "Steady", ease: "none" },
  { id: "snappy", label: "Snappy", ease: "power3.out" },
  { id: "bounce", label: "Bounce", ease: "back.out" },
] as const;

function MotionInspector({
  clip,
  currentTime,
  selectedKeyframe,
  onSelectKeyframe,
  onSeek,
  onAddMotion,
  onAddCheckpoint,
  onUpdateKeyframe,
  onMoveCheckpoint,
  onRenameMotion,
  onRemoveCheckpoint,
  onRemoveMotion,
}: {
  clip: EditorClip;
  currentTime: number;
  selectedKeyframe: ClipKeyframeSelection | null;
  onSelectKeyframe: (selection: ClipKeyframeSelection | null) => void;
  onSeek: (time: number) => void;
  onAddMotion: (time: number) => void;
  onAddCheckpoint: (motionId: string, time: number) => ClipKeyframeSelection | null;
  onUpdateKeyframe: (
    selection: ClipKeyframeSelection,
    patch: ClipKeyframeDisplayValues & { ease?: string },
  ) => void;
  onMoveCheckpoint: (
    clipId: string,
    motionId: string,
    checkpointId: string,
    time: number,
  ) => ClipKeyframeSelection | null;
  onRenameMotion: (clipId: string, motionId: string, name: string) => void;
  onRemoveCheckpoint: (clipId: string, motionId: string, checkpointId: string) => void;
  onRemoveMotion: (clipId: string, motionId: string) => void;
}) {
  const selectedMotion = selectedKeyframe
    ? clip.motionSteps.find((motion) => motion.checkpointIds.includes(selectedKeyframe.keyframeId))
    : null;
  const selectedCheckpoint =
    selectedMotion && selectedKeyframe
      ? selectedMotion.checkpoints.find(
          (checkpoint) => checkpoint.id === selectedKeyframe.keyframeId,
        )
      : null;
  const selectedCheckpointIndex =
    selectedMotion && selectedCheckpoint
      ? selectedMotion.checkpoints.findIndex(
          (checkpoint) => checkpoint.id === selectedCheckpoint.id,
        )
      : -1;
  const keyframe = selectedKeyframe
    ? clip.keyframes.find((candidate) => candidate.id === selectedKeyframe.keyframeId)
    : null;
  const localPlayheadTime = Math.max(0, Math.min(clip.duration, currentTime - clip.start));
  const selectedValues = keyframe ? keyframeDisplayValues(clip, keyframe) : {};
  const previewState = sampleClipKeyframedState(clip, localPlayheadTime);
  const previewSummary = `${Math.round(previewState.x)}, ${Math.round(previewState.y)}`;
  const canRemoveCheckpoint =
    selectedMotion &&
    selectedCheckpoint &&
    selectedMotion.checkpoints.length > 2 &&
    selectedCheckpointIndex > 0 &&
    selectedCheckpointIndex < selectedMotion.checkpoints.length - 1;
  const addPointToMotion = (motion: EditorClip["motionSteps"][number]) => {
    const time = pointTimeForMotion(motion, localPlayheadTime);
    const selection = onAddCheckpoint(motion.id, time);
    if (selection) {
      onSelectKeyframe(selection);
      onSeek(time);
    }
  };

  return (
    <div className="rounded border border-border bg-panel-2 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-semibold uppercase tracking-wider text-muted-foreground">Motion</div>
        {selectedKeyframe && (
          <button
            type="button"
            onClick={() => onSelectKeyframe(null)}
            className="rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-panel hover:text-foreground"
          >
            Done
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => onAddMotion(localPlayheadTime)}
        className="mb-2 w-full rounded border border-border bg-panel px-2 py-1.5 text-[11px] font-medium text-foreground hover:bg-panel-2"
        title={`Add motion at ${localPlayheadTime.toFixed(1)}s near ${previewSummary}`}
      >
        + Motion
      </button>

      {clip.motionSteps.length > 0 && (
        <div className="mb-2 space-y-1">
          {clip.motionSteps.map((motion) => {
            const selected = selectedMotion?.id === motion.id;
            return (
              <div
                key={motion.id}
                className={`rounded border p-2 ${
                  selected ? "border-primary bg-primary/10" : "border-border bg-panel"
                }`}
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const checkpoint = motion.checkpoints[motion.checkpoints.length - 1];
                      onSelectKeyframe(selectionForMotionCheckpoint(clip.id, checkpoint));
                      if (checkpoint) onSeek(checkpoint.time);
                    }}
                    className="min-w-0 flex-1 truncate text-left text-[11px] font-medium text-foreground"
                  >
                    {motion.label}
                  </button>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {motion.startTime.toFixed(1)}-{motion.endTime.toFixed(1)}s
                  </span>
                  <button
                    type="button"
                    onClick={() => addPointToMotion(motion)}
                    className="flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-primary/60 hover:bg-primary/10 hover:text-foreground"
                    title={`Add point at ${pointTimeForMotion(motion, localPlayheadTime).toFixed(
                      1,
                    )}s`}
                  >
                    <Plus size={11} />
                    Point
                  </button>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {motion.checkpoints.map((checkpoint) => (
                    <button
                      key={checkpoint.id}
                      type="button"
                      onClick={() => {
                        onSelectKeyframe(selectionForMotionCheckpoint(clip.id, checkpoint));
                        onSeek(checkpoint.time);
                      }}
                      className={`rounded border px-2 py-0.5 text-[10px] ${
                        selected && selectedKeyframe?.keyframeId === checkpoint.id
                          ? "border-primary bg-primary/20 text-foreground"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {checkpoint.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedMotion && selectedCheckpoint && keyframe ? (
        <div className="space-y-2 rounded border border-border bg-panel p-2">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
              {selectedMotion.label} {selectedCheckpoint.label}
            </span>
            <button
              type="button"
              onClick={() => addPointToMotion(selectedMotion)}
              className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-muted-foreground hover:border-primary/60 hover:bg-primary/10 hover:text-foreground"
            >
              <Plus size={11} />
              Point
            </button>
            {canRemoveCheckpoint && (
              <button
                type="button"
                onClick={() =>
                  onRemoveCheckpoint(clip.id, selectedMotion.id, selectedCheckpoint.id)
                }
                className="text-muted-foreground hover:text-foreground"
              >
                Delete point
              </button>
            )}
            <button
              type="button"
              onClick={() => onRemoveMotion(clip.id, selectedMotion.id)}
              className="text-destructive"
            >
              Delete
            </button>
          </div>
          <Field label="Motion name">
            <input
              value={selectedMotion.name ?? ""}
              placeholder="Motion"
              onChange={(event) => onRenameMotion(clip.id, selectedMotion.id, event.target.value)}
              className="w-full rounded border border-border bg-input px-2 py-1 text-foreground"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Point time (s)">
              <NumberInput
                value={selectedCheckpoint.time}
                min={0}
                step={0.05}
                onChange={(value) => {
                  const selection = onMoveCheckpoint(
                    clip.id,
                    selectedMotion.id,
                    selectedCheckpoint.id,
                    Math.max(0, Math.min(clip.duration, value)),
                  );
                  if (selection) {
                    onSelectKeyframe(selection);
                    onSeek(Math.max(0, Math.min(clip.duration, value)));
                  }
                }}
              />
            </Field>
            <Field label="Span">
              <div className="rounded border border-border bg-input px-2 py-1 text-foreground">
                {selectedMotion.startTime.toFixed(1)}-{selectedMotion.endTime.toFixed(1)}s
              </div>
            </Field>
            <Field label="Feel">
              <select
                value={feelForEase(selectedCheckpoint.ease)}
                onChange={(event) =>
                  onUpdateKeyframe(
                    selectionForMotionCheckpointProperty(clip.id, selectedCheckpoint, "position"),
                    { ease: easeForFeel(event.target.value) },
                  )
                }
                className="w-full rounded border border-border bg-input px-2 py-1 text-foreground"
              >
                {MOTION_FEELS.map((feel) => (
                  <option key={feel.id} value={feel.id}>
                    {feel.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <MotionValueFields
            clip={clip}
            values={selectedValues}
            onChange={(property, values) =>
              onUpdateKeyframe(
                selectionForMotionCheckpointProperty(clip.id, selectedCheckpoint, property),
                values,
              )
            }
          />
        </div>
      ) : (
        <div className="rounded border border-dashed border-border p-2 text-center text-[11px] text-muted-foreground">
          No motion selected.
        </div>
      )}
    </div>
  );
}

function MotionValueFields({
  clip,
  values,
  onChange,
}: {
  clip: EditorClip;
  values: ClipKeyframeDisplayValues;
  onChange: (property: ClipKeyframeProperty, values: ClipKeyframeDisplayValues) => void;
}) {
  const x = values.x ?? clip.x;
  const y = values.y ?? clip.y;
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Left">
        <NumberInput value={x} onChange={(nextX) => onChange("position", { x: nextX, y })} />
      </Field>
      <Field label="Top">
        <NumberInput value={y} onChange={(nextY) => onChange("position", { x, y: nextY })} />
      </Field>
      <Field label="Size">
        <NumberInput
          value={values.scale ?? 1}
          min={0.01}
          step={0.05}
          onChange={(scale) => onChange("scale", { scale: Math.max(0.01, scale) })}
        />
      </Field>
      <Field label="Angle°">
        <NumberInput
          value={values.rotation ?? clip.rotation}
          step={1}
          onChange={(rotation) => onChange("rotation", { rotation })}
        />
      </Field>
      <Field label="Visible">
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={values.opacity ?? clip.opacity}
          onChange={(event) => onChange("opacity", { opacity: Number(event.target.value) })}
          className="w-full"
        />
      </Field>
    </div>
  );
}

function pointTimeForMotion(motion: EditorClip["motionSteps"][number], localPlayheadTime: number) {
  const inset = Math.min(0.1, Math.max(0, (motion.endTime - motion.startTime) / 4));
  const min = motion.startTime + inset;
  const max = motion.endTime - inset;
  const fallback = motion.startTime + (motion.endTime - motion.startTime) / 2;
  const time = max > min ? Math.max(min, Math.min(max, localPlayheadTime)) : fallback;
  return Math.round(time * 100) / 100;
}

function selectionForMotionCheckpoint(
  clipId: string,
  checkpoint: ClipMotionCheckpoint | undefined,
): ClipKeyframeSelection | null {
  if (!checkpoint) return null;
  return {
    clipId,
    keyframeId: checkpoint.id,
    property: "position",
  };
}

function selectionForMotionCheckpointProperty(
  clipId: string,
  checkpoint: ClipMotionCheckpoint,
  property: ClipKeyframeProperty,
): ClipKeyframeSelection {
  return {
    clipId,
    keyframeId: checkpoint.id,
    property,
  };
}

function feelForEase(ease: string | undefined): string {
  return MOTION_FEELS.find((feel) => feel.ease === (ease ?? "power2.out"))?.id ?? "gentle";
}

function easeForFeel(id: string): string {
  const ease = MOTION_FEELS.find((feel) => feel.id === id)?.ease ?? "power2.out";
  return ease === "none" ? "" : ease;
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
  project,
  clip,
  source,
  projectWidth,
  projectHeight,
  onApply,
}: {
  project: Project;
  clip: EditorClip & { kind: "composition"; compositionId: string };
  source: string;
  projectWidth: number;
  projectHeight: number;
  onApply: (html: string) => void;
}) {
  const [draft, setDraft] = useState(source);
  const [errors, setErrors] = useState<string[]>([]);
  const [validated, setValidated] = useState<ReturnType<
    typeof validateCompositionSourceForClip
  > | null>(null);
  const [previewProject, setPreviewProject] = useState<Project | null>(null);
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
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
    () => validateCompositionSourceForClip(source, clip.compositionId, validationDefaults),
    [clip.compositionId, source, validationDefaults],
  );
  const isEditingStoredSource = draft === source;
  const validatedHtml = validated?.ok && validated.html ? validated.html : null;
  const canPreview = Boolean(validatedHtml);
  const canApply = Boolean(validatedHtml && previewStatus === "ready");
  const handlePreviewStatusChange = useCallback(
    (status: "idle" | "loading" | "ready" | "error") => setPreviewStatus(status),
    [],
  );

  useEffect(() => {
    setDraft(source);
    setErrors([]);
    setValidated(null);
    setPreviewProject(null);
    setPreviewStatus("idle");
  }, [source, clip.compositionId]);

  const validate = () => {
    const result = validateCompositionSourceForClip(draft, clip.compositionId, validationDefaults);
    setErrors(result.errors);
    setValidated(result.ok && result.html ? result : null);
    setPreviewProject(null);
    setPreviewStatus("idle");
    return result;
  };

  const preview = () => {
    if (!validated?.ok || !validated.html) return;
    setPreviewProject(buildCompositionPreviewProject(project, validated));
  };

  const apply = () => {
    if (!validatedHtml || previewStatus !== "ready") return;
    try {
      onApply(validatedHtml);
      setValidated(null);
      setPreviewProject(null);
      setPreviewStatus("idle");
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
      setValidated(null);
      setPreviewProject(null);
      setPreviewStatus("idle");
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
          setValidated(null);
          setPreviewProject(null);
          setPreviewStatus("idle");
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
          Source is valid. Preview it before updating project.hf.compositionHtml.
        </div>
      )}
      {previewProject && (
        <div className="mt-2">
          <HyperFramesPreviewPanel
            project={previewProject}
            width={(validated?.width ?? clip.width) || projectWidth}
            height={(validated?.height ?? clip.height) || projectHeight}
            seekTime={Math.min((validated?.duration ?? clip.duration) * 0.35, 1)}
            title={`Preview ${clip.compositionId}`}
            onStatusChange={handlePreviewStatusChange}
          />
        </div>
      )}
      <div className="mt-2 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={validate}
          className="rounded border border-border px-2 py-1.5 text-xs text-foreground hover:bg-panel"
        >
          Validate
        </button>
        <button
          type="button"
          onClick={preview}
          disabled={!canPreview}
          className="rounded border border-border px-2 py-1.5 text-xs text-foreground hover:bg-panel disabled:cursor-not-allowed disabled:opacity-50"
        >
          Preview
        </button>
        <button
          type="button"
          onClick={apply}
          disabled={!canApply}
          className="rounded bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
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

function validateCompositionSourceForClip(
  html: string,
  expectedCompositionId: string,
  defaults: Parameters<typeof validateCompositionSourceHtml>[1],
) {
  const result = validateCompositionSourceHtml(html, defaults);
  if (result.ok && result.compositionId !== expectedCompositionId) {
    return {
      ...result,
      ok: false,
      html: undefined,
      errors: [
        ...result.errors,
        `Composition source id "${result.compositionId ?? "(missing)"}" must match "${expectedCompositionId}".`,
      ],
    };
  }
  return result;
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
