// Canvas sizing and skeleton setup controls for the character editor.

import { ChevronDown, ChevronRight, CircleDot, Target } from "lucide-react";
import { useEffect, useState } from "react";
import type { CharacterBone, CharacterPart, CharacterPreset, CharacterRig, ID } from "../types";
import { getPartSlotId } from "./character-utils";
import { Field, NumberField } from "./CharacterInspectorFields";
import { bindSlotPartToAngle, normalizeCharacterRig, resolveSlotBinding } from "./rig";
import { buildCharacterRuntime } from "./runtime";
import { buildSkeletonTree, isSkeletonDetailBone, type SkeletonTreeNode } from "./skeleton-tree";
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

/** Short, phase-local checklist for getting a character into an FK/IK testable state. */
export function RigSetupGuide() {
  return (
    <section className="rounded border border-primary/30 bg-primary/5 p-3">
      <div className="mb-1 font-semibold text-foreground">Rig checklist</div>
      <ol className="list-inside list-decimal space-y-1 text-ui-sm leading-snug text-muted-foreground">
        <li>Build: use one slot for each visible body piece.</li>
        <li>Reset skeleton: creates Root → Pelvis → body and limb chains.</li>
        <li>Show Bones: calibrate joints, then use Pose or Acting to test FK/IK.</li>
      </ol>
      <p className="mt-2 text-ui-sm leading-snug text-muted-foreground">
        For a known-good test, use <span className="text-foreground">IK Rig Test</span> from the
        Characters library. It has a simple torso and two-bone legs with foot controls.
      </p>
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
  showBoneDetail,
  activeVariants,
  onSceneCommand,
  onRigChange,
  onResetRig,
  onSelectBone,
  onToggleBoneDetail,
}: {
  doc: CharacterPreset;
  selectedBoneId: ID | null;
  selectedSlotId: ID | null;
  selectedPart: CharacterPart | null;
  showBones: boolean;
  showBoneDetail: boolean;
  activeVariants: Readonly<Record<ID, string>>;
  onSceneCommand: (command: CharacterSceneCommand) => void;
  onRigChange: (rig: CharacterRig) => void;
  onResetRig: () => void;
  onSelectBone: (boneId: ID) => void;
  onToggleBoneDetail: () => void;
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
  const skeleton = buildSkeletonTree(resolvedBones);
  const detailCount = resolvedBones.filter(isSkeletonDetailBone).length;
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
      <div className="mb-3 rounded border border-border bg-background p-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="font-medium text-foreground">Clean hierarchy</span>
          <span className="text-ui-sm text-muted-foreground">{resolvedBones.length} joints</span>
        </div>
        <p className="mb-2 text-ui-sm leading-snug text-muted-foreground">
          Root carries the Pelvis, the Pelvis carries the torso and legs, and IK targets stay
          outside the body chain as animator controls.
        </p>
        <div className="space-y-0.5 rounded border border-border/70 bg-panel px-1.5 py-1.5">
          {skeleton.roots.map((node) => (
            <SkeletonTreeNodeRow
              key={node.bone.id}
              node={node}
              depth={0}
              selectedBoneId={selectedBoneId}
              showDetail={showBoneDetail}
              onSelectBone={onSelectBone}
              onToggleBoneDetail={onToggleBoneDetail}
            />
          ))}
          {skeleton.ikTargets.length > 0 && (
            <div className="mt-2 border-t border-border/70 pt-1">
              <div className="px-1 text-ui-sm font-semibold uppercase tracking-wider text-muted-foreground">
                IK controls
              </div>
              {skeleton.ikTargets.map((node) => (
                <SkeletonTreeNodeRow
                  key={node.bone.id}
                  node={node}
                  depth={0}
                  selectedBoneId={selectedBoneId}
                  showDetail
                  onSelectBone={onSelectBone}
                  onToggleBoneDetail={onToggleBoneDetail}
                />
              ))}
            </div>
          )}
        </div>
        {detailCount > 0 && (
          <button
            type="button"
            onClick={onToggleBoneDetail}
            className="mt-2 w-full rounded border border-border px-2 py-1 text-left text-ui-sm text-muted-foreground hover:bg-panel"
          >
            {showBoneDetail
              ? "Hide facial detail joints"
              : `Show ${detailCount} facial detail joints`}
          </button>
        )}
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

function SkeletonTreeNodeRow({
  node,
  depth,
  selectedBoneId,
  showDetail,
  onSelectBone,
  onToggleBoneDetail,
}: {
  node: SkeletonTreeNode;
  depth: number;
  selectedBoneId: ID | null;
  showDetail: boolean;
  onSelectBone: (boneId: ID) => void;
  onToggleBoneDetail: () => void;
}) {
  const detailChildren = node.children.filter((child) => isSkeletonDetailBone(child.bone));
  const regularChildren = node.children.filter((child) => !isSkeletonDetailBone(child.bone));
  const selected = node.bone.id === selectedBoneId;
  const label =
    node.bone.controlKind === "pelvis"
      ? "Pelvis control"
      : node.bone.controlKind === "ikTarget"
        ? node.bone.name.replace(" target", " target control")
        : node.bone.name;

  return (
    <div>
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelectBone(node.bone.id)}
        className={`flex w-full items-center gap-1 rounded px-1 py-1 text-left text-ui-sm ${
          selected ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-panel-2"
        }`}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        {node.children.length > 0 ? <ChevronDown size={12} /> : <CircleDot size={10} />}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {node.bone.controlKind && (
          <span className="rounded border border-primary/30 px-1 text-ui-sm uppercase tracking-wide text-primary">
            {node.bone.controlKind === "pelvis" ? "control" : <Target size={9} />}
          </span>
        )}
      </button>
      {regularChildren.map((child) => (
        <SkeletonTreeNodeRow
          key={child.bone.id}
          node={child}
          depth={depth + 1}
          selectedBoneId={selectedBoneId}
          showDetail={showDetail}
          onSelectBone={onSelectBone}
          onToggleBoneDetail={onToggleBoneDetail}
        />
      ))}
      {detailChildren.length > 0 && !showDetail && (
        <button
          type="button"
          onClick={onToggleBoneDetail}
          className="ml-7 rounded px-1 py-0.5 text-ui-sm text-muted-foreground hover:bg-panel-2 hover:text-foreground"
        >
          + {detailChildren.length} face detail joints
        </button>
      )}
      {showDetail &&
        detailChildren.map((child) => (
          <SkeletonTreeNodeRow
            key={child.bone.id}
            node={child}
            depth={depth + 1}
            selectedBoneId={selectedBoneId}
            showDetail
            onSelectBone={onSelectBone}
            onToggleBoneDetail={onToggleBoneDetail}
          />
        ))}
    </div>
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
