// MotionPresetRecorder — visual pose-and-capture flow for reusable motion presets.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
  Maximize2,
  Minimize2,
  Move,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Scaling,
  SkipBack,
  Unlock,
} from "lucide-react";
import { db, getMediaUrl, uid } from "../db";
import { useMediaUrl } from "../hooks/useMediaUrl";
import { useStudio } from "../store";
import { buildCharacterRenderPayload } from "../character/composition";
import { PixiCharacterPreview } from "../character/PixiCharacterPreview";
import type { CharacterSceneAsset } from "../character/scene";
import { variantKeyForPart, variantLabelForPart } from "../character/character-utils";
import { localAlphaBounds } from "../character/alpha-bounds";
import { faceTurnMotionForPart } from "../character/face-turn";
import { defaultPoseForCharacter } from "../character/pose-presets";
import {
  effectiveReachForSlot,
  motionDeltaMovesJoint,
  resolveFkJointDelta,
  resolveMotionDelta,
  type MotionConstraintContext,
} from "../character/motion-constraints";
import {
  buildCharacterRuntime,
  resolveRuntimeSlotPart,
  runtimeBoneWorldTransforms,
  runtimePartPlacement,
  type CharacterRuntime,
  type RuntimePartPlacement,
  type RuntimeCharacterSlot,
} from "../character/runtime";
import {
  canvasDeltaToMotionDelta,
  recordedOverrideTarget,
  runtimeMotionTargetForSlot,
  slotIdForRecordedOverride,
} from "../character/motion-targets";
import {
  resolveRuntimePosePartFrame,
  runtimePartFrameContains,
  type PartFrameTransform,
  type RuntimePartFrame,
} from "../character/part-frame";
import { matrixToCss } from "../character/geometry";
import {
  angleRigJsonFromPreset,
  characterJsonFromPreset,
  motionJsonFilename,
} from "../character-json/normalize";
import { buildMotionRequestPrompt } from "../character-json/ai-context";
import {
  ACTION_CATEGORY_TABS,
  ACTION_REGION_OPTIONS,
  actionRegionLabel,
  defaultActionRegionForCategory,
} from "./action-terminology";
import { sampleKeyposesAtTime } from "./keypose-sampling";
import { sampleMotionEase } from "./easing";
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
  CharacterPart,
  CharacterPreset,
  MotionCategory,
  MotionKeyframe,
  MotionPreset,
  MotionRegion,
  MotionTrack,
  PartRole,
  RecordedKeypose,
  RecordedPartOverride,
} from "../types";
import type { MotionJson } from "../character-json/schema";

const CATEGORIES = ACTION_CATEGORY_TABS.filter((tab) => tab.id !== "all");

const EASE_OPTIONS = [
  { label: "Linear", value: "linear" },
  { label: "Smooth", value: "easeInOut" },
  { label: "Ease In", value: "easeIn" },
  { label: "Ease Out", value: "easeOut" },
  { label: "Snappy", value: "snappy" },
  { label: "Overshoot", value: "overshoot" },
  { label: "Bounce", value: "bounce" },
  { label: "Elastic", value: "elastic" },
  { label: "Hold", value: "hold" },
];

const ROLE_GROUPS: { title: string; roles: PartRole[] }[] = [
  { title: "Eyes", roles: ["eye", "iris"] },
  { title: "Face", roles: ["eyebrow", "nose", "mouth"] },
  { title: "Body", roles: ["head", "body", "arm", "hand", "leg", "foot"] },
  { title: "Other", roles: ["hair", "accessory", "static", "custom"] },
];

type CharacterSlot = RuntimeCharacterSlot;
type RuntimeRig = CharacterRuntime["rig"];

interface RecorderPartState {
  slotId: string;
  target?: "slot" | "bone";
  boneId?: string;
  poseSwap?: string;
  dx: number;
  dy: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
  rotation: number;
  originX: number;
  originY: number;
  opacity: number;
}

interface SelectPopover {
  x: number;
  y: number;
  slots: CharacterSlot[];
}

type RecorderPartPlacement = RuntimePartPlacement;

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
  copyOnSave?: boolean;
}) {
  const runtime = useMemo(() => buildCharacterRuntime(character), [character]);
  const rig = runtime.rig;
  const slots = runtime.slots;
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
  const [draftDirty, setDraftDirty] = useState(false);
  // Layers this action may push past the character's reach (slot ids and/or roles) — the
  // per-action escape hatch. Carried from the loaded preset and saved back with it.
  const [allowOutOfBounds, setAllowOutOfBounds] = useState<string[]>(
    () => initialPreset?.allowOutOfBounds ?? [],
  );
  const [faceTurnX, setFaceTurnX] = useState(initialRecorderKeyposes[0]?.faceTurnX ?? 0);
  const [faceTurnY, setFaceTurnY] = useState(initialRecorderKeyposes[0]?.faceTurnY ?? 0);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
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
    if (!selectedSlotId && slots.length > 0) setSelectedSlotId(slots[0].id);
  }, [selectedSlotId, slots]);

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
      for (const ov of sample.parts.values()) {
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

  const confirmDiscardDraft = useCallback(() => {
    if (!draftDirty) return true;
    return window.confirm(
      "You have unstamped pose edits. Discard them and load a different keyframe?",
    );
  }, [draftDirty]);

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
      if (ov.originX !== (activePart?.anchorX ?? 0.5)) part.originX = ov.originX;
      if (ov.originY !== (activePart?.anchorY ?? 0.5)) part.originY = ov.originY;
      if (ov.opacity !== 1) part.opacity = ov.opacity;
      parts.push(part);
    }
    return parts;
  }, [activePartForSlot, overrides, runtime, slots]);

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
    });
  }, [allowOutOfBounds, category, duration, name, region, sortedKeyposes]);

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

  const updateOverride = useCallback(
    (slotId: string, patch: Partial<RecorderPartState>) => {
      stopCompiledPreview();
      setDraftDirty(true);
      setOverrides((prev) => {
        const next = new Map(prev);
        const slot = slots.find((item) => item.id === slotId);
        const cur = next.get(slotId);
        const curPart = slot ? activePartForSlot(slot, cur?.poseSwap) : undefined;
        const base = cur ?? defaultOverride(slotId, curPart);
        const targetMeta = slot ? recorderMotionTargetForSlot(slot, runtime) : {};
        const current = { ...base, ...targetMeta };
        const merged = { ...current, ...patch };
        if (recorderOverridesEqual(current, merged)) return prev;
        next.set(slotId, merged);
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
      alert("Select a stamp before updating it.");
      return;
    }
    const source = mode === "update" ? selected : undefined;
    const kp = draftKeypose(source);
    const targetCollision = findKeyposeAt(keyposes, kp.t);
    const collisionIsSelected =
      !!selected && !!targetCollision && Math.abs(targetCollision.t - selected.t) <= 0.001;
    if (mode === "new" && targetCollision) {
      alert(
        `There is already a stamp at ${kp.t.toFixed(2)}s. Move the draft time to add a new stamp, or update the selected stamp.`,
      );
      return;
    }
    if (mode === "update" && targetCollision && !collisionIsSelected) {
      alert(
        `Another stamp already uses ${kp.t.toFixed(2)}s. Choose a different time before updating.`,
      );
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
      alert(`Another stamp already uses ${clamped.toFixed(2)}s.`);
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

  const selectKeypose = (keypose: RecordedKeypose) => {
    if (!confirmDiscardDraft()) return;
    applyKeyposeToDraft(keypose);
  };

  const selectAdjacentKeypose = (direction: -1 | 1) => {
    const nextIndex = adjacentKeyposeIndex(sortedKeyposes, selectedKeyposeTime, time, direction);
    if (nextIndex < 0) return;
    const nextKeypose = sortedKeyposes[nextIndex];
    if (nextKeypose) selectKeypose(nextKeypose);
  };

  const loadPlaybackFrameAsDraft = () => {
    if (!confirmDiscardDraft()) return;
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

  const requestClose = () => {
    if (
      !draftDirty ||
      window.confirm("Discard unstamped pose edits and close the action editor?")
    ) {
      onClose();
    }
  };

  const save = async () => {
    if (sortedKeyposes.length === 0) {
      alert("Stamp at least one keyframe before saving.");
      return;
    }
    if (
      draftDirty &&
      !window.confirm("Save the action without the current unstamped pose edits?")
    ) {
      return;
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
      allowOutOfBounds: allowOutOfBounds.length ? [...allowOutOfBounds] : undefined,
      builtin: false,
      createdAt: savingCopy ? now : (initialPreset?.createdAt ?? now),
      updatedAt: now,
    };
    await db.motionPresets.put(preset);
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
          <div className="flex overflow-hidden rounded border border-border text-[10px]">
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
              className={`rounded border border-border px-2 py-1 text-[10px] ${
                showAnchorDebug ? "bg-primary/25 text-foreground" : "text-muted-foreground"
              }`}
              title="Show bone pivots, variant anchors, and each anchor's resolution path"
            >
              Anchors
            </button>
          )}
          <button
            onClick={requestClose}
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
          slots={slots}
          selectedSlotId={selectedSlotId}
          overrides={overrides}
          activePartForSlot={activePartForSlot}
          isLocked={isSlotLocked}
          onToggleLocked={toggleSlotLocked}
          onSelect={setSelectedSlotId}
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
                    className={`rounded border px-1.5 py-0.5 text-[10px] ${
                      cleanSelectedStamp
                        ? "border-primary/60 bg-primary/20 text-foreground"
                        : "border-border bg-panel-2 text-muted-foreground"
                    }`}
                  >
                    {selectedStampLabel ?? "Stamp"} · {selectedSavedKeypose.t.toFixed(2)}s
                  </span>
                )}
                {draftDirty && (
                  <span className="rounded bg-primary/25 px-1.5 py-0.5 text-[10px] text-foreground">
                    unstamped
                  </span>
                )}
                <div className="ml-auto flex items-center gap-1 text-[10px]">
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
                    <div className="pointer-events-none absolute left-2 top-2 z-10 rounded border border-primary/70 bg-panel/90 px-2 py-1 text-[10px] font-medium text-foreground shadow">
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
                      <ReactPoseCanvas
                        runtime={runtime}
                        slots={slots}
                        character={character}
                        overrides={overrides}
                        activePartForSlot={activePartForSlot}
                        activeVariantsBySlot={activeVariantsBySlot}
                        poseWorldByBone={poseWorldByBone}
                        faceTurnX={faceTurnX}
                        faceTurnY={faceTurnY}
                      />
                    </div>
                    {selectedSlot && selectedPart && selectedOverride && (
                      <SelectionHandles
                        slot={selectedSlot}
                        override={selectedOverride}
                        frame={recorderPartFrame(
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
                        )}
                        runtime={runtime}
                        worldByBone={poseWorldByBone}
                        scale={displayScale}
                        planeRef={planeRef}
                        onChange={(patch) => updateOverride(selectedOverride.slotId, patch)}
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
                <span className="text-[10px] text-muted-foreground">stamped keyframes only</span>
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
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
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
                  className="w-full rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-panel-2 disabled:opacity-40"
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

          <div className="mt-4 rounded border border-border bg-panel-2 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-semibold uppercase tracking-wider text-muted-foreground">
                Draft keyframe
              </span>
              <span className={draftDirty ? "text-primary" : "text-muted-foreground"}>
                {draftDirty ? "unstamped" : "clean"}
              </span>
            </div>
            <label className="grid grid-cols-[64px_1fr] items-center gap-2 text-[10px]">
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

function ReactPoseCanvas({
  runtime,
  slots,
  character,
  overrides,
  activePartForSlot,
  activeVariantsBySlot,
  poseWorldByBone,
  faceTurnX,
  faceTurnY,
  opacity = 1,
  tint,
}: {
  runtime: CharacterRuntime;
  slots: CharacterSlot[];
  character: CharacterPreset;
  overrides: Map<string, RecorderPartState>;
  activePartForSlot: (slot: CharacterSlot, poseSwap?: string) => CharacterPart | undefined;
  activeVariantsBySlot: Record<string, string>;
  poseWorldByBone: CharacterRuntime["worldByBone"];
  faceTurnX: number;
  faceTurnY: number;
  opacity?: number;
  tint?: "previous" | "next";
}) {
  const layers = useMemo(
    () =>
      slots
        .flatMap((slot) => {
          const overrideFromMap = overrides.get(slot.id);
          const part = activePartForSlot(slot, overrideFromMap?.poseSwap);
          if (!part?.visible) return [];
          const override = overrideFromMap ?? defaultOverride(slot.id, part);
          const placement = recorderPartPlacement(
            slot,
            part,
            runtime,
            activeVariantsBySlot,
            poseWorldByBone,
          );
          const frame = recorderPartFrame(
            slot,
            part,
            override,
            runtime,
            overrides,
            activePartForSlot,
            faceTurnX,
            faceTurnY,
            character.canvasWidth,
            character.canvasHeight,
            activeVariantsBySlot,
            poseWorldByBone,
            placement,
          );
          return [{ slot, part, override, frame, drawOrder: placement.drawOrder }];
        })
        .sort((a, b) => a.drawOrder - b.drawOrder),
    [
      activePartForSlot,
      activeVariantsBySlot,
      character.canvasHeight,
      character.canvasWidth,
      faceTurnX,
      faceTurnY,
      overrides,
      poseWorldByBone,
      runtime,
      slots,
    ],
  );

  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        opacity,
        filter: tint === "previous" ? "saturate(0.75) hue-rotate(155deg)" : undefined,
      }}
      aria-hidden={tint ? "true" : undefined}
    >
      {layers.map((layer, index) => (
        <ReactPosePart
          key={`${layer.slot.id}:${layer.part.id}`}
          part={layer.part}
          frame={layer.frame}
          opacity={layer.override.opacity}
          zIndex={index}
        />
      ))}
    </div>
  );
}

function ReactPosePart({
  part,
  frame,
  opacity,
  zIndex,
}: {
  part: CharacterPart;
  frame: RuntimePartFrame;
  opacity: number;
  zIndex: number;
}) {
  const url = useMediaUrl(part.mediaId);
  const style = {
    position: "absolute" as const,
    display: "block" as const,
    left: 0,
    top: 0,
    width: part.width,
    height: part.height,
    maxWidth: "none",
    maxHeight: "none",
    transform: matrixToCss(frame.matrix),
    transformOrigin: "0 0",
    opacity,
    zIndex,
    pointerEvents: "none" as const,
    userSelect: "none" as const,
  };

  if (part.morph?.primaryPath) {
    return (
      <svg
        viewBox={part.morph.viewBox ?? `0 0 ${part.width} ${part.height}`}
        aria-hidden="true"
        overflow="visible"
        style={style}
      >
        <path
          d={part.morph.primaryPath}
          fill={part.morph.fill ?? "#733f43"}
          stroke={part.morph.stroke}
          strokeWidth={part.morph.strokeWidth}
          strokeLinecap={part.morph.strokeLinecap as "round" | "butt" | "square" | undefined}
          strokeLinejoin={part.morph.strokeLinejoin as "round" | "miter" | "bevel" | undefined}
        />
      </svg>
    );
  }

  if (!url) return null;
  return <img src={url} alt="" draggable={false} style={style} />;
}

function KeyposeStrip({
  keyposes,
  selectedTime,
  duration,
  lastStampedTime,
  onSelect,
  onRemove,
  onTimeChange,
  onEaseChange,
  onAnticipationChange,
  onSpaceEvenly,
}: {
  keyposes: RecordedKeypose[];
  selectedTime: number | null;
  duration: number;
  lastStampedTime: number | null;
  onSelect: (keypose: RecordedKeypose) => void;
  onRemove: (time: number) => void;
  onTimeChange: (from: number, nextTime: number) => void;
  onEaseChange: (time: number, ease: string) => void;
  onAnticipationChange: (time: number, anticipation: RecordedKeypose["anticipation"]) => void;
  onSpaceEvenly: () => void;
}) {
  return (
    <section className="border-t border-border bg-panel p-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold uppercase tracking-wider text-muted-foreground">
          Keyframe stamps
        </span>
        <button
          type="button"
          onClick={onSpaceEvenly}
          disabled={keyposes.length < 2}
          className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-panel-2 disabled:opacity-40"
        >
          Space evenly
        </button>
      </div>

      {keyposes.length === 0 ? (
        <div className="rounded border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">
          Stamp poses to build this action.
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {keyposes.map((keypose, index) => {
            const selected = selectedTime != null && Math.abs(selectedTime - keypose.t) <= 0.001;
            const stamped =
              lastStampedTime != null && Math.abs(lastStampedTime - keypose.t) <= 0.001;
            const next = keyposes[index + 1];
            const span = next ? Math.max(0, next.t - keypose.t) : 0;
            return (
              <div key={`${keypose.t}:${index}`} className="flex shrink-0 items-center gap-2">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(keypose)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") onSelect(keypose);
                  }}
                  className={`group w-32 rounded border p-2 text-left transition ${
                    selected
                      ? "border-primary bg-primary/20 text-foreground"
                      : "border-border bg-panel-2 text-muted-foreground hover:bg-panel"
                  } ${stamped ? "ring-2 ring-primary/40" : ""}`}
                >
                  <div className="mb-1 aspect-video rounded border border-border bg-stage-bg">
                    <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
                      {index + 1}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-medium text-foreground">{keypose.t.toFixed(2)}s</span>
                    <span>{keypose.parts.length} parts</span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={duration}
                    step={0.01}
                    value={keypose.t}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    onChange={(event) => onTimeChange(keypose.t, Number(event.target.value) || 0)}
                    className="mt-1 w-full rounded border border-border bg-input px-1 py-0.5 text-[10px]"
                  />
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemove(keypose.t);
                    }}
                    className="mt-1 text-[10px] text-destructive"
                  >
                    Remove
                  </button>
                </div>

                {next && (
                  <div className="w-28 shrink-0 text-center text-[10px] text-muted-foreground">
                    <div className="mb-1 h-px bg-border" />
                    <select
                      value={next.ease ?? "easeInOut"}
                      onChange={(event) => onEaseChange(next.t, event.target.value)}
                      className="w-full rounded border border-border bg-input px-1 py-0.5"
                      title="Ease into the next keyframe"
                    >
                      {EASE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <div className="mt-1">{span.toFixed(2)}s</div>
                    <details className="mt-1 text-left">
                      <summary className="cursor-pointer text-center">Anticipation</summary>
                      <label className="mt-1 flex items-center justify-center gap-1">
                        <input
                          type="checkbox"
                          checked={!!next.anticipation}
                          onChange={(event) =>
                            onAnticipationChange(
                              next.t,
                              event.target.checked ? { amount: 0.25, duration: 0.12 } : undefined,
                            )
                          }
                        />
                        Enabled
                      </label>
                      {next.anticipation && (
                        <div className="mt-1 grid grid-cols-2 gap-1">
                          <NumberInput
                            label="Amount"
                            value={next.anticipation.amount}
                            min={0}
                            max={1}
                            step={0.05}
                            onChange={(value) =>
                              onAnticipationChange(next.t, {
                                ...next.anticipation!,
                                amount: value,
                              })
                            }
                          />
                          <NumberInput
                            label="Duration"
                            value={next.anticipation.duration}
                            min={0}
                            max={duration}
                            step={0.01}
                            onChange={(value) =>
                              onAnticipationChange(next.t, {
                                ...next.anticipation!,
                                duration: value,
                              })
                            }
                          />
                        </div>
                      )}
                    </details>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PartList({
  slots,
  selectedSlotId,
  overrides,
  activePartForSlot,
  isLocked,
  onToggleLocked,
  onSelect,
  onToggleHidden,
}: {
  slots: CharacterSlot[];
  selectedSlotId: string | null;
  overrides: Map<string, RecorderPartState>;
  activePartForSlot: (slot: CharacterSlot) => CharacterPart | undefined;
  isLocked: (id: string) => boolean;
  onToggleLocked: (id: string) => void;
  onSelect: (id: string) => void;
  onToggleHidden: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      {ROLE_GROUPS.map((group) => {
        const groupSlots = slots.filter((slot) => group.roles.includes(slot.role));
        if (groupSlots.length === 0) return null;
        return (
          <section key={group.title}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.title}
            </div>
            <div className="space-y-1">
              {groupSlots.map((slot) => {
                const part = activePartForSlot(slot);
                const override = overrides.get(slot.id);
                const dirty = isDirtyOverride(override, part);
                const hidden = (override?.opacity ?? 1) <= 0.01 || part?.visible === false;
                const locked = isLocked(slot.id);
                return (
                  <div
                    key={slot.id}
                    className={`flex w-full items-center gap-1 rounded ${
                      selectedSlotId === slot.id
                        ? "bg-primary/20 text-foreground"
                        : "text-muted-foreground hover:bg-panel-2 hover:text-foreground"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(slot.id)}
                      className="flex min-w-0 flex-1 items-center gap-1 px-1.5 py-1 text-left"
                    >
                      <span className="w-2">{dirty ? "•" : ""}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {slot.name ?? part?.name ?? roleLabel(slot.role)}
                      </span>
                      <span className="rounded bg-background/60 px-1 text-[9px]">{slot.role}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleLocked(slot.id);
                      }}
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-background/70 ${
                        locked ? "text-primary" : "text-muted-foreground"
                      }`}
                      title={locked ? "Unlock layer" : "Lock layer"}
                    >
                      {locked ? <Lock size={12} /> : <Unlock size={12} />}
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleHidden(slot.id);
                      }}
                      className={`mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-background/70 ${
                        hidden ? "text-muted-foreground" : "text-foreground"
                      }`}
                      title={hidden ? "Show layer in motion" : "Hide layer in motion"}
                    >
                      {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function PropertiesPanel({
  slot,
  part,
  override,
  advancedOpen,
  rotationLimit,
  allowOutOfBounds,
  onAllowOutOfBoundsChange,
  onAdvancedOpenChange,
  onChange,
  onResetAll,
}: {
  slot: CharacterSlot | null;
  part: CharacterPart | null;
  override: RecorderPartState | null;
  advancedOpen: boolean;
  rotationLimit: { min: number; max: number; variantLimited: boolean } | null;
  allowOutOfBounds: boolean;
  onAllowOutOfBoundsChange: (allowed: boolean) => void;
  onAdvancedOpenChange: (open: boolean) => void;
  onChange: (patch: Partial<RecorderPartState>) => void;
  onResetAll: () => void;
}) {
  if (!slot || !part || !override) {
    return (
      <div className="rounded border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">
        Select a part.
      </div>
    );
  }
  const variantOptions = variantOptionsForSlot(slot);
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground">{slot.name ?? part.name}</div>
          <div className="text-[10px] text-muted-foreground">{slot.role}</div>
        </div>
        <button
          onClick={onResetAll}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] hover:bg-panel-2"
        >
          <RotateCcw size={11} />
          Reset all
        </button>
      </div>

      <div className="space-y-2">
        {variantOptions.length > 1 && (
          <label className="grid grid-cols-[64px_1fr] items-center gap-2 text-[10px]">
            <span className="text-muted-foreground">Variant</span>
            <select
              value={override.poseSwap ?? ""}
              onChange={(e) => onChange({ poseSwap: e.target.value || undefined })}
              className="w-full rounded border border-border bg-input px-2 py-1"
            >
              {variantOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <PropertyRow
          label="X"
          value={override.dx}
          min={-300}
          max={300}
          step={1}
          rest={0}
          onChange={(value) => onChange({ dx: value })}
        />
        <PropertyRow
          label="Y"
          value={override.dy}
          min={-300}
          max={300}
          step={1}
          rest={0}
          onChange={(value) => onChange({ dy: value })}
        />
        <PropertyRow
          label="Size"
          value={override.scale}
          min={0.1}
          max={3}
          step={0.01}
          rest={1}
          onChange={(value) => onChange({ scale: value })}
        />
        <PropertyRow
          label="Width"
          value={override.scaleX}
          min={0.1}
          max={3}
          step={0.01}
          rest={1}
          onChange={(value) => onChange({ scaleX: value })}
        />
        <PropertyRow
          label="Height"
          value={override.scaleY}
          min={0.1}
          max={3}
          step={0.01}
          rest={1}
          onChange={(value) => onChange({ scaleY: value })}
        />
        <PropertyRow
          label="Rotation"
          value={override.rotation}
          min={-180}
          max={180}
          step={1}
          rest={0}
          onChange={(value) => onChange({ rotation: value })}
        />
        {rotationLimit && (
          <div className="flex items-center justify-between gap-2 pl-[72px] text-[10px] text-muted-foreground">
            <span
              title={
                allowOutOfBounds
                  ? "This action may exceed the limit."
                  : "Edits stop at this limit, matching playback."
              }
            >
              Limit {round(rotationLimit.min, 1)}° to {round(rotationLimit.max, 1)}°
              {rotationLimit.variantLimited ? " (variant)" : ""}
            </span>
            <label className="flex shrink-0 cursor-pointer items-center gap-1">
              <input
                type="checkbox"
                checked={allowOutOfBounds}
                onChange={(e) => onAllowOutOfBoundsChange(e.target.checked)}
              />
              Allow out of bounds
            </label>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => onAdvancedOpenChange(!advancedOpen)}
        className="mt-3 flex w-full items-center justify-between rounded border border-border px-2 py-1 text-left text-[11px] hover:bg-panel-2"
      >
        <span>Advanced transforms</span>
        <span className="text-muted-foreground">{advancedOpen ? "Hide" : "Show"}</span>
      </button>
      {advancedOpen && (
        <div className="mt-2 space-y-2 rounded border border-border bg-panel-2 p-2">
          <PropertyRow
            label="Skew X"
            value={override.skewX}
            min={-45}
            max={45}
            step={1}
            rest={0}
            onChange={(value) => onChange({ skewX: value })}
          />
          <PropertyRow
            label="Skew Y"
            value={override.skewY}
            min={-45}
            max={45}
            step={1}
            rest={0}
            onChange={(value) => onChange({ skewY: value })}
          />
          <PropertyRow
            label="Opacity"
            value={override.opacity}
            min={0}
            max={1}
            step={0.01}
            rest={1}
            onChange={(value) => onChange({ opacity: value })}
          />
        </div>
      )}
    </div>
  );
}

function PropertyRow({
  label,
  value,
  min,
  max,
  step,
  rest,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  rest: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid grid-cols-[64px_1fr_56px_22px] items-center gap-2 text-[10px]">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded border border-border bg-input px-1 py-0.5"
      />
      <button
        type="button"
        onClick={() => onChange(rest)}
        className="rounded border border-border px-1 py-0.5 hover:bg-panel-2"
      >
        <RotateCcw size={10} />
      </button>
    </label>
  );
}

// Playback preview consumes the same render payload as generated character
// composition HTML, but keeps a persistent Pixi app instead of rebuilding an
// iframe for every stamped draft. The pose editor remains React draft UI until a
// pose is stamped into the canonical keypose model.
function RecorderPixiPreview({
  character,
  basePoses,
  preset,
  compileRevision,
  time,
  staleBehavior = "hold",
  loadingLabel = "Loading character preview...",
}: {
  character: CharacterPreset;
  basePoses: Record<string, string>;
  preset: MotionPreset | null;
  compileRevision: number;
  time: number;
  staleBehavior?: "hold" | "blank";
  loadingLabel?: string;
}) {
  const compositionId = "recorder_character_preview";
  const mediaAssets = useStudio((state) => state.mediaAssets);

  const payload = useMemo(() => {
    const motionPresets = preset ? new Map([[preset.id, preset]]) : new Map<string, MotionPreset>();
    return buildCharacterRenderPayload({
      compositionId,
      clipId: "recorder-character-preview-clip",
      width: character.canvasWidth,
      height: character.canvasHeight,
      duration: Math.max(0.1, preset?.duration ?? 1),
      character,
      meta: {
        characterId: character.id,
        poses: basePoses,
        autoBlink: false,
        motions: preset
          ? [
              {
                id: "recorder-draft-motion",
                presetId: preset.id,
                offset: 0,
                intensity: 1,
                loop: false,
                duration: preset.duration,
              },
            ]
          : [],
      },
      mediaAssets,
      motionPresets,
    });
  }, [basePoses, character, compositionId, mediaAssets, preset]);

  const resetKey = `${payload.character.id}:${payload.duration}:${compileRevision}`;

  return (
    <PixiCharacterPreview
      payload={payload}
      time={time}
      resetKey={resetKey}
      staleBehavior={staleBehavior}
      loadingLabel={loadingLabel}
      resolveAssetRef={resolveRecorderPreviewAssetRef}
      className="pointer-events-none absolute inset-0 block h-full w-full bg-transparent"
    />
  );
}

async function resolveRecorderPreviewAssetRef(asset: CharacterSceneAsset): Promise<string | null> {
  return getMediaUrl(asset.id);
}

interface RafCoalescedDispatcher<T> {
  queue(value: T): void;
  flush(): void;
  cancel(): void;
}

function createRafCoalescedDispatcher<T>(apply: (value: T) => void): RafCoalescedDispatcher<T> {
  let frame: number | null = null;
  let queued: T | undefined;

  const applyQueued = () => {
    const value = queued;
    queued = undefined;
    if (value !== undefined) apply(value);
  };

  const cancelFrame = () => {
    if (frame === null) return;
    window.cancelAnimationFrame(frame);
    frame = null;
  };

  return {
    queue(value) {
      queued = value;
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        applyQueued();
      });
    },
    flush() {
      cancelFrame();
      applyQueued();
    },
    cancel() {
      cancelFrame();
      queued = undefined;
    },
  };
}

function useRafCoalescedCallback<T>(callback: (value: T) => void): RafCoalescedDispatcher<T> {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const dispatcherRef = useRef<RafCoalescedDispatcher<T> | null>(null);

  if (!dispatcherRef.current) {
    dispatcherRef.current = createRafCoalescedDispatcher((value) => callbackRef.current(value));
  }

  useEffect(() => () => dispatcherRef.current?.cancel(), []);
  return dispatcherRef.current;
}

function recorderPatchEqual(
  a: Partial<RecorderPartState> | null,
  b: Partial<RecorderPartState>,
): boolean {
  if (!a) return false;
  const keys = new Set<keyof RecorderPartState>();
  for (const key of Object.keys(a) as (keyof RecorderPartState)[]) keys.add(key);
  for (const key of Object.keys(b) as (keyof RecorderPartState)[]) keys.add(key);
  for (const key of keys) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}

/**
 * Dev-only editor chrome: marks every resolved bone pivot and labels pin-driven joints with the
 * active parent variant. Renders only in the recorder plane; never enters composition HTML.
 */
function AnchorDebugOverlay({
  runtime,
  overrides,
}: {
  runtime: CharacterRuntime;
  overrides: Map<string, RecorderPartState>;
}) {
  const activeVariants = Object.fromEntries(
    Array.from(overrides.entries()).flatMap(([slotId, state]) =>
      state.poseSwap ? [[slotId, state.poseSwap]] : [],
    ),
  );
  const world = runtimeBoneWorldTransforms(runtime, activeVariants);
  const markers: Array<{ key: string; x: number; y: number; color: string; label?: string }> = [];
  for (const bone of runtime.angleRig.bones) {
    const at = world.get(bone.id);
    if (!at) continue;
    markers.push({ key: `pivot:${bone.id}`, x: at.x, y: at.y, color: "rgba(255,255,255,0.6)" });
    if (!bone.restSource || !bone.parentId) continue;
    const parentSlotId = bone.restSource.slotId;
    const activeKey = overrides.get(parentSlotId)?.poseSwap;
    const parentSlot = runtime.slotById.get(parentSlotId);
    const parentPart = parentSlot
      ? resolveRuntimeSlotPart(parentSlot, runtime, activeKey)
      : undefined;
    const resolved = !!parentPart?.pins?.[bone.restSource.pinName];
    markers.push({
      key: `anchor:${bone.id}`,
      x: at.x,
      y: at.y,
      color: resolved ? "#4ade80" : "#fbbf24",
      label:
        `${bone.name} ← ${parentSlotId}${activeKey ? ` : ${activeKey}` : ""} ` +
        `(${resolved ? bone.restSource.pinName : "missing pin"})`,
    });
  }
  return (
    <div className="pointer-events-none absolute inset-0 z-50">
      {markers.map((marker) => (
        <div
          key={marker.key}
          className="absolute"
          style={{ left: marker.x, top: marker.y, transform: "translate(-50%, -50%)" }}
        >
          <div
            className="rounded-full"
            style={{
              width: marker.label ? 10 : 6,
              height: marker.label ? 10 : 6,
              background: marker.color,
              boxShadow: "0 0 0 1px rgba(0,0,0,0.8)",
            }}
          />
          {marker.label && (
            <div
              className="absolute left-2 top-2 whitespace-nowrap rounded px-1 text-[9px]"
              style={{ background: "rgba(0,0,0,0.75)", color: marker.color }}
            >
              {marker.label}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function recorderPreviewPreset({
  name,
  category,
  region,
  duration,
  keyposes,
  allowOutOfBounds,
}: {
  name: string;
  category: MotionCategory;
  region: MotionRegion | "";
  duration: number;
  keyposes: RecordedKeypose[];
  allowOutOfBounds?: string[];
}): MotionPreset {
  return {
    id: "__recorder_draft_motion",
    name: name.trim() || "Draft action",
    category,
    region: region || undefined,
    duration: Math.max(0.1, duration),
    loop: false,
    tracks: [],
    keyposes: cloneKeyposes(keyposes).sort((a, b) => a.t - b.t),
    allowOutOfBounds: allowOutOfBounds?.length ? [...allowOutOfBounds] : undefined,
    builtin: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

function SelectionHandles({
  slot,
  override,
  frame,
  runtime,
  worldByBone,
  scale,
  planeRef,
  onChange,
}: {
  slot: CharacterSlot;
  override: RecorderPartState;
  frame: RuntimePartFrame;
  runtime: CharacterRuntime;
  worldByBone: CharacterRuntime["worldByBone"];
  scale: number;
  planeRef: React.RefObject<HTMLDivElement | null>;
  onChange: (patch: Partial<RecorderPartState>) => void;
}) {
  const target = runtimeMotionTargetForSlot(runtime, slot.id);
  const queuedChange = useRafCoalescedCallback<Partial<RecorderPartState>>(onChange);
  const handleSize = 24 / Math.max(0.0001, scale);
  const gap = 18 / Math.max(0.0001, scale);
  const topEdge = {
    x: frame.quad[1].x - frame.quad[0].x,
    y: frame.quad[1].y - frame.quad[0].y,
  };
  const topLength = Math.max(0.0001, Math.hypot(topEdge.x, topEdge.y));
  const outward = { x: topEdge.y / topLength, y: -topEdge.x / topLength };
  const movePosition = {
    x: frame.quad[0].x + outward.x * gap,
    y: frame.quad[0].y + outward.y * gap,
  };
  const rotatePosition = {
    x: (frame.quad[0].x + frame.quad[1].x) / 2 + outward.x * gap,
    y: (frame.quad[0].y + frame.quad[1].y) / 2 + outward.y * gap,
  };
  const scalePosition = {
    x: frame.quad[2].x - outward.x * gap,
    y: frame.quad[2].y - outward.y * gap,
  };

  const startMove = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = override.dx;
    const oy = override.dy;
    let lastPatch: Partial<RecorderPartState> | null = null;
    const queuePatch = (patch: Partial<RecorderPartState>) => {
      if (recorderPatchEqual(lastPatch, patch)) return;
      lastPatch = patch;
      queuedChange.queue(patch);
    };
    const move = (ev: PointerEvent) => {
      const delta = canvasDeltaToMotionDelta(
        runtime,
        target,
        {
          x: (ev.clientX - sx) / scale,
          y: (ev.clientY - sy) / scale,
        },
        worldByBone,
      );
      queuePatch({
        dx: Math.round(ox + delta.x),
        dy: Math.round(oy + delta.y),
      });
    };
    startWindowPointerDrag({
      onMove: move,
      onEnd: (event) => {
        if (event) move(event);
        queuedChange.flush();
      },
      onCancel: queuedChange.cancel,
    });
  };

  const startRotate = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const rect = planeRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pivotX = rect.left + frame.pivot.x * scale;
    const pivotY = rect.top + frame.pivot.y * scale;
    const startAngle = Math.atan2(e.clientY - pivotY, e.clientX - pivotX) * (180 / Math.PI);
    const startRot = override.rotation;
    let lastPatch: Partial<RecorderPartState> | null = null;
    const queuePatch = (patch: Partial<RecorderPartState>) => {
      if (recorderPatchEqual(lastPatch, patch)) return;
      lastPatch = patch;
      queuedChange.queue(patch);
    };
    const move = (ev: PointerEvent) => {
      const angle = Math.atan2(ev.clientY - pivotY, ev.clientX - pivotX) * (180 / Math.PI);
      queuePatch({ rotation: round(startRot + angle - startAngle, 1) });
    };
    startWindowPointerDrag({
      onMove: move,
      onEnd: (event) => {
        if (event) move(event);
        queuedChange.flush();
      },
      onCancel: queuedChange.cancel,
    });
  };

  const startScale = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const rect = planeRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pivotX = rect.left + frame.pivot.x * scale;
    const pivotY = rect.top + frame.pivot.y * scale;
    const startDist = Math.hypot(e.clientX - pivotX, e.clientY - pivotY);
    const startScaleValue = override.scale;
    let lastPatch: Partial<RecorderPartState> | null = null;
    const queuePatch = (patch: Partial<RecorderPartState>) => {
      if (recorderPatchEqual(lastPatch, patch)) return;
      lastPatch = patch;
      queuedChange.queue(patch);
    };
    const move = (ev: PointerEvent) => {
      const dist = Math.hypot(ev.clientX - pivotX, ev.clientY - pivotY);
      if (startDist < 1) return;
      queuePatch({ scale: round(Math.max(0.1, startScaleValue * (dist / startDist)), 2) });
    };
    startWindowPointerDrag({
      onMove: move,
      onEnd: (event) => {
        if (event) move(event);
        queuedChange.flush();
      },
      onCancel: queuedChange.cancel,
    });
  };

  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: 9999 }}>
      <svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        <polygon
          points={frame.quad.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth={1 / Math.max(0.0001, scale)}
          className="text-primary"
        />
      </svg>
      <button
        type="button"
        onPointerDown={startMove}
        className="pointer-events-auto absolute flex items-center justify-center rounded border border-background bg-panel text-foreground shadow"
        style={{
          left: movePosition.x,
          top: movePosition.y,
          width: handleSize,
          height: handleSize,
          transform: "translate(-50%, -50%)",
        }}
        title="Move"
      >
        <Move size={Math.max(12, handleSize * 0.55)} />
      </button>
      <button
        type="button"
        onPointerDown={startRotate}
        className="pointer-events-auto absolute flex items-center justify-center rounded-full border border-background bg-primary text-primary-foreground shadow"
        style={{
          left: rotatePosition.x,
          top: rotatePosition.y,
          width: handleSize,
          height: handleSize,
          transform: "translate(-50%, -50%)",
        }}
        title="Rotate"
      >
        <RotateCw size={Math.max(12, handleSize * 0.55)} />
      </button>
      <button
        type="button"
        onPointerDown={startScale}
        className="pointer-events-auto absolute flex items-center justify-center rounded border border-background bg-accent text-accent-foreground shadow"
        style={{
          left: scalePosition.x,
          top: scalePosition.y,
          width: handleSize,
          height: handleSize,
          transform: "translate(-50%, -50%)",
        }}
        title="Scale"
      >
        <Scaling size={Math.max(12, handleSize * 0.55)} />
      </button>
      <div
        className="absolute rounded-full border border-primary bg-background/80"
        style={{
          left: frame.pivot.x,
          top: frame.pivot.y,
          width: Math.max(8, handleSize * 0.4),
          height: Math.max(8, handleSize * 0.4),
          transform: "translate(-50%, -50%)",
        }}
      />
    </div>
  );
}

function NumberInput({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span className="block text-[10px] text-muted-foreground">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded border border-border bg-input px-1 py-0.5"
      />
    </label>
  );
}

const MOTION_VALUE_KEYS = [
  "dx",
  "dy",
  "scale",
  "scaleX",
  "scaleY",
  "skewX",
  "skewY",
  "rotation",
  "originX",
  "originY",
  "opacity",
] as const;

type MotionValueKey = (typeof MOTION_VALUE_KEYS)[number];

const MOTION_VALUE_DEFAULTS: Record<MotionValueKey, number> = {
  dx: 0,
  dy: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  skewX: 0,
  skewY: 0,
  rotation: 0,
  originX: 0.5,
  originY: 0.5,
  opacity: 1,
};

function initialKeyposesForPreset(
  preset: MotionPreset | undefined,
  runtime: CharacterRuntime,
): RecordedKeypose[] {
  if (!preset) return [initialRestKeypose()];
  const keyposes = preset.keyposes?.length
    ? cloneKeyposes(preset.keyposes)
    : keyposesFromTracks(preset, runtime);
  return ensureInitialRestKeypose(keyposes);
}

function initialRestKeypose(): RecordedKeypose {
  return {
    t: 0,
    parts: [],
  };
}

function ensureInitialRestKeypose(keyposes: RecordedKeypose[]): RecordedKeypose[] {
  const sorted = cloneKeyposes(keyposes).sort((a, b) => a.t - b.t);
  if (sorted.length === 0) return [initialRestKeypose()];
  if (Math.abs(sorted[0].t) <= 0.001) return sorted;
  return [initialRestKeypose(), ...sorted];
}

function customPresetName(name: string) {
  return /\bcustom$/i.test(name.trim()) ? name : `${name} custom`;
}

function editorTitle(category: MotionCategory) {
  switch (category) {
    case "expression":
      return "Expression Editor";
    case "gesture":
      return "Gesture Action Editor";
    case "full-body":
      return "Full Body Action Editor";
    case "camera":
      return "Camera Cue Editor";
    case "headTurn":
      return "Head Turn Editor";
    case "custom":
      return "Custom Action Editor";
  }
}

function cloneKeyposes(keyposes: RecordedKeypose[]): RecordedKeypose[] {
  return keyposes.map((keypose) => ({
    ...keypose,
    parts: keypose.parts.map((part) => ({ ...part })),
    camera: keypose.camera ? { ...keypose.camera } : undefined,
    anticipation: keypose.anticipation ? { ...keypose.anticipation } : undefined,
  }));
}

function findKeyposeAt(keyposes: RecordedKeypose[], time: number) {
  return keyposes.find((keypose) => Math.abs(keypose.t - time) <= 0.001) ?? null;
}

function adjacentKeyposeIndex(
  keyposes: RecordedKeypose[],
  selectedTime: number | null,
  draftTime: number,
  direction: -1 | 1,
) {
  if (keyposes.length === 0) return -1;
  const currentIndex =
    selectedTime == null
      ? -1
      : keyposes.findIndex((keypose) => Math.abs(keypose.t - selectedTime) <= 0.001);
  if (currentIndex >= 0) {
    const nextIndex = currentIndex + direction;
    return nextIndex >= 0 && nextIndex < keyposes.length ? nextIndex : -1;
  }
  if (direction > 0) {
    return keyposes.findIndex((keypose) => keypose.t > draftTime + 0.001);
  }
  for (let index = keyposes.length - 1; index >= 0; index -= 1) {
    if (keyposes[index].t < draftTime - 0.001) return index;
  }
  return -1;
}

function keyposeDraftSignature(keypose: RecordedKeypose): string {
  return JSON.stringify({
    t: keypose.t,
    parts: keypose.parts,
    faceTurnX: keypose.faceTurnX,
    faceTurnY: keypose.faceTurnY,
    camera: keypose.camera,
  });
}

function keyposesFromTracks(preset: MotionPreset, runtime: CharacterRuntime): RecordedKeypose[] {
  const tracks = preset.tracks ?? [];
  if (tracks.length === 0) return [];
  const duration = Math.max(0.1, preset.duration);
  const normalizedTimes = new Set<number>([0, 1]);
  for (const track of tracks) {
    for (const keyframe of track.keyframes) {
      normalizedTimes.add(round(Math.max(0, Math.min(1, keyframe.t)), 4));
    }
  }
  return Array.from(normalizedTimes)
    .sort((a, b) => a - b)
    .map((tNorm) => {
      const parts: RecordedPartOverride[] = [];
      let camera: RecordedKeypose["camera"];
      for (const track of tracks) {
        const sample = sampleMotionTrack(track, tNorm);
        const keys = usedMotionValueKeys(track);
        if (track.partRole === "__camera") {
          camera = {
            dx: sample.dx,
            dy: sample.dy,
            zoom: sample.scale,
          };
          continue;
        }
        for (const slot of slotsForTrack(track, runtime)) {
          parts.push(recordedOverrideFromMotionTrack(track, slot, sample, keys));
        }
      }
      return {
        t: round(tNorm * duration, 3),
        parts,
        camera,
      };
    });
}

function slotsForTrack(track: MotionTrack, runtime: CharacterRuntime) {
  if (track.slotId) return runtime.slots.filter((slot) => slot.id === track.slotId);
  if (track.target === "bone" && track.boneId) {
    return runtime.slots.filter(
      (slot) => runtime.bindingBySlot.get(slot.id)?.effectiveBoneId === track.boneId,
    );
  }
  return runtime.slots.filter((slot) => slot.role === track.partRole);
}

function usedMotionValueKeys(track: MotionTrack): MotionValueKey[] {
  return MOTION_VALUE_KEYS.filter((key) =>
    track.keyframes.some((keyframe) => keyframe[key] !== undefined),
  );
}

function recordedOverrideFromMotionTrack(
  track: MotionTrack,
  slot: CharacterSlot,
  sample: Partial<Record<MotionValueKey, number>>,
  keys: MotionValueKey[],
): RecordedPartOverride {
  const out: RecordedPartOverride =
    track.target === "bone" && track.boneId
      ? {
          target: "bone",
          boneId: track.boneId,
          slotId: slot.id,
          partRole: slot.role,
        }
      : { target: "slot", partRole: slot.role, slotId: slot.id };
  if (track.poseSwap) out.poseSwap = track.poseSwap;
  const writable = out as RecordedPartOverride & Partial<Record<MotionValueKey, number>>;
  for (const key of keys) {
    const value = sample[key];
    if (value !== undefined) writable[key] = round(value, 4);
  }
  return out;
}

function sampleMotionTrack(
  track: MotionTrack,
  tNorm: number,
): Partial<Record<MotionValueKey, number>> {
  const sorted = [...track.keyframes].sort((a, b) => a.t - b.t);
  if (sorted.length === 0) return {};
  if (sorted.length === 1) return sampleSingleMotionKeyframe(sorted[0]);
  let a = sorted[0];
  let b = sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1].t >= tNorm) {
      a = sorted[i];
      b = sorted[i + 1];
      break;
    }
  }
  const span = Math.max(0.0001, b.t - a.t);
  const u = sampleMotionEase(b.ease ?? a.ease, Math.max(0, Math.min(1, (tNorm - a.t) / span)));
  const out: Partial<Record<MotionValueKey, number>> = {};
  for (const key of MOTION_VALUE_KEYS) {
    const av = a[key];
    const bv = b[key];
    if (av === undefined && bv === undefined) continue;
    if (av === undefined) out[key] = bv;
    else if (bv === undefined) out[key] = av;
    else out[key] = av + (bv - av) * u;
  }
  return out;
}

function sampleSingleMotionKeyframe(
  keyframe: MotionKeyframe,
): Partial<Record<MotionValueKey, number>> {
  const out: Partial<Record<MotionValueKey, number>> = {};
  for (const key of MOTION_VALUE_KEYS) {
    const value = keyframe[key] ?? MOTION_VALUE_DEFAULTS[key];
    if (keyframe[key] !== undefined) out[key] = value;
  }
  return out;
}

function constrainRecorderOverrides({
  character,
  rig,
  runtime,
  slots,
  overrides,
  activePartForSlot,
  basePoses,
  constraintCtx,
  allowOutOfBounds,
  faceTurnX,
  faceTurnY,
}: {
  character: CharacterPreset;
  rig: RuntimeRig;
  runtime: CharacterRuntime;
  slots: CharacterSlot[];
  overrides: Map<string, RecorderPartState>;
  activePartForSlot: (slot: CharacterSlot, poseSwap?: string) => CharacterPart | undefined;
  basePoses: Record<string, string>;
  constraintCtx: MotionConstraintContext;
  allowOutOfBounds: string[];
  faceTurnX: number;
  faceTurnY: number;
}): Map<string, RecorderPartState> {
  const out = new Map<string, RecorderPartState>();
  const activeVariants = activeVariantsForRecorderOverrides(basePoses, overrides);
  const unclampedLayers = new Set(allowOutOfBounds);
  const animatedBoneIds = animatedBoneIdsForRecorderOverrides({
    runtime,
    slots,
    overrides,
    activePartForSlot,
  });

  for (const [slotId, override] of overrides) {
    const slot = slots.find((candidate) => candidate.id === slotId);
    const part = slot ? activePartForSlot(slot, override.poseSwap) : undefined;
    if (!slot || !part) {
      out.set(slotId, override);
      continue;
    }
    const withTarget = { ...override, ...recorderMotionTargetForSlot(slot, runtime) };
    const hostClamped = clampRecorderOverrideToHost({
      character,
      runtime,
      rig,
      slots,
      overrides,
      activePartForSlot,
      slot,
      part,
      override: withTarget,
      activeVariants,
      faceTurnX,
      faceTurnY,
    });
    const fkLocked = resolveFkJointDelta({
      ctx: constraintCtx,
      boneId: hostClamped.boneId,
      slotId: slot.id,
      role: slot.role,
      dx: hostClamped.dx,
      dy: hostClamped.dy,
      animatedBoneIds,
      unclampedLayers,
    });
    const fkClamped = fkLocked.clamped
      ? { ...hostClamped, dx: round(fkLocked.dx, 1), dy: round(fkLocked.dy, 1) }
      : hostClamped;
    const limited = resolveMotionDelta({
      ctx: constraintCtx,
      slotId: slot.id,
      boneId: fkClamped.boneId,
      role: slot.role,
      activeVariants,
      dx: fkClamped.dx,
      dy: fkClamped.dy,
      rotation: fkClamped.rotation,
      unclampedLayers,
    });
    out.set(
      slotId,
      limited.clamped
        ? {
            ...fkClamped,
            dx: round(limited.dx, 1),
            dy: round(limited.dy, 1),
            rotation: round(limited.rotation, 1),
          }
        : fkClamped,
    );
  }
  return out;
}

function activeVariantsForRecorderOverrides(
  basePoses: Record<string, string>,
  overrides: Map<string, RecorderPartState>,
): Record<string, string> {
  const activeVariants: Record<string, string> = { ...basePoses };
  for (const [slotId, override] of overrides) {
    if (override.poseSwap) activeVariants[slotId] = override.poseSwap;
  }
  return activeVariants;
}

function animatedBoneIdsForRecorderOverrides({
  runtime,
  slots,
  overrides,
  activePartForSlot,
}: {
  runtime: CharacterRuntime;
  slots: CharacterSlot[];
  overrides: Map<string, RecorderPartState>;
  activePartForSlot: (slot: CharacterSlot, poseSwap?: string) => CharacterPart | undefined;
}): Set<string> {
  const out = new Set<string>();
  for (const [slotId, override] of overrides) {
    const slot = slots.find((candidate) => candidate.id === slotId);
    const part = slot ? activePartForSlot(slot, override.poseSwap) : undefined;
    if (!slot || !part || !motionDeltaMovesJoint(override)) continue;
    const target = recorderMotionTargetForSlot(slot, runtime);
    if (target.target === "bone" && target.boneId) out.add(target.boneId);
  }
  return out;
}

function recorderMotionTargetForSlot(
  slot: CharacterSlot,
  runtime: CharacterRuntime,
): Pick<RecorderPartState, "target" | "boneId"> {
  const target = runtimeMotionTargetForSlot(runtime, slot.id);
  return target.kind === "bone"
    ? { target: "bone", boneId: target.boneId }
    : { target: "slot", boneId: target.boneId };
}

function clampRecorderOverrideToHost({
  character,
  runtime,
  rig,
  slots,
  overrides,
  activePartForSlot,
  slot,
  part,
  override,
  activeVariants,
  faceTurnX,
  faceTurnY,
}: {
  character: CharacterPreset;
  runtime: CharacterRuntime;
  rig: RuntimeRig;
  slots: CharacterSlot[];
  overrides: Map<string, RecorderPartState>;
  activePartForSlot: (slot: CharacterSlot, poseSwap?: string) => CharacterPart | undefined;
  slot: CharacterSlot;
  part: CharacterPart;
  override: RecorderPartState;
  activeVariants: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
  faceTurnX: number;
  faceTurnY: number;
}): RecorderPartState {
  const constraint = rig.hostConstraints.find((entry) => entry.slotId === slot.id);
  if (
    !constraint?.hostSlotId ||
    constraint.hostSlotId === slot.id ||
    constraint.mode === "reach" ||
    constraint.reachPolicy === "allow"
  ) {
    return override;
  }

  const hostSlot = slots.find((candidate) => candidate.id === constraint.hostSlotId);
  const hostOverride = hostSlot ? overrides.get(hostSlot.id) : undefined;
  const hostPart = hostSlot ? activePartForSlot(hostSlot, hostOverride?.poseSwap) : undefined;
  if (!hostSlot || !hostPart) return override;

  const worldByBone = runtimeBoneWorldTransforms(runtime, activeVariants);
  const hostBounds = recorderPartFrame(
    hostSlot,
    hostPart,
    hostOverride ?? defaultOverride(hostSlot.id, hostPart),
    runtime,
    overrides,
    activePartForSlot,
    faceTurnX,
    faceTurnY,
    character.canvasWidth,
    character.canvasHeight,
    activeVariants,
    worldByBone,
    recorderPartPlacement(hostSlot, hostPart, runtime, activeVariants, worldByBone),
  ).bounds;
  const subjectBounds = recorderPartFrame(
    slot,
    part,
    override,
    runtime,
    overrides,
    activePartForSlot,
    faceTurnX,
    faceTurnY,
    character.canvasWidth,
    character.canvasHeight,
    activeVariants,
    worldByBone,
    recorderPartPlacement(slot, part, runtime, activeVariants, worldByBone),
  ).bounds;
  let canvasDx = 0;
  let canvasDy = 0;

  if (subjectBounds.right - subjectBounds.left > hostBounds.right - hostBounds.left) {
    const subjectCenter = (subjectBounds.left + subjectBounds.right) / 2;
    const hostCenter = (hostBounds.left + hostBounds.right) / 2;
    canvasDx += hostCenter - subjectCenter;
  } else {
    if (subjectBounds.left < hostBounds.left) canvasDx += hostBounds.left - subjectBounds.left;
    if (subjectBounds.right > hostBounds.right) canvasDx -= subjectBounds.right - hostBounds.right;
  }

  if (subjectBounds.bottom - subjectBounds.top > hostBounds.bottom - hostBounds.top) {
    const subjectCenter = (subjectBounds.top + subjectBounds.bottom) / 2;
    const hostCenter = (hostBounds.top + hostBounds.bottom) / 2;
    canvasDy += hostCenter - subjectCenter;
  } else {
    if (subjectBounds.top < hostBounds.top) canvasDy += hostBounds.top - subjectBounds.top;
    if (subjectBounds.bottom > hostBounds.bottom)
      canvasDy -= subjectBounds.bottom - hostBounds.bottom;
  }

  if (canvasDx === 0 && canvasDy === 0) return override;
  const correction = canvasDeltaToMotionDelta(
    runtime,
    runtimeMotionTargetForSlot(runtime, slot.id),
    { x: canvasDx, y: canvasDy },
    worldByBone,
  );
  return {
    ...override,
    dx: Math.round(override.dx + correction.x),
    dy: Math.round(override.dy + correction.y),
  };
}

function defaultOverride(slotId: string, part?: CharacterPart): RecorderPartState {
  return {
    slotId,
    dx: 0,
    dy: 0,
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
    skewY: 0,
    rotation: 0,
    originX: part?.anchorX ?? 0.5,
    originY: part?.anchorY ?? 0.5,
    opacity: 1,
  };
}

function recorderOverrideMapsEqual(
  a: Map<string, RecorderPartState>,
  b: Map<string, RecorderPartState>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [key, av] of a.entries()) {
    const bv = b.get(key);
    if (!bv || !recorderOverridesEqual(av, bv)) return false;
  }
  return true;
}

function recorderOverridesEqual(a: RecorderPartState, b: RecorderPartState): boolean {
  return (
    a.slotId === b.slotId &&
    a.target === b.target &&
    a.boneId === b.boneId &&
    a.poseSwap === b.poseSwap &&
    Object.is(a.dx, b.dx) &&
    Object.is(a.dy, b.dy) &&
    Object.is(a.scale, b.scale) &&
    Object.is(a.scaleX, b.scaleX) &&
    Object.is(a.scaleY, b.scaleY) &&
    Object.is(a.skewX, b.skewX) &&
    Object.is(a.skewY, b.skewY) &&
    Object.is(a.rotation, b.rotation) &&
    Object.is(a.originX, b.originX) &&
    Object.is(a.originY, b.originY) &&
    Object.is(a.opacity, b.opacity)
  );
}

function isDirtyOverride(override: RecorderPartState | undefined, part?: CharacterPart) {
  if (!override) return false;
  const rest = defaultOverride(override.slotId, part);
  return (
    override.poseSwap !== undefined ||
    override.dx !== 0 ||
    override.dy !== 0 ||
    override.scale !== 1 ||
    override.scaleX !== 1 ||
    override.scaleY !== 1 ||
    override.skewX !== 0 ||
    override.skewY !== 0 ||
    override.rotation !== 0 ||
    override.originX !== rest.originX ||
    override.originY !== rest.originY ||
    override.opacity !== 1
  );
}

function variantOptionsForSlot(slot: CharacterSlot) {
  const variants = new Map<string, string>();
  for (const part of slot.parts) {
    if (!part.variant && !part.pose && !part.viseme && !part.eyeState) continue;
    const value = variantKeyForPart(part);
    if (!value) continue;
    variants.set(value, variantLabelForPart(part));
  }
  if (variants.size === 0) return [];
  const defaultValue = slot.role === "eye" ? "open" : slot.role === "mouth" ? "rest" : undefined;
  return [
    {
      value: "",
      label: defaultValue ? `Default (${variantLabel(slot.role, defaultValue)})` : "Default",
    },
    ...Array.from(variants, ([value, label]) => ({ value, label })),
  ];
}

function variantLabel(role: PartRole, value: string) {
  if (role === "mouth" && value === "O") return "Round / O";
  if (role === "mouth" && value === "MBP") return "Closed / MBP";
  if (role === "mouth" && value === "FV") return "Teeth / FV";
  if (role === "mouth" && value === "WQ") return "Pucker / WQ";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function recorderPartPlacement(
  slot: CharacterSlot,
  part: CharacterPart,
  runtime: CharacterRuntime,
  activeVariants?: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
  worldByBone?: CharacterRuntime["worldByBone"],
): RecorderPartPlacement {
  return runtimePartPlacement(slot, part, runtime, {
    poseKey: variantKeyForPart(part),
    activeVariants,
    worldByBone,
  });
}

function recorderPartFrame(
  slot: CharacterSlot,
  part: CharacterPart,
  override: RecorderPartState,
  runtime: CharacterRuntime,
  overrides: ReadonlyMap<string, RecorderPartState>,
  activePartForSlot: (slot: CharacterSlot, poseSwap?: string) => CharacterPart | undefined,
  faceTurnX: number,
  faceTurnY: number,
  canvasWidth: number,
  canvasHeight: number,
  activeVariants: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
  worldByBone: CharacterRuntime["worldByBone"],
  placement = recorderPartPlacement(slot, part, runtime, activeVariants, worldByBone),
): RuntimePartFrame {
  const target = runtimeMotionTargetForSlot(runtime, slot.id);
  const transform = recorderFrameTransform(
    part,
    override,
    runtime,
    target,
    worldByBone,
    faceTurnX,
    faceTurnY,
    canvasWidth,
    canvasHeight,
  );
  return resolveRuntimePosePartFrame({
    slotId: slot.id,
    resolveTransformForSlot: (ancestorSlotId) => {
      const ancestorSlot = runtime.slotById.get(ancestorSlotId);
      if (!ancestorSlot) return undefined;
      const ancestorOverride = overrides.get(ancestorSlotId);
      const ancestorPart = activePartForSlot(ancestorSlot, ancestorOverride?.poseSwap);
      if (!ancestorPart) return undefined;
      return recorderFrameTransform(
        ancestorPart,
        ancestorOverride ?? defaultOverride(ancestorSlotId, ancestorPart),
        runtime,
        runtimeMotionTargetForSlot(runtime, ancestorSlotId),
        worldByBone,
        faceTurnX,
        faceTurnY,
        canvasWidth,
        canvasHeight,
      );
    },
    part,
    placement,
    runtime,
    target,
    localBounds: localAlphaBounds(part),
    transform,
    worldByBone,
  });
}

function recorderFrameTransform(
  part: CharacterPart,
  override: RecorderPartState,
  runtime: CharacterRuntime,
  target: ReturnType<typeof runtimeMotionTargetForSlot>,
  worldByBone: CharacterRuntime["worldByBone"],
  faceTurnX: number,
  faceTurnY: number,
  canvasWidth: number,
  canvasHeight: number,
): PartFrameTransform {
  const turn = faceTurnMotionForPart(part, faceTurnX, canvasWidth, faceTurnY, canvasHeight);
  const turnDelta = canvasDeltaToMotionDelta(
    runtime,
    target,
    { x: turn.dx, y: turn.dy },
    worldByBone,
  );
  return {
    dx: override.dx + turnDelta.x,
    dy: override.dy + turnDelta.y,
    rotation: override.rotation + turn.rotation,
    scaleX: override.scale * override.scaleX * turn.scaleX,
    scaleY: override.scale * override.scaleY * turn.scaleY,
    skewX: override.skewX + turn.skewX,
    skewY: override.skewY + turn.skewY,
    originX: override.originX,
    originY: override.originY,
  };
}

function roleLabel(role: PartRole) {
  return role
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function round(n: number, digits: number) {
  const k = Math.pow(10, digits);
  return Math.round(n * k) / k;
}
