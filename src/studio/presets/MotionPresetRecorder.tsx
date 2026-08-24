// MotionPresetRecorder — visual pose-and-capture flow for reusable Actions and
// Expressions. The file/type names are legacy; see docs/ui-vocabulary.md.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
} from "lucide-react";
import { uid } from "../db";
import { useStudio } from "../store";
import { defaultPoseForCharacter } from "../character/pose-presets";
import { saveMotionPreset } from "./preset-persistence";
import { effectiveReachForSlot } from "../character/motion-constraints";
import {
  buildCharacterRuntime,
  resolveRuntimeSlotPart,
  runtimeBoneWorldTransforms,
  type CharacterRuntime,
} from "../character/runtime";
import {
  canvasDeltaToMotionDelta,
  recordedOverrideTarget,
  runtimeMotionTargetForSlot,
  slotIdForRecordedOverride,
} from "../character/motion-targets";
import { runtimePartFrameContains } from "../character/part-frame";
import {
  angleRigJsonFromPreset,
  characterJsonFromPreset,
  motionJsonFilename,
} from "../character-json/normalize";
import { buildMotionRequestPrompt } from "../character-json/ai-context";
import { useConfirm, useNotify } from "../components/ConfirmDialog";
import {
  ACTION_CATEGORY_TABS,
  ACTION_REGION_OPTIONS,
  actionRegionLabel,
  defaultActionRegionForCategory,
} from "./action-terminology";
import { sampleKeyposesAtTime } from "./keypose-sampling";
import {
  motionJsonToPreset,
  normalizeMotionInput,
  parseJsonArtifact,
  validateMotionJsonForAngle,
} from "./motion-json";
import { AiAddonPromptPanel, GeneratedEditorShell } from "../ai/generated-editor";
import { buildJsonRepairPrompt } from "../ai/external-ai";
import {
  useAiGeneratedArtifactAddon,
  type AiGeneratedFeatureAdapter,
} from "../ai/generated-artifact";
import {
  type DrillPick,
  exceedsDragThreshold,
  resolveDragSubject,
  resolveDrillSelection,
} from "../interaction/select-drag";
import { startWindowPointerDrag } from "../interaction/pointer-drag";
import type {
  CharacterBone,
  CharacterPart,
  CharacterPreset,
  MotionCategory,
  MotionPreset,
  MotionRegion,
  RecordedKeypose,
  RecordedPartOverride,
} from "../types";
import type { MotionJson } from "../character-json/schema";
import {
  ControlPropertiesPanel,
  KeyposeStrip,
  PartList,
  PropertiesPanel,
  PropertyRow,
} from "./MotionPresetRecorderPanels";
import {
  AnchorDebugOverlay,
  ReactPoseCanvas,
  RecorderPixiPreview,
  SelectionHandles,
} from "./MotionPresetRecorderPreview";
import {
  activeVariantsForRecorderOverrides,
  constrainRecorderOverrides,
  recorderMotionTargetForSlot,
  recorderPartFrame,
  recorderPartPlacement,
} from "./motion-recorder-geometry";
import { recorderPatchEqual, useRafCoalescedCallback } from "./motion-recorder-interactions";
import {
  adjacentKeyposeIndex,
  cloneKeyposes,
  controlOverrideMapsEqual,
  customPresetName,
  defaultControlOverride,
  defaultOverride,
  editorTitle,
  findKeyposeAt,
  initialKeyposesForPreset,
  isDirtyOverride,
  isDirtyControlOverride,
  keyposeDraftSignature,
  recorderPreviewPreset,
  recorderOverrideMapsEqual,
  recorderOverridesEqual,
  round,
  type CharacterSlot,
  type RecorderControlState,
  type FlexiblePointChange,
  type RecorderOverridePatch,
  type RecorderPartState,
} from "./motion-recorder-state";

const CATEGORIES = ACTION_CATEGORY_TABS.filter((tab) => tab.id !== "all");

interface SelectPopover {
  x: number;
  y: number;
  slots: CharacterSlot[];
}

export function MotionPresetRecorder({
  character,
  onClose,
  initialPreset,
  initialCategory,
  onSaved,
  copyOnSave,
}: {
  character: CharacterPreset;
  onClose: () => void;
  initialPreset?: MotionPreset;
  initialCategory?: MotionCategory;
  onSaved?: (preset: MotionPreset) => void;
  /** Deprecated: action editing must not mutate character artwork/rig structure. */
  onCharacterChange?: (next: CharacterPreset) => void;
  copyOnSave?: boolean;
}) {
  const confirm = useConfirm();
  const notify = useNotify();
  const runtime = useMemo(() => buildCharacterRuntime(character), [character]);
  const rig = runtime.rig;
  const slots = runtime.slots;
  const controls = useMemo(
    () => runtime.angleRig.bones.filter((bone): bone is CharacterBone => !!bone.controlKind),
    [runtime.angleRig.bones],
  );
  // The same resolved runtime boundary the compiled timeline clamps through — editing is WYSIWYG.
  const constraintCtx = runtime.constraintContext;
  const [name, setName] = useState(
    initialPreset && (initialPreset.builtin || copyOnSave)
      ? customPresetName(initialPreset.name)
      : (initialPreset?.name ?? "New action"),
  );
  const [category, setCategory] = useState<MotionCategory>(
    initialPreset?.category ?? initialCategory ?? "full-body",
  );
  const [kinematics, setKinematics] = useState<"fk" | "ik">(initialPreset?.kinematics ?? "fk");
  const [region, setRegion] = useState<MotionRegion | "">(
    initialPreset?.region ??
      defaultActionRegionForCategory(initialPreset?.category ?? initialCategory ?? "full-body"),
  );
  const [duration, setDuration] = useState(initialPreset?.duration ?? 1);
  const initialRecorderKeyposes = useMemo(
    () => initialKeyposesForPreset(initialPreset, runtime),
    [initialPreset, runtime],
  );
  const [time, setTime] = useState(0);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [keyposes, setKeyposes] = useState<RecordedKeypose[]>(() =>
    cloneKeyposes(initialRecorderKeyposes),
  );
  const [selectedKeyposeTime, setSelectedKeyposeTime] = useState<number | null>(
    () => initialRecorderKeyposes[0]?.t ?? null,
  );
  const [overrides, setOverrides] = useState<Map<string, RecorderPartState>>(new Map());
  const [controlOverrides, setControlOverrides] = useState<Map<string, RecorderControlState>>(
    new Map(),
  );
  const [draftDirty, setDraftDirty] = useState(false);
  // Layers this action may push past the character's reach (slot ids and/or roles) — the
  // per-action escape hatch. Carried from the loaded preset and saved back with it.
  const [allowOutOfBounds, setAllowOutOfBounds] = useState<string[]>(
    () => initialPreset?.allowOutOfBounds ?? [],
  );
  const [faceTurnX, setFaceTurnX] = useState(initialRecorderKeyposes[0]?.faceTurnX ?? 0);
  const [faceTurnY, setFaceTurnY] = useState(initialRecorderKeyposes[0]?.faceTurnY ?? 0);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [selectedControlId, setSelectedControlId] = useState<string | null>(null);
  // Transient editor lock for this recording session — locked slots ignore canvas
  // clicks/drags (still selectable from the part list). Parts locked in the character
  // editor (part.locked) are also treated as locked here.
  const [lockedSlotIds, setLockedSlotIds] = useState<Set<string>>(new Set());
  const [fitScale, setFitScale] = useState(0.5);
  const [previewMode, setPreviewMode] = useState<"fit" | "export">("fit");
  // Dev-only visual debugger for variant anchors (bone pivots, anchor targets, resolution path).
  const [showAnchorDebug, setShowAnchorDebug] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [playbackCompileRevision, setPlaybackCompileRevision] = useState(0);
  const [selectPopover, setSelectPopover] = useState<SelectPopover | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [onionSkin, setOnionSkin] = useState<"off" | "previous" | "next" | "both">("off");
  const [lastStampedTime, setLastStampedTime] = useState<number | null>(null);
  const wrapRef = useRef<HTMLElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const lastPickRef = useRef<DrillPick | null>(null);
  const lastLoadedDraftRef = useRef<string | null>(null);
  const basePoses = useMemo(() => defaultPoseForCharacter(character), [character]);
  const characterJson = useMemo(() => characterJsonFromPreset(character), [character]);
  const activeAngleRig = useMemo(() => angleRigJsonFromPreset(character), [character]);
  const activePartForSlot = useCallback(
    (slot: CharacterSlot, poseSwap?: string) => {
      const poseKey = poseSwap ?? basePoses[slot.id];
      return resolveRuntimeSlotPart(slot, runtime, poseKey);
    },
    [basePoses, runtime],
  );
  const motionAiAdapter = useMemo<AiGeneratedFeatureAdapter<MotionJson>>(
    () => ({
      featureName: "Studio Boom action editor",
      artifactLabel: "action JSON",
      buildPrompt: (request) =>
        buildMotionRequestPrompt({
          character: characterJson,
          activeAngle: activeAngleRig,
          request,
        }),
      parseArtifact: (source) => {
        const parsed = parseJsonArtifact(source);
        if (parsed.error) return { ok: false, errors: [`Invalid JSON: ${parsed.error}`] };

        const { motion, warnings: shapeWarnings } = normalizeMotionInput(parsed.value);
        if (!motion) {
          return {
            ok: false,
            errors: ['Paste an action: a JSON object with a "tracks" array.'],
          };
        }

        const validation = validateMotionJsonForAngle(motion, activeAngleRig);
        const warnings = [
          ...shapeWarnings,
          ...validation.warnings.map((issue) => `${issue.path}: ${issue.message}`),
        ];
        if (!validation.ok) {
          return {
            ok: false,
            errors: validation.errors.map((issue) => `${issue.path}: ${issue.message}`),
            warnings,
          };
        }

        return { ok: true, artifact: motion, warnings };
      },
      loadArtifact: (motion) => {
        const converted = motionJsonToPreset(motion, activeAngleRig, { id: uid() });
        if (!converted.preset) {
          return {
            ok: false,
            errors: converted.errors,
            warnings: converted.warnings,
          };
        }

        setName(converted.preset.name);
        setCategory(converted.preset.category);
        setKinematics(converted.preset.kinematics ?? "fk");
        setRegion(
          converted.preset.region ?? defaultActionRegionForCategory(converted.preset.category),
        );
        setDuration(converted.preset.duration);
        const nextKeyposes = initialKeyposesForPreset(converted.preset, runtime);
        setKeyposes(nextKeyposes);
        setSelectedKeyposeTime(nextKeyposes[0]?.t ?? null);
        setAllowOutOfBounds(converted.preset.allowOutOfBounds ?? []);
        setDraftDirty(false);
        setTime(0);
        setPlaybackTime(0);
        setPreviewPlaying(false);

        return {
          ok: true,
          message: `Loaded "${converted.preset.name}" into the editor. Preview, tweak, then save.`,
          warnings: converted.warnings,
          summary: {
            title: converted.preset.name,
            detail: "Loaded into the action editor.",
            items: [
              `Category: ${editorTitle(converted.preset.category)}`,
              `Duration: ${converted.preset.duration.toFixed(2)}s`,
              `Keyposes: ${converted.preset.keyposes?.length ?? 0}`,
            ],
          },
        };
      },
      buildRepairPrompt: ({ errors, source }) =>
        buildJsonRepairPrompt({
          featureName: "Studio Boom action editor",
          artifactLabel: "action JSON",
          errors,
          source,
        }),
    }),
    [activeAngleRig, characterJson, runtime],
  );
  const aiAddon = useAiGeneratedArtifactAddon(motionAiAdapter, {
    initialRequest: "Create a forward walk cycle.",
  });

  useEffect(() => {
    if (!selectedSlotId && !selectedControlId && slots.length > 0) setSelectedSlotId(slots[0].id);
  }, [selectedControlId, selectedSlotId, slots]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth - 32;
      const h = el.clientHeight - 32;
      setFitScale(
        Math.max(0.1, Math.min(w / character.canvasWidth, h / character.canvasHeight, 1)),
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [character.canvasWidth, character.canvasHeight]);

  useEffect(() => {
    if (!previewPlaying) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const maxTime = Math.max(0.1, duration);
      const dt = Math.max(0, (now - last) / 1000);
      last = now;
      setPlaybackTime((current) => {
        const next = current + dt;
        return next >= maxTime ? next % maxTime : next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, previewPlaying]);

  useEffect(() => {
    setTime((current) => Math.min(current, Math.max(0.1, duration)));
    setPlaybackTime((current) => Math.min(current, Math.max(0.1, duration)));
  }, [duration]);

  const stopCompiledPreview = useCallback(() => {
    setPreviewPlaying(false);
  }, []);

  const resolveSampleToDraftState = useCallback(
    (sample: ReturnType<typeof sampleKeyposesAtTime>) => {
      const next = new Map<string, RecorderPartState>();
      const nextControls = new Map<string, RecorderControlState>();
      for (const ov of sample.parts.values()) {
        const control =
          ov.target === "bone" && ov.boneId
            ? controls.find((candidate) => candidate.id === ov.boneId)
            : undefined;
        if (control) {
          nextControls.set(control.id, {
            ...defaultControlOverride(control),
            dx: ov.dx ?? 0,
            dy: ov.dy ?? 0,
            rotation: ov.rotation ?? 0,
          });
          continue;
        }
        const slotId = slotIdForRecordedOverride(runtime, ov);
        const slot = slotId ? runtime.slotById.get(slotId) : undefined;
        if (!slot) continue;
        const poseSwap = ov.poseSwap;
        const part = activePartForSlot(slot, poseSwap);
        next.set(slot.id, {
          ...defaultOverride(slot.id, part),
          target: ov.target,
          boneId: ov.boneId,
          poseSwap,
          dx: ov.dx ?? 0,
          dy: ov.dy ?? 0,
          scale: ov.scale ?? 1,
          scaleX: ov.scaleX ?? 1,
          scaleY: ov.scaleY ?? 1,
          skewX: ov.skewX ?? 0,
          skewY: ov.skewY ?? 0,
          rotation: ov.rotation ?? 0,
          bend: ov.bend ?? 0,
          pathEndX: ov.pathEndX ?? 0,
          pathEndY: ov.pathEndY ?? 0,
          pathCurveX: ov.pathCurveX ?? 0,
          pathCurveY: ov.pathCurveY ?? 0,
          originX: ov.originX ?? part?.anchorX ?? 0.5,
          originY: ov.originY ?? part?.anchorY ?? 0.5,
          opacity: ov.opacity ?? 1,
        });
      }
      const constrained = constrainRecorderOverrides({
        character,
        rig,
        runtime,
        slots,
        overrides: next,
        activePartForSlot,
        basePoses,
        constraintCtx,
        allowOutOfBounds,
        faceTurnX: sample.faceTurnX,
        faceTurnY: sample.faceTurnY,
      });
      return {
        overrides: constrained,
        controlOverrides: nextControls,
        faceTurnX: sample.faceTurnX,
        faceTurnY: sample.faceTurnY,
      };
    },
    [
      activePartForSlot,
      allowOutOfBounds,
      basePoses,
      character,
      constraintCtx,
      controls,
      rig,
      runtime,
      slots,
    ],
  );

  const applySampleToDraft = useCallback(
    (
      sample: ReturnType<typeof sampleKeyposesAtTime>,
      nextTime: number,
      sourceKeypose?: RecordedKeypose | null,
    ) => {
      const draft = resolveSampleToDraftState(sample);
      setOverrides((prev) =>
        recorderOverrideMapsEqual(prev, draft.overrides) ? prev : draft.overrides,
      );
      setControlOverrides((prev) =>
        controlOverrideMapsEqual(prev, draft.controlOverrides) ? prev : draft.controlOverrides,
      );
      setFaceTurnX(draft.faceTurnX);
      setFaceTurnY(draft.faceTurnY);
      setTime(Math.max(0, Math.min(duration, nextTime)));
      setSelectedKeyposeTime(sourceKeypose?.t ?? null);
      setDraftDirty(false);
      lastLoadedDraftRef.current = sourceKeypose ? keyposeDraftSignature(sourceKeypose) : null;
      stopCompiledPreview();
    },
    [duration, resolveSampleToDraftState, stopCompiledPreview],
  );

  const applyKeyposeToDraft = useCallback(
    (keypose: RecordedKeypose) => {
      applySampleToDraft(sampleKeyposesAtTime([keypose], keypose.t), keypose.t, keypose);
    },
    [applySampleToDraft],
  );

  const confirmDiscardDraft = useCallback(async () => {
    if (!draftDirty) return true;
    return confirm({
      title: "Discard unstamped pose edits?",
      body: ["Loading a different stamp replaces what you have not stamped yet."],
      confirmLabel: "Discard",
      destructive: true,
    });
  }, [confirm, draftDirty]);

  useEffect(() => {
    if (draftDirty) return;
    const selected =
      selectedKeyposeTime == null ? keyposes[0] : findKeyposeAt(keyposes, selectedKeyposeTime);
    if (!selected) return;
    const signature = keyposeDraftSignature(selected);
    if (lastLoadedDraftRef.current === signature) return;
    applyKeyposeToDraft(selected);
  }, [applyKeyposeToDraft, draftDirty, keyposes, selectedKeyposeTime]);

  const displayScale = previewMode === "export" ? 1 : fitScale;
  const selectedSlot = slots.find((slot) => slot.id === selectedSlotId) ?? null;
  const selectedControl = controls.find((control) => control.id === selectedControlId) ?? null;
  const selectedControlOverride = selectedControl
    ? (controlOverrides.get(selectedControl.id) ?? defaultControlOverride(selectedControl))
    : null;
  const selectedOverrideFromMap = selectedSlotId ? overrides.get(selectedSlotId) : undefined;
  const selectedPart = selectedSlot
    ? (activePartForSlot(selectedSlot, selectedOverrideFromMap?.poseSwap) ?? null)
    : null;
  const selectedOverride = selectedSlotId
    ? (selectedOverrideFromMap ?? defaultOverride(selectedSlotId, selectedPart ?? undefined))
    : null;
  const activeVariantsBySlot = useMemo(() => {
    const map: Record<string, string> = { ...basePoses };
    for (const [id, override] of overrides) {
      if (override.poseSwap) map[id] = override.poseSwap;
    }
    return map;
  }, [basePoses, overrides]);
  const poseWorldByBone = useMemo(
    () => runtimeBoneWorldTransforms(runtime, activeVariantsBySlot),
    [activeVariantsBySlot, runtime],
  );
  // The selected part's runtime frame (alpha quad + pivot + matrix), shared by
  // the action-editor handles and hit testing so both agree on the same geometry.
  const selectionFrame =
    selectedSlot && selectedPart && selectedOverride
      ? recorderPartFrame(
          selectedSlot,
          selectedPart,
          selectedOverride,
          runtime,
          overrides,
          activePartForSlot,
          faceTurnX,
          faceTurnY,
          character.canvasWidth,
          character.canvasHeight,
          activeVariantsBySlot,
          poseWorldByBone,
        )
      : null;
  const selectedRotationLimit = useMemo(() => {
    if (!selectedSlot) return null;
    const { reach, source } = effectiveReachForSlot(
      constraintCtx,
      selectedSlot.id,
      activeVariantsBySlot,
    );
    return reach?.rotReach
      ? { ...reach.rotReach, variantLimited: source === "variantRotationLimits" }
      : null;
  }, [activeVariantsBySlot, constraintCtx, selectedSlot]);
  const selectedAllowsOutOfBounds = selectedSlot
    ? allowOutOfBounds.includes(selectedSlot.id) || allowOutOfBounds.includes(selectedSlot.role)
    : false;
  const setSelectedAllowOutOfBounds = (allowed: boolean) => {
    if (!selectedSlot) return;
    stopCompiledPreview();
    setDraftDirty(true);
    setAllowOutOfBounds((prev) => {
      const withoutSlot = prev.filter((id) => id !== selectedSlot.id && id !== selectedSlot.role);
      return allowed ? [...withoutSlot, selectedSlot.id] : withoutSlot;
    });
  };

  const currentRecordedParts = useCallback((): RecordedPartOverride[] => {
    const parts: RecordedPartOverride[] = [];
    for (const ov of overrides.values()) {
      const slot = slots.find((s) => s.id === ov.slotId);
      const poseSwap = ov.poseSwap;
      const activePart = slot ? activePartForSlot(slot, poseSwap) : undefined;
      const normalizedOverride = { ...ov, poseSwap };
      if (!slot || !isDirtyOverride(normalizedOverride, activePart)) continue;
      const part: RecordedPartOverride = recordedOverrideTarget(
        runtimeMotionTargetForSlot(runtime, slot.id),
        slot.role,
      );
      if (poseSwap) part.poseSwap = poseSwap;
      if (ov.dx !== 0) part.dx = ov.dx;
      if (ov.dy !== 0) part.dy = ov.dy;
      if (ov.scale !== 1) part.scale = ov.scale;
      if (ov.scaleX !== 1) part.scaleX = ov.scaleX;
      if (ov.scaleY !== 1) part.scaleY = ov.scaleY;
      if (ov.skewX !== 0) part.skewX = ov.skewX;
      if (ov.skewY !== 0) part.skewY = ov.skewY;
      if (ov.rotation !== 0) part.rotation = ov.rotation;
      if (ov.bend !== 0) part.bend = ov.bend;
      if (ov.pathEndX !== 0) part.pathEndX = ov.pathEndX;
      if (ov.pathEndY !== 0) part.pathEndY = ov.pathEndY;
      if (ov.pathCurveX !== 0) part.pathCurveX = ov.pathCurveX;
      if (ov.pathCurveY !== 0) part.pathCurveY = ov.pathCurveY;
      if (ov.originX !== (activePart?.anchorX ?? 0.5)) part.originX = ov.originX;
      if (ov.originY !== (activePart?.anchorY ?? 0.5)) part.originY = ov.originY;
      if (ov.opacity !== 1) part.opacity = ov.opacity;
      parts.push(part);
    }
    for (const controlOverride of controlOverrides.values()) {
      if (!isDirtyControlOverride(controlOverride)) continue;
      parts.push({
        target: "bone",
        boneId: controlOverride.controlId,
        partRole: "custom",
        ...(controlOverride.dx !== 0 ? { dx: controlOverride.dx } : {}),
        ...(controlOverride.dy !== 0 ? { dy: controlOverride.dy } : {}),
        ...(controlOverride.rotation !== 0 ? { rotation: controlOverride.rotation } : {}),
      });
    }
    return parts;
  }, [activePartForSlot, controlOverrides, overrides, runtime, slots]);

  const sortedKeyposes = useMemo(
    () => cloneKeyposes(keyposes).sort((a, b) => a.t - b.t),
    [keyposes],
  );

  const playbackPreviewPreset = useMemo(() => {
    if (sortedKeyposes.length === 0) return null;
    return recorderPreviewPreset({
      name,
      category,
      region,
      duration,
      keyposes: sortedKeyposes,
      allowOutOfBounds,
      kinematics,
    });
  }, [allowOutOfBounds, category, duration, kinematics, name, region, sortedKeyposes]);
  const livePreviewPreset = useMemo(
    () =>
      recorderPreviewPreset({
        name,
        category,
        region,
        duration: 0.1,
        keyposes: [
          {
            t: 0,
            parts: currentRecordedParts(),
            faceTurnX: faceTurnX === 0 ? undefined : faceTurnX,
            faceTurnY: faceTurnY === 0 ? undefined : faceTurnY,
          },
        ],
        allowOutOfBounds,
        kinematics,
      }),
    [
      allowOutOfBounds,
      category,
      currentRecordedParts,
      faceTurnX,
      faceTurnY,
      kinematics,
      name,
      region,
    ],
  );

  const commitRecorderPreviewToHtml = useCallback(() => {
    setPlaybackCompileRevision((revision) => revision + 1);
    setPlaybackTime(0);
    setPreviewPlaying(true);
  }, []);

  const refreshPlaybackPreview = useCallback((nextTime?: number) => {
    setPreviewPlaying(false);
    if (nextTime !== undefined) setPlaybackTime(Math.max(0, nextTime));
    setPlaybackCompileRevision((revision) => revision + 1);
  }, []);

  const updateOverrides = useCallback(
    (updates: RecorderOverridePatch[]) => {
      if (updates.length === 0) return;
      stopCompiledPreview();
      setDraftDirty(true);
      setOverrides((prev) => {
        const next = new Map(prev);
        let changed = false;
        for (const { slotId, patch } of updates) {
          const slot = slots.find((item) => item.id === slotId);
          const cur = next.get(slotId);
          const curPart = slot ? activePartForSlot(slot, cur?.poseSwap) : undefined;
          const base = cur ?? defaultOverride(slotId, curPart);
          const targetMeta = slot ? recorderMotionTargetForSlot(slot, runtime) : {};
          const current = { ...base, ...targetMeta };
          const merged = { ...current, ...patch };
          if (recorderOverridesEqual(current, merged)) continue;
          next.set(slotId, merged);
          changed = true;
        }
        if (!changed) return prev;
        const constrained = constrainRecorderOverrides({
          character,
          rig,
          runtime,
          slots,
          overrides: next,
          activePartForSlot,
          basePoses,
          constraintCtx,
          allowOutOfBounds,
          faceTurnX,
          faceTurnY,
        });
        return recorderOverrideMapsEqual(prev, constrained) ? prev : constrained;
      });
    },
    [
      activePartForSlot,
      allowOutOfBounds,
      basePoses,
      character,
      constraintCtx,
      faceTurnX,
      faceTurnY,
      rig,
      runtime,
      slots,
      stopCompiledPreview,
    ],
  );
  const updateOverride = useCallback(
    (slotId: string, patch: Partial<RecorderPartState>) => updateOverrides([{ slotId, patch }]),
    [updateOverrides],
  );
  const updateControlOverride = useCallback(
    (controlId: string, patch: Partial<RecorderControlState>) => {
      stopCompiledPreview();
      setDraftDirty(true);
      setControlOverrides((prev) => {
        const control = controls.find((candidate) => candidate.id === controlId);
        if (!control) return prev;
        const current = prev.get(controlId) ?? defaultControlOverride(control);
        const next = new Map(prev);
        next.set(controlId, { ...current, ...patch });
        return next;
      });
    },
    [controls, stopCompiledPreview],
  );
  const handleFlexiblePointChange = useCallback(
    ({ patch }: FlexiblePointChange) => {
      if (!selectedSlotId) return;
      updateOverride(selectedSlotId, patch);
    },
    [selectedSlotId, updateOverride],
  );
  const queuedOverrideUpdate = useRafCoalescedCallback<{
    slotId: string;
    patch: Partial<RecorderPartState>;
  }>(({ slotId, patch }) => updateOverride(slotId, patch));

  const clearOverride = (slotId: string) => {
    stopCompiledPreview();
    setDraftDirty(true);
    setOverrides((prev) => {
      const next = new Map(prev);
      next.delete(slotId);
      return next;
    });
  };

  const clearControlOverride = (controlId: string) => {
    stopCompiledPreview();
    setDraftDirty(true);
    setControlOverrides((prev) => {
      const next = new Map(prev);
      next.delete(controlId);
      return next;
    });
  };

  // A slot is locked if it's locked for this session or its active part is locked in the
  // character editor — locked slots ignore canvas clicks/drags entirely.
  const isSlotLocked = (slotId: string) =>
    lockedSlotIds.has(slotId) ||
    !!activePartForSlot(slots.find((slot) => slot.id === slotId)!, undefined)?.locked;

  const toggleSlotLocked = (slotId: string) =>
    setLockedSlotIds((prev) => {
      const next = new Set(prev);
      if (next.has(slotId)) next.delete(slotId);
      else next.add(slotId);
      return next;
    });

  // Ordered stack of slots under a point, topmost first, with locked slots excluded.
  const slotsAtPoint = (clientX: number, clientY: number) => {
    const rect = planeRef.current?.getBoundingClientRect();
    if (!rect) return [];
    const x = (clientX - rect.left) / displayScale;
    const y = (clientY - rect.top) / displayScale;
    return slots
      .filter((slot) => {
        const part = activePartForSlot(slot, overrides.get(slot.id)?.poseSwap);
        if (!part?.visible || part.locked || lockedSlotIds.has(slot.id)) return false;
        const frame = recorderPartFrame(
          slot,
          part,
          overrides.get(slot.id) ?? defaultOverride(slot.id, part),
          runtime,
          overrides,
          activePartForSlot,
          faceTurnX,
          faceTurnY,
          character.canvasWidth,
          character.canvasHeight,
          activeVariantsBySlot,
          poseWorldByBone,
        );
        return runtimePartFrameContains(frame, { x, y });
      })
      .sort((a, b) => {
        const aPart = activePartForSlot(a, overrides.get(a.id)?.poseSwap);
        const bPart = activePartForSlot(b, overrides.get(b.id)?.poseSwap);
        return (
          (bPart
            ? recorderPartPlacement(b, bPart, runtime, activeVariantsBySlot, poseWorldByBone)
                .drawOrder
            : 0) -
          (aPart
            ? recorderPartPlacement(a, aPart, runtime, activeVariantsBySlot, poseWorldByBone)
                .drawOrder
            : 0)
        );
      });
  };

  // Figma-style canvas select/drag (shared model — see select-drag.ts), centralized on the
  // pose plane so the full z-stack is considered: a click selects the top slot and drills
  // under it on a repeat click; a drag moves the already-selected slot from anywhere even
  // when overlapped, or selects+drags an unselected slot in one gesture. Alt-click opens
  // the candidate popover. Selection never changes mid-drag.
  const handlePlanePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const candidates = slotsAtPoint(e.clientX, e.clientY);
    if (e.altKey) {
      e.stopPropagation();
      if (candidates.length > 0)
        setSelectPopover({ x: e.clientX, y: e.clientY, slots: candidates });
      return;
    }
    const candidateIds = candidates.map((slot) => slot.id);
    const subjectId = resolveDragSubject(candidateIds, selectedSlotId) ?? selectedSlotId;
    if (subjectId) e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const ox = subjectId ? (overrides.get(subjectId)?.dx ?? 0) : 0;
    const oy = subjectId ? (overrides.get(subjectId)?.dy ?? 0) : 0;
    const subjectTarget = subjectId ? runtimeMotionTargetForSlot(runtime, subjectId) : undefined;
    let dragging = false;
    let lastPatch: Partial<RecorderPartState> | null = null;

    const queuePatch = (patch: Partial<RecorderPartState>) => {
      if (!subjectId || recorderPatchEqual(lastPatch, patch)) return;
      lastPatch = patch;
      queuedOverrideUpdate.queue({ slotId: subjectId, patch });
    };

    const move = (ev: PointerEvent) => {
      if (!subjectId) return;
      if (!dragging) {
        if (!exceedsDragThreshold({ x: startX, y: startY }, { x: ev.clientX, y: ev.clientY }))
          return;
        dragging = true;
        if (subjectId !== selectedSlotId) setSelectedSlotId(subjectId);
        setSelectPopover(null);
      }
      const canvasDelta = {
        x: (ev.clientX - startX) / displayScale,
        y: (ev.clientY - startY) / displayScale,
      };
      const delta = subjectTarget
        ? canvasDeltaToMotionDelta(runtime, subjectTarget, canvasDelta, poseWorldByBone)
        : canvasDelta;
      queuePatch({
        dx: Math.round(ox + delta.x),
        dy: Math.round(oy + delta.y),
      });
    };
    const up = (ev: PointerEvent | null) => {
      if (dragging) {
        if (ev) move(ev);
        queuedOverrideUpdate.flush();
        return;
      }
      queuedOverrideUpdate.cancel();
      const { id, nextPick } = resolveDrillSelection(candidateIds, lastPickRef.current, {
        x: startX,
        y: startY,
      });
      lastPickRef.current = nextPick;
      if (id) {
        setSelectedSlotId(id);
        setSelectPopover(null);
      }
    };
    startWindowPointerDrag({ onMove: move, onEnd: up, onCancel: queuedOverrideUpdate.cancel });
  };

  const draftKeypose = useCallback(
    (source?: RecordedKeypose | null): RecordedKeypose => ({
      t: round(Math.max(0, Math.min(duration, time)), 2),
      parts: currentRecordedParts(),
      faceTurnX: faceTurnX === 0 ? undefined : faceTurnX,
      faceTurnY: faceTurnY === 0 ? undefined : faceTurnY,
      ease: source?.ease ?? "easeInOut",
      anticipation: source?.anticipation,
    }),
    [currentRecordedParts, duration, faceTurnX, faceTurnY, time],
  );

  const stampKeypose = (mode: "new" | "update") => {
    const selected =
      selectedKeyposeTime == null ? null : findKeyposeAt(keyposes, selectedKeyposeTime);
    if (mode === "update" && !selected) {
      void notify({ title: "Select a stamp before updating it." });
      return;
    }
    const source = mode === "update" ? selected : undefined;
    const kp = draftKeypose(source);
    const targetCollision = findKeyposeAt(keyposes, kp.t);
    const collisionIsSelected =
      !!selected && !!targetCollision && Math.abs(targetCollision.t - selected.t) <= 0.001;
    if (mode === "new" && targetCollision) {
      void notify({
        title: `There is already a stamp at ${kp.t.toFixed(2)}s`,
        body: ["Move the draft time to add a new stamp, or update the selected one."],
      });
      return;
    }
    if (mode === "update" && targetCollision && !collisionIsSelected) {
      void notify({
        title: `Another stamp already uses ${kp.t.toFixed(2)}s`,
        body: ["Choose a different time before updating."],
      });
      return;
    }
    setKeyposes((prev) => {
      const filtered = prev.filter((k) => {
        if (mode === "update" && selected && Math.abs(k.t - selected.t) <= 0.001) return false;
        return true;
      });
      return [...filtered, kp].sort((a, b) => a.t - b.t);
    });
    setSelectedKeyposeTime(kp.t);
    setDraftDirty(false);
    setLastStampedTime(kp.t);
    lastLoadedDraftRef.current = keyposeDraftSignature(kp);
    refreshPlaybackPreview(kp.t);
  };

  const updateKeypose = (t: number, patch: Partial<RecordedKeypose>) => {
    refreshPlaybackPreview();
    setKeyposes((prev) =>
      prev.map((kp) => (Math.abs(kp.t - t) <= 0.001 ? { ...kp, ...patch } : kp)),
    );
  };

  const moveKeyposeTime = (from: number, nextTime: number) => {
    const clamped = round(Math.max(0, Math.min(duration, nextTime)), 2);
    const collision = keyposes.some(
      (keypose) => Math.abs(keypose.t - from) > 0.001 && Math.abs(keypose.t - clamped) <= 0.001,
    );
    if (collision) {
      void notify({ title: `Another stamp already uses ${clamped.toFixed(2)}s` });
      return;
    }
    refreshPlaybackPreview(clamped);
    setKeyposes((prev) =>
      prev
        .map((kp) => (Math.abs(kp.t - from) <= 0.001 ? { ...kp, t: clamped } : kp))
        .sort((a, b) => a.t - b.t),
    );
    if (selectedKeyposeTime != null && Math.abs(selectedKeyposeTime - from) <= 0.001) {
      setSelectedKeyposeTime(clamped);
      setTime(clamped);
    }
  };

  const removeKeypose = (t: number) => {
    refreshPlaybackPreview();
    setKeyposes((prev) => prev.filter((k) => Math.abs(k.t - t) > 0.001));
    if (selectedKeyposeTime != null && Math.abs(selectedKeyposeTime - t) <= 0.001) {
      setSelectedKeyposeTime(null);
      setDraftDirty(false);
    }
  };

  const selectKeypose = async (keypose: RecordedKeypose) => {
    if (!(await confirmDiscardDraft())) return;
    applyKeyposeToDraft(keypose);
  };

  const selectAdjacentKeypose = (direction: -1 | 1) => {
    const nextIndex = adjacentKeyposeIndex(sortedKeyposes, selectedKeyposeTime, time, direction);
    if (nextIndex < 0) return;
    const nextKeypose = sortedKeyposes[nextIndex];
    if (nextKeypose) void selectKeypose(nextKeypose);
  };

  const loadPlaybackFrameAsDraft = async () => {
    if (!(await confirmDiscardDraft())) return;
    applySampleToDraft(sampleKeyposesAtTime(sortedKeyposes, playbackTime), playbackTime, null);
    setDraftDirty(true);
  };

  const spaceKeyposesEvenly = () => {
    if (keyposes.length < 2) return;
    refreshPlaybackPreview();
    setKeyposes((prev) => {
      const sorted = cloneKeyposes(prev).sort((a, b) => a.t - b.t);
      const step = duration / Math.max(1, sorted.length - 1);
      return sorted.map((keypose, index) => ({ ...keypose, t: round(step * index, 2) }));
    });
    setSelectedKeyposeTime((current) => {
      if (current == null) return current;
      const index = sortedKeyposes.findIndex((keypose) => Math.abs(keypose.t - current) <= 0.001);
      if (index < 0) return current;
      return round((duration / Math.max(1, sortedKeyposes.length - 1)) * index, 2);
    });
  };

  const requestClose = async () => {
    if (draftDirty) {
      const discard = await confirm({
        title: "Discard unstamped pose edits?",
        body: ["Closing the action editor loses changes you have not stamped."],
        confirmLabel: "Discard and close",
        destructive: true,
      });
      if (!discard) return;
    }
    onClose();
  };

  const save = async () => {
    if (sortedKeyposes.length === 0) {
      void notify({
        title: "Stamp at least one pose before saving",
        body: ["An action needs a pose to animate towards."],
      });
      return;
    }
    if (draftDirty) {
      const saveAnyway = await confirm({
        title: "Save without the unstamped pose edits?",
        body: ["The edits you have not stamped will not be part of this action."],
        confirmLabel: "Save anyway",
      });
      if (!saveAnyway) return;
    }
    const now = Date.now();
    const savingCopy = !!initialPreset && (!!initialPreset.builtin || !!copyOnSave);
    const preset: MotionPreset = {
      id: savingCopy ? uid() : (initialPreset?.id ?? uid()),
      name: name.trim() || "Untitled action",
      category,
      region: region || undefined,
      duration: Math.max(0.1, duration),
      loop: initialPreset?.loop ?? false,
      tracks: [],
      keyposes: cloneKeyposes(sortedKeyposes).sort((a, b) => a.t - b.t),
      kinematics,
      allowOutOfBounds: allowOutOfBounds.length ? [...allowOutOfBounds] : undefined,
      builtin: false,
      createdAt: savingCopy ? now : (initialPreset?.createdAt ?? now),
      updatedAt: now,
    };
    await saveMotionPreset(preset);
    useStudio.getState().registerMotionPreset(preset);
    onSaved?.(preset);
    onClose();
  };

  useEffect(() => {
    if (!draftDirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [draftDirty]);

  const selectedKeyposeIndex =
    selectedKeyposeTime == null
      ? -1
      : sortedKeyposes.findIndex((keypose) => Math.abs(keypose.t - selectedKeyposeTime) <= 0.001);
  const previousStampIndex = adjacentKeyposeIndex(sortedKeyposes, selectedKeyposeTime, time, -1);
  const nextStampIndex = adjacentKeyposeIndex(sortedKeyposes, selectedKeyposeTime, time, 1);
  const previousOnionKeypose =
    (onionSkin === "previous" || onionSkin === "both") && selectedKeyposeIndex > 0
      ? sortedKeyposes[selectedKeyposeIndex - 1]
      : null;
  const nextOnionKeypose =
    (onionSkin === "next" || onionSkin === "both") && selectedKeyposeIndex >= 0
      ? (sortedKeyposes[selectedKeyposeIndex + 1] ?? null)
      : null;
  const previousOnionDraft = useMemo(
    () =>
      previousOnionKeypose
        ? resolveSampleToDraftState(
            sampleKeyposesAtTime([previousOnionKeypose], previousOnionKeypose.t),
          )
        : null,
    [previousOnionKeypose, resolveSampleToDraftState],
  );
  const nextOnionDraft = useMemo(
    () =>
      nextOnionKeypose
        ? resolveSampleToDraftState(sampleKeyposesAtTime([nextOnionKeypose], nextOnionKeypose.t))
        : null,
    [nextOnionKeypose, resolveSampleToDraftState],
  );
  const previousOnionVariants = useMemo(
    () =>
      previousOnionDraft
        ? activeVariantsForRecorderOverrides(basePoses, previousOnionDraft.overrides)
        : basePoses,
    [basePoses, previousOnionDraft],
  );
  const nextOnionVariants = useMemo(
    () =>
      nextOnionDraft
        ? activeVariantsForRecorderOverrides(basePoses, nextOnionDraft.overrides)
        : basePoses,
    [basePoses, nextOnionDraft],
  );
  const previousOnionWorldByBone = useMemo(
    () => runtimeBoneWorldTransforms(runtime, previousOnionVariants),
    [previousOnionVariants, runtime],
  );
  const nextOnionWorldByBone = useMemo(
    () => runtimeBoneWorldTransforms(runtime, nextOnionVariants),
    [nextOnionVariants, runtime],
  );
  const selectedSavedKeypose =
    selectedKeyposeTime == null ? null : findKeyposeAt(sortedKeyposes, selectedKeyposeTime);
  const selectedStampLabel =
    selectedSavedKeypose && selectedKeyposeIndex >= 0 ? `Stamp ${selectedKeyposeIndex + 1}` : null;
  const cleanSelectedStamp = !!selectedSavedKeypose && !draftDirty;
  const draftTimeKeypose = findKeyposeAt(sortedKeyposes, time);
  const draftTimeIsSelected =
    !!draftTimeKeypose &&
    !!selectedSavedKeypose &&
    Math.abs(draftTimeKeypose.t - selectedSavedKeypose.t) <= 0.001;
  const draftTimeKeyposeIndex = draftTimeKeypose
    ? sortedKeyposes.findIndex((keypose) => Math.abs(keypose.t - draftTimeKeypose.t) <= 0.001)
    : -1;
  const draftTimeStampLabel =
    draftTimeKeyposeIndex >= 0 ? `Stamp ${draftTimeKeyposeIndex + 1}` : "A stamp";
  const primaryStampAction =
    draftTimeKeypose && !draftTimeIsSelected
      ? {
          mode: null,
          label: "Time already stamped",
          title: `${draftTimeStampLabel} already uses ${time.toFixed(2)}s. Select that stamp or choose an empty time.`,
        }
      : selectedSavedKeypose && draftTimeIsSelected
        ? draftDirty
          ? {
              mode: "update" as const,
              label: `Update ${selectedStampLabel ?? "stamp"}`,
              title: "Replace the selected stamp with this draft.",
            }
          : {
              mode: null,
              label: "No changes to update",
              title: `Make a pose change before updating ${selectedStampLabel ?? "this stamp"}.`,
            }
        : {
            mode: "new" as const,
            label: "Stamp new",
            title: "Add the draft as a new stamp.",
          };
  const playbackScale = Math.max(
    0.12,
    Math.min(displayScale, 320 / character.canvasWidth, 240 / character.canvasHeight),
  );

  return (
    <GeneratedEditorShell
      title={initialPreset ? `Edit ${editorTitle(category)}` : `Create ${editorTitle(category)}`}
      headerControls={
        <>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Action name"
            className="rounded border border-border bg-input px-2 py-1 text-xs"
          />
          <select
            value={category}
            onChange={(e) => {
              const nextCategory = e.target.value as MotionCategory;
              setCategory(nextCategory);
              setRegion(defaultActionRegionForCategory(nextCategory));
            }}
            className="rounded border border-border bg-input px-2 py-1 text-xs"
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value as MotionRegion | "")}
            className="rounded border border-border bg-input px-2 py-1 text-xs"
            title={`Default scope: ${actionRegionLabel(defaultActionRegionForCategory(category))}`}
          >
            {ACTION_REGION_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Solve
            <select
              value={kinematics}
              onChange={(event) => setKinematics(event.target.value as "fk" | "ik")}
              className="rounded border border-border bg-input px-1.5 py-1 text-xs text-foreground"
              title="FK poses bones directly; IK poses limbs from their end Controls"
            >
              <option value="fk">FK</option>
              <option value="ik">IK</option>
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Duration
            <input
              type="number"
              step={0.1}
              min={0.1}
              value={duration}
              onChange={(e) => setDuration(Math.max(0.1, Number(e.target.value) || 0.1))}
              className="w-16 rounded border border-border bg-input px-1 py-0.5"
            />
            s
          </label>
        </>
      }
      actions={
        <>
          <div className="flex overflow-hidden rounded border border-border text-ui-sm">
            <button
              onClick={() => setPreviewMode("fit")}
              className={`flex items-center gap-1 px-2 py-1 ${
                previewMode === "fit" ? "bg-primary/25 text-foreground" : "text-muted-foreground"
              }`}
            >
              <Minimize2 size={12} />
              Editor zoom
            </button>
            <button
              onClick={() => setPreviewMode("export")}
              className={`flex items-center gap-1 border-l border-border px-2 py-1 ${
                previewMode === "export" ? "bg-primary/25 text-foreground" : "text-muted-foreground"
              }`}
            >
              <Maximize2 size={12} />
              Export size
            </button>
          </div>
          {import.meta.env.DEV && (
            <button
              onClick={() => setShowAnchorDebug((prev) => !prev)}
              className={`rounded border border-border px-2 py-1 text-ui-sm ${
                showAnchorDebug ? "bg-primary/25 text-foreground" : "text-muted-foreground"
              }`}
              title="Show bone pivots, variant anchors, and each anchor's resolution path"
            >
              Anchors
            </button>
          )}
          <button
            onClick={() => void requestClose()}
            className="rounded border border-border px-2 py-1 text-xs hover:bg-panel"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            {initialPreset?.builtin || copyOnSave
              ? "Save custom action"
              : initialPreset
                ? "Update action"
                : "Save action"}
          </button>
        </>
      }
      leftPanel={
        <PartList
          controls={controls}
          controlOverrides={controlOverrides}
          slots={slots}
          selectedSlotId={selectedSlotId}
          overrides={overrides}
          activePartForSlot={activePartForSlot}
          isLocked={isSlotLocked}
          onToggleLocked={toggleSlotLocked}
          onSelect={(id) => {
            setSelectedControlId(null);
            setSelectedSlotId(id);
          }}
          selectedControlId={selectedControlId}
          onSelectControl={(id) => {
            setSelectedSlotId(null);
            setSelectedControlId(id);
          }}
          onToggleHidden={(slotId) => {
            const slot = slots.find((item) => item.id === slotId);
            const part = slot
              ? activePartForSlot(slot, overrides.get(slotId)?.poseSwap)
              : undefined;
            const current = overrides.get(slotId) ?? defaultOverride(slotId, part);
            updateOverride(slotId, { opacity: current.opacity <= 0.01 ? 1 : 0 });
          }}
        />
      }
      previewRef={wrapRef}
      previewPaneClassName="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-stage-bg"
      onPreviewPointerDown={() => setSelectPopover(null)}
      previewPane={
        <>
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(280px,360px)] gap-3 p-3">
            <section
              className={`flex min-w-0 flex-col overflow-hidden rounded border bg-panel/70 ${
                cleanSelectedStamp ? "border-primary/70 ring-2 ring-primary/25" : "border-border"
              }`}
            >
              <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
                <span className="font-semibold uppercase tracking-wider text-muted-foreground">
                  Pose editor
                </span>
                {selectedSavedKeypose && (
                  <span
                    className={`rounded border px-1.5 py-0.5 text-ui-sm ${
                      cleanSelectedStamp
                        ? "border-primary/60 bg-primary/20 text-foreground"
                        : "border-border bg-panel-2 text-muted-foreground"
                    }`}
                  >
                    {selectedStampLabel ?? "Stamp"} · {selectedSavedKeypose.t.toFixed(2)}s
                  </span>
                )}
                {draftDirty && (
                  <span className="rounded bg-primary/25 px-1.5 py-0.5 text-ui-sm text-foreground">
                    unstamped
                  </span>
                )}
                <div className="ml-auto flex items-center gap-1 text-ui-sm">
                  <button
                    type="button"
                    onClick={() => selectAdjacentKeypose(-1)}
                    disabled={previousStampIndex < 0}
                    className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-muted-foreground hover:bg-panel-2 disabled:opacity-40"
                    title="Select previous stamp"
                  >
                    <ChevronLeft size={12} />
                    Prev stamp
                  </button>
                  <button
                    type="button"
                    onClick={() => selectAdjacentKeypose(1)}
                    disabled={nextStampIndex < 0}
                    className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-muted-foreground hover:bg-panel-2 disabled:opacity-40"
                    title="Select next stamp"
                  >
                    Next stamp
                    <ChevronRight size={12} />
                  </button>
                  <select
                    aria-label="Onion skin"
                    value={onionSkin}
                    onChange={(event) =>
                      setOnionSkin(event.target.value as "off" | "previous" | "next" | "both")
                    }
                    className="rounded border border-border bg-input px-1.5 py-0.5 text-muted-foreground"
                  >
                    {(["off", "previous", "next", "both"] as const).map((mode) => (
                      <option key={mode} value={mode}>
                        Onion {mode === "off" ? "off" : mode}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-3">
                <div
                  className={`relative shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] outline ${
                    cleanSelectedStamp ? "outline-2 outline-primary/80" : "outline-1 outline-border"
                  }`}
                  style={{
                    width: character.canvasWidth * displayScale,
                    height: character.canvasHeight * displayScale,
                    background: "oklch(0.12 0.015 270)",
                  }}
                >
                  {cleanSelectedStamp && selectedSavedKeypose && (
                    <div className="pointer-events-none absolute left-2 top-2 z-10 rounded border border-primary/70 bg-panel/90 px-2 py-1 text-ui-sm font-medium text-foreground shadow">
                      {selectedStampLabel} · {selectedSavedKeypose.t.toFixed(2)}s
                    </div>
                  )}
                  <div
                    ref={planeRef}
                    onPointerDown={handlePlanePointerDown}
                    className="absolute left-0 top-0 origin-top-left"
                    style={{
                      width: character.canvasWidth,
                      height: character.canvasHeight,
                      transform: `scale(${displayScale})`,
                      touchAction: "none",
                    }}
                  >
                    {previousOnionDraft && (
                      <ReactPoseCanvas
                        runtime={runtime}
                        slots={slots}
                        character={character}
                        overrides={previousOnionDraft.overrides}
                        activePartForSlot={activePartForSlot}
                        activeVariantsBySlot={previousOnionVariants}
                        poseWorldByBone={previousOnionWorldByBone}
                        faceTurnX={previousOnionDraft.faceTurnX}
                        faceTurnY={previousOnionDraft.faceTurnY}
                        opacity={0.28}
                        tint="previous"
                      />
                    )}
                    {nextOnionDraft && (
                      <ReactPoseCanvas
                        runtime={runtime}
                        slots={slots}
                        character={character}
                        overrides={nextOnionDraft.overrides}
                        activePartForSlot={activePartForSlot}
                        activeVariantsBySlot={nextOnionVariants}
                        poseWorldByBone={nextOnionWorldByBone}
                        faceTurnX={nextOnionDraft.faceTurnX}
                        faceTurnY={nextOnionDraft.faceTurnY}
                        opacity={0.22}
                        tint="next"
                      />
                    )}
                    <div className="pointer-events-none absolute inset-0 z-10">
                      <RecorderPixiPreview
                        character={character}
                        basePoses={basePoses}
                        preset={livePreviewPreset}
                        compileRevision={0}
                        time={0}
                        loadingLabel="Loading pose..."
                      />
                    </div>
                    {selectedSlot && selectedPart && selectedOverride && selectionFrame && (
                      <SelectionHandles
                        part={selectedPart}
                        override={selectedOverride}
                        frame={selectionFrame}
                        scale={displayScale}
                        planeRef={planeRef}
                        onChange={(patch) => updateOverride(selectedOverride.slotId, patch)}
                        onFlexiblePointChange={handleFlexiblePointChange}
                      />
                    )}
                    {import.meta.env.DEV && showAnchorDebug && (
                      <AnchorDebugOverlay runtime={runtime} overrides={overrides} />
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="flex min-w-0 flex-col overflow-hidden rounded border border-border bg-panel/70">
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs">
                <span className="font-semibold uppercase tracking-wider text-muted-foreground">
                  Playback
                </span>
                <span className="text-ui-sm text-muted-foreground">stamped keyframes only</span>
              </div>
              <div className="grid min-h-0 flex-1 place-items-center overflow-hidden p-3">
                <div
                  className="relative outline outline-1 outline-border"
                  style={{
                    width: character.canvasWidth * playbackScale,
                    height: character.canvasHeight * playbackScale,
                    background: "oklch(0.12 0.015 270)",
                  }}
                >
                  <div
                    className="absolute left-0 top-0 origin-top-left"
                    style={{
                      width: character.canvasWidth,
                      height: character.canvasHeight,
                      transform: `scale(${playbackScale})`,
                    }}
                  >
                    <RecorderPixiPreview
                      character={character}
                      basePoses={basePoses}
                      preset={playbackPreviewPreset}
                      compileRevision={playbackCompileRevision}
                      time={playbackTime}
                      staleBehavior="blank"
                      loadingLabel="Updating playback..."
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-2 border-t border-border p-3 text-xs">
                <div className="flex items-center justify-between text-ui-sm text-muted-foreground">
                  <span>{playbackTime.toFixed(2)}s</span>
                  <span>{duration.toFixed(2)}s</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={duration}
                  step={0.02}
                  value={playbackTime}
                  onChange={(event) => {
                    stopCompiledPreview();
                    setPlaybackTime(Number(event.target.value));
                  }}
                  className="w-full"
                />
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (previewPlaying) stopCompiledPreview();
                      else commitRecorderPreviewToHtml();
                    }}
                    className="flex items-center justify-center gap-1 rounded border border-border bg-panel-2 px-2 py-1 hover:bg-panel"
                  >
                    {previewPlaying ? <Pause size={12} /> : <Play size={12} />}
                    {previewPlaying ? "Pause" : "Play"}
                  </button>
                  <button
                    type="button"
                    onClick={commitRecorderPreviewToHtml}
                    className="flex items-center justify-center rounded border border-border bg-panel-2 px-2 py-1 hover:bg-panel"
                    title="Restart playback"
                  >
                    <SkipBack size={12} />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={loadPlaybackFrameAsDraft}
                  disabled={sortedKeyposes.length === 0}
                  className="w-full rounded border border-border px-2 py-1 text-ui-sm text-muted-foreground hover:bg-panel-2 disabled:opacity-40"
                >
                  Load current playback frame as draft
                </button>
              </div>
            </section>
          </div>

          <KeyposeStrip
            keyposes={sortedKeyposes}
            selectedTime={selectedKeyposeTime}
            duration={duration}
            lastStampedTime={lastStampedTime}
            onSelect={selectKeypose}
            onRemove={removeKeypose}
            onTimeChange={moveKeyposeTime}
            onEaseChange={(keyposeTime, ease) => updateKeypose(keyposeTime, { ease })}
            onAnticipationChange={(keyposeTime, anticipation) =>
              updateKeypose(keyposeTime, { anticipation })
            }
            onSpaceEvenly={spaceKeyposesEvenly}
          />

          {selectPopover && (
            <div
              className="fixed z-[60] min-w-36 rounded border border-border bg-panel p-1 text-xs shadow-xl"
              style={{ left: selectPopover.x + 8, top: selectPopover.y + 8 }}
            >
              {selectPopover.slots.map((slot) => (
                <button
                  key={slot.id}
                  onClick={() => {
                    setSelectedSlotId(slot.id);
                    setSelectPopover(null);
                  }}
                  className="block w-full rounded px-2 py-1 text-left hover:bg-primary/20"
                >
                  {slot.name ?? activePartForSlot(slot)?.name ?? slot.role}
                </button>
              ))}
            </div>
          )}
        </>
      }
      inspectorPanel={
        <>
          <AiAddonPromptPanel
            open={aiAddon.open}
            title="AI Action"
            intro={
              <>
                Optional AI add-on. Copy one prompt package, use it in your AI chat, then paste the
                returned action JSON here to preview before saving.
              </>
            }
            requestLabel="Describe action"
            request={aiAddon.request}
            pasteLabel="Paste returned action JSON"
            paste={aiAddon.paste}
            pastePlaceholder={`Paste ${motionJsonFilename("AI action")} or *.motion-suggestion.ai-in.json`}
            status={aiAddon.status}
            promptText={aiAddon.promptText}
            promptOpen={aiAddon.promptOpen}
            repairPrompt={aiAddon.repairPrompt}
            summary={aiAddon.summary}
            onOpenChange={aiAddon.setOpen}
            onRequestChange={aiAddon.setRequest}
            onPasteChange={aiAddon.setPaste}
            onCopyPrompt={aiAddon.copyPrompt}
            onShowPrompt={aiAddon.showPrompt}
            onPromptOpenChange={aiAddon.setPromptOpen}
            onCopyRepairPrompt={aiAddon.copyRepairPrompt}
            onLoadSuggestion={aiAddon.loadSuggestion}
          />

          {selectedControl ? (
            <ControlPropertiesPanel
              control={selectedControl}
              override={selectedControlOverride}
              onChange={(patch) => updateControlOverride(selectedControl.id, patch)}
              onReset={() => clearControlOverride(selectedControl.id)}
            />
          ) : (
            <PropertiesPanel
              slot={selectedSlot}
              part={selectedPart}
              override={selectedOverride}
              advancedOpen={advancedOpen}
              rotationLimit={selectedRotationLimit}
              allowOutOfBounds={selectedAllowsOutOfBounds}
              onAllowOutOfBoundsChange={setSelectedAllowOutOfBounds}
              onAdvancedOpenChange={setAdvancedOpen}
              onChange={(patch) => selectedSlotId && updateOverride(selectedSlotId, patch)}
              onResetAll={() => selectedSlotId && clearOverride(selectedSlotId)}
            />
          )}

          <div className="mt-4 rounded border border-border bg-panel-2 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-semibold uppercase tracking-wider text-muted-foreground">
                Draft keyframe
              </span>
              <span className={draftDirty ? "text-primary" : "text-muted-foreground"}>
                {draftDirty ? "unstamped" : "clean"}
              </span>
            </div>
            <label className="grid grid-cols-[64px_1fr] items-center gap-2 text-ui-sm">
              <span className="text-muted-foreground">Time</span>
              <input
                type="number"
                min={0}
                max={duration}
                step={0.01}
                value={time}
                onChange={(event) => {
                  stopCompiledPreview();
                  setTime(Math.max(0, Math.min(duration, Number(event.target.value) || 0)));
                  setDraftDirty(true);
                }}
                className="w-full rounded border border-border bg-input px-1 py-0.5"
              />
            </label>
            <input
              type="range"
              min={0}
              max={duration}
              step={0.05}
              value={time}
              onChange={(event) => {
                stopCompiledPreview();
                setTime(Number(event.target.value));
                setDraftDirty(true);
              }}
              className="mt-2 w-full"
            />
            <div className="mt-3">
              <button
                type="button"
                onClick={() => {
                  if (primaryStampAction.mode) stampKeypose(primaryStampAction.mode);
                }}
                disabled={!primaryStampAction.mode}
                title={primaryStampAction.title}
                className="w-full rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
              >
                {primaryStampAction.label}
              </button>
            </div>
          </div>

          <div className="mt-4 rounded border border-border bg-panel-2 p-3">
            <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
              Face Turn
            </div>
            <PropertyRow
              label="Turn X"
              value={faceTurnX}
              min={-1}
              max={1}
              step={0.01}
              rest={0}
              onChange={(value) => {
                stopCompiledPreview();
                setDraftDirty(true);
                setFaceTurnX(value);
              }}
            />
            <PropertyRow
              label="Turn Y"
              value={faceTurnY}
              min={-1}
              max={1}
              step={0.01}
              rest={0}
              onChange={(value) => {
                stopCompiledPreview();
                setDraftDirty(true);
                setFaceTurnY(value);
              }}
            />
          </div>
        </>
      }
    />
  );
}
