// Canvas sizing and skeleton setup controls for the character editor.

import { useEffect, useState } from "react";
import type { CharacterPart, CharacterPreset, CharacterRig, ID } from "../types";
import { getPartSlotId } from "./character-utils";
import { Field, NumberField } from "./CharacterInspectorFields";
import { bindSlotPartToAngle, normalizeCharacterRig, resolveSlotBinding } from "./rig";
import { buildCharacterRuntime } from "./runtime";
import type { CharacterSceneCommand } from "./scene-commands";
import { resolvePinnedBonesForAngle } from "./rig-v2";

const CANVAS_PRESETS = [
  { label: "Portrait", width: 600, height: 900 },
  { label: "Square", width: 1000, height: 1000 },
  { label: "Landscape", width: 1280, height: 720 },
  { label: "Custom", width: 900, height: 900 },
];

/** Canvas size for the whole character. Angles are managed in the editor toolbar. */
export function CanvasSection({
  doc,
  onChange,
  onFitActiveAngle,
}: {
  doc: CharacterPreset;
  onChange: (patch: Partial<CharacterPreset>) => void;
  onFitActiveAngle: () => void;
}) {
  return (
    <section className="rounded border border-border bg-panel-2 p-3">
      <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
        Canvas
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        {CANVAS_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => onChange({ canvasWidth: preset.width, canvasHeight: preset.height })}
            className={`rounded border px-2 py-1 text-ui-sm hover:bg-panel ${
              doc.canvasWidth === preset.width && doc.canvasHeight === preset.height
                ? "border-primary bg-primary/15 text-foreground"
                : "border-border text-muted-foreground"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Width"
          value={doc.canvasWidth}
          onChange={(canvasWidth) => onChange({ canvasWidth })}
        />
        <NumberField
          label="Height"
          value={doc.canvasHeight}
          onChange={(canvasHeight) => onChange({ canvasHeight })}
        />
      </div>
      <button
        type="button"
        onClick={onFitActiveAngle}
        className="mt-2 w-full rounded border border-border bg-background px-2 py-1 text-ui-sm font-medium text-foreground hover:bg-panel"
        title="Uniformly scale and center this angle using full transparent part frames"
      >
        Fit active angle to canvas
      </button>
    </section>
  );
}

/** Skeleton selection, numeric tuning, angle binding, and reset controls. */
export function SkeletonCard({
  doc,
  selectedBoneId,
  selectedSlotId,
  selectedPart,
  showBones,
  activeVariants,
  onSceneCommand,
  onRigChange,
  onResetRig,
}: {
  doc: CharacterPreset;
  selectedBoneId: ID | null;
  selectedSlotId: ID | null;
  selectedPart: CharacterPart | null;
  showBones: boolean;
  activeVariants: Readonly<Record<ID, string>>;
  onSceneCommand: (command: CharacterSceneCommand) => void;
  onRigChange: (rig: CharacterRig) => void;
  onResetRig: () => void;
}) {
  const rig = normalizeCharacterRig(doc);
  const runtime = buildCharacterRuntime(doc);
  const resolvedBones = resolvePinnedBonesForAngle(
    runtime.character,
    runtime.angleRig,
    runtime.angle,
    activeVariants,
  );
  const selectedBone = resolvedBones.find((bone) => bone.id === selectedBoneId) ?? null;
  const selectedBinding = selectedSlotId ? resolveSlotBinding(rig, selectedSlotId) : undefined;
  const bindSelectedPart = () => {
    if (!selectedPart) return;
    onRigChange(bindSlotPartToAngle(rig, getPartSlotId(selectedPart), selectedPart.id));
  };

  return (
    <section className="rounded border border-border bg-panel-2 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-wider text-muted-foreground">
          Skeleton
        </span>
        <span className="text-ui-sm text-muted-foreground">{rig.bones.length} bones</span>
      </div>
      <div className="mb-3 rounded border border-border bg-background px-2 py-1.5 text-ui-sm leading-snug text-muted-foreground">
        {showBones
          ? selectedBone
            ? `Editing ${selectedBone.name} — drag it on the canvas or fine-tune below.`
            : "Click a joint on the canvas to select it; drag joints to position the skeleton."
          : "Show Bones (bottom-left of the canvas) to see and adjust the skeleton."}
      </div>
      {selectedBone && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <NumberField
            label="Bone X"
            value={selectedBone.x}
            onChange={(x) =>
              onSceneCommand({
                kind: "set-bone-rest-transform",
                boneId: selectedBone.id,
                patch: { x },
                angle: runtime.angle,
                activeVariants,
              })
            }
          />
          <NumberField
            label="Bone Y"
            value={selectedBone.y}
            onChange={(y) =>
              onSceneCommand({
                kind: "set-bone-rest-transform",
                boneId: selectedBone.id,
                patch: { y },
                angle: runtime.angle,
                activeVariants,
              })
            }
          />
          <NumberField
            label="Bone Rot"
            value={selectedBone.rotation}
            onChange={(rotation) =>
              onSceneCommand({
                kind: "set-bone-rest-transform",
                boneId: selectedBone.id,
                patch: { rotation },
                angle: runtime.angle,
                activeVariants,
              })
            }
          />
          <NumberField
            label="Bone Depth"
            value={selectedBone.depth ?? 0}
            onChange={(depth) =>
              onSceneCommand({ kind: "set-bone-depth", boneId: selectedBone.id, depth })
            }
          />
        </div>
      )}
      {selectedBinding && (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Slot Depth"
            value={selectedBinding.effectiveDepth}
            onChange={(depth) =>
              onSceneCommand({ kind: "set-slot-depth", slotId: selectedBinding.slotId, depth })
            }
          />
          <Field label="Angle Variant">
            <button
              type="button"
              disabled={!selectedPart}
              onClick={bindSelectedPart}
              className="w-full rounded border border-border px-2 py-1 disabled:opacity-50"
              title="Use the currently selected part/variant when this angle is active"
            >
              Use selected part
            </button>
          </Field>
          {selectedBinding.effectivePartId && (
            <div className="col-span-2 rounded border border-border bg-background px-2 py-1.5 text-ui-sm text-muted-foreground">
              Active angle uses part{" "}
              <span className="text-foreground">{selectedBinding.effectivePartId}</span>.
            </div>
          )}
        </div>
      )}
      <ConfirmButton
        label="Reset skeleton to default"
        confirmLabel="Click again to confirm reset"
        onConfirm={onResetRig}
        title="Rebuild the skeleton from the artwork — recovers from a tangled rig (movement limits are kept)"
      />
    </section>
  );
}

/** Two-step destructive action that disarms itself after three seconds. */
function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  title,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  title?: string;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timeout = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(timeout);
  }, [armed]);

  return (
    <button
      type="button"
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
      className={`mt-3 w-full rounded border px-2 py-1 text-ui-sm ${
        armed
          ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
          : "border-border text-muted-foreground hover:text-foreground"
      }`}
      title={title}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
