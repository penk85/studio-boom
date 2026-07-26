// Header, angle navigation, and pose controls for the Character Editor.
import { Redo2, Undo2 } from "lucide-react";
import type { CharacterAngle, CharacterPosePreset, CharacterPreset, ID } from "../types";
import {
  ANGLE_LABELS,
  CHARACTER_ANGLES,
  availableCharacterAngles,
  normalizeCharacterRig,
} from "./rig";

export type CharacterEditorPhase = "build" | "rig" | "pose";
export type CharacterPosePrompt = { kind: "new" } | { kind: "rename"; poseId: ID };

export function CharacterEditorHeader({
  name,
  phase,
  canUndo,
  canRedo,
  saveState,
  onClose,
  onNameChange,
  onPhaseChange,
  onUndo,
  onRedo,
  onDone,
}: {
  name: string;
  phase: CharacterEditorPhase;
  canUndo: boolean;
  canRedo: boolean;
  saveState: "saved" | "saving";
  onClose: () => void;
  onNameChange: (name: string) => void;
  onPhaseChange: (phase: CharacterEditorPhase) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDone: () => void;
}) {
  return (
    <header className="flex items-center gap-3 border-b border-border bg-panel px-4 py-2">
      <button
        onClick={onClose}
        className="rounded border border-border px-2 py-1 text-xs hover:bg-panel-2"
      >
        ← Studio
      </button>
      <input
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        className="min-w-0 rounded border border-transparent bg-transparent px-2 py-1 text-sm font-semibold hover:border-border focus:border-primary focus:outline-none"
      />
      <div className="flex items-center justify-center">
        <div className="flex overflow-hidden rounded border border-border">
          {(
            [
              { phase: "build", label: "Build", hint: "Upload and arrange artwork" },
              { phase: "rig", label: "Rig", hint: "Skeleton, anchors, and movement limits" },
              { phase: "pose", label: "Pose", hint: "Variants and saved poses" },
            ] as const
          ).map((item) => (
            <button
              key={item.phase}
              type="button"
              aria-pressed={phase === item.phase}
              onClick={() => onPhaseChange(item.phase)}
              className={`px-3 py-1 text-xs ${
                phase === item.phase
                  ? "bg-primary/25 text-foreground"
                  : "text-muted-foreground hover:bg-panel-2"
              }`}
              title={item.hint}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-panel-2 disabled:opacity-40"
          title="Undo"
        >
          <Undo2 size={13} />
          Undo
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-panel-2 disabled:opacity-40"
          title="Redo"
        >
          <Redo2 size={13} />
          Redo
        </button>
        <span
          className={`text-[10px] ${
            saveState === "saved" ? "text-emerald-400" : "text-muted-foreground"
          }`}
          title="The editor saves automatically as you work"
        >
          {saveState === "saved" ? "✓ Saved" : "Saving…"}
        </span>
        <button
          onClick={onDone}
          className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
          title="Everything is already saved — this just closes the editor"
        >
          Done
        </button>
      </div>
    </header>
  );
}

export function CharacterAnglePoseToolbar({
  doc,
  phase,
  activePoseId,
  activePose,
  poseModified,
  poseMenuId,
  posePrompt,
  posePromptValue,
  pendingDeleteAngle,
  addAngleMenuOpen,
  onActiveAngleChange,
  onPhaseChange,
  onPendingDeleteAngleChange,
  onDeleteAngle,
  onAddAngleMenuOpenChange,
  onShowRestPose,
  onApplyPose,
  onPoseMenuIdChange,
  onRenamePose,
  onSetDefaultPose,
  onTogglePoseAngleScope,
  onDeletePose,
  onUpdateActivePose,
  onSavePoseAsNew,
  onPosePromptValueChange,
  onConfirmPosePrompt,
  onCancelPosePrompt,
}: {
  doc: CharacterPreset;
  phase: CharacterEditorPhase;
  activePoseId: ID | null;
  activePose: CharacterPosePreset | null;
  poseModified: boolean;
  poseMenuId: ID | null;
  posePrompt: CharacterPosePrompt | null;
  posePromptValue: string;
  pendingDeleteAngle: CharacterAngle | null;
  addAngleMenuOpen: boolean;
  onActiveAngleChange: (angle: CharacterAngle) => void;
  onPhaseChange: (phase: CharacterEditorPhase) => void;
  onPendingDeleteAngleChange: (angle: CharacterAngle | null) => void;
  onDeleteAngle: (angle: CharacterAngle) => void;
  onAddAngleMenuOpenChange: (open: boolean) => void;
  onShowRestPose: () => void;
  onApplyPose: (preset: CharacterPosePreset) => void;
  onPoseMenuIdChange: (poseId: ID | null) => void;
  onRenamePose: (poseId: ID) => void;
  onSetDefaultPose: (poseId: ID) => void;
  onTogglePoseAngleScope: (poseId: ID) => void;
  onDeletePose: (poseId: ID) => void;
  onUpdateActivePose: () => void;
  onSavePoseAsNew: () => void;
  onPosePromptValueChange: (value: string) => void;
  onConfirmPosePrompt: () => void;
  onCancelPosePrompt: () => void;
}) {
  const angles = availableCharacterAngles(doc);
  const activeAngle = normalizeCharacterRig(doc).activeAngle;

  return (
    <div className="flex items-stretch border-b border-border bg-panel text-xs">
      <div className="flex items-stretch">
        {angles.map((angle) => {
          const active = activeAngle === angle;
          const canDelete = active && angles.length > 1;
          const confirmingDelete = pendingDeleteAngle === angle;
          return (
            <span key={angle} className="relative flex items-stretch">
              <button
                type="button"
                onClick={() => onActiveAngleChange(angle)}
                className={`border-b-2 py-2 pl-4 text-[11px] font-medium transition-colors ${
                  canDelete ? "pr-1" : "pr-4"
                } ${
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                }`}
                title={`Switch to ${ANGLE_LABELS[angle]} view`}
              >
                {ANGLE_LABELS[angle]}
              </button>
              {canDelete && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (confirmingDelete) onDeleteAngle(angle);
                    else onPendingDeleteAngleChange(angle);
                  }}
                  onBlur={() => {
                    window.setTimeout(() => {
                      if (pendingDeleteAngle === angle) onPendingDeleteAngleChange(null);
                    }, 200);
                  }}
                  className={`border-b-2 border-primary py-2 pr-2 text-[10px] transition-colors ${
                    confirmingDelete
                      ? "text-destructive"
                      : "text-muted-foreground/40 hover:text-muted-foreground"
                  }`}
                  title={
                    confirmingDelete
                      ? "Click again to confirm deletion"
                      : `Delete ${ANGLE_LABELS[angle]} angle`
                  }
                >
                  {confirmingDelete ? "delete?" : "×"}
                </button>
              )}
            </span>
          );
        })}
      </div>
      {CHARACTER_ANGLES.some((angle) => !angles.includes(angle)) && (
        <span className="relative flex items-center">
          <button
            type="button"
            onClick={() => onAddAngleMenuOpenChange(!addAngleMenuOpen)}
            className="border-b-2 border-transparent px-3 py-2 text-[11px] text-muted-foreground hover:text-foreground"
            title="Add another view of this character — it starts with its own empty set of drawings"
          >
            + Add angle
          </button>
          {addAngleMenuOpen && (
            <div className="absolute left-0 top-full z-[70] mt-1 min-w-32 rounded border border-border bg-panel p-1 text-[11px] shadow-xl">
              {CHARACTER_ANGLES.filter((angle) => !angles.includes(angle)).map((angle) => (
                <button
                  key={angle}
                  type="button"
                  onClick={() => {
                    onAddAngleMenuOpenChange(false);
                    onActiveAngleChange(angle);
                    onPhaseChange("build");
                  }}
                  className="block w-full rounded px-2 py-1 text-left hover:bg-panel-2"
                >
                  {ANGLE_LABELS[angle]}
                </button>
              ))}
            </div>
          )}
        </span>
      )}
      {phase === "pose" && (
        <div className="flex min-w-0 flex-1 items-center gap-1 border-l border-border px-4">
          <span className="mr-1 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
            Pose
          </span>
          <button
            type="button"
            onClick={onShowRestPose}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
              activePoseId === null
                ? "border-primary bg-primary/20 text-foreground"
                : "border-border text-muted-foreground hover:bg-panel-2"
            }`}
            title="Show the raw rest art with no pose applied"
          >
            Rest
          </button>
          {(doc.posePresets ?? []).map((preset) => {
            const availableHere = !preset.angleIds?.length || preset.angleIds.includes(activeAngle);
            const isActive = preset.id === activePoseId;
            const isDefault = preset.id === doc.defaultPoseId;
            return (
              <span key={preset.id} className="relative inline-flex">
                <button
                  type="button"
                  disabled={!availableHere}
                  onClick={() => onApplyPose(preset)}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                    isActive
                      ? "border-primary bg-primary/20 text-foreground"
                      : "border-border text-muted-foreground hover:bg-panel-2"
                  } ${availableHere ? "" : "opacity-40"}`}
                  title={
                    availableHere
                      ? `Apply ${preset.name}`
                      : `Saved for ${(preset.angleIds ?? [])
                          .map((angle) => ANGLE_LABELS[angle])
                          .join(", ")}`
                  }
                >
                  {preset.name}
                  {isDefault && <span className="ml-1 text-amber-300">★</span>}
                  {isActive && poseModified && (
                    <span
                      className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle"
                      title="Edited since this pose was applied"
                    />
                  )}
                </button>
                {isActive && (
                  <button
                    type="button"
                    onClick={() => onPoseMenuIdChange(poseMenuId === preset.id ? null : preset.id)}
                    className="ml-0.5 rounded px-1 text-muted-foreground hover:text-foreground"
                    title="Pose options"
                  >
                    …
                  </button>
                )}
                {poseMenuId === preset.id && (
                  <div className="absolute left-0 top-full z-[70] mt-1 min-w-36 rounded border border-border bg-panel p-1 text-[11px] shadow-xl">
                    {[
                      { label: "Rename", action: () => onRenamePose(preset.id) },
                      {
                        label: isDefault ? "Default pose ✓" : "Set as default",
                        action: () => onSetDefaultPose(preset.id),
                      },
                      {
                        label: preset.angleIds?.length
                          ? "Available on all angles"
                          : `Only ${ANGLE_LABELS[activeAngle]}`,
                        action: () => onTogglePoseAngleScope(preset.id),
                      },
                      {
                        label: "Delete",
                        action: () => onDeletePose(preset.id),
                        danger: true,
                      },
                    ].map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => {
                          onPoseMenuIdChange(null);
                          item.action();
                        }}
                        className={`block w-full rounded px-2 py-1 text-left hover:bg-panel-2 ${
                          item.danger ? "text-destructive" : ""
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </span>
            );
          })}
          {poseModified && activePose && (
            <button
              type="button"
              onClick={onUpdateActivePose}
              className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300 hover:bg-amber-500/20"
              title={`Save the current arrangement into "${activePose.name}"`}
            >
              Update {activePose.name}
            </button>
          )}
          <span className="relative inline-flex">
            <button
              type="button"
              onClick={onSavePoseAsNew}
              className="rounded border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              title="Save the current arrangement as a new pose"
            >
              + Save pose
            </button>
            {posePrompt && (
              <div className="absolute right-0 top-full z-[70] mt-1 flex items-center gap-1 rounded border border-border bg-panel p-1.5 shadow-xl">
                <input
                  autoFocus
                  value={posePromptValue}
                  onChange={(event) => onPosePromptValueChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onConfirmPosePrompt();
                    if (event.key === "Escape") onCancelPosePrompt();
                  }}
                  onFocus={(event) => event.target.select()}
                  placeholder="Pose name"
                  className="w-32 rounded border border-border bg-input px-2 py-0.5 text-[11px]"
                />
                <button
                  type="button"
                  onClick={onConfirmPosePrompt}
                  className="rounded border border-primary/50 bg-primary/15 px-2 py-0.5 text-[11px]"
                >
                  {posePrompt.kind === "new" ? "Save" : "Rename"}
                </button>
                <button
                  type="button"
                  onClick={onCancelPosePrompt}
                  className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  ✕
                </button>
              </div>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
