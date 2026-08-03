// Inspector — edits the currently selected clip's properties.
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { usePlayerStore } from "@hyperframes/studio";
import {
  Clock3,
  Code2,
  Layers,
  Lock,
  Mic2,
  Move,
  Paintbrush,
  Plus,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Type,
  Unlock,
  Volume2,
  WandSparkles,
} from "lucide-react";
import { loadCharacter } from "../character/character-persistence";
import { readStudioElementHtml } from "../hyperframes/html";
import { useStudio } from "../store";
import type {
  AnyClip,
  CharacterCompositionClip,
  ClipKeyframeSelection,
  CharacterPreset,
  CompositionClip,
  EditorClip,
  Project,
  TextClip,
  TrackMeta,
} from "../types";
import { deriveEditorClips, isCharacterCompositionClip } from "../types";
import { VoiceLipSyncPanel } from "./VoiceLipSyncPanel";
import { MotionPanel } from "./MotionPanel";
import {
  buildCompositionRepairPrompt,
  validateCompositionSourceHtml,
  validateCompositionSourceHtmlSync,
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
import { SourceTrustConfirmation } from "./SourceTrustConfirmation";
import { buildSceneEditingProject } from "../scenes";

type InspectorTab = "clip" | "speech" | "move" | "acting" | "advanced";
type ClipUpdater = (patch: Partial<AnyClip>) => void;
type IconComponent = ComponentType<{ size?: number; className?: string }>;

export function Inspector({ seek }: { seek?: (time: number) => void }) {
  const rootProject = useStudio((s) => s.project);
  const activeSceneId = useStudio((s) => s.activeSceneId);
  const project = useMemo(
    () => (rootProject ? buildSceneEditingProject(rootProject, activeSceneId) : null),
    [activeSceneId, rootProject],
  );
  const clips = useMemo(() => (project ? deriveEditorClips(project) : []), [project]);
  const tracks = useStudio((s) => s.tracks);
  const id = useStudio((s) => s.selectedClipId);
  const update = useStudio((s) => s.updateClip);
  const updateCompositionHtml = useStudio((s) => s.updateCompositionHtml);
  const selectedKeyframe = useStudio((s) => s.selectedKeyframe);
  const selectKeyframe = useStudio((s) => s.selectKeyframe);
  const speechFocusRequest = useStudio((s) => s.speechFocusRequest);
  const addClipMotionStep = useStudio((s) => s.addClipMotionStep);
  const addClipMotionCheckpoint = useStudio((s) => s.addClipMotionCheckpoint);
  const updateClipKeyframe = useStudio((s) => s.updateClipKeyframe);
  const moveClipMotionCheckpoint = useStudio((s) => s.moveClipMotionCheckpoint);
  const renameClipMotionStep = useStudio((s) => s.renameClipMotionStep);
  const removeClipMotionCheckpoint = useStudio((s) => s.removeClipMotionCheckpoint);
  const removeClipMotionStep = useStudio((s) => s.removeClipMotionStep);
  const setMotionStepPathStyle = useStudio((s) => s.setClipMotionStepPathStyle);
  const remove = useStudio((s) => s.removeClip);
  const registerCharacterPreset = useStudio((s) => s.registerCharacterPreset);
  const clip = clips.find((c) => c.id === id);
  const characterClip = isCharacterCompositionClip(clip) ? clip : null;
  const currentTime = usePlayerStore((s) => s.currentTime);
  const [activeTab, setActiveTab] = useState<InspectorTab>("clip");
  const characterId = characterClip?.character.characterId;
  const character = useLiveQuery<CharacterPreset | undefined>(
    () => (characterId ? loadCharacter(characterId) : Promise.resolve(undefined)),
    [characterId],
  );

  useEffect(() => {
    if (character) registerCharacterPreset(character);
  }, [character, registerCharacterPreset]);

  useEffect(() => {
    setActiveTab("clip");
  }, [clip?.id]);

  useEffect(() => {
    if (clip?.kind === "audio" && activeTab === "move") {
      setActiveTab("clip");
    }
    if (!characterClip && (activeTab === "speech" || activeTab === "acting")) {
      setActiveTab("clip");
    }
  }, [activeTab, characterClip, clip?.kind]);

  // Timeline "speech settings" shortcut: jump straight to the Speech tab. Declared
  // last so it wins over the clip-change reset above when both fire in one render.
  // Self-correcting: the guard effect resets to "clip" if the focused clip isn't a character.
  useEffect(() => {
    if (speechFocusRequest > 0) setActiveTab("speech");
  }, [speechFocusRequest]);

  if (!project || !rootProject) return null;

  return (
    <div className="flex h-full flex-col bg-panel">
      <InspectorHeader
        clip={clip}
        project={project}
        onRemove={() => {
          if (clip) remove(clip.id);
        }}
      />
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!clip ? (
          <div className="space-y-3 text-xs">
            <EmptyInspectorState />
            <ProjectSettingsPanel project={rootProject} />
          </div>
        ) : (
          <div className="space-y-3 text-xs">
            <InspectorTabs
              value={activeTab}
              canMove={clip.kind !== "audio"}
              canSpeak={!!characterClip}
              canAct={!!characterClip}
              onChange={setActiveTab}
            />

            {activeTab === "clip" && (
              <ClipInspectorTab clip={clip} onUpdate={(patch) => update(clip.id, patch)} />
            )}

            {activeTab === "speech" && characterClip && <VoiceLipSyncPanel clip={characterClip} />}

            {activeTab === "move" && clip.kind !== "audio" && (
              <MoveInspector
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
                onSetPathStyle={setMotionStepPathStyle}
                onRemoveCheckpoint={removeClipMotionCheckpoint}
                onRemoveMotion={removeClipMotionStep}
              />
            )}

            {activeTab === "acting" && characterClip && (
              <ActingInspectorTab
                characterClip={characterClip}
                character={character}
                onUpdate={(patch) => update(characterClip.id, patch)}
              />
            )}

            {activeTab === "advanced" && (
              <AdvancedInspectorTab
                clip={clip}
                project={project}
                tracks={tracks}
                onUpdate={(patch) => update(clip.id, patch)}
                updateCompositionHtml={updateCompositionHtml}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function InspectorHeader({
  clip,
  project,
  onRemove,
}: {
  clip: EditorClip | undefined;
  project: Project;
  onRemove: () => void;
}) {
  return (
    <div className="border-b border-border px-3 py-3">
      <div className="flex items-center gap-2">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-primary/35 bg-primary/15 text-primary">
          <WandSparkles size={16} />
        </div>
        <div className="min-w-0">
          <div className="text-ui-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Inspector
          </div>
          <div className="truncate text-sm font-semibold text-foreground">
            {clip?.name || (clip ? "Untitled clip" : project.name)}
          </div>
        </div>
      </div>
      {clip && (
        <div className="mt-2 flex items-center gap-2">
          <span className="rounded-full border border-border bg-panel-2 px-2 py-0.5 text-ui-sm font-medium uppercase tracking-wider text-muted-foreground">
            {clipKindLabel(clip)}
          </span>
          <span className="min-w-0 flex-1 truncate text-ui-sm text-muted-foreground">
            {clip.id}
          </span>
          {/* Deleting a clip is an everyday action, not an advanced one. It used to
              sit two levels down under "More" → "Danger". */}
          <button
            type="button"
            onClick={onRemove}
            title={`Delete ${clip.name || "this clip"}`}
            aria-label={`Delete ${clip.name || "this clip"}`}
            className="shrink-0 rounded border border-border p-1 text-muted-foreground hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

function EmptyInspectorState() {
  return (
    <PanelSection title="Ready" icon={Sparkles}>
      <div className="rounded-md border border-dashed border-border bg-background/30 px-3 py-4 text-center">
        <div className="mx-auto mb-2 grid h-9 w-9 place-items-center rounded-md bg-primary/15 text-primary">
          <SlidersHorizontal size={17} />
        </div>
        <div className="font-medium text-foreground">Pick a clip to shape it.</div>
      </div>
    </PanelSection>
  );
}

function InspectorTabs({
  value,
  canMove,
  canSpeak,
  canAct,
  onChange,
}: {
  value: InspectorTab;
  canMove: boolean;
  canSpeak: boolean;
  canAct: boolean;
  onChange: (value: InspectorTab) => void;
}) {
  const tabs: {
    id: InspectorTab;
    label: string;
    icon: IconComponent;
    title: string;
    disabled?: boolean;
  }[] = [
    { id: "clip", label: "Clip", icon: SlidersHorizontal, title: "Timing, frame, and look" },
    ...(canSpeak
      ? [{ id: "speech" as const, label: "Speech", icon: Mic2, title: "Voice and lip sync" }]
      : []),
    {
      id: "move",
      label: "Move",
      icon: Move,
      title: "Travel this clip across the canvas over time",
      disabled: !canMove,
    },
    ...(canAct
      ? [
          {
            id: "acting" as const,
            label: "Acting",
            icon: Sparkles,
            title: "Actions and expressions performed by this character",
          },
        ]
      : []),
    { id: "advanced", label: "More", icon: Settings2, title: "Layer, source, and delete" },
  ];
  // Five tabs in a 288px rail can't fit an icon and a readable label. Labels win.
  const showIcons = tabs.length < 5;

  return (
    <div
      className="grid gap-1 rounded-md border border-border bg-background/35 p-1"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map((tab) => {
        const selected = value === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            title={tab.title}
            className={`flex min-w-0 items-center justify-center gap-1 rounded px-1.5 py-1.5 text-ui-sm font-medium transition-colors ${
              selected
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-panel hover:text-foreground"
            } disabled:cursor-not-allowed disabled:opacity-35`}
          >
            {showIcons && <Icon size={13} />}
            <span className="truncate">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ClipInspectorTab({ clip, onUpdate }: { clip: EditorClip; onUpdate: ClipUpdater }) {
  return (
    <>
      <PanelSection title="Clip" icon={Clock3}>
        <div className="space-y-2">
          <Field label="Name">
            <input
              value={clip.name}
              onChange={(event) => onUpdate({ name: event.target.value })}
              className="w-full rounded border border-border bg-input px-2 py-1 text-foreground"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Start (s)">
              <NumberInput
                value={clip.start}
                step={0.1}
                onChange={(value) => onUpdate({ start: Math.max(0, value) })}
              />
            </Field>
            <Field label="Duration (s)">
              <NumberInput
                value={clip.duration}
                step={0.1}
                onChange={(value) => onUpdate({ duration: Math.max(0.1, value) })}
              />
            </Field>
          </div>
        </div>
      </PanelSection>

      {clip.kind === "audio" ? (
        <>
          <PanelSection title="Audio" icon={Volume2}>
            <RangeField
              label="Volume"
              value={clip.volume ?? 1}
              min={0}
              max={1}
              step={0.05}
              displayValue={`${Math.round((clip.volume ?? 1) * 100)}%`}
              onChange={(value) => onUpdate({ volume: value })}
            />
          </PanelSection>
          {clip.sourceDuration != null && (
            <PanelSection title="Trim" icon={Clock3}>
              <div className="grid grid-cols-2 gap-2">
                <Field label="In-point (s)">
                  <NumberInput
                    value={Number((clip.mediaStartTime ?? 0).toFixed(2))}
                    onChange={(v) => {
                      const max = Math.max(0, (clip.sourceDuration ?? 0) - clip.duration);
                      onUpdate({ mediaStartTime: Math.max(0, Math.min(max, v)) });
                    }}
                  />
                </Field>
                <Field label="Length (s)">
                  <NumberInput
                    value={Number(clip.duration.toFixed(2))}
                    onChange={(v) => {
                      const max = Math.max(
                        0.1,
                        (clip.sourceDuration ?? Infinity) - (clip.mediaStartTime ?? 0),
                      );
                      onUpdate({ duration: Math.max(0.1, Math.min(max, v)) });
                    }}
                  />
                </Field>
              </div>
              <div className="mt-1 text-ui-sm text-muted-foreground">
                Source length {clip.sourceDuration.toFixed(2)}s
              </div>
            </PanelSection>
          )}
        </>
      ) : (
        <>
          <PanelSection title="Frame" icon={Move}>
            <div className="grid grid-cols-2 gap-2">
              <Field label="X">
                <NumberInput value={clip.x} onChange={(value) => onUpdate({ x: value })} />
              </Field>
              <Field label="Y">
                <NumberInput value={clip.y} onChange={(value) => onUpdate({ y: value })} />
              </Field>
              <Field label="Width">
                <NumberInput value={clip.width} onChange={(value) => onUpdate({ width: value })} />
              </Field>
              <Field label="Height">
                <NumberInput
                  value={clip.height}
                  onChange={(value) => onUpdate({ height: value })}
                />
              </Field>
              <Field label="Rotation°">
                <NumberInput
                  value={clip.rotation}
                  onChange={(value) => onUpdate({ rotation: value })}
                />
              </Field>
            </div>
          </PanelSection>

          <PanelSection title="Look" icon={Paintbrush}>
            <RangeField
              label="Opacity"
              value={clip.opacity}
              min={0}
              max={1}
              step={0.05}
              displayValue={`${Math.round(clip.opacity * 100)}%`}
              onChange={(value) => onUpdate({ opacity: value })}
            />
          </PanelSection>
        </>
      )}

      {clip.kind === "text" && (
        <TextInspector
          clip={clip as TextClip}
          update={(patch) => onUpdate(patch as Partial<AnyClip>)}
        />
      )}
    </>
  );
}

function ActingInspectorTab({
  characterClip,
  character,
  onUpdate,
}: {
  characterClip: CharacterCompositionClip;
  character: CharacterPreset | undefined;
  onUpdate: ClipUpdater;
}) {
  const openModal = useStudio((s) => s.openModal);
  const characterId = characterClip.character.characterId;
  return (
    <>
      <PanelSection title="Character" icon={Sparkles}>
        <div className="space-y-2">
          <SwitchRow
            label="Auto blink"
            checked={characterClip.character.autoBlink !== false}
            onChange={(checked) =>
              onUpdate({
                character: {
                  ...characterClip.character,
                  autoBlink: checked,
                },
              } as Partial<CompositionClip>)
            }
          />
          {/* Rigging (bones, depths, camera angles) used to sit right here, but it
              writes to the shared character — every other clip using it changes too.
              That belongs in the Character Editor, where the change is obviously
              about the character rather than about this one clip. */}
          <button
            type="button"
            onClick={() => openModal({ type: "character-editor", characterId })}
            className="flex w-full items-center justify-center gap-2 rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-panel-2 hover:text-foreground"
            title="Edit artwork, rig, and poses — affects every clip using this character"
          >
            <SlidersHorizontal size={13} />
            Edit this character
          </button>
        </div>
      </PanelSection>
      {character && <MotionPanel clip={characterClip} character={character} />}
    </>
  );
}

function AdvancedInspectorTab({
  clip,
  project,
  tracks,
  onUpdate,
  updateCompositionHtml,
}: {
  clip: EditorClip;
  project: Project;
  tracks: TrackMeta[];
  onUpdate: ClipUpdater;
  updateCompositionHtml: (compositionId: string, html: string) => void;
}) {
  const toggleClipLock = useStudio((s) => s.toggleClipLock);
  const compositionClip =
    clip.kind === "composition" && clip.compositionId && !isCharacterCompositionClip(clip)
      ? (clip as EditorClip & { kind: "composition"; compositionId: string })
      : null;

  return (
    <>
      <PanelSection title="Layer" icon={Layers}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Z-index">
            <NumberInput value={clip.zIndex} onChange={(value) => onUpdate({ zIndex: value })} />
          </Field>
          <Field label="Track">
            <select
              value={clip.trackIndex}
              onChange={(event) => onUpdate({ trackIndex: Number(event.target.value) })}
              className="w-full rounded border border-border bg-input px-2 py-1 text-foreground"
            >
              {tracks.map((track, index) => (
                <option key={track.id} value={index}>
                  {track.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <button
          type="button"
          onClick={() => toggleClipLock(clip.id)}
          className={`mt-2 flex w-full items-center justify-center gap-2 rounded border px-3 py-1.5 text-xs font-medium ${
            clip.locked
              ? "border-primary/60 bg-primary/15 text-foreground"
              : "border-border text-muted-foreground hover:bg-panel-2 hover:text-foreground"
          }`}
          title="Locked layers ignore canvas clicks and drags (still selectable here and in the timeline)"
        >
          {clip.locked ? <Lock size={13} /> : <Unlock size={13} />}
          {clip.locked ? "Locked" : "Lock layer"}
        </button>
      </PanelSection>

      {compositionClip && (
        <CompositionSourceInspector
          project={project}
          clip={compositionClip}
          source={project.hf.compositionHtml[compositionClip.compositionId] ?? ""}
          projectWidth={project.hf.width}
          projectHeight={project.hf.height}
          onApply={(html) => updateCompositionHtml(compositionClip.compositionId, html)}
        />
      )}
      {isPrimitiveSourceClip(clip) && (
        <RootElementSourceInspector clip={clip} rootHtml={project.hf.rootHtml} />
      )}
    </>
  );
}

function ProjectSettingsPanel({ project }: { project: Project }) {
  return (
    <PanelSection title="Project" icon={Settings2}>
      <div className="space-y-2">
        <Field label="Name">
          <input
            value={project.name}
            onChange={(event) => useStudio.getState().setProjectMeta({ name: event.target.value })}
            className="w-full rounded border border-border bg-input px-2 py-1 text-foreground"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Duration (s)">
            <NumberInput
              value={project.hf.duration}
              onChange={(value) =>
                useStudio.getState().setProjectMeta({ duration: Math.max(1, value) })
              }
            />
          </Field>
          <Field label="FPS">
            <NumberInput
              value={project.hf.fps}
              onChange={(value) => useStudio.getState().setProjectMeta({ fps: value })}
            />
          </Field>
          <Field label="Width">
            <NumberInput
              value={project.hf.width}
              onChange={(value) => useStudio.getState().setProjectMeta({ width: value })}
            />
          </Field>
          <Field label="Height">
            <NumberInput
              value={project.hf.height}
              onChange={(value) => useStudio.getState().setProjectMeta({ height: value })}
            />
          </Field>
        </div>
      </div>
    </PanelSection>
  );
}

function PanelSection({
  title,
  icon: Icon,
  meta,
  children,
}: {
  title: string;
  icon: IconComponent;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-panel-2 p-3 shadow-[var(--shadow-panel)]">
      <div className="mb-3 flex items-center gap-2">
        <div className="grid h-6 w-6 shrink-0 place-items-center rounded bg-background/45 text-primary">
          <Icon size={13} />
        </div>
        <div className="min-w-0 flex-1 font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </div>
        {meta && <div className="min-w-0 truncate text-ui-sm text-muted-foreground">{meta}</div>}
      </div>
      {children}
    </section>
  );
}

function clipKindLabel(clip: EditorClip): string {
  if (isCharacterCompositionClip(clip)) return "Character";
  if (clip.kind === "composition") return clip.compositionKind ?? "Composition";
  return clip.kind;
}

const MOTION_FEELS = [
  { id: "gentle", label: "Gentle", ease: "power2.out" },
  { id: "smooth", label: "Smooth", ease: "power2.inOut" },
  { id: "steady", label: "Steady", ease: "none" },
  { id: "snappy", label: "Snappy", ease: "power3.out" },
  { id: "bounce", label: "Bounce", ease: "back.out" },
] as const;

function MoveInspector({
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
  onSetPathStyle,
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
  onSetPathStyle: (clipId: string, motionId: string, pathStyle: "linear" | "smooth") => void;
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
  const keyframe = selectedKeyframe
    ? clip.keyframes.find((candidate) => candidate.id === selectedKeyframe.keyframeId)
    : null;
  const localPlayheadTime = Math.max(0, Math.min(clip.duration, currentTime - clip.start));
  const selectedValues = keyframe ? keyframeDisplayValues(clip, keyframe) : {};
  const previewState = sampleClipKeyframedState(clip, localPlayheadTime);
  const previewSummary = `${Math.round(previewState.x)}, ${Math.round(previewState.y)}`;
  // Allow removing any point as long as we'd leave at least the 2 minimum a move
  // needs. Used to be middle-only, which hid the option for the first/last point
  // and pushed users to the "Delete move" button by accident.
  const canRemoveCheckpoint =
    selectedMotion && selectedCheckpoint && selectedMotion.checkpoints.length > 2;
  const firstMotionCheckpoint = selectedMotion?.checkpoints[0];
  const lastMotionCheckpoint = selectedMotion?.checkpoints[selectedMotion.checkpoints.length - 1];
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
        <div className="font-semibold uppercase tracking-wider text-muted-foreground">Move</div>
        {selectedKeyframe && (
          <button
            type="button"
            onClick={() => onSelectKeyframe(null)}
            className="rounded border border-border px-2 py-0.5 text-ui-sm text-muted-foreground hover:bg-panel hover:text-foreground"
          >
            Done
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => onAddMotion(localPlayheadTime)}
        className="mb-2 w-full rounded border border-border bg-panel px-2 py-1.5 text-ui-sm font-medium text-foreground hover:bg-panel-2"
        title={`Add a move at ${localPlayheadTime.toFixed(1)}s near ${previewSummary}`}
      >
        + Move
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
                    className="min-w-0 flex-1 truncate text-left text-ui-sm font-medium text-foreground"
                  >
                    {motion.label}
                  </button>
                  <span className="shrink-0 text-ui-sm text-muted-foreground">
                    {motion.startTime.toFixed(1)}-{motion.endTime.toFixed(1)}s
                  </span>
                  <button
                    type="button"
                    onClick={() => addPointToMotion(motion)}
                    className="flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-ui-sm text-muted-foreground hover:border-primary/60 hover:bg-primary/10 hover:text-foreground"
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
                      className={`rounded border px-2 py-0.5 text-ui-sm ${
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
          <div className="flex items-center gap-2 text-ui-sm">
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
                className="rounded border border-border px-1.5 py-0.5 text-muted-foreground hover:border-primary/60 hover:bg-primary/10 hover:text-foreground"
                title="Remove just this point from the move"
              >
                Delete point
              </button>
            )}
            <button
              type="button"
              onClick={() => onRemoveMotion(clip.id, selectedMotion.id)}
              className="rounded border border-destructive/40 px-1.5 py-0.5 text-destructive hover:bg-destructive/10"
              title="Remove the whole move and every point in it"
            >
              Delete move
            </button>
          </div>
          <Field label="Move name">
            <input
              value={selectedMotion.name ?? ""}
              placeholder="Move"
              onChange={(event) => onRenameMotion(clip.id, selectedMotion.id, event.target.value)}
              className="w-full rounded border border-border bg-input px-2 py-1 text-foreground"
            />
          </Field>
          <Field label="Path">
            <PathStyleToggle
              pathStyle={selectedMotion.pathStyle}
              checkpointCount={selectedMotion.checkpoints.length}
              onChange={(next) => onSetPathStyle(clip.id, selectedMotion.id, next)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Starts (s)">
              <NumberInput
                value={selectedMotion.startTime}
                min={0}
                step={0.05}
                onChange={(value) => {
                  if (!firstMotionCheckpoint || !lastMotionCheckpoint) return;
                  const nextTime = Math.max(0, Math.min(lastMotionCheckpoint.time - 0.05, value));
                  const selection = onMoveCheckpoint(
                    clip.id,
                    selectedMotion.id,
                    firstMotionCheckpoint.id,
                    nextTime,
                  );
                  if (selection) {
                    onSelectKeyframe(selection);
                    onSeek(nextTime);
                  }
                }}
              />
            </Field>
            <Field label="Ends (s)">
              <NumberInput
                value={selectedMotion.endTime}
                min={0}
                step={0.05}
                onChange={(value) => {
                  if (!firstMotionCheckpoint || !lastMotionCheckpoint) return;
                  const nextTime = Math.max(
                    firstMotionCheckpoint.time + 0.05,
                    Math.min(clip.duration, value),
                  );
                  const selection = onMoveCheckpoint(
                    clip.id,
                    selectedMotion.id,
                    lastMotionCheckpoint.id,
                    nextTime,
                  );
                  if (selection) {
                    onSelectKeyframe(selection);
                    onSeek(nextTime);
                  }
                }}
              />
            </Field>
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
          <MoveValueFields
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
        <div className="rounded border border-dashed border-border p-2 text-center text-ui-sm text-muted-foreground">
          No move selected.
        </div>
      )}
    </div>
  );
}

// Property names here must match the Frame and Look sections exactly — the same
// property under two names in one panel is the fastest way to lose a beginner.
function MoveValueFields({
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
  const opacity = values.opacity ?? clip.opacity;
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Field label="X">
          <NumberInput value={x} onChange={(nextX) => onChange("position", { x: nextX, y })} />
        </Field>
        <Field label="Y">
          <NumberInput value={y} onChange={(nextY) => onChange("position", { x, y: nextY })} />
        </Field>
        <Field label="Scale">
          <NumberInput
            value={values.scale ?? 1}
            min={0.01}
            step={0.05}
            onChange={(scale) => onChange("scale", { scale: Math.max(0.01, scale) })}
          />
        </Field>
        <Field label="Rotation°">
          <NumberInput
            value={values.rotation ?? clip.rotation}
            step={1}
            onChange={(rotation) => onChange("rotation", { rotation })}
          />
        </Field>
      </div>
      <RangeField
        label="Opacity"
        value={opacity}
        min={0}
        max={1}
        step={0.05}
        displayValue={`${Math.round(opacity * 100)}%`}
        onChange={(value) => onChange("opacity", { opacity: value })}
      />
    </>
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

function PathStyleToggle({
  pathStyle,
  checkpointCount,
  onChange,
}: {
  pathStyle: "linear" | "smooth";
  checkpointCount: number;
  onChange: (next: "linear" | "smooth") => void;
}) {
  // Smooth needs 3+ points to actually curve. We still let the user pick it
  // with 2 points (so the choice persists when they add a third), but hint
  // why nothing has curved yet.
  const smoothInactive = pathStyle === "smooth" && checkpointCount < 3;
  return (
    <div>
      <div className="grid grid-cols-2 overflow-hidden rounded border border-border bg-input">
        {(["linear", "smooth"] as const).map((option) => {
          const selected = pathStyle === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => {
                if (!selected) onChange(option);
              }}
              className={`px-2 py-1 text-ui-sm font-medium capitalize transition-colors ${
                selected ? "bg-primary/20 text-foreground" : "text-muted-foreground hover:bg-panel"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
      {smoothInactive && (
        <div className="mt-1 text-ui-sm text-muted-foreground">
          Add a third point to bend the path.
        </div>
      )}
    </div>
  );
}

function RootElementSourceInspector({ clip, rootHtml }: { clip: EditorClip; rootHtml: string }) {
  const source = useMemo(() => readRootElementSource(rootHtml, clip.id), [rootHtml, clip.id]);

  return (
    <PanelSection title="Source" icon={Code2} meta="rootHtml element">
      <textarea
        value={source ?? `Element "${clip.id}" was not found in project.hf.rootHtml.`}
        readOnly
        rows={6}
        spellCheck={false}
        className="w-full resize-y rounded border border-border bg-input px-2 py-2 font-mono text-ui-sm leading-relaxed text-muted-foreground"
      />
      {source && (
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(source)}
          className="mt-2 rounded border border-border px-2 py-1 text-ui-sm text-foreground hover:bg-panel"
        >
          Copy source
        </button>
      )}
    </PanelSection>
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
  onApply: (html: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(source);
  const [errors, setErrors] = useState<string[]>([]);
  const [validated, setValidated] = useState<Awaited<
    ReturnType<typeof validateCompositionSourceForClip>
  > | null>(null);
  const [previewProject, setPreviewProject] = useState<Project | null>(null);
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [sourceTrusted, setSourceTrusted] = useState(false);
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
    () => validateCompositionSourceForClipSync(source, clip.compositionId, validationDefaults),
    [clip.compositionId, source, validationDefaults],
  );
  const isEditingStoredSource = draft === source;
  const validatedHtml = validated?.ok && validated.html ? validated.html : null;
  const canPreview = Boolean(validatedHtml);
  const canApply = Boolean(validatedHtml && previewStatus === "ready" && sourceTrusted);
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
    setSourceTrusted(false);
  }, [source, clip.compositionId]);

  const validate = async () => {
    const result = await validateCompositionSourceForClip(
      draft,
      clip.compositionId,
      validationDefaults,
    );
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

  const apply = async () => {
    if (!validatedHtml || previewStatus !== "ready" || !sourceTrusted) return;
    try {
      await onApply(validatedHtml);
      setValidated(null);
      setPreviewProject(null);
      setPreviewStatus("idle");
      setSourceTrusted(false);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
      setValidated(null);
      setPreviewProject(null);
      setPreviewStatus("idle");
      setSourceTrusted(false);
    }
  };

  return (
    <PanelSection title="Source" icon={Code2} meta={clip.compositionId}>
      <textarea
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setErrors([]);
          setValidated(null);
          setPreviewProject(null);
          setPreviewStatus("idle");
          setSourceTrusted(false);
        }}
        rows={10}
        spellCheck={false}
        className="w-full resize-y rounded border border-border bg-input px-2 py-2 font-mono text-ui-sm leading-relaxed text-foreground"
      />
      {!storedValidation.ok && isEditingStoredSource && errors.length === 0 && (
        <div className="mt-2 rounded border border-red-400/60 bg-red-500/10 p-2 text-ui-sm text-red-100">
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
            className="mt-2 rounded border border-red-300/60 px-2 py-1 text-ui-sm hover:bg-red-500/20"
          >
            Copy repair prompt
          </button>
        </div>
      )}
      {errors.length > 0 && (
        <div className="mt-2 rounded border border-destructive/60 bg-destructive/10 p-2 text-ui-sm text-destructive-foreground">
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
            className="mt-2 rounded border border-destructive/60 px-2 py-1 text-ui-sm hover:bg-destructive/20"
          >
            Copy repair prompt
          </button>
        </div>
      )}
      {validatedHtml && (
        <div className="mt-2 rounded border border-primary/50 bg-primary/10 px-2 py-1 text-ui-sm text-foreground">
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
      <div className="mt-2">
        <SourceTrustConfirmation confirmed={sourceTrusted} onConfirmedChange={setSourceTrusted} />
      </div>
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
    </PanelSection>
  );
}

function isPrimitiveSourceClip(clip: EditorClip): boolean {
  return (
    clip.kind === "image" || clip.kind === "video" || clip.kind === "audio" || clip.kind === "text"
  );
}

async function validateCompositionSourceForClip(
  html: string,
  expectedCompositionId: string,
  defaults: Parameters<typeof validateCompositionSourceHtml>[1],
) {
  const result = await validateCompositionSourceHtml(html, { ...defaults, isSubComposition: true });
  return addExpectedCompositionIdError(result, expectedCompositionId);
}

function validateCompositionSourceForClipSync(
  html: string,
  expectedCompositionId: string,
  defaults: Parameters<typeof validateCompositionSourceHtmlSync>[1],
) {
  const result = validateCompositionSourceHtmlSync(html, {
    ...defaults,
    isSubComposition: true,
  });
  return addExpectedCompositionIdError(result, expectedCompositionId);
}

function addExpectedCompositionIdError(
  result: Awaited<ReturnType<typeof validateCompositionSourceHtmlSync>>,
  expectedCompositionId: string,
) {
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
  return readStudioElementHtml(rootHtml, elementId);
}

function TextInspector({
  clip,
  update,
}: {
  clip: TextClip;
  update: (patch: Partial<TextClip>) => void;
}) {
  const content = clip.content ?? "";
  const [contentDraft, setContentDraft] = useState(content);

  useEffect(() => {
    setContentDraft(content);
  }, [clip.id, content]);

  const commitContent = (nextContent: string) => {
    if (nextContent !== content) update({ content: nextContent });
  };

  return (
    <PanelSection title="Text" icon={Type}>
      <div className="space-y-2">
        <Field label="Content">
          <textarea
            value={contentDraft}
            rows={3}
            onChange={(event) => setContentDraft(event.target.value)}
            onBlur={(event) => commitContent(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.currentTarget.value = content;
                setContentDraft(content);
                event.currentTarget.blur();
              } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.currentTarget.blur();
              }
            }}
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
                className="min-w-0 flex-1 rounded border border-border bg-input px-2 py-1 font-mono text-ui-sm text-foreground"
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
        <SwitchRow
          label="Fit to bounds"
          checked={clip.fitToBounds === true}
          onChange={(checked) => update({ fitToBounds: checked })}
        />
      </div>
    </PanelSection>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-ui-sm uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="min-w-0 flex-1"
        />
        <span className="w-10 rounded border border-border bg-input px-1.5 py-1 text-center text-ui-sm tabular-nums text-foreground">
          {displayValue}
        </span>
      </div>
    </Field>
  );
}

function SwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded border border-border bg-panel px-2 py-1.5 text-xs text-foreground">
      <span className="min-w-0 truncate">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="sr-only"
      />
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
          checked ? "border-primary/70 bg-primary/70" : "border-border bg-input"
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full transition-transform ${
            checked ? "translate-x-4 bg-primary-foreground" : "bg-foreground/80"
          }`}
        />
      </span>
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
