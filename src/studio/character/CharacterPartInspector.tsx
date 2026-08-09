// Inspector for a selected character part across Build, Rig, and Pose phases.

import { Copy, Maximize2, Minimize2, MousePointer2, Trash2 } from "lucide-react";
import { MOUTH_VISEMES, MOUTH_VISEME_DESCRIPTIONS } from "../lipsync/viseme-schema";
import type {
  CharacterPart,
  CharacterPartDeform,
  CharacterPreset,
  CharacterVariantKind,
  EyeState,
  ID,
  MouthViseme,
  PartMotionBehavior,
  PartRole,
} from "../types";
import { useStudio } from "../store";
import { alphaCenterForPart } from "./alpha-bounds";
import { FlexibleSection } from "./CharacterFlexibleSection";
import { Field, NumberField } from "./CharacterInspectorFields";
import { VariantAnchorSection, VariantKeyChip } from "./CharacterVariantControls";
import {
  CHARACTER_VARIANT_KIND_VALUES,
  defaultMotionBehaviorForRole,
  findCharacterSlot,
  getPartSlotId,
  listCharacterSlots,
  normalizePartVariant,
  roleLabel,
  variantLabelForPart,
} from "./character-utils";
import {
  EYE_STATES,
  MOTION_BEHAVIOR_OPTIONS,
  ROLE_OPTIONS,
  SLOT_SIDE_OPTIONS,
  VARIANT_KIND_LABELS,
  SAMPLE_WORDS,
  type EditorBoundsMode,
  type EditorMode,
} from "./character-inspector-options";
import { previewLabels, wordToVisemes, type PreviewState } from "./character-editor-preview";
import { defaultImportedVariantKind } from "./character-part-import";
import {
  ANGLE_LABELS,
  availableCharacterAngles,
  normalizeCharacterRig,
  parentSlotIdForSlot,
} from "./rig";
import type { VariantAlignPlan } from "./variant-align";
import type { VariantKeyIssue } from "./variant-pairing";

export function Inspector({
  doc,
  part,
  mode,
  boundsMode,
  keyIssues,
  phase,
  onSwitchPhase,
  onSelectSlot,
  variantPreview,
  alignPlan,
  onAlignVariant,
  onSetDeform,
  anchorDragContext,
  pinPlacement,
  onPreviewVariant,
  onArmPinPlacement,
  onClearPin,
  onResetPin,
  onSetRotation,
  onModeChange,
  onBoundsModeChange,
  onAttachSlot,
  onChange,
  onRemove,
  onDuplicate,
  onPreview,
}: {
  doc: CharacterPreset;
  part: CharacterPart | null;
  mode: EditorMode;
  boundsMode: EditorBoundsMode;
  keyIssues: Map<ID, VariantKeyIssue[]>;
  phase: "build" | "rig" | "pose";
  onSwitchPhase: (phase: "build" | "rig" | "pose") => void;
  onSelectSlot: (slotId: ID) => void;
  variantPreview: Record<ID, string>;
  /** Snap plan for aligning this variant's art onto the slot's default variant. */
  alignPlan: VariantAlignPlan | null;
  onAlignVariant: () => void;
  onSetDeform: (deform: CharacterPartDeform | undefined, options?: { history?: boolean }) => void;
  /** Set when dragging this part on the canvas would pin its anchor (parent variant previewed). */
  anchorDragContext: { childSlotId: ID; parentSlotId: ID; variantKey: string } | null;
  pinPlacement: { childSlotId: ID; parentSlotId: ID; variantKey: string } | null;
  onPreviewVariant: (slotId: ID, key: string) => void;
  onArmPinPlacement: (
    placement: { childSlotId: ID; parentSlotId: ID; variantKey: string } | null,
  ) => void;
  onClearPin: (context: { parentSlotId: ID; variantKey: string; childSlotId: ID }) => void;
  onResetPin: (context: { parentSlotId: ID; variantKey: string; childSlotId: ID }) => void;
  onSetRotation: (
    context: { parentSlotId: ID; variantKey: string; childSlotId: ID },
    rotation: number,
  ) => void;
  onModeChange: (mode: EditorMode) => void;
  onBoundsModeChange: (mode: EditorBoundsMode) => void;
  onAttachSlot: (slotId: ID, parentSlotId: ID | "") => void;
  onChange: (id: ID, patch: Partial<CharacterPart>) => void;
  onRemove: (id: ID) => void;
  onDuplicate: (part: CharacterPart) => void;
  onPreview: (preview: PreviewState) => void;
}) {
  if (!part) {
    return (
      <div className="space-y-4">
        <div className="rounded border border-dashed border-border p-3 text-center text-muted-foreground">
          Select a part on the canvas or in the layer list.
        </div>
      </div>
    );
  }

  const rig = normalizeCharacterRig(doc);
  const activeAngle = rig.activeAngle;
  const partSlotId = getPartSlotId(part);
  const slot = findCharacterSlot(doc, partSlotId);
  const parentOptions = listCharacterSlots(doc, { angle: activeAngle, includeEmpty: false }).filter(
    (candidate) => candidate.id !== partSlotId,
  );
  const parentValue = parentSlotIdForSlot(rig, partSlotId) ?? "";
  const previewButtons = previewLabels(part);
  const variantInputKey = part.variant?.key ?? part.viseme ?? part.eyeState ?? part.pose ?? "";
  const variantKind =
    part.variant?.kind ?? defaultImportedVariantKind(part.role, part.viseme, part.eyeState);
  const updateVariant = (
    patch: Partial<NonNullable<CharacterPart["variant"]>>,
    semantic?: Pick<CharacterPart, "viseme" | "eyeState" | "pose">,
  ) => {
    const next = normalizePartVariant({
      role: part.role,
      pose: semantic?.pose ?? part.pose,
      viseme: semantic?.viseme ?? part.viseme,
      eyeState: semantic?.eyeState ?? part.eyeState,
      variant: {
        key: variantInputKey,
        kind: variantKind,
        ...part.variant,
        ...patch,
      },
    });
    return next;
  };

  return (
    <div className="space-y-4">
      {phase !== "build" && (
        <section className="rounded border border-border bg-panel-2 p-3">
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">
              <button
                type="button"
                onClick={() => onSelectSlot(getPartSlotId(part))}
                className="text-muted-foreground hover:text-foreground"
                title="Select the whole layer group"
              >
                {slot?.name ?? roleLabel(part.role)}
              </button>
              <span className="text-muted-foreground"> › </span>
              {variantLabelForPart(part)}
            </div>
            <div className="text-ui-sm text-muted-foreground">{roleLabel(part.role)}</div>
          </div>
          {phase === "pose" && (
            <div className="mt-2">
              <VariantKeyChip part={part} issues={keyIssues.get(part.id) ?? []} />
            </div>
          )}
          {phase === "pose" && anchorDragContext && (
            <div className="mt-2 text-ui-sm leading-snug text-muted-foreground">
              Drag this layer on the canvas to adjust its anchor —{" "}
              <button
                type="button"
                onClick={() => onSwitchPhase("rig")}
                className="text-foreground underline-offset-2 hover:underline"
              >
                fine controls in Rig →
              </button>
            </div>
          )}
        </section>
      )}
      {phase === "build" && (
        <>
          <section className="rounded border border-border bg-panel-2 p-3">
            <div className="mb-1 text-ui-sm text-muted-foreground">
              <button
                type="button"
                onClick={() => onSelectSlot(getPartSlotId(part))}
                className="hover:text-foreground"
                title="Select the whole layer group"
              >
                {slot?.name ?? roleLabel(part.role)}
              </button>
              {" › "}
              {variantLabelForPart(part)}
            </div>
            <div className="mb-3 flex items-center gap-2">
              <input
                value={part.name}
                onChange={(e) => onChange(part.id, { name: e.target.value })}
                className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-medium"
              />
              <button
                onClick={() => onDuplicate(part)}
                className="rounded border border-border p-1.5"
                title="Duplicate"
              >
                <Copy size={14} />
              </button>
              <button
                onClick={() => onRemove(part.id)}
                className="rounded border border-border p-1.5 text-destructive"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
            {alignPlan && (
              <div className="mb-3 rounded border border-border bg-background/60 p-2 text-ui-sm leading-snug text-muted-foreground">
                <div>
                  Swaps in for{" "}
                  <span className="text-foreground">
                    {variantLabelForPart(alignPlan.referencePart)}
                  </span>{" "}
                  — the other variants stay visible as ghosts while this one is selected.
                </div>
                <button
                  type="button"
                  onClick={onAlignVariant}
                  disabled={alignPlan.aligned}
                  className="mt-1.5 w-full rounded border border-border bg-panel px-2 py-1 text-foreground hover:bg-panel-2 disabled:cursor-default disabled:opacity-60"
                  title="Move this variant's artwork so its visible pixels center on the default variant's"
                >
                  {alignPlan.aligned
                    ? "Art centers are aligned"
                    : `Align art with "${variantLabelForPart(alignPlan.referencePart)}"`}
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Field label="Role">
                <select
                  value={part.role}
                  onChange={(e) =>
                    onChange(part.id, {
                      role: e.target.value as PartRole,
                      motionBehavior: defaultMotionBehaviorForRole(
                        e.target.value as PartRole,
                        part.viseme,
                      ),
                    })
                  }
                  className="w-full rounded border border-border bg-background px-2 py-1"
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {roleLabel(role)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Side">
                <select
                  value={part.side ?? ""}
                  onChange={(e) =>
                    onChange(part.id, {
                      side: (e.target.value || undefined) as CharacterPart["side"] | undefined,
                    })
                  }
                  className="w-full rounded border border-border bg-background px-2 py-1"
                >
                  {SLOT_SIDE_OPTIONS.map((option) => (
                    <option key={option.value || "none"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Motion behavior">
                <select
                  value={part.motionBehavior ?? "none"}
                  onChange={(e) =>
                    onChange(part.id, { motionBehavior: e.target.value as PartMotionBehavior })
                  }
                  className="w-full rounded border border-border bg-background px-2 py-1"
                >
                  {MOTION_BEHAVIOR_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </Field>
              {part.role === "mouth" && (
                <Field label="Mouth">
                  <select
                    value={part.viseme ?? "rest"}
                    onChange={(e) => {
                      const viseme = e.target.value as MouthViseme;
                      onChange(part.id, {
                        viseme,
                        variant: updateVariant(
                          { key: viseme, kind: "viseme" },
                          { viseme, eyeState: part.eyeState, pose: part.pose },
                        ),
                      });
                    }}
                    className="w-full rounded border border-border bg-background px-2 py-1"
                    title={MOUTH_VISEME_DESCRIPTIONS[part.viseme ?? "rest"]}
                  >
                    {MOUTH_VISEMES.map((viseme) => (
                      <option key={viseme} value={viseme}>
                        {viseme}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {part.role === "eye" && (
                <Field label="Eye state">
                  <select
                    value={part.eyeState ?? "open"}
                    onChange={(e) => {
                      const eyeState = e.target.value as EyeState;
                      onChange(part.id, {
                        eyeState,
                        variant: updateVariant(
                          { key: eyeState, kind: "eyeState" },
                          { viseme: part.viseme, eyeState, pose: part.pose },
                        ),
                      });
                    }}
                    className="w-full rounded border border-border bg-background px-2 py-1"
                  >
                    {EYE_STATES.map((eyeState) => (
                      <option key={eyeState} value={eyeState}>
                        {eyeState}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Attached to">
                <select
                  value={parentValue}
                  onChange={(e) => onAttachSlot(partSlotId, e.target.value)}
                  className="w-full rounded border border-border bg-background px-2 py-1"
                >
                  <option value="">None</option>
                  {parentOptions.map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {slot.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </section>

          <FlexibleSection
            doc={doc}
            slotId={partSlotId}
            role={part.role}
            parts={doc.parts.filter((candidate) => getPartSlotId(candidate) === partSlotId)}
            onSetDeform={onSetDeform}
          />

          <section className="rounded border border-border bg-panel-2 p-3">
            <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
              Variant
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Key">
                <input
                  value={variantInputKey}
                  onChange={(e) =>
                    onChange(part.id, { variant: updateVariant({ key: e.target.value }) })
                  }
                  placeholder="open"
                  className="w-full rounded border border-border bg-background px-2 py-1"
                />
              </Field>
              <Field label="Kind">
                <select
                  value={variantKind}
                  onChange={(e) =>
                    onChange(part.id, {
                      variant: updateVariant({ kind: e.target.value as CharacterVariantKind }),
                    })
                  }
                  className="w-full rounded border border-border bg-background px-2 py-1"
                >
                  {CHARACTER_VARIANT_KIND_VALUES.map((kind) => (
                    <option key={kind} value={kind}>
                      {VARIANT_KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="col-span-2">
                <Field label="Label">
                  <input
                    value={part.variant?.name ?? ""}
                    onChange={(e) =>
                      onChange(part.id, {
                        variant: updateVariant({ name: e.target.value || undefined }),
                      })
                    }
                    placeholder={variantInputKey || part.name}
                    className="w-full rounded border border-border bg-background px-2 py-1"
                  />
                </Field>
              </div>
              <div className="col-span-2">
                <VariantKeyChip part={part} issues={keyIssues.get(part.id) ?? []} />
              </div>
            </div>
          </section>

          {availableCharacterAngles(doc).length > 1 && (
            <section className="rounded border border-border bg-panel-2 p-3">
              <div className="mb-1 font-semibold uppercase tracking-wider text-muted-foreground">
                Angles
              </div>
              <div className="mb-2 text-ui-sm leading-snug text-muted-foreground">
                Which views show this drawing. All checked = shared with every angle (props,
                accessories), including ones added later.
              </div>
              <div className="flex flex-wrap gap-2">
                {availableCharacterAngles(doc).map((angle) => {
                  const available = availableCharacterAngles(doc);
                  const effective = part.angleIds?.length
                    ? part.angleIds
                    : part.angleId
                      ? [part.angleId]
                      : available;
                  const checked = effective.includes(angle);
                  const lastOne = checked && effective.length === 1;
                  return (
                    <label
                      key={angle}
                      className={`flex items-center gap-1 text-ui-sm ${
                        lastOne ? "opacity-70" : "cursor-pointer"
                      }`}
                      title={
                        lastOne
                          ? "A drawing must belong to at least one angle"
                          : `Show this drawing on ${ANGLE_LABELS[angle]}`
                      }
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={lastOne}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...effective.filter((a) => a !== angle), angle]
                            : effective.filter((a) => a !== angle);
                          const coversAll = available.every((a) => next.includes(a));
                          onChange(part.id, {
                            angleIds: coversAll ? undefined : next,
                            angleId: undefined,
                          });
                        }}
                      />
                      {ANGLE_LABELS[angle]}
                    </label>
                  );
                })}
                {!part.angleIds?.length && !part.angleId && (
                  <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-ui-sm text-emerald-300">
                    Shared
                  </span>
                )}
              </div>
            </section>
          )}
          <button
            type="button"
            onClick={() => onSwitchPhase("rig")}
            className="w-full rounded border border-dashed border-border px-2 py-1 text-ui-sm text-muted-foreground hover:text-foreground"
            title="Anchors, movement limits, and the skeleton live in the Rig phase"
          >
            Rig this layer →
          </button>
        </>
      )}

      {phase === "rig" && (
        <VariantAnchorSection
          doc={doc}
          childSlotId={getPartSlotId(part)}
          variantPreview={variantPreview}
          pinPlacement={pinPlacement}
          onPreviewVariant={onPreviewVariant}
          onArmPinPlacement={onArmPinPlacement}
          onClearPin={onClearPin}
          onResetPin={onResetPin}
          onSetRotation={onSetRotation}
        />
      )}

      {phase === "build" && (
        <>
          <ResolutionNotice part={part} />
          <section className="rounded border border-border bg-panel-2 p-3">
            <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
              Transform
            </div>
            <div className="mb-3 grid grid-cols-2 gap-1 rounded border border-border bg-background p-1">
              <button
                type="button"
                onClick={() => onBoundsModeChange("frame")}
                className={`flex items-center justify-center gap-1 rounded px-2 py-1 ${
                  boundsMode === "frame" ? "bg-primary text-primary-foreground" : "hover:bg-panel"
                }`}
                title="Use the full transparent registration frame for editor controls"
              >
                <Maximize2 size={12} />
                Frame
              </button>
              <button
                type="button"
                onClick={() => onBoundsModeChange("art")}
                className={`flex items-center justify-center gap-1 rounded px-2 py-1 ${
                  boundsMode === "art" ? "bg-primary text-primary-foreground" : "hover:bg-panel"
                }`}
                title="Use the visible non-transparent art bounds for editor controls"
              >
                <Minimize2 size={12} />
                Art
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="X" value={part.x} onChange={(x) => onChange(part.id, { x })} />
              <NumberField label="Y" value={part.y} onChange={(y) => onChange(part.id, { y })} />
              <NumberField
                label="Width"
                value={part.width}
                onChange={(width) => onChange(part.id, { width })}
              />
              <NumberField
                label="Height"
                value={part.height}
                onChange={(height) => onChange(part.id, { height })}
              />
              <NumberField
                label="Rotate"
                value={part.rotation}
                onChange={(rotation) => onChange(part.id, { rotation })}
              />
              <NumberField
                label="Draw Order"
                value={part.zIndex}
                onChange={(zIndex) => onChange(part.id, { zIndex })}
              />
              <NumberField
                label="Depth (2.5D)"
                value={part.depth}
                onChange={(depth) => onChange(part.id, { depth })}
              />
            </div>
          </section>

          <section className="rounded border border-border bg-panel-2 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold uppercase tracking-wider text-muted-foreground">
                Motion Helpers
              </span>
              <button
                onClick={() => onModeChange(mode === "select" ? "pivot" : "select")}
                className={`flex items-center gap-1 rounded border px-2 py-1 ${
                  mode === "pivot" ? "border-primary bg-primary/15" : "border-border"
                }`}
              >
                <MousePointer2 size={13} />
                Set Pivot
              </button>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <NumberField
                label="Pivot X"
                value={Math.round((part.pivot ?? alphaCenterForPart(part)).x)}
                onChange={(x) =>
                  onChange(part.id, { pivot: { x, y: (part.pivot ?? alphaCenterForPart(part)).y } })
                }
              />
              <NumberField
                label="Pivot Y"
                value={Math.round((part.pivot ?? alphaCenterForPart(part)).y)}
                onChange={(y) =>
                  onChange(part.id, { pivot: { x: (part.pivot ?? alphaCenterForPart(part)).x, y } })
                }
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => onModeChange(mode === "bounds-rect" ? "select" : "bounds-rect")}
                className={`flex-1 rounded border px-2 py-1 ${mode === "bounds-rect" ? "border-primary bg-primary/15" : "border-border"}`}
              >
                Rect Area
              </button>
              <button
                onClick={() =>
                  onModeChange(mode === "bounds-ellipse" ? "select" : "bounds-ellipse")
                }
                className={`flex-1 rounded border px-2 py-1 ${mode === "bounds-ellipse" ? "border-primary bg-primary/15" : "border-border"}`}
              >
                Ellipse Area
              </button>
            </div>
            {part.bounds && (
              <button
                onClick={() => onChange(part.id, { bounds: undefined })}
                className="mt-2 text-ui-sm text-destructive"
              >
                Clear allowed area
              </button>
            )}
          </section>
        </>
      )}

      {phase === "pose" && part.role === "mouth" && (
        <section className="rounded border border-border bg-panel-2 p-3">
          <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
            Test Talk
          </div>
          <div className="grid grid-cols-2 gap-2">
            {SAMPLE_WORDS.map((word) => (
              <button
                key={word}
                onClick={() =>
                  onPreview({
                    kind: "talk",
                    targetPartId: part.id,
                    targetSlotId: part.slotId,
                    targetRole: part.role,
                    startedAt: Date.now(),
                    durationMs: 1300,
                    visemes: wordToVisemes(word),
                  })
                }
                className="rounded border border-border px-2 py-1 hover:bg-panel"
              >
                {word}
              </button>
            ))}
          </div>
        </section>
      )}

      {phase === "pose" && previewButtons.length > 0 && (
        <section className="rounded border border-border bg-panel-2 p-3">
          <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
            Preview
          </div>
          <div className="flex flex-wrap gap-2">
            {previewButtons.map((item) => (
              <button
                key={item.kind}
                onClick={() =>
                  onPreview({
                    kind: item.kind,
                    targetPartId: part.id,
                    targetSlotId: part.slotId,
                    targetRole: part.role,
                    startedAt: Date.now(),
                    durationMs: 1200,
                  })
                }
                className="rounded border border-border px-2 py-1 hover:bg-panel"
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Flags a raster part being drawn larger than the pixels it actually has.
 *
 * SVG parts scale losslessly; PNG/JPG/WebP do not. Import never upscales — it
 * fits artwork to the canvas with `ratio = min(1, …)` — so the softness only
 * appears once someone resizes a part past its source resolution. That is where
 * this warns, rather than at import, where it would never be true.
 */
function ResolutionNotice({ part }: { part: CharacterPart }) {
  const asset = useStudio((s) => s.mediaAssets.get(part.mediaId));
  if (!asset || asset.mimeType === "image/svg+xml") return null;

  const sourceWidth = asset.width ?? 0;
  const sourceHeight = asset.height ?? 0;
  if (sourceWidth <= 0 || sourceHeight <= 0) return null;

  // A little upscaling is invisible; this is about the point it starts to show.
  const upscale = Math.max(part.width / sourceWidth, part.height / sourceHeight);
  if (upscale < 1.25) return null;

  return (
    <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-ui-sm text-amber-300">
      This artwork is {sourceWidth}×{sourceHeight} but is drawn about {Math.round(upscale * 100)}%
      of that size, so it will look soft. Use a larger image, or an SVG, if this part is meant to be
      seen close up.
    </div>
  );
}
