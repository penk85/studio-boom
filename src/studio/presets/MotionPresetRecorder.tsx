// MotionPresetRecorder — visual pose-and-capture flow for reusable motion presets.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
import { useStudio } from "../store";
import {
  buildCharacterCompositionHtml,
  buildCharacterGsapScript,
  characterAssetIds,
} from "../character/composition";
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
import {
  angleRigJsonFromPreset,
  characterJsonFromPreset,
  motionJsonFilename,
} from "../character-json/normalize";
import { buildMotionRequestPrompt } from "../character-json/ai-context";
import { sampleKeyposesAtTime } from "./keypose-sampling";
import { sampleMotionEase } from "./easing";
import { motionJsonToPreset, parseJsonArtifact, validateMotionJsonForAngle } from "./motion-json";
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
  MotionTrack,
  PartRole,
  RecordedKeypose,
  RecordedPartOverride,
} from "../types";
import type { MotionJson } from "../character-json/schema";

const CATEGORIES: { value: MotionCategory; label: string }[] = [
  { value: "expression", label: "Expression" },
  { value: "gesture", label: "Body gesture" },
  { value: "full-body", label: "Full body" },
  { value: "camera", label: "Camera move" },
  { value: "headTurn", label: "Head turn" },
  { value: "custom", label: "Custom" },
];

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
  onSaved,
  copyOnSave,
}: {
  character: CharacterPreset;
  onClose: () => void;
  initialPreset?: MotionPreset;
  onSaved?: (preset: MotionPreset) => void;
  copyOnSave?: boolean;
}) {
  const runtime = useMemo(() => buildCharacterRuntime(character), [character]);
  const rig = runtime.rig;
  const slots = runtime.slots;
  // The same resolved runtime boundary the compiled timeline clamps through — editing is WYSIWYG.
  const constraintCtx = runtime.constraintContext;
  const usesGeneratedMouth = !!character.mouthRig && character.mouthStyle === "rig";
  const generatedMouthPart = useMemo(
    () => (usesGeneratedMouth ? generatedMouthPreviewPart(character) : null),
    [character, usesGeneratedMouth],
  );
  const [name, setName] = useState(
    initialPreset && (initialPreset.builtin || copyOnSave)
      ? customPresetName(initialPreset.name)
      : (initialPreset?.name ?? "New movement"),
  );
  const [category, setCategory] = useState<MotionCategory>(initialPreset?.category ?? "expression");
  const [duration, setDuration] = useState(initialPreset?.duration ?? 1);
  const [time, setTime] = useState(0);
  const [keyposes, setKeyposes] = useState<RecordedKeypose[]>(() =>
    initialKeyposesForPreset(initialPreset, runtime),
  );
  const [overrides, setOverrides] = useState<Map<string, RecorderPartState>>(new Map());
  const [draftDirty, setDraftDirty] = useState(false);
  // Layers this movement may push past the character's reach (slot ids and/or roles) — the
  // per-movement escape hatch. Carried from the loaded preset and saved back with it.
  const [allowOutOfBounds, setAllowOutOfBounds] = useState<string[]>(
    () => initialPreset?.allowOutOfBounds ?? [],
  );
  const [faceTurnX, setFaceTurnX] = useState(initialPreset?.keyposes?.[0]?.faceTurnX ?? 0);
  const [faceTurnY, setFaceTurnY] = useState(initialPreset?.keyposes?.[0]?.faceTurnY ?? 0);
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
  const [playbackPreset, setPlaybackPreset] = useState<MotionPreset | null>(null);
  const [previewCompileRevision, setPreviewCompileRevision] = useState(0);
  const [selectPopover, setSelectPopover] = useState<SelectPopover | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const wrapRef = useRef<HTMLElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const lastPickRef = useRef<DrillPick | null>(null);
  const basePoses = useMemo(() => defaultPoseForCharacter(character), [character]);
  const characterJson = useMemo(() => characterJsonFromPreset(character), [character]);
  const activeAngleRig = useMemo(() => angleRigJsonFromPreset(character), [character]);
  const activePartForSlot = useCallback(
    (slot: CharacterSlot, poseSwap?: string) => {
      if (usesGeneratedMouth && slot.role === "mouth" && generatedMouthPart)
        return generatedMouthPart;
      const poseKey = poseSwap ?? basePoses[slot.id];
      return resolveRuntimeSlotPart(slot, runtime, poseKey);
    },
    [basePoses, generatedMouthPart, runtime, usesGeneratedMouth],
  );
  const motionAiAdapter = useMemo<AiGeneratedFeatureAdapter<MotionJson>>(
    () => ({
      featureName: "Studio Boom motion editor",
      artifactLabel: "movement JSON",
      buildPrompt: (request) =>
        buildMotionRequestPrompt({
          character: characterJson,
          activeAngle: activeAngleRig,
          request,
        }),
      parseArtifact: (source) => {
        const parsed = parseJsonArtifact(source);
        if (parsed.error) return { ok: false, errors: [`Invalid JSON: ${parsed.error}`] };

        const motion = motionFromPastedJson(parsed.value);
        if (!motion) {
          return {
            ok: false,
            errors: ['Paste kind "studioBoom.ai.motionSuggestion.v1" or "studioBoom.motion.v1".'],
          };
        }

        const validation = validateMotionJsonForAngle(motion, activeAngleRig);
        const warnings = validation.warnings.map((issue) => `${issue.path}: ${issue.message}`);
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
        setDuration(converted.preset.duration);
        setKeyposes(cloneKeyposes(converted.preset.keyposes ?? []));
        setAllowOutOfBounds(converted.preset.allowOutOfBounds ?? []);
        setDraftDirty(false);
        setTime(0);
        setPreviewPlaying(false);

        return {
          ok: true,
          message: `Loaded "${converted.preset.name}" into the editor. Preview, tweak, then save.`,
          warnings: converted.warnings,
          summary: {
            title: converted.preset.name,
            detail: "Loaded into the motion editor.",
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
          featureName: "Studio Boom motion editor",
          artifactLabel: "movement JSON",
          errors,
          source,
        }),
    }),
    [activeAngleRig, characterJson],
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
      setTime((current) => {
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
  }, [duration]);

  const keyposesForSampling = keyposes;

  useEffect(() => {
    if (previewPlaying) return;
    const interp = sampleKeyposesAtTime(keyposesForSampling, time);
    const next = new Map<string, RecorderPartState>();
    for (const ov of interp.parts.values()) {
      const slotId = slotIdForRecordedOverride(runtime, ov);
      const slot = slotId ? runtime.slotById.get(slotId) : undefined;
      if (!slot) continue;
      const poseSwap = usesGeneratedMouth && slot.role === "mouth" ? undefined : ov.poseSwap;
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
      faceTurnX: interp.faceTurnX,
      faceTurnY: interp.faceTurnY,
    });
    setOverrides((prev) => (recorderOverrideMapsEqual(prev, constrained) ? prev : constrained));
    setFaceTurnX((prev) => (Object.is(prev, interp.faceTurnX) ? prev : interp.faceTurnX));
    setFaceTurnY((prev) => (Object.is(prev, interp.faceTurnY) ? prev : interp.faceTurnY));
    setDraftDirty(false);
  }, [
    activePartForSlot,
    allowOutOfBounds,
    basePoses,
    character,
    constraintCtx,
    keyposesForSampling,
    rig,
    runtime,
    slots,
    time,
    usesGeneratedMouth,
    previewPlaying,
  ]);

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
      const poseSwap = slot?.role === "mouth" && usesGeneratedMouth ? undefined : ov.poseSwap;
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
  }, [activePartForSlot, overrides, runtime, slots, usesGeneratedMouth]);

  const sortedKeyposes = useMemo(
    () => cloneKeyposes(keyposes).sort((a, b) => a.t - b.t),
    [keyposes],
  );

  const keyposesForPlayback = useCallback(() => {
    const currentParts = currentRecordedParts();
    const hasDraft = draftDirty || currentParts.length > 0 || faceTurnX !== 0 || faceTurnY !== 0;
    if (!hasDraft) return sortedKeyposes;
    const existing = keyposes.find((k) => Math.abs(k.t - time) <= 0.001);
    const draft: RecordedKeypose = {
      t: round(time, 2),
      parts: currentParts,
      faceTurnX: faceTurnX === 0 ? undefined : faceTurnX,
      faceTurnY: faceTurnY === 0 ? undefined : faceTurnY,
      ease: existing?.ease ?? "easeInOut",
      anticipation: existing?.anticipation,
    };
    return [
      ...sortedKeyposes.filter((keypose) => Math.abs(keypose.t - draft.t) > 0.001),
      draft,
    ].sort((a, b) => a.t - b.t);
  }, [currentRecordedParts, draftDirty, faceTurnX, faceTurnY, keyposes, sortedKeyposes, time]);

  // Stable preset: committed keyposes only, no live overrides or face-turn.
  // Controls srcDoc (DOM structure) — only rebuilds the iframe on keypose commits.
  const stablePreviewPreset = useMemo(() => {
    if (sortedKeyposes.length === 0) return null;
    return recorderPreviewPreset({
      name,
      category,
      duration,
      keyposes: sortedKeyposes,
      allowOutOfBounds,
    });
  }, [allowOutOfBounds, category, duration, name, sortedKeyposes]);

  // Edit preset: current overrides + face-turn at t=0.
  // Used for GSAP script injection — changes every drag frame but never reloads the DOM.
  const editPreviewPreset = useMemo(() => {
    const currentParts = currentRecordedParts();
    if (currentParts.length === 0 && faceTurnX === 0 && faceTurnY === 0) return null;
    return recorderPreviewPreset({
      name,
      category,
      duration,
      keyposes: [
        {
          t: 0,
          parts: currentParts,
          faceTurnX: faceTurnX === 0 ? undefined : faceTurnX,
          faceTurnY: faceTurnY === 0 ? undefined : faceTurnY,
          ease: "linear",
        },
      ],
      allowOutOfBounds,
    });
  }, [allowOutOfBounds, category, currentRecordedParts, duration, faceTurnX, faceTurnY, name]);

  const commitRecorderPreviewToHtml = useCallback(() => {
    const playbackKeyposes = keyposesForPlayback();
    const preset =
      playbackKeyposes.length > 0
        ? recorderPreviewPreset({
            name,
            category,
            duration,
            keyposes: playbackKeyposes,
            allowOutOfBounds,
          })
        : null;
    setPlaybackPreset(preset);
    setPreviewCompileRevision((revision) => revision + 1);
    setTime(0);
    setPreviewPlaying(true);
  }, [allowOutOfBounds, category, duration, keyposesForPlayback, name]);

  const stopCompiledPreview = useCallback(() => {
    setPreviewPlaying(false);
    setPlaybackPreset(null);
  }, []);

  const updateOverride = (slotId: string, patch: Partial<RecorderPartState>) => {
    stopCompiledPreview();
    setDraftDirty(true);
    setOverrides((prev) => {
      const next = new Map(prev);
      const slot = slots.find((item) => item.id === slotId);
      const cur = next.get(slotId);
      const curPart = slot ? activePartForSlot(slot, cur?.poseSwap) : undefined;
      const base = cur ?? defaultOverride(slotId, curPart);
      const normalizedPatch =
        slot?.role === "mouth" && usesGeneratedMouth && "poseSwap" in patch
          ? { ...patch, poseSwap: undefined }
          : patch;
      const targetMeta = slot ? recorderMotionTargetForSlot(slot, runtime) : {};
      const merged = { ...base, ...targetMeta, ...normalizedPatch };
      next.set(slotId, merged);
      return constrainRecorderOverrides({
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
    });
  };

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
    const startX = e.clientX;
    const startY = e.clientY;
    const ox = subjectId ? (overrides.get(subjectId)?.dx ?? 0) : 0;
    const oy = subjectId ? (overrides.get(subjectId)?.dy ?? 0) : 0;
    const subjectTarget = subjectId ? runtimeMotionTargetForSlot(runtime, subjectId) : undefined;
    let dragging = false;

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
      updateOverride(subjectId, {
        dx: Math.round(ox + delta.x),
        dy: Math.round(oy + delta.y),
      });
    };
    const up = () => {
      if (dragging) return;
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
    startWindowPointerDrag({ onMove: move, onEnd: up });
  };

  const captureKeypose = () => {
    const existing = keyposes.find((k) => Math.abs(k.t - time) <= 0.001);
    const kp: RecordedKeypose = {
      t: round(time, 2),
      parts: currentRecordedParts(),
      faceTurnX: faceTurnX === 0 ? undefined : faceTurnX,
      faceTurnY: faceTurnY === 0 ? undefined : faceTurnY,
      ease: existing?.ease ?? "easeInOut",
      anticipation: existing?.anticipation,
    };
    setKeyposes((prev) => {
      const filtered = prev.filter((k) => Math.abs(k.t - kp.t) > 0.001);
      return [...filtered, kp].sort((a, b) => a.t - b.t);
    });
    setDraftDirty(false);
  };

  const updateKeypose = (t: number, patch: Partial<RecordedKeypose>) => {
    setKeyposes((prev) =>
      prev.map((kp) => (Math.abs(kp.t - t) <= 0.001 ? { ...kp, ...patch } : kp)),
    );
  };

  const removeKeypose = (t: number) =>
    setKeyposes((prev) => prev.filter((k) => Math.abs(k.t - t) > 0.001));

  const save = async () => {
    const playbackKeyposes = keyposesForPlayback();
    if (playbackKeyposes.length === 0) {
      alert("Capture at least one pose before saving.");
      return;
    }
    const now = Date.now();
    const savingCopy = !!initialPreset && (!!initialPreset.builtin || !!copyOnSave);
    const preset: MotionPreset = {
      id: savingCopy ? uid() : (initialPreset?.id ?? uid()),
      name: name.trim() || "Untitled movement",
      category,
      duration: Math.max(0.1, duration),
      loop: initialPreset?.loop ?? false,
      tracks: [],
      keyposes: cloneKeyposes(playbackKeyposes).sort((a, b) => a.t - b.t),
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

  return (
    <GeneratedEditorShell
      title={initialPreset ? `Edit ${editorTitle(category)}` : `Create ${editorTitle(category)}`}
      headerControls={
        <>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Movement name"
            className="rounded border border-border bg-input px-2 py-1 text-xs"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as MotionCategory)}
            className="rounded border border-border bg-input px-2 py-1 text-xs"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
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
            onClick={onClose}
            className="rounded border border-border px-2 py-1 text-xs hover:bg-panel"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            {initialPreset?.builtin || copyOnSave
              ? "Save custom movement"
              : initialPreset
                ? "Update movement"
                : "Save movement"}
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
      onPreviewPointerDown={() => setSelectPopover(null)}
      previewPane={
        <>
          <div
            className="relative shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] outline outline-1 outline-border"
            style={{
              width: character.canvasWidth * displayScale,
              height: character.canvasHeight * displayScale,
              background: "oklch(0.12 0.015 270)",
            }}
          >
            <div
              ref={planeRef}
              onPointerDown={handlePlanePointerDown}
              className="absolute left-0 top-0 origin-top-left"
              style={{
                width: character.canvasWidth,
                height: character.canvasHeight,
                transform: `scale(${displayScale})`,
              }}
            >
              <RecorderHyperFramesPreview
                character={character}
                basePoses={basePoses}
                preset={previewPlaying ? playbackPreset : stablePreviewPreset}
                editPreset={previewPlaying ? null : editPreviewPreset}
                compileRevision={previewCompileRevision}
                time={time}
              />
              {!previewPlaying && selectedSlot && selectedPart && selectedOverride && (
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
            title="AI Movement"
            intro={
              <>
                Optional AI add-on. Copy one prompt package, use it in your AI chat, then paste the
                returned movement JSON here to preview before saving.
              </>
            }
            requestLabel="Describe movement"
            request={aiAddon.request}
            pasteLabel="Paste returned movement JSON"
            paste={aiAddon.paste}
            pastePlaceholder={`Paste ${motionJsonFilename("AI movement")} or *.motion-suggestion.ai-in.json`}
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
            usesGeneratedMouth={usesGeneratedMouth}
            advancedOpen={advancedOpen}
            rotationLimit={selectedRotationLimit}
            allowOutOfBounds={selectedAllowsOutOfBounds}
            onAllowOutOfBoundsChange={setSelectedAllowOutOfBounds}
            onAdvancedOpenChange={setAdvancedOpen}
            onChange={(patch) => selectedSlotId && updateOverride(selectedSlotId, patch)}
            onResetAll={() => selectedSlotId && clearOverride(selectedSlotId)}
          />

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

          <div className="mt-4 border-t border-border pt-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-semibold uppercase tracking-wider text-muted-foreground">
                Time
              </span>
              <span className="text-[10px] text-muted-foreground">
                {time.toFixed(2)}s / {duration.toFixed(2)}s
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={duration}
              step={0.05}
              value={time}
              onChange={(e) => setTime(Number(e.target.value))}
              className="w-full"
            />
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
              <button
                type="button"
                onClick={() => {
                  if (previewPlaying) stopCompiledPreview();
                  else commitRecorderPreviewToHtml();
                }}
                className="flex items-center justify-center gap-1 rounded border border-border bg-panel-2 px-2 py-1 text-xs hover:bg-panel"
              >
                {previewPlaying ? <Pause size={12} /> : <Play size={12} />}
                {previewPlaying ? "Pause preview" : "Play preview"}
              </button>
              <button
                type="button"
                onClick={() => {
                  commitRecorderPreviewToHtml();
                }}
                className="flex items-center justify-center rounded border border-border bg-panel-2 px-2 py-1 hover:bg-panel"
                title="Restart preview"
              >
                <SkipBack size={12} />
              </button>
            </div>
            <button
              onClick={captureKeypose}
              className="mt-2 w-full rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              Capture pose at {time.toFixed(2)}s
            </button>
          </div>

          <div className="mt-4">
            <div className="mb-1 font-semibold uppercase tracking-wider text-muted-foreground">
              Captured poses
            </div>
            {keyposes.length === 0 && (
              <div className="rounded border border-dashed border-border p-2 text-center text-[10px] text-muted-foreground">
                No poses yet.
              </div>
            )}
            <ul className="space-y-1">
              {keyposes.map((k) => (
                <li
                  key={k.t}
                  className={`rounded border border-border p-2 ${
                    Math.abs(k.t - time) < 0.05 ? "bg-primary/20" : "bg-panel-2"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <button onClick={() => setTime(k.t)} className="flex-1 text-left">
                      {k.t.toFixed(2)}s · {k.parts.length} parts
                    </button>
                    <button
                      onClick={() => removeKeypose(k.t)}
                      className="text-[10px] text-destructive"
                    >
                      Remove
                    </button>
                  </div>
                  <select
                    value={k.ease ?? "easeInOut"}
                    onChange={(e) => updateKeypose(k.t, { ease: e.target.value })}
                    className="mt-2 w-full rounded border border-border bg-input px-1 py-0.5 text-[10px]"
                  >
                    {EASE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[10px] text-muted-foreground">
                      Anticipation
                    </summary>
                    <label className="mt-2 flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!k.anticipation}
                        onChange={(e) =>
                          updateKeypose(k.t, {
                            anticipation: e.target.checked
                              ? { amount: 0.25, duration: 0.12 }
                              : undefined,
                          })
                        }
                      />
                      Enabled
                    </label>
                    {k.anticipation && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <NumberInput
                          label="Amount"
                          value={k.anticipation.amount}
                          min={0}
                          max={1}
                          step={0.05}
                          onChange={(value) =>
                            updateKeypose(k.t, {
                              anticipation: { ...k.anticipation!, amount: value },
                            })
                          }
                        />
                        <NumberInput
                          label="Duration"
                          value={k.anticipation.duration}
                          min={0}
                          max={duration}
                          step={0.01}
                          onChange={(value) =>
                            updateKeypose(k.t, {
                              anticipation: { ...k.anticipation!, duration: value },
                            })
                          }
                        />
                      </div>
                    )}
                  </details>
                </li>
              ))}
            </ul>
          </div>
        </>
      }
    />
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
  usesGeneratedMouth,
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
  usesGeneratedMouth: boolean;
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
  const variantOptions =
    usesGeneratedMouth && slot.role === "mouth" ? [] : variantOptionsForSlot(slot);
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
                  ? "This movement may exceed the limit."
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

// Extract the GSAP timeline setup script from a compiled composition HTML string.
// The character timeline script is the inline <script> block that registers
// window.__timelines[compositionId]. Using it directly guarantees the same
// GSAP vars (effectiveBaseRotation, boneCarriesChildren, face-turn, etc.) as
// the fully compiled animation — the single truth for both overlay and preview.
// Inject the edit-preset GSAP script into the existing iframe without touching srcDoc.
// Kills the old timeline, injects the new script (which creates the paused timeline
// with the correct overrides), then seeks to `time`. No DOM reload = no flash.
// editScript is the raw IIFE text from buildCharacterGsapScript — no HTML parsing needed.
function applyEditScriptToIframe(
  iframe: HTMLIFrameElement | null,
  compositionId: string,
  time: number,
  editScript: string | null,
  attempts = 0,
  isCancelled: () => boolean = () => false,
): void {
  if (isCancelled()) return;
  type TimelineEntry = {
    seek?: (t: number, suppressEvents?: boolean) => unknown;
    pause?: () => unknown;
    kill?: () => void;
  };
  type RWin = Window & { __timelines?: Record<string, TimelineEntry> };
  let win: RWin | null | undefined;
  let timeline: TimelineEntry | undefined;
  try {
    win = iframe?.contentWindow as RWin;
    timeline = win?.__timelines?.[compositionId];
  } catch {
    win = null;
    timeline = undefined;
  }
  if (!timeline) {
    if (iframe && attempts < 30) {
      window.setTimeout(
        () =>
          applyEditScriptToIframe(
            iframe,
            compositionId,
            time,
            editScript,
            attempts + 1,
            isCancelled,
          ),
        40,
      );
    }
    return;
  }
  if (editScript) {
    // Kill old timeline so GSAP releases element control before we rebuild.
    timeline.kill?.();
    const el = iframe!.contentDocument!.createElement("script");
    el.textContent = editScript;
    iframe!.contentDocument!.body.appendChild(el);
    // Re-read the freshly registered timeline.
    timeline = win?.__timelines?.[compositionId];
  }
  timeline?.pause?.();
  timeline?.seek?.(Math.max(0, time), false);
}

function RecorderHyperFramesPreview({
  character,
  basePoses,
  preset,
  editPreset,
  compileRevision,
  time,
}: {
  character: CharacterPreset;
  basePoses: Record<string, string>;
  preset: MotionPreset | null;
  editPreset: MotionPreset | null;
  compileRevision: number;
  time: number;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const compositionId = "recorder_character_preview";

  // Stable HTML: DOM structure + committed motion. Controls srcDoc.
  // Only changes when the character, base poses, or committed keyposes change.
  const sourceHtml = useMemo(() => {
    const motionPresets = preset ? new Map([[preset.id, preset]]) : new Map<string, MotionPreset>();
    return buildCharacterCompositionHtml({
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
      motionPresets,
    });
  }, [basePoses, character, compositionId, preset]);

  // Edit GSAP script: current override state (single t=0 keypose + face-turn).
  // Built on every drag frame and injected into the live iframe — DOM never reloads.
  // Uses buildCharacterGsapScript (not buildCharacterCompositionHtml) so no HTML
  // serialization or DOMParser extraction is needed.
  const editGsapScript = useMemo(() => {
    if (!editPreset) return null;
    const motionPresets = new Map([[editPreset.id, editPreset]]);
    return buildCharacterGsapScript({
      compositionId,
      clipId: "recorder-character-preview-clip",
      width: character.canvasWidth,
      height: character.canvasHeight,
      duration: Math.max(0.1, editPreset.duration),
      character,
      meta: {
        characterId: character.id,
        poses: basePoses,
        autoBlink: false,
        motions: [
          {
            id: "recorder-draft-motion",
            presetId: editPreset.id,
            offset: 0,
            intensity: 1,
            loop: false,
            duration: editPreset.duration,
          },
        ],
      },
      motionPresets,
    });
  }, [basePoses, character, compositionId, editPreset]);

  const [html, setHtml] = useState<string | null>(null);
  const htmlKey = useMemo(() => (html ? recorderHtmlKey(html) : "pending"), [html]);
  const iframeKey = useMemo(
    () => `${htmlKey}:compile-${compileRevision}`,
    [compileRevision, htmlKey],
  );

  useEffect(() => {
    let alive = true;
    // Keep the current iframe mounted while the next composition resolves, and bail when
    // the resolved HTML is identical — resetting to null here (or updating on identical
    // content) reloads the iframe every render and trips the update-depth guard.
    void resolveRecorderPreviewAssetRefs(sourceHtml, character).then((resolved) => {
      if (alive) setHtml((prev) => (prev === resolved ? prev : resolved));
    });
    return () => {
      alive = false;
    };
  }, [character, sourceHtml]);

  // Inject the edit GSAP script whenever the override state changes.
  // When html changes (srcDoc reload), retry until the timeline is ready.
  useEffect(() => {
    if (!html) return;
    let alive = true;
    applyEditScriptToIframe(
      iframeRef.current,
      compositionId,
      time,
      editGsapScript,
      0,
      () => !alive,
    );
    return () => {
      alive = false;
    };
  }, [compositionId, editGsapScript, html, time]);

  return (
    <>
      {html ? (
        <iframe
          key={iframeKey}
          ref={iframeRef}
          title="Recorder HyperFrames character preview"
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          srcDoc={html}
          className="pointer-events-none absolute inset-0 block h-full w-full border-0 bg-transparent"
          onLoad={() => {
            applyEditScriptToIframe(iframeRef.current, compositionId, time, editGsapScript);
          }}
        />
      ) : (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-[11px] text-muted-foreground">
          Loading character preview...
        </div>
      )}
    </>
  );
}

async function resolveRecorderPreviewAssetRefs(
  html: string,
  character: CharacterPreset,
): Promise<string> {
  let resolved = html;
  const assetIds = Array.from(characterAssetIds(character));
  const entries = await Promise.all(
    assetIds.map(async (id) => [id, await getMediaUrl(id)] as const),
  );
  for (const [id, url] of entries) {
    if (!url) continue;
    resolved = resolved.replaceAll(`asset:${id}`, url);
  }
  return resolved;
}

function recorderHtmlKey(html: string): string {
  let hash = 2166136261;
  for (let i = 0; i < html.length; i += 1) {
    hash ^= html.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${html.length}:${hash >>> 0}`;
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
  duration,
  keyposes,
  allowOutOfBounds,
}: {
  name: string;
  category: MotionCategory;
  duration: number;
  keyposes: RecordedKeypose[];
  allowOutOfBounds?: string[];
}): MotionPreset {
  return {
    id: "__recorder_draft_motion",
    name: name.trim() || "Draft movement",
    category,
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
      onChange({
        dx: Math.round(ox + delta.x),
        dy: Math.round(oy + delta.y),
      });
    };
    startWindowPointerDrag({ onMove: move });
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
    const move = (ev: PointerEvent) => {
      const angle = Math.atan2(ev.clientY - pivotY, ev.clientX - pivotX) * (180 / Math.PI);
      onChange({ rotation: round(startRot + angle - startAngle, 1) });
    };
    startWindowPointerDrag({ onMove: move });
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
    const move = (ev: PointerEvent) => {
      const dist = Math.hypot(ev.clientX - pivotX, ev.clientY - pivotY);
      if (startDist < 1) return;
      onChange({ scale: round(Math.max(0.1, startScaleValue * (dist / startDist)), 2) });
    };
    startWindowPointerDrag({ onMove: move });
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
  if (!preset) return [];
  if (preset.keyposes?.length) return cloneKeyposes(preset.keyposes);
  return keyposesFromTracks(preset, runtime);
}

function customPresetName(name: string) {
  return /\bcustom$/i.test(name.trim()) ? name : `${name} custom`;
}

function editorTitle(category: MotionCategory) {
  switch (category) {
    case "expression":
      return "Expression Editor";
    case "gesture":
      return "Body Gesture Editor";
    case "full-body":
      return "Full Body Movement Editor";
    case "camera":
      return "Camera Movement Editor";
    case "headTurn":
      return "Head Turn Editor";
    case "custom":
      return "Custom Movement Editor";
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

function motionFromPastedJson(value: unknown): MotionJson | null {
  if (!isRecord(value)) return null;
  if (value.kind === "studioBoom.motion.v1") return value as MotionJson;
  if (value.kind === "studioBoom.ai.motionSuggestion.v1" && isRecord(value.motion)) {
    return value.motion as MotionJson;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function generatedMouthPreviewPart(character: CharacterPreset): CharacterPart | null {
  const rig = character.mouthRig;
  if (!rig) return null;
  const placement = rig.placement;
  return {
    id: "__generated-mouth-preview",
    slotId: "role:mouth",
    slotName: "Mouth",
    role: "mouth",
    name: "Generated mouth",
    mediaId: "",
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
    rotation: 0,
    anchorX: 0.5,
    anchorY: 0.5,
    pivot: {
      x: placement.x + placement.width / 2,
      y: placement.y + placement.height / 2,
    },
    motionBehavior: "lipSync",
    zIndex: placement.zIndex,
    depth: 0,
    visible: true,
  };
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
