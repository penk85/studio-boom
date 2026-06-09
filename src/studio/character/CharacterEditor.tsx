import { useEffect, useRef, useState } from "react";
import { EYE_PRESETS, MOUTH_PRESETS, generatePresetBlob } from "./presets";
import { clamp } from "./mouth-morph";
import {
  type DrillPick,
  exceedsDragThreshold,
  resolveDragSubject,
  resolveDrillSelection,
} from "../interaction/select-drag";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  Lock,
  Maximize2,
  Minimize2,
  MousePointer2,
  RotateCw,
  Redo2,
  Trash2,
  Unlock,
  Undo2,
  Upload,
} from "lucide-react";
import { db, importMediaFile, uid } from "../db";
import { useMediaUrl } from "../hooks/useMediaUrl";
import { useStudio } from "../store";
import {
  createBlankCharacter,
  CHARACTER_VARIANT_KIND_VALUES,
  defaultMotionBehaviorForRole,
  getPartSlotId,
  listCharacterSlots,
  makePart,
  normalizeCharacterSlots,
  normalizePartVariant,
  normalizePartManifest,
  partMatchesVariant,
  roleEnabledByManifest,
  roleLabel,
  saveCharacter,
  variantKeyForPart,
  variantLabelForPart,
  withInferredHumanParentIds,
} from "./character-utils";
import {
  alphaMaskContains,
  alphaCenterForPart,
  createAlphaHitMaskFromBlob,
  editorControlBounds,
  editorSelectionBounds,
  localAlphaBounds,
  measureAlphaBoundsFromBlob,
  pivotForPart,
  pointInEditorHitBounds,
  type AlphaHitMask,
} from "./alpha-bounds";
import { MOUTH_VISEMES, MOUTH_VISEME_DESCRIPTIONS } from "../lipsync/viseme-schema";
import type { CharacterCommand } from "../character-document";
import type {
  CharacterAngle,
  CharacterPart,
  CharacterPartBounds,
  CharacterPreset,
  CharacterRig,
  CharacterSlotRelation,
  CharacterVariantKind,
  EyeState,
  ID,
  MouthViseme,
  PartMotionBehavior,
  PartManifest,
  PartRole,
} from "../types";
import {
  CHARACTER_ANGLES,
  availableCharacterAngles,
  bindSlotPartToAngle,
  buildDefaultRig,
  rebuildRigPreservingConstraints,
  characterRigPrompt,
  computeBoneWorldTransforms,
  moveBone,
  moveBoneForSlot,
  movePartAndDescendants,
  moveSlotBinding,
  moveSlotParts,
  normalizeCharacterRig,
  resolveSlotBinding,
  setBoneDepth,
  setBoneTransform,
  setSlotHostConstraint,
  setSlotDepth,
  setSlotReach,
  setSlotRotReach,
  slotIdsForBoneSubtree,
  validateCharacterRig,
} from "./rig";

interface Props {
  characterId: string;
  onClose: () => void;
}

const CANVAS_PRESETS = [
  { label: "Portrait", width: 600, height: 900 },
  { label: "Square", width: 1000, height: 1000 },
  { label: "Landscape", width: 1280, height: 720 },
  { label: "Custom", width: 900, height: 900 },
];

const SLOT_DEFS: Array<{ label: string; role: PartRole; side?: CharacterPart["side"] }> = [
  { label: "Head", role: "head" },
  { label: "Body", role: "body" },
  { label: "Left Eye", role: "eye", side: "left" },
  { label: "Right Eye", role: "eye", side: "right" },
  { label: "Left Iris", role: "iris", side: "left" },
  { label: "Right Iris", role: "iris", side: "right" },
  { label: "Left Eyebrow", role: "eyebrow", side: "left" },
  { label: "Right Eyebrow", role: "eyebrow", side: "right" },
  { label: "Nose", role: "nose" },
  { label: "Left Arm", role: "arm", side: "left" },
  { label: "Right Arm", role: "arm", side: "right" },
  { label: "Left Hand", role: "hand", side: "left" },
  { label: "Right Hand", role: "hand", side: "right" },
  { label: "Left Leg", role: "leg", side: "left" },
  { label: "Right Leg", role: "leg", side: "right" },
  { label: "Left Foot", role: "foot", side: "left" },
  { label: "Right Foot", role: "foot", side: "right" },
  { label: "Hair Back", role: "hair", side: "back" },
  { label: "Hair Front", role: "hair", side: "front" },
  { label: "Accessory", role: "accessory" },
];

const ROLE_OPTIONS: PartRole[] = [
  "head",
  "body",
  "eye",
  "iris",
  "eyebrow",
  "nose",
  "mouth",
  "arm",
  "hand",
  "leg",
  "foot",
  "hair",
  "accessory",
  "static",
  "custom",
];

const MOTION_BEHAVIOR_OPTIONS: Array<{ value: PartMotionBehavior; label: string }> = [
  { value: "none", label: "None" },
  { value: "blink", label: "Blink" },
  { value: "rotate", label: "Rotate" },
  { value: "raise", label: "Raise" },
  { value: "lipSync", label: "Lip Sync" },
  { value: "bounce", label: "Bounce" },
];

const VARIANT_KIND_LABELS: Record<CharacterVariantKind, string> = {
  pose: "Pose",
  eyeState: "Eye state",
  viseme: "Viseme",
  handShape: "Hand shape",
  mouthShape: "Mouth shape",
  expression: "Expression",
  custom: "Custom",
};

const SAMPLE_WORDS = ["Hello", "Shalom", "Mommy", "Welcome"];
const EYE_STATES: EyeState[] = ["open", "half", "closed", "wink"];
const HISTORY_LIMIT = 60;

// Lip-sync test clips: drop audio files into ./lipsync-samples and they appear
// automatically as test buttons on the mouth group inspector. (Vite glob — no
// manifest to edit.)
const LIPSYNC_SAMPLES = Object.entries(
  import.meta.glob("./lipsync-samples/*.{mp3,wav,m4a,ogg,aac}", {
    eager: true,
    query: "?url",
    import: "default",
  }) as Record<string, string>,
)
  .map(([path, url]) => ({
    name:
      path
        .split("/")
        .pop()
        ?.replace(/\.[^.]+$/, "") ?? "clip",
    url,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

type EditorMode = "select" | "pivot" | "bounds-rect" | "bounds-ellipse";

/** Focus-mode state while editing a layer's reach (sweep the layer to trace its limit). */
interface RangeEdit {
  slotId: ID;
}
type EditorBoundsMode = "frame" | "art";

export function CharacterEditor({ characterId, onClose }: Props) {
  const [doc, setDoc] = useState<CharacterPreset | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<ID | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<ID | null>(null);
  const [selectedBoneId, setSelectedBoneId] = useState<ID | null>(null);
  const [showBones, setShowBones] = useState(false);
  const [scale, setScale] = useState(0.7);
  const [mode, setMode] = useState<EditorMode>("select");
  // Default to visible-art hit-testing: a click selects a layer by its actual pixels (plus a
  // small halo), not its whole transparent registration frame, so clicking empty space
  // between overlapping layers no longer grabs the wrong one. Toggle back to "frame" anytime.
  const [boundsMode, setBoundsMode] = useState<EditorBoundsMode>("art");
  // Focus mode for editing a layer's reach (hides bones/chrome, shows the traced reach outline).
  const [rangeEdit, setRangeEdit] = useState<RangeEdit | null>(null);
  // The traced reach outline as absolute canvas points (convex hull), while editing.
  const [reachDraft, setReachDraft] = useState<{ x: number; y: number }[] | null>(null);
  // Live rotation reach (min/max degrees from rest) while twisting the layer.
  const [rotDraft, setRotDraft] = useState<{ min: number; max: number } | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  // True while a layer is actively being dragged / resized / rotated, so the other layers
  // can blur to keep focus on it. Set at gesture start; cleared globally on pointerup below.
  const [interacting, setInteracting] = useState(false);
  const [, setPreviewTick] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [mouthTestPlaying, setMouthTestPlaying] = useState(false);
  const [historyPast, setHistoryPast] = useState<CharacterPreset[]>([]);
  const [historyFuture, setHistoryFuture] = useState<CharacterPreset[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const mouthAudioCtxRef = useRef<AudioContext | null>(null);
  const mouthAudioRafRef = useRef<number | null>(null);
  const alphaBackfillRef = useRef<Set<string>>(new Set());
  const alphaMaskRef = useRef<Map<string, AlphaHitMask>>(new Map());
  const alphaMaskLoadingRef = useRef<Set<string>>(new Set());
  // Remembers the last canvas click so a repeat click in the same spot drills the z-stack.
  const canvasLastPickRef = useRef<DrillPick | null>(null);
  const docRef = useRef<CharacterPreset | null>(null);
  const historyPastRef = useRef<CharacterPreset[]>([]);
  const historyFutureRef = useRef<CharacterPreset[]>([]);
  const undoHistoryRef = useRef<() => void>(() => {});
  const redoHistoryRef = useRef<() => void>(() => {});
  const [, setAlphaMaskTick] = useState(0);

  // Leave reach-edit focus mode whenever the selection changes.
  useEffect(() => {
    setRangeEdit(null);
    setReachDraft(null);
    setRotDraft(null);
  }, [selectedPartId, selectedSlotId]);

  useEffect(() => {
    (async () => {
      let row = await db.characters.get(characterId);
      if (!row) {
        row = createBlankCharacter();
        row.id = characterId;
        await db.characters.put(row);
        useStudio.getState().registerCharacterPreset(row);
      }
      const normalized = withInferredHumanParentIds(normalizeCharacterSlots(row));
      setDoc({ ...normalized, rig: normalizeCharacterRig(normalized) });
      setHistoryPast([]);
      setHistoryFuture([]);
    })();
  }, [characterId]);

  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  useEffect(() => {
    historyPastRef.current = historyPast;
  }, [historyPast]);

  useEffect(() => {
    historyFutureRef.current = historyFuture;
  }, [historyFuture]);

  useEffect(() => {
    if (!doc) return;
    const t = window.setTimeout(() => {
      void saveCharacter(doc).then((saved) => {
        useStudio.getState().registerCharacterPreset(saved);
      });
    }, 450);
    return () => window.clearTimeout(t);
  }, [doc]);

  useEffect(() => {
    if (!doc || !wrapRef.current) return;
    const ro = new ResizeObserver(() => {
      const el = wrapRef.current;
      if (!el) return;
      const w = el.clientWidth - 64;
      const h = el.clientHeight - 64;
      setScale(Math.max(0.12, Math.min(w / doc.canvasWidth, h / doc.canvasHeight, 1.4)));
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [doc]);

  useEffect(() => {
    if (!doc) return;
    const missing = doc.parts.filter(
      (part) => !part.alphaBounds && !alphaBackfillRef.current.has(part.id),
    );
    if (missing.length === 0) return;
    for (const part of missing) alphaBackfillRef.current.add(part.id);
    let alive = true;
    void (async () => {
      const measured = await Promise.all(
        missing.map(async (part) => {
          const [blobRow, media] = await Promise.all([
            db.mediaBlobs.get(part.mediaId),
            db.media.get(part.mediaId),
          ]);
          if (!blobRow?.blob) return null;
          const alphaBounds = await measureAlphaBoundsFromBlob(
            blobRow.blob,
            media?.width ?? part.width,
            media?.height ?? part.height,
          );
          return { id: part.id, alphaBounds };
        }),
      );
      const patches = measured.filter(Boolean) as NonNullable<(typeof measured)[number]>[];
      if (!alive || patches.length === 0) return;
      setDoc((current) => {
        if (!current) return current;
        const patchMap = new Map(patches.map((patch) => [patch.id, patch.alphaBounds] as const));
        return {
          ...current,
          parts: current.parts.map((part) => {
            const alphaBounds = patchMap.get(part.id);
            if (!alphaBounds || part.alphaBounds) return part;
            return normalizePartPatch({ ...part, alphaBounds }, { alphaBounds });
          }),
          updatedAt: Date.now(),
        };
      });
    })();
    return () => {
      alive = false;
    };
  }, [doc]);

  useEffect(() => {
    if (!doc) return;
    const missingMasks = doc.parts.filter(
      (part) => !alphaMaskRef.current.has(part.id) && !alphaMaskLoadingRef.current.has(part.id),
    );
    if (missingMasks.length === 0) return;
    for (const part of missingMasks) alphaMaskLoadingRef.current.add(part.id);
    let alive = true;
    void (async () => {
      const masks = await Promise.all(
        missingMasks.map(async (part) => {
          const [blobRow, media] = await Promise.all([
            db.mediaBlobs.get(part.mediaId),
            db.media.get(part.mediaId),
          ]);
          if (!blobRow?.blob) return null;
          const mask = await createAlphaHitMaskFromBlob(
            blobRow.blob,
            media?.width ?? part.width,
            media?.height ?? part.height,
          );
          return mask ? { id: part.id, mask } : null;
        }),
      );
      if (!alive) return;
      for (const item of masks) {
        if (item) alphaMaskRef.current.set(item.id, item.mask);
      }
      setAlphaMaskTick((tick) => tick + 1);
    })();
    return () => {
      alive = false;
    };
  }, [doc]);

  useEffect(() => {
    if (!preview) return;
    // Audio-driven tests update the preview each frame and clear it on playback end.
    if (preview.audioDriven) return;
    const t = window.setTimeout(() => setPreview(null), preview.durationMs);
    const interval = window.setInterval(() => setPreviewTick((n) => n + 1), 50);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(interval);
    };
  }, [preview]);

  undoHistoryRef.current = undoCharacterHistory;
  redoHistoryRef.current = redoCharacterHistory;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        redoHistoryRef.current();
      } else if (key === "z") {
        event.preventDefault();
        undoHistoryRef.current();
      } else if (key === "y") {
        event.preventDefault();
        redoHistoryRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Any pointer release ends the active drag/resize/rotate — clear the focus-blur flag once,
  // centrally, so each gesture only has to switch it on.
  useEffect(() => {
    const clear = () => setInteracting(false);
    window.addEventListener("pointerup", clear);
    window.addEventListener("pointercancel", clear);
    return () => {
      window.removeEventListener("pointerup", clear);
      window.removeEventListener("pointercancel", clear);
    };
  }, []);

  function restoreCharacterSnapshot(next: CharacterPreset) {
    setDoc(next);
    setSelectedPartId((id) => (id && next.parts.some((part) => part.id === id) ? id : null));
    setSelectedSlotId((id) =>
      id && next.parts.some((part) => getPartSlotId(part) === id) ? id : null,
    );
    setSelectedBoneId((id) =>
      id && normalizeCharacterRig(next).bones.some((bone) => bone.id === id) ? id : null,
    );
  }

  function undoCharacterHistory() {
    const current = docRef.current;
    const past = historyPastRef.current;
    if (!current || past.length === 0) return;
    const previous = past[past.length - 1];
    const nextPast = past.slice(0, -1);
    const nextFuture = [current, ...historyFutureRef.current].slice(0, HISTORY_LIMIT);
    setHistoryPast(nextPast);
    setHistoryFuture(nextFuture);
    historyPastRef.current = nextPast;
    historyFutureRef.current = nextFuture;
    restoreCharacterSnapshot(previous);
    setStatus("Undone");
  }

  function redoCharacterHistory() {
    const current = docRef.current;
    const future = historyFutureRef.current;
    if (!current || future.length === 0) return;
    const next = future[0];
    const nextPast = [...historyPastRef.current, current].slice(-HISTORY_LIMIT);
    const nextFuture = future.slice(1);
    setHistoryPast(nextPast);
    setHistoryFuture(nextFuture);
    historyPastRef.current = nextPast;
    historyFutureRef.current = nextFuture;
    restoreCharacterSnapshot(next);
    setStatus("Redone");
  }

  if (!doc) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        Loading character…
      </div>
    );
  }

  const withRig = (character: CharacterPreset, preserveRig = false): CharacterPreset => ({
    ...character,
    // A structural rebuild (preserveRig = false) recomputes bones/bindings from the parts but
    // must keep authored movement/rotation reaches — otherwise setting a pivot/area or moving a
    // layer would silently wipe a slot's drag boundary and rotation clipping.
    rig: preserveRig
      ? normalizeCharacterRig(character)
      : rebuildRigPreservingConstraints(character),
  });

  const pushUndoSnapshot = () => {
    if (!docRef.current) return;
    const snapshot = docRef.current;
    const nextPast = [...historyPastRef.current, snapshot].slice(-HISTORY_LIMIT);
    setHistoryPast(nextPast);
    setHistoryFuture([]);
    historyPastRef.current = nextPast;
    historyFutureRef.current = [];
  };

  const updateDoc = (patch: Partial<CharacterPreset>, options: { history?: boolean } = {}) => {
    if (options.history !== false) pushUndoSnapshot();
    setDoc((d) => (d ? withRig({ ...d, ...patch, updatedAt: Date.now() }, "rig" in patch) : d));
  };

  const applyLiveCharacterCommand = (command: CharacterCommand) => {
    try {
      useStudio.getState().applyCharacterDocumentCommand(doc.id, command, { history: false });
    } catch (error) {
      console.warn("Character document command rejected", error);
      setStatus("Live character document rejected the edit");
    }
  };

  const applyLiveSlotBinding = (rig: CharacterRig, slotId: ID) => {
    const binding = resolveSlotBinding(rig, slotId);
    if (!binding) return;
    applyLiveCharacterCommand({
      type: "setSlotBinding",
      slotId,
      boneId: binding.effectiveBoneId,
      x: binding.x,
      y: binding.y,
      rotation: binding.rotation,
      scaleX: binding.scaleX,
      scaleY: binding.scaleY,
      depth: binding.effectiveDepth,
    });
  };

  const applyLiveBoneTransform = (rig: CharacterRig, boneId: ID) => {
    const bone = rig.bones.find((candidate) => candidate.id === boneId);
    if (!bone) return;
    applyLiveCharacterCommand({
      type: "setBoneTransform",
      boneId,
      x: bone.x,
      y: bone.y,
      rotation: bone.rotation,
      depth: bone.depth ?? 0,
    });
  };

  const updatePart = (
    id: ID,
    patch: Partial<CharacterPart>,
    options: { history?: boolean } = {},
  ) => {
    if (options.history !== false) pushUndoSnapshot();
    setDoc((d) => {
      if (!d) return d;
      const original = d.parts.find((part) => part.id === id);
      const rotationDelta =
        original && patch.rotation !== undefined && Number.isFinite(patch.rotation)
          ? patch.rotation - original.rotation
          : 0;
      const parentPivot = original ? pivotForPart(original) : null;
      const descendantIds =
        original && rotationDelta !== 0 ? descendantPartIds(d.parts, new Set([id])) : new Set<ID>();
      return withRig({
        ...d,
        parts: d.parts.map((part) => {
          if (part.id === id) return normalizePartPatch({ ...part, ...patch }, patch);
          if (!parentPivot || rotationDelta === 0 || !descendantIds.has(part.id)) return part;
          const pivot = pivotForPart(part);
          const rotatedPivot = rotateCanvasPointAroundPivot(pivot, parentPivot, rotationDelta);
          const dx = rotatedPivot.x - pivot.x;
          const dy = rotatedPivot.y - pivot.y;
          return normalizePartPatch(
            {
              ...part,
              x: Math.round(part.x + dx),
              y: Math.round(part.y + dy),
              pivot: { x: Math.round(rotatedPivot.x), y: Math.round(rotatedPivot.y) },
              rotation: Math.round(part.rotation + rotationDelta),
            },
            {
              x: part.x + dx,
              y: part.y + dy,
              pivot: rotatedPivot,
              rotation: part.rotation + rotationDelta,
            },
          );
        }),
        updatedAt: Date.now(),
      });
    });
  };

  const addPart = (part: CharacterPart) => {
    pushUndoSnapshot();
    setDoc((d) =>
      d
        ? withRig(
            withInferredHumanParentIds({ ...d, parts: [...d.parts, part], updatedAt: Date.now() }),
          )
        : d,
    );
    setSelectedPartId(part.id);
  };

  const removePart = (id: ID) => {
    pushUndoSnapshot();
    setDoc((d) =>
      d
        ? withRig({
            ...d,
            parts: d.parts
              .filter((p) => p.id !== id)
              .map((p) => (p.parentId === id ? { ...p, parentId: undefined } : p)),
            updatedAt: Date.now(),
          })
        : d,
    );
    if (selectedPartId === id) setSelectedPartId(null);
  };

  const duplicatePart = (part: CharacterPart) => {
    const nextId = uid();
    addPart({
      ...part,
      id: nextId,
      slotId: part.role === "custom" ? `custom:${nextId}` : `${part.slotId}:copy:${nextId}`,
      name: `${part.name} copy`,
      x: part.x + 24,
      y: part.y + 24,
      zIndex: maxZ(doc.parts) + 1,
      parentId: undefined,
    });
  };

  const importSvg = async (file: File, options: ImportOptions = {}) => {
    try {
      const asset = await importMediaFile(file, { scope: "character-part" });
      useStudio.getState().registerMediaAsset(asset);
      const role = options.role ?? detectRole(file.name);
      const side = options.side ?? detectSide(file.name);
      const viseme = options.viseme ?? (role === "mouth" ? detectViseme(file.name) : undefined);
      const eyeState = options.eyeState ?? (role === "eye" ? detectEyeState(file.name) : undefined);
      const fitted = fitAsset(asset.width, asset.height, doc.canvasWidth, doc.canvasHeight);
      const alphaBounds = await measureAlphaBoundsFromBlob(file, asset.width, asset.height);
      const id = uid();
      const label = options.label ?? asset.name;
      const variantKey =
        options.variantKey?.trim() ||
        viseme ||
        eyeState ||
        detectVariantKey(file.name, role, side);
      const variant = variantKey
        ? {
            key: variantKey,
            ...(options.variantLabel?.trim() ? { name: options.variantLabel.trim() } : {}),
            kind: options.variantKind ?? defaultVariantKindForRole(role, viseme, eyeState),
          }
        : undefined;
      const part = makePart(role, asset.id, {
        id,
        name: label,
        slotId: options.slotId ?? slotIdForImport(role, label, viseme, id, side),
        slotName: label,
        side,
        variant,
        viseme,
        eyeState,
        alphaBounds,
        ...fitted,
        ...options.placement,
        zIndex: options.zIndex ?? maxZ(doc.parts) + 1,
        motionBehavior: defaultMotionBehaviorForRole(role, viseme),
      });
      addPart(part);
      setStatus(`${file.name} added`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not import SVG.");
    }
  };

  const selectedPart = doc.parts.find((p) => p.id === selectedPartId) ?? null;
  const orderedParts = doc.parts.slice().sort((a, b) => a.zIndex - b.zIndex);

  const selectPart = (id: ID) => {
    setSelectedPartId(id);
    setSelectedSlotId(null);
    setSelectedBoneId(null);
  };
  const selectSlot = (slotId: ID) => {
    setSelectedSlotId(slotId);
    setSelectedPartId(null);
    setSelectedBoneId(null);
  };
  const selectBone = (boneId: ID) => {
    setSelectedBoneId(boneId);
    setSelectedPartId(null);
    setSelectedSlotId(null);
  };

  const partsInSlot = (slotId: ID) => doc.parts.filter((p) => getPartSlotId(p) === slotId);

  const toggleSlotVisible = (slotId: ID) => {
    const anyVisible = partsInSlot(slotId).some((p) => p.visible);
    pushUndoSnapshot();
    setDoc((d) =>
      d
        ? withRig({
            ...d,
            parts: d.parts.map((p) =>
              getPartSlotId(p) === slotId ? { ...p, visible: !anyVisible } : p,
            ),
            updatedAt: Date.now(),
          })
        : d,
    );
  };

  // Lock cascades across a slot's variants — a locked slot ignores canvas clicks/drags
  // (still selectable from the Layers list so it can be unlocked).
  const toggleSlotLocked = (slotId: ID) => {
    const anyLocked = partsInSlot(slotId).some((p) => p.locked);
    pushUndoSnapshot();
    setDoc((d) =>
      d
        ? withRig({
            ...d,
            parts: d.parts.map((p) =>
              getPartSlotId(p) === slotId ? { ...p, locked: !anyLocked } : p,
            ),
            updatedAt: Date.now(),
          })
        : d,
    );
  };

  const nudgeSlotZ = (slotId: ID, delta: number) => {
    pushUndoSnapshot();
    setDoc((d) =>
      d
        ? withRig({
            ...d,
            parts: d.parts.map((p) =>
              getPartSlotId(p) === slotId ? { ...p, zIndex: p.zIndex + delta } : p,
            ),
            updatedAt: Date.now(),
          })
        : d,
    );
  };

  const removeSlot = (slotId: ID) => {
    pushUndoSnapshot();
    setDoc((d) =>
      d
        ? withRig({
            ...d,
            parts: d.parts.filter((p) => getPartSlotId(p) !== slotId),
            updatedAt: Date.now(),
          })
        : d,
    );
    if (selectedSlotId === slotId) setSelectedSlotId(null);
  };

  // Commit a one-shot group move (used by the Inspector numeric fields).
  const applyGroupMove = (slotId: ID, dx: number, dy: number) => {
    pushUndoSnapshot();
    setDoc((d) => {
      if (!d) return d;
      const rig = normalizeCharacterRig(d);
      const limited = clampSlotDeltaToHost(d, rig, slotId, dx, dy);
      return withRig(
        {
          ...d,
          parts: moveSlotParts(d, slotId, limited.dx, limited.dy),
          rig: moveSlotBinding(rig, slotId, limited.dx, limited.dy),
          updatedAt: Date.now(),
        },
        true,
      );
    });
  };

  // Commit a one-shot group scale around a fixed anchor corner.
  const applyGroupScale = (
    slotId: ID,
    anchor: { x: number; y: number },
    scaleX: number,
    scaleY: number,
  ) => {
    pushUndoSnapshot();
    setDoc((d) =>
      d
        ? withRig({
            ...d,
            parts: d.parts.map((p) => {
              if (getPartSlotId(p) !== slotId) return p;
              const pivot = pivotForPart(p);
              return {
                ...p,
                x: Math.round(anchor.x + (p.x - anchor.x) * scaleX),
                y: Math.round(anchor.y + (p.y - anchor.y) * scaleY),
                width: Math.max(4, Math.round(p.width * scaleX)),
                height: Math.max(4, Math.round(p.height * scaleY)),
                pivot: {
                  x: Math.round(anchor.x + (pivot.x - anchor.x) * scaleX),
                  y: Math.round(anchor.y + (pivot.y - anchor.y) * scaleY),
                },
              };
            }),
            updatedAt: Date.now(),
          })
        : d,
    );
  };

  const applyGroupRotate = (slotId: ID, anchor: { x: number; y: number }, degrees: number) => {
    if (!Number.isFinite(degrees) || degrees === 0) return;
    pushUndoSnapshot();
    setDoc((d) => {
      if (!d) return d;
      const targetIds = partAndDescendantIdsForSlot(d.parts, slotId);
      return withRig({
        ...d,
        parts: d.parts.map((part) => {
          if (!targetIds.has(part.id)) return part;
          const pivot = pivotForPart(part);
          const rotatedPivot = rotateCanvasPointAroundPivot(pivot, anchor, degrees);
          const dx = rotatedPivot.x - pivot.x;
          const dy = rotatedPivot.y - pivot.y;
          return {
            ...part,
            x: Math.round(part.x + dx),
            y: Math.round(part.y + dy),
            pivot: { x: Math.round(rotatedPivot.x), y: Math.round(rotatedPivot.y) },
            rotation: Math.round(part.rotation + degrees),
          };
        }),
        updatedAt: Date.now(),
      });
    });
  };

  // Representative (rest) part of a mouth slot — used as the talk preview target.
  const mouthSlotRepId = (slotId: ID) => {
    const ps = partsInSlot(slotId);
    return (ps.find((p) => p.viseme === "rest") ?? ps[0])?.id ?? "";
  };

  // Find an audio clip attached to a sample word (file named after the word).
  const sampleForWord = (word: string) =>
    LIPSYNC_SAMPLES.find((s) => s.name.toLowerCase() === word.toLowerCase());

  // Word lip-sync test: play the attached clip (if any) with the word's scripted
  // visemes timed to it; otherwise fall back to a silent shape preview.
  const testMouthWord = (slotId: ID, word: string) => {
    const sample = sampleForWord(word);
    if (sample) {
      void playMouthClip(slotId, sample.url, wordToVisemes(word));
      return;
    }
    setPreview({
      kind: "talk",
      targetPartId: mouthSlotRepId(slotId),
      targetSlotId: slotId,
      targetRole: "mouth",
      startedAt: Date.now(),
      durationMs: 1300,
      visemes: wordToVisemes(word),
    });
  };

  const stopMouthTestAudio = () => {
    if (mouthAudioRafRef.current) cancelAnimationFrame(mouthAudioRafRef.current);
    mouthAudioRafRef.current = null;
    void mouthAudioCtxRef.current?.close();
    mouthAudioCtxRef.current = null;
    setMouthTestPlaying(false);
    setPreview(null);
  };

  // Play a clip and drive the mouth slot's visemes. With `scriptedVisemes` the
  // sequence is timed to the clip's duration (correct shapes synced to audio);
  // without it, the mouth is driven by live amplitude (rough, for arbitrary clips).
  const playMouthClip = async (slotId: ID, url: string, scriptedVisemes?: MouthViseme[]) => {
    stopMouthTestAudio();
    const repId = mouthSlotRepId(slotId);
    try {
      const buffer = await fetch(url).then((r) => r.arrayBuffer());
      const ctx = new AudioContext();
      mouthAudioCtxRef.current = ctx;
      const audioBuffer = await ctx.decodeAudioData(buffer);
      const durationMs = audioBuffer.duration * 1000;
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      let analyser: AnalyserNode | null = null;
      let data: Uint8Array<ArrayBuffer> | null = null;
      if (scriptedVisemes) {
        source.connect(ctx.destination);
      } else {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        data = new Uint8Array(analyser.frequencyBinCount);
        source.connect(analyser);
        analyser.connect(ctx.destination);
      }
      const startedAt = Date.now();
      source.start();
      setMouthTestPlaying(true);
      setPreview({
        kind: "talk",
        targetPartId: repId,
        targetSlotId: slotId,
        targetRole: "mouth",
        startedAt,
        durationMs,
        audioDriven: true,
        forcedViseme: "rest",
      });
      const tick = () => {
        let v: MouthViseme = "rest";
        if (scriptedVisemes) {
          const t = Math.min(1, (Date.now() - startedAt) / Math.max(1, durationMs));
          const idx = Math.min(scriptedVisemes.length - 1, Math.floor(t * scriptedVisemes.length));
          v = scriptedVisemes[idx] ?? "rest";
        } else if (analyser && data) {
          analyser.getByteFrequencyData(data);
          const mean = data.reduce((s, x) => s + x, 0) / data.length;
          if (mean > 55) v = "A";
          else if (mean > 38) v = "E";
          else if (mean > 22) v = "O";
          else if (mean > 10) v = "MBP";
        }
        setPreview((p) => (p && p.audioDriven ? { ...p, forcedViseme: v } : p));
        mouthAudioRafRef.current = requestAnimationFrame(tick);
      };
      mouthAudioRafRef.current = requestAnimationFrame(tick);
      source.onended = stopMouthTestAudio;
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not play test audio.");
      stopMouthTestAudio();
    }
  };

  const exportData = JSON.stringify(normalizeCharacterSlots(doc), null, 2);
  const manifest = normalizePartManifest(doc.manifest);
  const previewParentPart =
    preview?.targetRole === "head"
      ? orderedParts.find((part) => part.id === preview.targetPartId)
      : undefined;
  const visibleEditorParts = orderedParts.filter((part) =>
    roleEnabledByManifest(part.role, manifest),
  );
  const selectedEditorPart = selectedPart
    ? visibleEditorParts.find((part) => part.id === selectedPart.id)
    : null;
  const selectedSlotParts = selectedSlotId
    ? doc.parts.filter((part) => getPartSlotId(part) === selectedSlotId)
    : [];
  const selectedSlotBounds =
    selectedSlotParts.length > 0 ? unionFrameBounds(selectedSlotParts) : null;
  // The layer that movement-range controls act on: a selected slot, or the slot of the
  // selected part.
  const restrictSlotId = selectedSlotId ?? (selectedPart ? getPartSlotId(selectedPart) : null);
  // While the active layer is being edited — a pivot/area tool is armed, or a drag/resize/
  // rotate is underway — slightly blur every other layer so the focus is unmistakable.
  const editingActive = !!restrictSlotId && (mode !== "select" || interacting);
  const focusEditing = !!rangeEdit;

  const canvasPointFromEvent = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    };
  };

  const localPointForPart = (part: CharacterPart, point: { x: number; y: number }) =>
    canvasPointToPartLocal(part, point, previewDelta(part, preview, previewParentPart, doc.parts));

  // Ordered stack of parts under a point, topmost first (alpha-exact before padded
  // hits), with locked parts excluded — the candidate list the select/drag model
  // drills through. `pickPartAt` keeps returning just the topmost for other callers.
  const hitPartsAt = (point: { x: number; y: number }) => {
    const exact: CharacterPart[] = [];
    const padded: CharacterPart[] = [];
    const candidates = visibleEditorParts
      .filter((part) => (part.visible || part.id === selectedPartId) && !part.locked)
      .slice()
      .sort((a, b) => b.zIndex - a.zIndex);

    for (const part of candidates) {
      const transform = previewDelta(part, preview, previewParentPart, doc.parts);
      if (transform.opacity <= 0.05 && part.id !== selectedPartId) continue;
      const local = canvasPointToPartLocal(part, point, transform);
      if (boundsMode === "frame") {
        if (pointInEditorHitBounds(part, local, scale, boundsMode)) exact.push(part);
      } else if (alphaMaskContains(alphaMaskRef.current.get(part.id), part, local)) {
        exact.push(part);
      } else if (pointInEditorHitBounds(part, local, scale, boundsMode)) {
        padded.push(part);
      }
    }
    return [...exact, ...padded];
  };

  const pickPartAt = (point: { x: number; y: number }) => hitPartsAt(point)[0] ?? null;

  // The parts the pivot / area tools act on. These tools are launched from the selected
  // layer's inspector, so they target the active selection — the selected part, or every
  // variant of the selected slot — never whatever happens to be topmost under the click.
  // (Placing an arm's pivot over the shoulder must not grab the body underneath.) Empty
  // when nothing is selected.
  const activeToolPartIds = (): ID[] => {
    if (selectedPartId) return [selectedPartId];
    if (selectedSlotId) return partsInSlot(selectedSlotId).map((part) => part.id);
    return [];
  };

  // Place the pivot at a canvas point on each given part (one undo step, selection left
  // untouched). Every part maps the shared canvas point through its own transform, matching
  // the single-part path so rotation stays consistent.
  const setPivotForParts = (ids: ID[], point: { x: number; y: number }) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    pushUndoSnapshot();
    setDoc((d) => {
      if (!d) return d;
      return withRig({
        ...d,
        parts: d.parts.map((part) => {
          if (!idSet.has(part.id)) return part;
          const local = localPointForPart(part, point);
          const pivot = {
            x: Math.round(local.x + part.x),
            y: Math.round(local.y + part.y),
          };
          return normalizePartPatch({ ...part, pivot }, { pivot });
        }),
        updatedAt: Date.now(),
      });
    });
  };

  // Set each given part's allowed-area to a padded box/ellipse of its own art (one undo
  // step, selection left untouched).
  const setBoundsForParts = (ids: ID[], shape: "rect" | "ellipse") => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    pushUndoSnapshot();
    setDoc((d) => {
      if (!d) return d;
      return withRig({
        ...d,
        parts: d.parts.map((part) => {
          if (!idSet.has(part.id)) return part;
          const box = editorSelectionBounds(part, boundsMode);
          const bounds = {
            type: shape,
            x: Math.round(part.x + box.x - box.width * 0.08),
            y: Math.round(part.y + box.y - box.height * 0.08),
            width: Math.round(box.width * 1.16),
            height: Math.round(box.height * 1.16),
          };
          return normalizePartPatch({ ...part, bounds }, { bounds });
        }),
        updatedAt: Date.now(),
      });
    });
  };

  const startCanvasPartDrag = (
    e: React.PointerEvent,
    part: CharacterPart,
    point: { x: number; y: number },
  ) => {
    if (e.button !== 0) return;
    // Reached only in select mode now — the pivot / area tools act on the active selection
    // through handleCanvasPointerDown, not on the dragged subject.
    selectPart(part.id);
    setInteracting(true);

    pushUndoSnapshot();
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = part.x;
    const oy = part.y;
    const slotId = getPartSlotId(part);
    const rigSnapshot = normalizeCharacterRig(doc);
    let latestRig = rigSnapshot;
    const partSnapshot = new Map(
      doc.parts.map((snapshotPart) => {
        const pivot = pivotForPart(snapshotPart);
        return [snapshotPart.id, { x: snapshotPart.x, y: snapshotPart.y, pivot }] as const;
      }),
    );
    const movesBone = doc.parts.some((candidate) => candidate.parentId === part.id);
    const move = (ev: PointerEvent) => {
      const dx = Math.round((ev.clientX - sx) / scale);
      const dy = Math.round((ev.clientY - sy) / scale);
      setDoc((d) => {
        if (!d) return d;
        const snapshotParts = d.parts.map((currentPart) => {
          const snapshotPart = partSnapshot.get(currentPart.id);
          if (!snapshotPart) return currentPart;
          return {
            ...currentPart,
            x: snapshotPart.x,
            y: snapshotPart.y,
            pivot: snapshotPart.pivot,
          };
        });
        const limited = movesBone
          ? { dx, dy }
          : clampSlotDeltaToHost({ ...d, parts: snapshotParts }, rigSnapshot, slotId, dx, dy);
        const appliedDx = limited.dx;
        const appliedDy = limited.dy;
        const parts = movesBone
          ? movePartAndDescendants(snapshotParts, part.id, appliedDx, appliedDy)
          : moveSlotParts({ ...d, parts: snapshotParts }, slotId, appliedDx, appliedDy);
        const rig = movesBone
          ? moveBoneForSlot(rigSnapshot, slotId, appliedDx, appliedDy)
          : moveSlotBinding(rigSnapshot, slotId, appliedDx, appliedDy);
        latestRig = rig;
        return withRig({ ...d, parts, rig, updatedAt: Date.now() }, true);
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const binding = resolveSlotBinding(rigSnapshot, slotId);
      if (movesBone && binding) applyLiveBoneTransform(latestRig, binding.effectiveBoneId);
      else applyLiveSlotBinding(latestRig, slotId);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Drag every variant in a slot together by the same canvas delta.
  const startGroupDrag = (e: React.PointerEvent, slotId: ID) => {
    if (e.button !== 0) return;
    setInteracting(true);
    pushUndoSnapshot();
    const snapshot = new Map(
      partsInSlot(slotId).map((p) => {
        const pivot = pivotForPart(p);
        return [p.id, { x: p.x, y: p.y, pivot }] as const;
      }),
    );
    const sx = e.clientX;
    const sy = e.clientY;
    const rigSnapshot = normalizeCharacterRig(doc);
    let latestRig = rigSnapshot;
    const move = (ev: PointerEvent) => {
      const dx = Math.round((ev.clientX - sx) / scale);
      const dy = Math.round((ev.clientY - sy) / scale);
      setDoc((d) => {
        if (!d) return d;
        const snapshotParts = d.parts.map((p) => {
          const s = snapshot.get(p.id);
          if (!s) return p;
          return { ...p, x: s.x, y: s.y, pivot: s.pivot };
        });
        const limited = clampSlotDeltaToHost(
          { ...d, parts: snapshotParts },
          rigSnapshot,
          slotId,
          dx,
          dy,
        );
        const rig = moveSlotBinding(rigSnapshot, slotId, limited.dx, limited.dy);
        latestRig = rig;
        return withRig(
          {
            ...d,
            parts: moveSlotParts(
              {
                ...d,
                parts: snapshotParts,
              },
              slotId,
              limited.dx,
              limited.dy,
            ),
            rig,
            updatedAt: Date.now(),
          },
          true,
        );
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      applyLiveSlotBinding(latestRig, slotId);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startBoneDrag = (e: React.PointerEvent, boneId: ID) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    pushUndoSnapshot();
    selectBone(boneId);
    const sx = e.clientX;
    const sy = e.clientY;
    // Bones drive the skeleton only; artwork stays put (drag layers with bones hidden instead).
    const shouldMoveArt = false;
    const rigSnapshot = normalizeCharacterRig(doc);
    let latestRig = rigSnapshot;
    const startBoneWorld = computeBoneWorldTransforms(rigSnapshot).get(boneId);
    const slotIds = slotIdsForBoneSubtree(rigSnapshot, boneId);
    const snapshot = doc.parts.map((part) => ({
      id: part.id,
      x: part.x,
      y: part.y,
      pivot: pivotForPart(part),
    }));
    const move = (ev: PointerEvent) => {
      const dx = Math.round((ev.clientX - sx) / scale);
      const dy = Math.round((ev.clientY - sy) / scale);
      const rig = moveBone(rigSnapshot, boneId, dx, dy);
      latestRig = rig;
      const movedBoneWorld = computeBoneWorldTransforms(rig).get(boneId);
      const appliedDx =
        startBoneWorld && movedBoneWorld ? Math.round(movedBoneWorld.x - startBoneWorld.x) : dx;
      const appliedDy =
        startBoneWorld && movedBoneWorld ? Math.round(movedBoneWorld.y - startBoneWorld.y) : dy;
      setDoc((d) =>
        d
          ? withRig(
              {
                ...d,
                parts: shouldMoveArt
                  ? moveSlotSetFromSnapshot(d.parts, snapshot, slotIds, appliedDx, appliedDy)
                  : d.parts,
                rig,
                updatedAt: Date.now(),
              },
              true,
            )
          : d,
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      applyLiveBoneTransform(latestRig, boneId);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const toggleBones = () => {
    setShowBones((visible) => {
      const next = !visible;
      if (!next) setSelectedBoneId(null);
      return next;
    });
  };

  // Resize a whole slot from a corner, scaling every variant around the
  // opposite (fixed) corner of the group's union bounds.
  const startGroupResize = (e: React.PointerEvent, slotId: ID, corner: ResizeCorner) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setInteracting(true);
    pushUndoSnapshot();
    const parts = partsInSlot(slotId);
    const box = unionFrameBounds(parts);
    const anchor = {
      x: corner.includes("w") ? box.x + box.width : box.x,
      y: corner.includes("n") ? box.y + box.height : box.y,
    };
    const snapshot = parts.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
      pivot: pivotForPart(p),
    }));
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / scale;
      const dy = (ev.clientY - sy) / scale;
      const movingX = corner.includes("w") ? box.x + dx : box.x + box.width + dx;
      const movingY = corner.includes("n") ? box.y + dy : box.y + box.height + dy;
      const scaleX = Math.max(8, Math.abs(anchor.x - movingX)) / Math.max(1, box.width);
      const scaleY = Math.max(8, Math.abs(anchor.y - movingY)) / Math.max(1, box.height);
      setDoc((d) =>
        d
          ? withRig({
              ...d,
              parts: d.parts.map((p) => {
                const s = snapshot.find((q) => q.id === p.id);
                if (!s) return p;
                return {
                  ...p,
                  x: Math.round(anchor.x + (s.x - anchor.x) * scaleX),
                  y: Math.round(anchor.y + (s.y - anchor.y) * scaleY),
                  width: Math.max(4, Math.round(s.width * scaleX)),
                  height: Math.max(4, Math.round(s.height * scaleY)),
                  pivot: {
                    x: Math.round(anchor.x + (s.pivot.x - anchor.x) * scaleX),
                    y: Math.round(anchor.y + (s.pivot.y - anchor.y) * scaleY),
                  },
                };
              }),
              updatedAt: Date.now(),
            })
          : d,
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startGroupRotate = (e: React.PointerEvent, slotId: ID) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setInteracting(true);
    pushUndoSnapshot();
    const canvas = e.currentTarget.closest("[data-editor-canvas]") as HTMLDivElement | null;
    const rect = canvas?.getBoundingClientRect();
    const parts = partsInSlot(slotId);
    const box = unionFrameBounds(parts);
    const anchor = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    if (!rect) return;
    const anchorScreen = {
      x: rect.left + anchor.x * scale,
      y: rect.top + anchor.y * scale,
    };
    const startAngle = Math.atan2(e.clientY - anchorScreen.y, e.clientX - anchorScreen.x);
    const targetIds = partAndDescendantIdsForSlot(doc.parts, slotId);
    const snapshot = doc.parts
      .filter((part) => targetIds.has(part.id))
      .map((part) => ({
        id: part.id,
        x: part.x,
        y: part.y,
        pivot: pivotForPart(part),
        rotation: part.rotation,
      }));
    const move = (ev: PointerEvent) => {
      const nextAngle = Math.atan2(ev.clientY - anchorScreen.y, ev.clientX - anchorScreen.x);
      const degrees = ((nextAngle - startAngle) * 180) / Math.PI;
      setDoc((d) =>
        d
          ? withRig({
              ...d,
              parts: d.parts.map((part) => {
                const base = snapshot.find((item) => item.id === part.id);
                if (!base) return part;
                const rotatedPivot = rotateCanvasPointAroundPivot(base.pivot, anchor, degrees);
                const dx = rotatedPivot.x - base.pivot.x;
                const dy = rotatedPivot.y - base.pivot.y;
                return {
                  ...part,
                  x: Math.round(base.x + dx),
                  y: Math.round(base.y + dy),
                  pivot: { x: Math.round(rotatedPivot.x), y: Math.round(rotatedPivot.y) },
                  rotation: Math.round(base.rotation + degrees),
                };
              }),
              updatedAt: Date.now(),
            })
          : d,
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Once a select-mode drag actually begins, dispatch to a slot-group drag (multi-variant
  // slots) or a single-part drag. Both select the subject and install their own listeners.
  const startCanvasDragForSubject = (
    e: React.PointerEvent,
    part: CharacterPart,
    point: { x: number; y: number },
  ) => {
    const slotId = getPartSlotId(part);
    const editingVariant =
      selectedPart && !selectedSlotId && getPartSlotId(selectedPart) === slotId;
    if (!editingVariant && partsInSlot(slotId).length > 1) {
      selectSlot(slotId);
      startGroupDrag(e, slotId);
      return;
    }
    startCanvasPartDrag(e, part, point);
  };

  // Rest reference (alpha center of the slot) that reach offsets are measured from.
  const slotRestCenter = (parts: CharacterPart[]) => {
    const b = parts.length > 0 ? unionAlphaBounds(parts) : { x: 0, y: 0, width: 0, height: 0 };
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };

  // Stored reach (parent-frame deltas) → absolute canvas polygon for display / continued editing.
  const reachToCanvas = (slotId: ID): { x: number; y: number }[] | null => {
    const constraint = normalizeCharacterRig(doc).reaches.find((c) => c.slotId === slotId);
    if (!constraint?.reach || constraint.reach.length < 3) return null;
    const center = slotRestCenter(doc.parts.filter((p) => getPartSlotId(p) === slotId));
    return constraint.reach.map((pt) => ({ x: center.x + pt.x, y: center.y + pt.y }));
  };

  const enterReachEdit = () => {
    if (!restrictSlotId) return;
    setReachDraft(reachToCanvas(restrictSlotId));
    setRotDraft(null);
    setRangeEdit({ slotId: restrictSlotId });
  };

  const exitReachEdit = () => {
    setRangeEdit(null);
    setReachDraft(null);
    setRotDraft(null);
  };

  const clearReach = (slotId: ID) => {
    let rig = normalizeCharacterRig(doc);
    rig = setSlotReach(rig, slotId, undefined);
    rig = setSlotRotReach(rig, slotId, undefined);
    updateDoc({ rig });
    setReachDraft(null);
    setRotDraft(null);
    setStatus("Reach cleared");
  };

  const setSlotHost = (slotId: ID, hostSlotId: ID | "") => {
    updateDoc({
      rig: setSlotHostConstraint(normalizeCharacterRig(doc), slotId, hostSlotId || undefined),
    });
  };

  const setSlotHostMode = (slotId: ID, mode: "insideHostMask" | "insideHostBounds") => {
    const rig = normalizeCharacterRig(doc);
    const current = rig.hostConstraints.find((constraint) => constraint.slotId === slotId);
    updateDoc({
      rig: setSlotHostConstraint(
        rig,
        slotId,
        current?.hostSlotId,
        mode,
        current?.reachPolicy ?? "scaleToFit",
      ),
    });
  };

  // Twist the layer around its pivot to its extremes; the swept angle range becomes the rotation
  // reach. Snaps back on release. Distinct from the position sweep — driven by the blue knob.
  const startRotationTrace = (e: React.PointerEvent) => {
    if (e.button !== 0 || !rangeEdit) return;
    e.stopPropagation();
    const slotId = rangeEdit.slotId;
    const parts = doc.parts.filter((p) => getPartSlotId(p) === slotId);
    const rep = parts.find((p) => p.visible) ?? parts[0];
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rep || !rect) return;
    const anchor = pivotForPart(rep);
    const anchorScreen = { x: rect.left + anchor.x * scale, y: rect.top + anchor.y * scale };
    const startAngle = Math.atan2(e.clientY - anchorScreen.y, e.clientX - anchorScreen.x);
    const snapshot = parts.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      pivot: pivotForPart(p),
      rotation: p.rotation,
    }));
    let minD = 0;
    let maxD = 0;
    pushUndoSnapshot();
    setRotDraft({ min: 0, max: 0 });
    const move = (ev: PointerEvent) => {
      let degrees =
        ((Math.atan2(ev.clientY - anchorScreen.y, ev.clientX - anchorScreen.x) - startAngle) *
          180) /
        Math.PI;
      while (degrees > 180) degrees -= 360;
      while (degrees < -180) degrees += 360;
      minD = Math.min(minD, degrees);
      maxD = Math.max(maxD, degrees);
      setRotDraft({ min: Math.round(minD), max: Math.round(maxD) });
      setDoc((d) => {
        if (!d) return d;
        const byId = new Map(snapshot.map((s) => [s.id, s]));
        return {
          ...d,
          parts: d.parts.map((part) => {
            const base = byId.get(part.id);
            if (!base) return part;
            const rp = rotateCanvasPointAroundPivot(base.pivot, anchor, degrees);
            return {
              ...part,
              x: Math.round(base.x + (rp.x - base.pivot.x)),
              y: Math.round(base.y + (rp.y - base.pivot.y)),
              pivot: { x: Math.round(rp.x), y: Math.round(rp.y) },
              rotation: Math.round(base.rotation + degrees),
            };
          }),
        };
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const rotReach = { min: Math.round(minD), max: Math.round(maxD) };
      setRotDraft(rotReach);
      setDoc((d) => {
        if (!d) return d;
        const byId = new Map(snapshot.map((s) => [s.id, s]));
        const restored = d.parts.map((p) => {
          const base = byId.get(p.id);
          return base
            ? { ...p, x: base.x, y: base.y, pivot: base.pivot, rotation: base.rotation }
            : p;
        });
        return withRig(
          {
            ...d,
            parts: restored,
            rig: setSlotRotReach(
              normalizeCharacterRig({ ...d, parts: restored }),
              slotId,
              rotReach,
            ),
            updatedAt: Date.now(),
          },
          true,
        );
      });
      setStatus(`Twist set — ${rotReach.min}° to ${rotReach.max}°`);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Set which layer a slot is attached to (the parent carries it). Stored on part.parentId.
  const setSlotAttachTo = (slotId: ID, parentSlotId: ID | "") => {
    const parentRep = parentSlotId
      ? (doc.parts.find((p) => getPartSlotId(p) === parentSlotId && p.visible) ??
        doc.parts.find((p) => getPartSlotId(p) === parentSlotId))
      : undefined;
    updateDoc({
      parts: doc.parts.map((p) =>
        getPartSlotId(p) === slotId ? { ...p, parentId: parentRep?.id } : p,
      ),
    });
  };

  // Sweep the layer around its extremes; the traced outline (convex hull of its swept footprint)
  // becomes the reach. The layer snaps back on release — sweeping sets the limit, it doesn't pose.
  const startReachSweep = (e: React.PointerEvent) => {
    if (e.button !== 0 || !rangeEdit) return;
    const slotId = rangeEdit.slotId;
    const parts = doc.parts.filter((p) => getPartSlotId(p) === slotId);
    if (parts.length === 0) return;
    const rep = parts.find((p) => p.visible) ?? parts[0];
    const alpha = localAlphaBounds(rep);
    const footprint = (dx: number, dy: number) =>
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ].map(([cx, cy]) => ({
        x: rep.x + alpha.x + cx * alpha.width + dx,
        y: rep.y + alpha.y + cy * alpha.height + dy,
      }));
    const sx = e.clientX;
    const sy = e.clientY;
    const restSnapshot = new Map(
      doc.parts.map((p) => [p.id, { x: p.x, y: p.y, pivot: pivotForPart(p) }] as const),
    );
    // Seed with the part's own footprint plus any existing reach, so sweeping only ever grows it.
    const samples: { x: number; y: number }[] = [...footprint(0, 0), ...(reachDraft ?? [])];
    pushUndoSnapshot();
    setReachDraft(convexHull(samples));
    const move = (ev: PointerEvent) => {
      const dx = Math.round((ev.clientX - sx) / scale);
      const dy = Math.round((ev.clientY - sy) / scale);
      samples.push(...footprint(dx, dy));
      setReachDraft(convexHull(samples));
      setDoc((d) => {
        if (!d) return d;
        const restored = d.parts.map((p) => {
          const snap = restSnapshot.get(p.id);
          if (!snap) return p;
          return { ...p, x: snap.x, y: snap.y, pivot: snap.pivot };
        });
        return { ...d, parts: moveSlotParts({ ...d, parts: restored }, slotId, dx, dy) };
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const hull = convexHull(samples);
      const center = slotRestCenter(parts);
      const deltas = hull.map((pt) => ({
        x: Math.round(pt.x - center.x),
        y: Math.round(pt.y - center.y),
      }));
      setReachDraft(hull);
      // Snap the layer back to rest — sweeping sets the limit, it does not pose.
      setDoc((d) => {
        if (!d) return d;
        const restored = d.parts.map((p) => {
          const snap = restSnapshot.get(p.id);
          if (!snap) return p;
          return { ...p, x: snap.x, y: snap.y, pivot: snap.pivot };
        });
        return withRig(
          {
            ...d,
            parts: restored,
            rig: setSlotReach(normalizeCharacterRig({ ...d, parts: restored }), slotId, deltas),
            updatedAt: Date.now(),
          },
          true,
        );
      });
      setStatus("Reach set — sweep again to extend it");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const point = canvasPointFromEvent(e);
    if (!point) return;

    // Reach-edit focus mode owns the canvas: dragging the layer sweeps out its reach. Normal
    // selection / part dragging is locked out.
    if (rangeEdit) {
      startReachSweep(e);
      return;
    }

    // Pivot / area tools are one-shot and act on the active selection (their buttons live in
    // the selected layer's inspector). The click only positions the pivot; selection is left
    // untouched. With nothing selected, fall back to the topmost part under the click.
    if (mode !== "select") {
      let ids = activeToolPartIds();
      if (ids.length === 0) {
        const picked = pickPartAt(point);
        ids = picked ? [picked.id] : [];
      }
      if (ids.length === 0) return;
      if (mode === "pivot") setPivotForParts(ids, point);
      else setBoundsForParts(ids, mode === "bounds-ellipse" ? "ellipse" : "rect");
      setMode("select");
      return;
    }

    // When the skeleton is shown the canvas manipulates bones (via their handles); layers are
    // static. A click still selects a layer (for the inspector / movement range) but never drags
    // it — to move a layer, hide the bones first.
    if (showBones) {
      const candidates = hitPartsAt(point);
      const candidateIds = candidates.map((part) => part.id);
      const { id, nextPick } = resolveDrillSelection(
        candidateIds,
        canvasLastPickRef.current,
        { x: e.clientX, y: e.clientY },
        undefined,
        e.altKey,
      );
      canvasLastPickRef.current = nextPick;
      if (!id) {
        setSelectedPartId(null);
        setSelectedSlotId(null);
        setSelectedBoneId(null);
        return;
      }
      const part = candidates.find((candidate) => candidate.id === id);
      const slotId = part ? getPartSlotId(part) : null;
      if (slotId && partsInSlot(slotId).length > 1) selectSlot(slotId);
      else selectPart(id);
      return;
    }

    // Figma-style select/drag (shared model — see select-drag.ts): a click selects the
    // top part (Alt-click drills to the part underneath); a drag moves the already-selected
    // part from anywhere even when overlapped, or selects+drags an unselected part in one
    // gesture. Selection never changes mid-drag.
    const dragPoint = point;
    const candidates = hitPartsAt(dragPoint);
    const candidateIds = candidates.map((part) => part.id);
    const subjectId = resolveDragSubject(candidateIds, selectedPartId);
    const subject = candidates.find((part) => part.id === subjectId) ?? null;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    function onMove(ev: PointerEvent) {
      if (dragging || !subject) return;
      if (!exceedsDragThreshold({ x: startX, y: startY }, { x: ev.clientX, y: ev.clientY })) return;
      dragging = true;
      cleanup();
      // Deltas are measured from the original pointerdown, so handing off here is seamless.
      startCanvasDragForSubject(e, subject, dragPoint);
    }
    function onUp() {
      cleanup();
      if (dragging) return;
      const { id, nextPick } = resolveDrillSelection(
        candidateIds,
        canvasLastPickRef.current,
        { x: startX, y: startY },
        undefined,
        e.altKey,
      );
      canvasLastPickRef.current = nextPick;
      if (!id) {
        setSelectedPartId(null);
        setSelectedSlotId(null);
        setSelectedBoneId(null);
        return;
      }
      const part = candidates.find((candidate) => candidate.id === id);
      const slotId = part ? getPartSlotId(part) : null;
      const editingVariant =
        selectedPart && !selectedSlotId && !!slotId && getPartSlotId(selectedPart) === slotId;
      if (slotId && !editingVariant && partsInSlot(slotId).length > 1) selectSlot(slotId);
      else selectPart(id);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border bg-panel px-4 py-2">
        <button
          onClick={onClose}
          className="rounded border border-border px-2 py-1 text-xs hover:bg-panel-2"
        >
          ← Studio
        </button>
        <input
          value={doc.name}
          onChange={(e) => updateDoc({ name: e.target.value })}
          className="min-w-0 rounded border border-transparent bg-transparent px-2 py-1 text-sm font-semibold hover:border-border focus:border-primary focus:outline-none"
        />
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={undoCharacterHistory}
            disabled={historyPast.length === 0}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-panel-2 disabled:opacity-40"
            title="Undo"
          >
            <Undo2 size={13} />
            Undo
          </button>
          <button
            type="button"
            onClick={redoCharacterHistory}
            disabled={historyFuture.length === 0}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-panel-2 disabled:opacity-40"
            title="Redo"
          >
            <Redo2 size={13} />
            Redo
          </button>
          {CANVAS_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => updateDoc({ canvasWidth: preset.width, canvasHeight: preset.height })}
              className="rounded border border-border px-2 py-1 text-xs hover:bg-panel-2"
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            onClick={toggleBones}
            className={`flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-panel-2 ${
              showBones ? "border-primary text-primary" : "border-border text-muted-foreground"
            }`}
            title={showBones ? "Hide bone controls" : "Show bone controls"}
          >
            {showBones ? <Eye size={13} /> : <EyeOff size={13} />}
            Bones
          </button>
          <button
            onClick={() => navigator.clipboard?.writeText(exportData)}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-panel-2"
            title="Copy structured character data"
          >
            <Download size={13} />
            Export
          </button>
          <button
            onClick={async () => {
              const saved = await saveCharacter(doc);
              useStudio.getState().registerCharacterPreset(saved);
              setDoc(saved);
              onClose();
            }}
            className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            Save & close
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 overflow-auto border-r border-border bg-panel p-3 text-xs">
          <StructureEditor
            manifest={manifest}
            onChange={(nextManifest) => updateDoc({ manifest: nextManifest })}
          />
          <UploadSlots
            onImport={importSvg}
            parts={doc.parts}
            manifest={manifest}
            canvasWidth={doc.canvasWidth}
            canvasHeight={doc.canvasHeight}
          />
          <LayerList
            parts={orderedParts}
            rig={normalizeCharacterRig(doc)}
            selectedId={selectedPartId}
            selectedSlotId={selectedSlotId}
            onSelect={selectPart}
            onSelectSlot={selectSlot}
            onChange={updatePart}
            onRemove={removePart}
            onToggleSlotVisible={toggleSlotVisible}
            onToggleSlotLocked={toggleSlotLocked}
            onNudgeSlotZ={nudgeSlotZ}
            onRemoveSlot={removeSlot}
          />
        </aside>

        <main
          ref={wrapRef}
          className="relative flex min-w-0 flex-1 items-center justify-center bg-stage-bg p-8"
          onDrop={(e) => {
            e.preventDefault();
            Array.from(e.dataTransfer.files)
              .filter((file) => file.name.toLowerCase().endsWith(".svg"))
              .forEach((file) => void importSvg(file));
          }}
          onDragOver={(e) => e.preventDefault()}
        >
          <div
            className="relative bg-white shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] outline outline-1 outline-border"
            style={{ width: doc.canvasWidth * scale, height: doc.canvasHeight * scale }}
          >
            <div
              ref={canvasRef}
              data-editor-canvas
              onPointerDown={handleCanvasPointerDown}
              className="absolute left-0 top-0 origin-top-left"
              style={{
                width: doc.canvasWidth,
                height: doc.canvasHeight,
                transform: `scale(${scale})`,
              }}
            >
              {visibleEditorParts.map((part) => (
                <PartLayer
                  key={part.id}
                  part={part}
                  selected={part.id === selectedPartId}
                  dimmed={focusEditing && getPartSlotId(part) !== rangeEdit?.slotId}
                  blurred={editingActive && getPartSlotId(part) !== restrictSlotId}
                  preview={preview}
                  previewParentPart={previewParentPart}
                  allParts={doc.parts}
                />
              ))}
              {showBones && !focusEditing && (
                <RigBonesOverlay
                  doc={doc}
                  selectedBoneId={selectedBoneId}
                  scale={scale}
                  onSelectBone={selectBone}
                  onStartBoneDrag={startBoneDrag}
                />
              )}
              {selectedEditorPart && !focusEditing && (
                <PartControlsOverlay
                  part={selectedEditorPart}
                  canvasWidth={doc.canvasWidth}
                  canvasHeight={doc.canvasHeight}
                  scale={scale}
                  boundsMode={boundsMode}
                  onBoundsModeChange={setBoundsMode}
                  preview={preview}
                  previewParentPart={previewParentPart}
                  allParts={doc.parts}
                  onBeginChange={() => {
                    setInteracting(true);
                    pushUndoSnapshot();
                  }}
                  onChange={(patch) => updatePart(selectedEditorPart.id, patch, { history: false })}
                />
              )}
              {selectedSlotId && selectedSlotBounds && !focusEditing && (
                <GroupControlsOverlay
                  bounds={selectedSlotBounds}
                  scale={scale}
                  onStartMove={(e) => startGroupDrag(e, selectedSlotId)}
                  onStartResize={(e, corner) => startGroupResize(e, selectedSlotId, corner)}
                  onStartRotate={(e) => startGroupRotate(e, selectedSlotId)}
                />
              )}
              {rangeEdit && reachDraft && reachDraft.length >= 3 && (
                <ReachOverlay
                  points={reachDraft}
                  scale={scale}
                  canvasWidth={doc.canvasWidth}
                  canvasHeight={doc.canvasHeight}
                />
              )}
              {rangeEdit &&
                (() => {
                  const parts = doc.parts.filter((p) => getPartSlotId(p) === rangeEdit.slotId);
                  const rep = parts.find((p) => p.visible) ?? parts[0];
                  if (!rep) return null;
                  const box = unionAlphaBounds(parts);
                  const stored = normalizeCharacterRig(doc).reaches.find(
                    (r) => r.slotId === rangeEdit.slotId,
                  )?.rotReach;
                  return (
                    <RotationReachOverlay
                      anchor={pivotForPart(rep)}
                      radius={Math.max(box.width, box.height) * 0.6 + 24}
                      range={rotDraft ?? stored ?? null}
                      scale={scale}
                      canvasWidth={doc.canvasWidth}
                      canvasHeight={doc.canvasHeight}
                      onStartRotate={startRotationTrace}
                    />
                  );
                })()}
            </div>
          </div>
          <div className="pointer-events-none absolute bottom-2 right-3 rounded bg-panel/80 px-2 py-1 text-[10px] text-muted-foreground">
            {doc.canvasWidth}×{doc.canvasHeight} · {Math.round(scale * 100)}%
          </div>
          {status && (
            <div className="absolute left-4 top-4 rounded border border-border bg-panel/95 px-3 py-2 text-xs shadow-[var(--shadow-panel)]">
              {status}
            </div>
          )}
        </main>

        <aside className="w-80 shrink-0 overflow-auto border-l border-border bg-panel p-3 text-xs">
          <div className="space-y-4">
            <CanvasControls doc={doc} onChange={(patch) => updateDoc(patch)} />
            <RigPanel
              doc={doc}
              selectedBoneId={selectedBoneId}
              selectedSlotId={selectedSlotId ?? (selectedPart ? getPartSlotId(selectedPart) : null)}
              selectedPart={selectedPart}
              showBones={showBones}
              onSelectBone={selectBone}
              onRigChange={(rig) => updateDoc({ rig })}
            />
            {restrictSlotId && (
              <RestrictMovementPanel
                doc={doc}
                slotId={restrictSlotId}
                editing={rangeEdit?.slotId === restrictSlotId}
                onEnterEdit={enterReachEdit}
                onExitEdit={exitReachEdit}
                onAttachTo={(parentSlotId) => setSlotAttachTo(restrictSlotId, parentSlotId)}
                onHostChange={(hostSlotId) => setSlotHost(restrictSlotId, hostSlotId)}
                onHostModeChange={(mode) => setSlotHostMode(restrictSlotId, mode)}
                onClear={() => clearReach(restrictSlotId)}
              />
            )}
            <RigAssistant doc={doc} onChange={(patch) => updateDoc(patch)} />
            {selectedSlotId && selectedSlotBounds ? (
              <GroupInspector
                doc={doc}
                slotId={selectedSlotId}
                parts={selectedSlotParts}
                bounds={selectedSlotBounds}
                onMove={(dx, dy) => applyGroupMove(selectedSlotId, dx, dy)}
                onScale={(anchor, sx, sy) => applyGroupScale(selectedSlotId, anchor, sx, sy)}
                onRotate={(anchor, degrees) => applyGroupRotate(selectedSlotId, anchor, degrees)}
                onSelectPart={selectPart}
                lipSyncSamples={LIPSYNC_SAMPLES}
                mouthTestPlaying={mouthTestPlaying}
                onTestWord={(word) => testMouthWord(selectedSlotId, word)}
                onTestAudio={(url) => void playMouthClip(selectedSlotId, url)}
                onStopTestAudio={stopMouthTestAudio}
              />
            ) : (
              <Inspector
                doc={doc}
                part={selectedPart}
                mode={mode}
                boundsMode={boundsMode}
                onModeChange={setMode}
                onBoundsModeChange={setBoundsMode}
                onChange={updatePart}
                onRemove={removePart}
                onDuplicate={duplicatePart}
                onPreview={setPreview}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

interface ImportOptions {
  role?: PartRole;
  side?: CharacterPart["side"];
  variantKey?: string;
  variantLabel?: string;
  variantKind?: CharacterVariantKind;
  viseme?: MouthViseme;
  eyeState?: EyeState;
  label?: string;
  slotId?: string;
  placement?: Partial<Pick<CharacterPart, "x" | "y" | "width" | "height" | "rotation" | "pivot">>;
  zIndex?: number;
}

const STRUCTURE_OPTIONS: Array<{ key: keyof PartManifest; label: string }> = [
  { key: "hasHead", label: "Head" },
  { key: "hasBody", label: "Body" },
  { key: "hasArms", label: "Arms" },
  { key: "hasHands", label: "Hands" },
  { key: "hasLegs", label: "Legs" },
  { key: "hasFeet", label: "Feet" },
  { key: "hasEyes", label: "Eyes" },
  { key: "hasIrises", label: "Irises" },
  { key: "hasBrows", label: "Eyebrows" },
  { key: "hasNose", label: "Nose" },
  { key: "hasMouth", label: "Mouth" },
  { key: "hasHair", label: "Hair" },
  { key: "hasAccessories", label: "Accessories" },
];

function StructureEditor({
  manifest,
  onChange,
}: {
  manifest: PartManifest;
  onChange: (manifest: PartManifest) => void;
}) {
  return (
    <div className="mb-3 rounded border border-border bg-panel-2 p-2">
      <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
        Character Structure
      </div>
      <div className="grid grid-cols-2 gap-1">
        {STRUCTURE_OPTIONS.map((item) => (
          <label key={item.key} className="flex items-center gap-1.5 text-[11px]">
            <input
              type="checkbox"
              checked={manifest[item.key]}
              onChange={(e) => onChange({ ...manifest, [item.key]: e.target.checked })}
            />
            {item.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function UploadSlots({
  onImport,
  parts,
  manifest,
  canvasWidth,
  canvasHeight,
}: {
  onImport: (file: File, options?: ImportOptions) => void;
  parts: CharacterPart[];
  manifest: PartManifest;
  canvasWidth: number;
  canvasHeight: number;
}) {
  const [customSlotName, setCustomSlotName] = useState("");
  const [variantSlotId, setVariantSlotId] = useState("");
  const [variantKey, setVariantKey] = useState("");
  const [variantName, setVariantName] = useState("");
  const normalizedCustomName = customSlotName.trim();
  const customSlotId = normalizedCustomName ? `custom:${slug(normalizedCustomName)}` : "";
  const variantSlots = listCharacterSlots(parts);
  const selectedVariantSlot = variantSlots.find((slot) => slot.id === variantSlotId);
  const normalizedVariantKey = variantKey.trim();
  return (
    <div className="space-y-3">
      <div>
        <div className="font-semibold uppercase tracking-wider text-muted-foreground">
          SVG Parts
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          Drop SVGs on the canvas or upload into a slot.
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {SLOT_DEFS.filter(
          (slot) =>
            slot.role !== "eye" && slot.role !== "iris" && roleEnabledByManifest(slot.role, manifest),
        ).map((slot) => (
          <SlotUpload
            key={`${slot.label}-${slot.role}`}
            label={slot.label}
            filled={parts.some((p) => p.slotName === slot.label)}
            onUpload={(file) =>
              onImport(file, {
                role: slot.role,
                side: slot.side,
                label: slot.label,
                slotId: `slot:${slug(slot.label)}`,
              })
            }
          />
        ))}
      </div>
      <div className="rounded border border-border bg-panel-2 p-2">
        <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
          Add variant to existing slot
        </div>
        <div className="mb-2 text-[10px] leading-snug text-muted-foreground">
          Use this for alternate images of the same animatable part, like hand open/fist/point.
        </div>
        <div className="grid gap-2">
          <select
            value={variantSlotId}
            onChange={(e) => setVariantSlotId(e.target.value)}
            aria-label="Variant slot"
            className="min-w-0 rounded border border-border bg-background px-2 py-1"
          >
            <option value="">Choose slot</option>
            {variantSlots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                {slot.name}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <input
              value={variantKey}
              onChange={(e) => setVariantKey(e.target.value)}
              aria-label="Variant key"
              placeholder="fist"
              className="min-w-0 rounded border border-border bg-background px-2 py-1"
            />
            <input
              value={variantName}
              onChange={(e) => setVariantName(e.target.value)}
              aria-label="Variant label"
              placeholder="Fist"
              className="min-w-0 rounded border border-border bg-background px-2 py-1"
            />
            <SlotUpload
              label="Upload"
              compact
              disabled={!selectedVariantSlot || !normalizedVariantKey}
              filled={Boolean(
                selectedVariantSlot &&
                  normalizedVariantKey &&
                  selectedVariantSlot.parts.some(
                    (part) => partMatchesVariant(part, normalizedVariantKey),
                  ),
              )}
              onUpload={(file) => {
                if (!selectedVariantSlot || !normalizedVariantKey) return;
                const representative = selectedVariantSlot.parts[0];
                onImport(file, {
                  role: selectedVariantSlot.role,
                  side: representative?.side,
                  label: selectedVariantSlot.name,
                  slotId: selectedVariantSlot.id,
                  variantKey: normalizedVariantKey,
                  variantLabel: variantName.trim() || normalizedVariantKey,
                  variantKind: defaultVariantKindForRole(
                    selectedVariantSlot.role,
                    undefined,
                    undefined,
                  ),
                  zIndex: representative?.zIndex,
                });
              }}
            />
          </div>
        </div>
      </div>
      <div className="rounded border border-border bg-panel-2 p-2">
        <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
          Named custom slot
        </div>
        <div className="mb-2 text-[10px] leading-snug text-muted-foreground">
          Use this for props, tails, wings, clothing, or any part outside the base human schema. The
          name becomes the slot id used in character JSON and AI motion prompts.
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input
            value={customSlotName}
            onChange={(e) => setCustomSlotName(e.target.value)}
            aria-label="Custom slot name"
            placeholder=""
            className="min-w-0 rounded border border-border bg-background px-2 py-1"
          />
          <SlotUpload
            label="Upload"
            compact
            filled={!!customSlotId && parts.some((p) => getPartSlotId(p) === customSlotId)}
            onUpload={(file) => {
              const label = normalizedCustomName || file.name.replace(/\.svg$/i, "");
              onImport(file, {
                role: "custom",
                label,
                slotId: `custom:${slug(label)}`,
              });
            }}
          />
        </div>
      </div>
      {manifest.hasEyes && (
        <div className="rounded border border-border bg-panel-2 p-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold uppercase tracking-wider text-muted-foreground">
              Eye States
            </span>
            <span className="text-[10px] text-muted-foreground">(optional)</span>
          </div>
          <EyePresetSelector
            onImport={onImport}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
          />
          {manifest.hasIrises && (
            <>
              <div className="mb-2 text-[10px] text-muted-foreground">Upload iris artwork:</div>
              <div className="mb-3 grid grid-cols-2 gap-1.5">
                {(["left", "right"] as const).map((side) => {
                  const label = `${side === "left" ? "Left" : "Right"} Iris`;
                  return (
                    <SlotUpload
                      key={`${side}-iris`}
                      compact
                      label={label}
                      filled={parts.some((p) => p.role === "iris" && p.side === side)}
                      onUpload={(file) =>
                        onImport(file, {
                          role: "iris",
                          side,
                          label,
                          slotId: `slot:${side}-iris`,
                          zIndex: 55,
                        })
                      }
                    />
                  );
                })}
              </div>
            </>
          )}
          <div className="text-[10px] text-muted-foreground mb-2">
            Or upload eye state variants:
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {(["left", "right"] as const).flatMap((side) =>
              EYE_STATES.map((eyeState) => {
                const label = `${side === "left" ? "Left" : "Right"} ${eyeState}`;
                return (
                  <SlotUpload
                    key={`${side}-${eyeState}`}
                    compact
                    label={label}
                    filled={parts.some(
                      (p) => p.role === "eye" && p.side === side && p.eyeState === eyeState,
                    )}
                    onUpload={(file) =>
                      onImport(file, {
                        role: "eye",
                        side,
                        eyeState,
                        label,
                        slotId: `slot:${side}-eye`,
                        zIndex: 50,
                      })
                    }
                  />
                );
              }),
            )}
          </div>
        </div>
      )}
      {manifest.hasMouth && <MouthShapeSetup parts={parts} onImport={onImport} />}
    </div>
  );
}

function SlotUpload({
  label,
  filled,
  compact,
  disabled,
  onUpload,
}: {
  label: string;
  filled: boolean;
  compact?: boolean;
  disabled?: boolean;
  onUpload: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        onClick={() => {
          if (!disabled) inputRef.current?.click();
        }}
        disabled={disabled}
        className={`flex items-center justify-between gap-2 rounded border px-2 text-left hover:bg-panel disabled:cursor-not-allowed disabled:opacity-50 ${
          compact ? "py-1" : "py-2"
        } ${filled ? "border-primary/60 bg-primary/10" : "border-border bg-panel-2"}`}
      >
        <span className="truncate">{label}</span>
        <Upload size={13} className="shrink-0 text-muted-foreground" />
      </button>
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        accept=".svg,image/svg+xml"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
    </>
  );
}

function MouthShapeSetup({
  parts,
  onImport,
}: {
  parts: CharacterPart[];
  onImport: (file: File, options?: ImportOptions) => void;
}) {
  return (
    <div className="rounded border border-border bg-panel-2 p-2">
      <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
        Mouth Shapes
      </div>
      <MouthPresetSelector onImport={onImport} />
      <div className="mb-2 text-[10px] text-muted-foreground">Or upload mouth shape variants:</div>
      <div className="grid grid-cols-2 gap-1.5">
        {MOUTH_VISEMES.map((viseme) => {
          const part = parts.find((p) => p.role === "mouth" && p.viseme === viseme);
          return (
            <SlotUpload
              key={viseme}
              compact
              label={viseme}
              filled={Boolean(part)}
              onUpload={(file) =>
                onImport(file, {
                  role: "mouth",
                  viseme,
                  label: `Mouth ${viseme}`,
                  slotId: "role:mouth",
                  zIndex: 60,
                })
              }
            />
          );
        })}
      </div>
    </div>
  );
}

const VISEME_ORDER: MouthViseme[] = ["rest", "A", "E", "O", "U", "MBP", "FV", "L", "WQ", "Smile"];
const EYE_STATE_ORDER: EyeState[] = ["open", "half", "closed", "wink"];

function variantLabel(part: CharacterPart) {
  return variantLabelForPart(part);
}

function orderVariants(parts: CharacterPart[]) {
  return parts.slice().sort((a, b) => {
    if (a.role === "mouth" && b.role === "mouth") {
      return (
        VISEME_ORDER.indexOf((a.viseme ?? variantKeyForPart(a)) as MouthViseme) -
        VISEME_ORDER.indexOf((b.viseme ?? variantKeyForPart(b)) as MouthViseme)
      );
    }
    if (a.role === "eye" && b.role === "eye") {
      return (
        EYE_STATE_ORDER.indexOf((a.eyeState ?? variantKeyForPart(a)) as EyeState) -
        EYE_STATE_ORDER.indexOf((b.eyeState ?? variantKeyForPart(b)) as EyeState)
      );
    }
    const byVariant = variantKeyForPart(a).localeCompare(variantKeyForPart(b));
    if (byVariant !== 0) return byVariant;
    return a.zIndex - b.zIndex;
  });
}

function LayerPartRow({
  part,
  selected,
  indented,
  indentLevel = indented ? 1 : 0,
  label,
  onSelect,
  onChange,
  onRemove,
}: {
  part: CharacterPart;
  selected: boolean;
  indented?: boolean;
  indentLevel?: number;
  label?: string;
  onSelect: () => void;
  onChange: (patch: Partial<CharacterPart>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={`flex cursor-pointer items-center gap-1 rounded border px-2 py-1.5 ${
        selected ? "border-primary bg-primary/15" : "border-border bg-panel-2 hover:bg-panel"
      }`}
      style={indentLevel > 0 ? { marginLeft: indentLevel * 12 } : undefined}
    >
      <span className="min-w-0 flex-1 truncate">
        {label ?? (indented ? variantLabel(part) : (part.slotName ?? part.name))}
        {!indented && (
          <span className="ml-1 text-[10px] text-muted-foreground">{roleLabel(part.role)}</span>
        )}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onChange({ visible: !part.visible });
        }}
        className="rounded p-1 text-muted-foreground hover:text-foreground"
        title={part.visible ? "Hide" : "Show"}
      >
        {part.visible ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onChange({ locked: !part.locked });
        }}
        className={`rounded p-1 hover:text-foreground ${
          part.locked ? "text-primary" : "text-muted-foreground"
        }`}
        title={part.locked ? "Unlock" : "Lock"}
      >
        {part.locked ? <Lock size={14} /> : <Unlock size={14} />}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onChange({ zIndex: part.zIndex + 1 });
        }}
        className="rounded p-1 text-muted-foreground hover:text-foreground"
        title="Bring forward"
      >
        <ArrowUp size={14} />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onChange({ zIndex: part.zIndex - 1 });
        }}
        className="rounded p-1 text-muted-foreground hover:text-foreground"
        title="Send backward"
      >
        <ArrowDown size={14} />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="rounded p-1 text-destructive"
        title="Delete"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function LayerList({
  parts,
  rig,
  selectedId,
  selectedSlotId,
  onSelect,
  onSelectSlot,
  onChange,
  onRemove,
  onToggleSlotVisible,
  onToggleSlotLocked,
  onNudgeSlotZ,
  onRemoveSlot,
}: {
  parts: CharacterPart[];
  rig: CharacterRig;
  selectedId: ID | null;
  selectedSlotId: ID | null;
  onSelect: (id: ID) => void;
  onSelectSlot: (slotId: ID) => void;
  onChange: (id: ID, patch: Partial<CharacterPart>) => void;
  onRemove: (id: ID) => void;
  onToggleSlotVisible: (slotId: ID) => void;
  onToggleSlotLocked: (slotId: ID) => void;
  onNudgeSlotZ: (slotId: ID, delta: number) => void;
  onRemoveSlot: (slotId: ID) => void;
}) {
  const [expanded, setExpanded] = useState<Set<ID>>(new Set());

  const groups = new Map<ID, CharacterPart[]>();
  for (const part of parts) {
    const slotId = getPartSlotId(part);
    const arr = groups.get(slotId) ?? [];
    arr.push(part);
    groups.set(slotId, arr);
  }
  const groupList = Array.from(groups.entries())
    .map(([slotId, slotParts]) => ({
      slotId,
      slotParts,
      topZ: Math.max(...slotParts.map((p) => p.zIndex)),
      name: slotParts[0].slotName ?? roleLabel(slotParts[0].role),
      role: slotParts[0].role,
      side: slotParts.find((part) => part.side)?.side,
    }))
    .sort((a, b) => b.topZ - a.topZ);
  type LayerGroup = (typeof groupList)[number];
  const hostedSlotIds = new Set<ID>();
  const groupBySlotId = new Map(groupList.map((group) => [group.slotId, group]));
  const hostedSlotsByHostSlotId = new Map<ID, LayerGroup[]>();
  for (const group of groupList) {
    const relation = rig.slotRelations.find((entry) => entry.childSlotId === group.slotId);
    const hostSlotId = relation ? parentSlotIdForEditorRelation(relation, groupList) : undefined;
    if (!hostSlotId || hostSlotId === group.slotId || !groupBySlotId.has(hostSlotId)) continue;
    hostedSlotIds.add(group.slotId);
    hostedSlotsByHostSlotId.set(hostSlotId, [
      ...(hostedSlotsByHostSlotId.get(hostSlotId) ?? []),
      group,
    ]);
  }
  const topLevelGroups = groupList.filter((group) => !hostedSlotIds.has(group.slotId));
  const roots = topLevelGroups.length > 0 ? topLevelGroups : groupList;

  const toggleExpanded = (slotId: ID) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(slotId)) next.delete(slotId);
      else next.add(slotId);
      return next;
    });

  const renderLayerGroup = (group: LayerGroup, depth = 0, ancestors = new Set<ID>()) => {
    if (ancestors.has(group.slotId)) return null;
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(group.slotId);
    const childGroups = hostedSlotsByHostSlotId.get(group.slotId) ?? [];
    const children =
      childGroups.length > 0
        ? childGroups.map((child) => renderLayerGroup(child, depth + 1, nextAncestors))
        : null;

    if (group.slotParts.length === 1) {
      const part = group.slotParts[0];
      return (
        <div key={group.slotId} className="space-y-1">
          <LayerPartRow
            part={part}
            selected={part.id === selectedId}
            indentLevel={depth}
            onSelect={() => onSelect(part.id)}
            onChange={(patch) => onChange(part.id, patch)}
            onRemove={() => onRemove(part.id)}
          />
          {children}
        </div>
      );
    }

    const isOpen = expanded.has(group.slotId);
    const anyVisible = group.slotParts.some((p) => p.visible);
    const anyLocked = group.slotParts.some((p) => p.locked);
    return (
      <div key={group.slotId} className="space-y-1">
        <div
          onClick={() => onSelectSlot(group.slotId)}
          className={`flex cursor-pointer items-center gap-1 rounded border px-2 py-1.5 ${
            group.slotId === selectedSlotId
              ? "border-primary bg-primary/15"
              : "border-border bg-panel-2 hover:bg-panel"
          }`}
          style={depth > 0 ? { marginLeft: depth * 12 } : undefined}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleExpanded(group.slotId);
            }}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            title={isOpen ? "Collapse variants" : "Expand variants"}
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <span className="min-w-0 flex-1 truncate font-medium">
            {group.name}
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
              {group.slotParts.length} variants
            </span>
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSlotVisible(group.slotId);
            }}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            title={anyVisible ? "Hide all" : "Show all"}
          >
            {anyVisible ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSlotLocked(group.slotId);
            }}
            className={`rounded p-1 hover:text-foreground ${
              anyLocked ? "text-primary" : "text-muted-foreground"
            }`}
            title={anyLocked ? "Unlock all" : "Lock all"}
          >
            {anyLocked ? <Lock size={14} /> : <Unlock size={14} />}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNudgeSlotZ(group.slotId, 1);
            }}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            title="Bring all forward"
          >
            <ArrowUp size={14} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNudgeSlotZ(group.slotId, -1);
            }}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            title="Send all backward"
          >
            <ArrowDown size={14} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemoveSlot(group.slotId);
            }}
            className="rounded p-1 text-destructive"
            title="Delete group"
          >
            <Trash2 size={14} />
          </button>
        </div>
        {isOpen && (
          <div className="space-y-1">
            {orderVariants(group.slotParts).map((part) => (
              <LayerPartRow
                key={part.id}
                part={part}
                selected={part.id === selectedId}
                indentLevel={depth + 1}
                label={variantLabel(part)}
                onSelect={() => onSelect(part.id)}
                onChange={(patch) => onChange(part.id, patch)}
                onRemove={() => onRemove(part.id)}
              />
            ))}
          </div>
        )}
        {children}
      </div>
    );
  };

  return (
    <div className="mt-4">
      <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
        Layers
      </div>
      <div className="space-y-1">
        {roots.map((group) => renderLayerGroup(group))}
      </div>
    </div>
  );
}

function parentSlotIdForEditorRelation(
  relation: CharacterSlotRelation,
  groups: Array<{
    slotId: ID;
    role: PartRole;
    side?: CharacterPart["side"];
    slotParts: CharacterPart[];
  }>,
): ID | undefined {
  if (relation.parentRef.type === "slot" || relation.parentRef.type === "semanticSlot") {
    return relation.parentRef.id;
  }
  if (relation.parentRef.type === "role") {
    return groups.find(
      (group) =>
        group.role === relation.parentRef.role &&
        (!relation.parentRef.side ||
          group.side === relation.parentRef.side ||
          group.slotParts.some((part) => part.side === relation.parentRef.side)),
    )?.slotId;
  }
  return undefined;
}

function Inspector({
  doc,
  part,
  mode,
  boundsMode,
  onModeChange,
  onBoundsModeChange,
  onChange,
  onRemove,
  onDuplicate,
  onPreview,
}: {
  doc: CharacterPreset;
  part: CharacterPart | null;
  mode: EditorMode;
  boundsMode: EditorBoundsMode;
  onModeChange: (mode: EditorMode) => void;
  onBoundsModeChange: (mode: EditorBoundsMode) => void;
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

  const parentOptions = doc.parts.filter((p) => p.id !== part.id);
  const previewButtons = previewLabels(part);
  const variantInputKey = part.variant?.key ?? part.viseme ?? part.eyeState ?? part.pose ?? "";
  const variantKind =
    part.variant?.kind ?? defaultVariantKindForRole(part.role, part.viseme, part.eyeState);
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
      <section className="rounded border border-border bg-panel-2 p-3">
        <div className="mb-3 flex items-center gap-2">
          <input
            value={part.name}
            onChange={(e) => onChange(part.id, { name: e.target.value, slotName: e.target.value })}
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
          <Field label="Attach To">
            <select
              value={part.parentId ?? ""}
              onChange={(e) => onChange(part.id, { parentId: e.target.value || undefined })}
              className="w-full rounded border border-border bg-background px-2 py-1"
            >
              <option value="">None</option>
              {parentOptions.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.slotName ?? candidate.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section className="rounded border border-border bg-panel-2 p-3">
        <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
          Variant
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Key">
            <input
              value={variantInputKey}
              onChange={(e) => onChange(part.id, { variant: updateVariant({ key: e.target.value }) })}
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
        </div>
      </section>

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
            onClick={() => onModeChange(mode === "bounds-ellipse" ? "select" : "bounds-ellipse")}
            className={`flex-1 rounded border px-2 py-1 ${mode === "bounds-ellipse" ? "border-primary bg-primary/15" : "border-border"}`}
          >
            Ellipse Area
          </button>
        </div>
        {part.bounds && (
          <button
            onClick={() => onChange(part.id, { bounds: undefined })}
            className="mt-2 text-[11px] text-destructive"
          >
            Clear allowed area
          </button>
        )}
      </section>

      {part.role === "mouth" && (
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

      {previewButtons.length > 0 && (
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

function CanvasControls({
  doc,
  onChange,
}: {
  doc: CharacterPreset;
  onChange: (patch: Partial<CharacterPreset>) => void;
}) {
  const rig = normalizeCharacterRig(doc);
  const angles = availableCharacterAngles(doc);
  const selectAngle = (activeAngle: CharacterAngle) => {
    const nextAngles = CHARACTER_ANGLES.filter(
      (angle) => angle === activeAngle || angles.includes(angle),
    );
    onChange({ angles: nextAngles, rig: { ...rig, activeAngle } });
  };
  return (
    <section className="rounded border border-border bg-panel-2 p-3">
      <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
        Canvas
      </div>
      <div className="mb-2 rounded border border-border bg-background px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
        Active angle is discrete in V1. Depth, bone offsets, and selected slot variants can be
        overridden per angle.
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
        <Field label="Active Angle">
          <select
            value={rig.activeAngle}
            onChange={(e) => selectAngle(e.target.value as CharacterAngle)}
            className="w-full rounded border border-border bg-background px-2 py-1"
          >
            {CHARACTER_ANGLES.map((angle) => (
              <option key={angle} value={angle}>
                {angle}
                {angles.includes(angle) ? "" : " (add)"}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </section>
  );
}

function RigAssistant({
  doc,
  onChange,
}: {
  doc: CharacterPreset;
  onChange: (patch: Partial<CharacterPreset>) => void;
}) {
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const rig = normalizeCharacterRig(doc);

  const copyPrompt = () => {
    void navigator.clipboard?.writeText(characterRigPrompt(doc));
    setMessage("Prompt copied.");
  };

  const applyDraft = () => {
    try {
      const parsed = JSON.parse(draft) as CharacterRig | { rig?: CharacterRig };
      const candidate = "rig" in parsed && parsed.rig ? parsed.rig : (parsed as CharacterRig);
      const validation = validateCharacterRig(candidate);
      if (!validation.ok) {
        setMessage(validation.errors.join(" "));
        return;
      }
      onChange({ rig: candidate });
      setMessage("Rig applied.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not parse rig JSON.");
    }
  };

  return (
    <section className="rounded border border-border bg-panel-2 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-wider text-muted-foreground">
          Rig Assistant
        </span>
        <span className="text-[10px] text-muted-foreground">{rig.bones.length} bones</span>
      </div>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onChange({ rig: buildDefaultRig(doc) })}
          className="rounded border border-border px-2 py-1 hover:bg-panel"
        >
          Rebuild
        </button>
        <button
          type="button"
          onClick={copyPrompt}
          className="rounded border border-border px-2 py-1 hover:bg-panel"
        >
          Copy AI prompt
        </button>
      </div>
      <div className="mb-2 rounded border border-accent/30 bg-accent/10 px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
        Paste either a raw <code className="font-mono text-foreground">CharacterRig</code> object or{" "}
        <code className="font-mono text-foreground">{'{"rig": {...}}'}</code>. Required shape:{" "}
        <code className="font-mono text-foreground">
          {
            "version:1, activeAngle, angles{}, bones[], slotBindings[], drawOrder[], slotRelations[], hostConstraints[], reaches[]"
          }
        </code>
        . Bone ids must be acyclic, and each slot binding must reference an existing slot and bone.
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Paste reviewed CharacterRig JSON"
        className="h-20 w-full resize-none rounded border border-border bg-background px-2 py-1 font-mono text-[10px]"
      />
      <button
        type="button"
        onClick={applyDraft}
        className="mt-2 w-full rounded border border-border px-2 py-1 hover:bg-panel"
      >
        Validate & apply
      </button>
      {message && <div className="mt-2 text-[10px] text-muted-foreground">{message}</div>}
    </section>
  );
}

function RigPanel({
  doc,
  selectedBoneId,
  selectedSlotId,
  selectedPart,
  showBones,
  onSelectBone,
  onRigChange,
}: {
  doc: CharacterPreset;
  selectedBoneId: ID | null;
  selectedSlotId: ID | null;
  selectedPart: CharacterPart | null;
  showBones: boolean;
  onSelectBone: (boneId: ID) => void;
  onRigChange: (rig: CharacterRig) => void;
}) {
  const rig = normalizeCharacterRig(doc);
  const selectedBone = rig.bones.find((bone) => bone.id === selectedBoneId) ?? null;
  const selectedBinding = selectedSlotId ? resolveSlotBinding(rig, selectedSlotId) : undefined;
  const bindSelectedPart = () => {
    if (!selectedPart) return;
    onRigChange(bindSlotPartToAngle(rig, getPartSlotId(selectedPart), selectedPart.id));
  };

  return (
    <section className="rounded border border-border bg-panel-2 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-wider text-muted-foreground">Rig</span>
        <span className="text-[10px] text-muted-foreground">{rig.bones.length} bones</span>
      </div>
      <div className="mb-3 max-h-28 space-y-1 overflow-auto">
        {rig.bones.map((bone) => (
          <button
            key={bone.id}
            type="button"
            onClick={() => onSelectBone(bone.id)}
            className={`flex w-full items-center justify-between gap-2 rounded border px-2 py-1 text-left hover:bg-panel ${
              bone.id === selectedBoneId ? "border-primary bg-primary/15" : "border-border"
            }`}
          >
            <span className="truncate">{bone.name}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{bone.role}</span>
          </button>
        ))}
      </div>
      <div className="mb-3 rounded border border-border bg-background px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
        {showBones
          ? "Bones shown — drag the joints to position the skeleton; artwork stays put. Hide bones (top bar) to drag the layers themselves."
          : "Bones hidden — drag layers on the canvas to reposition artwork. Show bones to adjust the skeleton."}
      </div>
      {selectedBone && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <NumberField
            label="Bone X"
            value={selectedBone.x}
            onChange={(x) => onRigChange(setBoneTransform(rig, selectedBone.id, { x }))}
          />
          <NumberField
            label="Bone Y"
            value={selectedBone.y}
            onChange={(y) => onRigChange(setBoneTransform(rig, selectedBone.id, { y }))}
          />
          <NumberField
            label="Bone Rot"
            value={selectedBone.rotation}
            onChange={(rotation) =>
              onRigChange(setBoneTransform(rig, selectedBone.id, { rotation }))
            }
          />
          <NumberField
            label="Bone Depth"
            value={selectedBone.depth ?? 0}
            onChange={(depth) => onRigChange(setBoneDepth(rig, selectedBone.id, depth))}
          />
        </div>
      )}
      {selectedBinding && (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Slot Depth"
            value={selectedBinding.effectiveDepth}
            onChange={(depth) => onRigChange(setSlotDepth(rig, selectedBinding.slotId, depth))}
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
            <div className="col-span-2 rounded border border-border bg-background px-2 py-1.5 text-[10px] text-muted-foreground">
              Active angle uses part{" "}
              <span className="text-foreground">{selectedBinding.effectivePartId}</span>.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Friendly UI for a layer's attach-to parent and its movement "reach". Attach-to carries the layer
 * with its parent; the reach (traced by sweeping the layer to its extremes) is how far it may drift
 * from that parent, in the parent's frame, so it rides along. Reach is a guide for generated motion;
 * manual dragging stays free.
 */
// A compact set/not-set status chip: green dot when configured, amber dot when it still
// needs setting. Gives the inspector an at-a-glance read of which limits are in place.
function ConstraintPill({ set, label }: { set: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${
        set
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : "border-amber-500/30 bg-amber-500/5 text-amber-300/90"
      }`}
      title={set ? `${label}: set` : `${label}: not set`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${set ? "bg-emerald-400" : "bg-amber-400"}`} />
      {label}
    </span>
  );
}

function RestrictMovementPanel({
  doc,
  slotId,
  editing,
  onEnterEdit,
  onExitEdit,
  onAttachTo,
  onHostChange,
  onHostModeChange,
  onClear,
}: {
  doc: CharacterPreset;
  slotId: ID;
  editing: boolean;
  onEnterEdit: () => void;
  onExitEdit: () => void;
  onAttachTo: (parentSlotId: ID | "") => void;
  onHostChange: (hostSlotId: ID | "") => void;
  onHostModeChange: (mode: "insideHostMask" | "insideHostBounds") => void;
  onClear: () => void;
}) {
  const rig = normalizeCharacterRig(doc);
  const slots = listCharacterSlots(doc.parts);
  const slot = slots.find((s) => s.id === slotId);
  const slotParts = doc.parts.filter((p) => getPartSlotId(p) === slotId);
  const parentPart = slotParts.map((p) => p.parentId).find(Boolean)
    ? doc.parts.find((p) => p.id === slotParts.map((sp) => sp.parentId).find(Boolean))
    : undefined;
  const parentSlotId = parentPart ? getPartSlotId(parentPart) : "";
  const parentName = slots.find((s) => s.id === parentSlotId)?.name;
  const parentOptions = slots.filter((s) => s.id !== slotId);
  const hostConstraint = rig.hostConstraints.find((c) => c.slotId === slotId);
  const hostSlotId = hostConstraint?.hostSlotId ?? "";
  const hostName = slots.find((s) => s.id === hostSlotId)?.name;
  const constraint = rig.reaches.find((c) => c.slotId === slotId);
  const hasPosReach = !!constraint?.reach && constraint.reach.length >= 3;
  const hasRotReach = !!constraint?.rotReach;
  const hasReach = hasPosReach || hasRotReach;

  return (
    <section className="rounded border border-border bg-panel-2 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Lock size={13} className="text-muted-foreground" />
        <span className="font-semibold uppercase tracking-wider text-muted-foreground">
          Bounds & host
        </span>
      </div>

      {/* At-a-glance status: green = set, amber = still needs setting. */}
      <div className="mb-3 flex flex-wrap gap-1">
        <ConstraintPill set={!!parentSlotId} label="Attached" />
        <ConstraintPill set={!!hostSlotId} label="Drag boundary" />
        <ConstraintPill set={hasPosReach} label="Drift" />
        <ConstraintPill
          set={hasRotReach}
          label={
            hasRotReach
              ? `Twist ${constraint?.rotReach?.min}°/${constraint?.rotReach?.max}°`
              : "Twist"
          }
        />
      </div>

      <Field label="Attach to layer">
        <select
          value={parentSlotId}
          onChange={(e) => onAttachTo(e.target.value)}
          className="w-full rounded border border-border bg-background px-2 py-1"
        >
          <option value="">Nothing (independent)</option>
          {parentOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <p className="mb-2 mt-1 text-[10px] leading-snug text-muted-foreground">
        {parentName
          ? `Carried by ${parentName} when it moves.`
          : "Not attached — moves on its own."}
      </p>

      <Field label="Drag boundary">
        <select
          value={hostSlotId}
          onChange={(e) => onHostChange(e.target.value)}
          className="w-full rounded border border-border bg-background px-2 py-1"
        >
          <option value="">No drag boundary</option>
          {parentOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      {hostSlotId && (
        <div className="mt-2 grid grid-cols-2 gap-1 rounded border border-border bg-background p-1">
          <button
            type="button"
            onClick={() => onHostModeChange("insideHostMask")}
            className={`rounded px-2 py-1 ${
              hostConstraint?.mode !== "insideHostBounds"
                ? "bg-primary text-primary-foreground"
                : "hover:bg-panel"
            }`}
            title="Use visible art bounds from the host as the drag limit"
          >
            Visible bounds
          </button>
          <button
            type="button"
            onClick={() => onHostModeChange("insideHostBounds")}
            className={`rounded px-2 py-1 ${
              hostConstraint?.mode === "insideHostBounds"
                ? "bg-primary text-primary-foreground"
                : "hover:bg-panel"
            }`}
            title="Use the host registration frame as the containment box"
          >
            Frame box
          </button>
        </div>
      )}
      <p className="mb-2 mt-1 text-[10px] leading-snug text-muted-foreground">
        {hostName
          ? `Manual drags are clamped so ${slot?.name ?? "this layer"} stays inside ${hostName}. This does not clip pixels in playback or export.`
          : "No drag boundary — manual moves are unrestricted."}
      </p>

      <p className="mb-2 text-[10px] leading-snug text-muted-foreground">
        Reach limits generated or preset motion. It controls how far{" "}
        <span className="text-foreground">{slot?.name ?? "this layer"}</span> may drift and twist
        from {parentName ?? "its parent"}.{" "}
        {hasReach
          ? `Set${hasPosReach ? " · drift" : ""}${hasRotReach ? ` · twist ${constraint?.rotReach?.min}°/${constraint?.rotReach?.max}°` : ""}.`
          : "Nothing set — unlimited."}
      </p>

      {!editing ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onEnterEdit}
            disabled={!parentSlotId}
            className="flex-1 rounded border border-primary/60 bg-primary/10 px-2 py-1 font-medium text-foreground hover:bg-primary/20 disabled:opacity-40"
            title={parentSlotId ? "" : "Attach to a layer first"}
          >
            {hasReach ? "Edit reach" : "Set reach"}
          </button>
          {hasReach && (
            <button
              type="button"
              onClick={onClear}
              className="rounded border border-border px-2 py-1 hover:bg-panel"
              title="Remove the reach — unlimited drift"
            >
              Clear
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="rounded border border-amber-400/40 bg-amber-300/10 px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
            <span className="text-foreground">Sweep the layer</span> to the farthest spots it should
            reach — the amber outline is its drift. Drag the{" "}
            <span className="text-sky-400">blue knob</span> to twist it to its rotation extremes. It
            snaps back; you&apos;re setting limits, not posing.
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onClear}
              className="flex-1 rounded border border-border px-2 py-1 hover:bg-panel"
            >
              Clear reach
            </button>
            <button
              type="button"
              onClick={onExitEdit}
              className="flex-1 rounded border border-primary/60 bg-primary/10 px-2 py-1 font-medium text-foreground hover:bg-primary/20"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Convex hull (monotonic chain) of a point cloud — the outline of a swept reach. */
function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const pts = points
    .slice()
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .filter((p, i, arr) => i === 0 || p.x !== arr[i - 1].x || p.y !== arr[i - 1].y);
  if (pts.length <= 2) return pts;
  const cross = (
    o: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: { x: number; y: number }[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * The traced reach outline (the area a layer may move within), drawn as an organic polygon in
 * canvas coordinates. Shown only in reach-edit focus mode for the layer being edited.
 */
function ReachOverlay({
  points,
  scale,
  canvasWidth,
  canvasHeight,
}: {
  points: { x: number; y: number }[];
  scale: number;
  canvasWidth: number;
  canvasHeight: number;
}) {
  if (points.length < 3) return null;
  const stroke = Math.max(1.5, 2 / Math.max(0.0001, scale));
  const path = points.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={canvasWidth}
      height={canvasHeight}
      style={{ zIndex: 9400 }}
    >
      <polygon
        points={path}
        fill="rgba(245, 158, 11, 0.28)"
        stroke="#f59e0b"
        strokeWidth={stroke}
        strokeDasharray={`${stroke * 3} ${stroke * 2}`}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Rotation-reach gizmo: a pivot, a wedge showing the allowed twist range, and a draggable knob to
 * trace it. Distinct (sky-blue) from the amber position reach. Shown in reach-edit focus mode.
 */
function RotationReachOverlay({
  anchor,
  radius,
  range,
  scale,
  canvasWidth,
  canvasHeight,
  onStartRotate,
}: {
  anchor: { x: number; y: number };
  radius: number;
  range: { min: number; max: number } | null;
  scale: number;
  canvasWidth: number;
  canvasHeight: number;
  onStartRotate: (e: React.PointerEvent) => void;
}) {
  const restAngle = -90; // straight up
  const stroke = Math.max(1.5, 2 / Math.max(0.0001, scale));
  const knobR = Math.max(7, 9 / Math.max(0.0001, scale));
  const toXY = (deg: number, r: number) => ({
    x: anchor.x + r * Math.cos((deg * Math.PI) / 180),
    y: anchor.y + r * Math.sin((deg * Math.PI) / 180),
  });
  const knob = toXY(restAngle, radius);
  let wedge: string | null = null;
  if (range && (range.min !== 0 || range.max !== 0)) {
    const p0 = toXY(restAngle + range.min, radius);
    const p1 = toXY(restAngle + range.max, radius);
    const large = range.max - range.min > 180 ? 1 : 0;
    wedge = `M ${anchor.x} ${anchor.y} L ${p0.x} ${p0.y} A ${radius} ${radius} 0 ${large} 1 ${p1.x} ${p1.y} Z`;
  }
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={canvasWidth}
      height={canvasHeight}
      style={{ zIndex: 9450 }}
    >
      {wedge && (
        <path
          d={wedge}
          fill="rgba(14, 165, 233, 0.22)"
          stroke="#0ea5e9"
          strokeWidth={stroke}
          strokeLinejoin="round"
        />
      )}
      <line
        x1={anchor.x}
        y1={anchor.y}
        x2={knob.x}
        y2={knob.y}
        stroke="#0ea5e9"
        strokeWidth={stroke}
        strokeDasharray={`${stroke * 3} ${stroke * 2}`}
      />
      <circle cx={anchor.x} cy={anchor.y} r={stroke * 1.6} fill="#0ea5e9" />
      <circle
        className="pointer-events-auto cursor-grab"
        cx={knob.x}
        cy={knob.y}
        r={knobR}
        fill="#0ea5e9"
        stroke="#082f49"
        strokeWidth={stroke * 0.7}
        onPointerDown={onStartRotate}
      />
    </svg>
  );
}

function RigBonesOverlay({
  doc,
  selectedBoneId,
  scale,
  onSelectBone,
  onStartBoneDrag,
}: {
  doc: CharacterPreset;
  selectedBoneId: ID | null;
  scale: number;
  onSelectBone: (boneId: ID) => void;
  onStartBoneDrag: (e: React.PointerEvent, boneId: ID) => void;
}) {
  const rig = normalizeCharacterRig(doc);
  const world = computeBoneWorldTransforms(rig);
  const radius = Math.max(6, 8 / Math.max(0.0001, scale));
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={doc.canvasWidth}
      height={doc.canvasHeight}
      style={{ zIndex: 12000 }}
    >
      {rig.bones.map((bone) => {
        const point = world.get(bone.id);
        const parent = bone.parentId ? world.get(bone.parentId) : undefined;
        if (!point || !parent) return null;
        return (
          <line
            key={`${bone.id}:link`}
            x1={parent.x}
            y1={parent.y}
            x2={point.x}
            y2={point.y}
            stroke="rgba(56, 189, 248, 0.72)"
            strokeWidth={Math.max(1.5, 2 / Math.max(0.0001, scale))}
          />
        );
      })}
      {rig.bones.map((bone) => {
        const point = world.get(bone.id);
        if (!point) return null;
        const selected = bone.id === selectedBoneId;
        return (
          <g
            key={bone.id}
            role="button"
            tabIndex={0}
            aria-label={`Select ${bone.name} bone`}
            className="pointer-events-auto cursor-move"
            onClick={(e) => {
              e.stopPropagation();
              onSelectBone(bone.id);
            }}
            onPointerDown={(e) => onStartBoneDrag(e, bone.id)}
          >
            <circle
              cx={point.x}
              cy={point.y}
              r={radius}
              fill={selected ? "#facc15" : "#38bdf8"}
              stroke="#0f172a"
              strokeWidth={Math.max(1, 1.5 / Math.max(0.0001, scale))}
            />
            <text
              x={point.x + radius + 3}
              y={point.y - radius - 3}
              fill="#0f172a"
              stroke="rgba(255,255,255,0.82)"
              strokeWidth={3}
              paintOrder="stroke"
              fontSize={Math.max(10, 11 / Math.max(0.0001, scale))}
            >
              {bone.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Axis-aligned move/resize box for a whole slot group (eyes / mouth visemes). */
function GroupControlsOverlay({
  bounds,
  scale,
  onStartMove,
  onStartResize,
  onStartRotate,
}: {
  bounds: { x: number; y: number; width: number; height: number };
  scale: number;
  onStartMove: (e: React.PointerEvent) => void;
  onStartResize: (e: React.PointerEvent, corner: ResizeCorner) => void;
  onStartRotate: (e: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  const handleSize = 14 / Math.max(0.0001, scale);
  const rotateSize = 24 / Math.max(0.0001, scale);
  const rotateOffset = 34 / Math.max(0.0001, scale);
  const rotateTop =
    bounds.y > rotateOffset + rotateSize ? -rotateOffset : bounds.height + rotateOffset;
  const corners: ResizeCorner[] = ["nw", "ne", "sw", "se"];
  const cornerPos: Record<ResizeCorner, { x: number; y: number }> = {
    nw: { x: 0, y: 0 },
    ne: { x: bounds.width, y: 0 },
    sw: { x: 0, y: bounds.height },
    se: { x: bounds.width, y: bounds.height },
  };
  return (
    <div
      className="absolute"
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        zIndex: 10000,
      }}
    >
      <div
        onPointerDown={(e) => {
          e.stopPropagation();
          onStartMove(e);
        }}
        className="absolute inset-0 cursor-move border-2 border-dashed border-primary"
        style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.4)" }}
      />
      {corners.map((corner) => (
        <button
          key={corner}
          type="button"
          aria-label={`Resize group from ${corner}`}
          onPointerDown={(e) => {
            e.stopPropagation();
            onStartResize(e, corner);
          }}
          className={`absolute rounded-sm border border-background bg-primary shadow-[0_1px_4px_rgba(0,0,0,0.35)] ${resizeCursor(corner)}`}
          style={{
            left: cornerPos[corner].x,
            top: cornerPos[corner].y,
            width: handleSize,
            height: handleSize,
            transform: "translate(-50%, -50%)",
          }}
        />
      ))}
      <button
        type="button"
        aria-label="Rotate group"
        onPointerDown={onStartRotate}
        className="pointer-events-auto absolute flex items-center justify-center rounded-full border border-background bg-primary text-primary-foreground shadow-[0_1px_5px_rgba(0,0,0,0.35)]"
        style={{
          left: bounds.width / 2,
          top: rotateTop,
          width: rotateSize,
          height: rotateSize,
          transform: "translate(-50%, -50%)",
        }}
      >
        <RotateCw size={Math.max(10, rotateSize * 0.55)} strokeWidth={2.25} />
      </button>
    </div>
  );
}

/** Inspector panel shown when a whole slot group is selected. */
function GroupInspector({
  doc,
  slotId,
  parts,
  bounds,
  onMove,
  onScale,
  onRotate,
  onSelectPart,
  lipSyncSamples,
  mouthTestPlaying,
  onTestWord,
  onTestAudio,
  onStopTestAudio,
}: {
  doc: CharacterPreset;
  slotId: ID;
  parts: CharacterPart[];
  bounds: { x: number; y: number; width: number; height: number };
  onMove: (dx: number, dy: number) => void;
  onScale: (anchor: { x: number; y: number }, scaleX: number, scaleY: number) => void;
  onRotate: (anchor: { x: number; y: number }, degrees: number) => void;
  onSelectPart: (id: ID) => void;
  lipSyncSamples: Array<{ name: string; url: string }>;
  mouthTestPlaying: boolean;
  onTestWord: (word: string) => void;
  onTestAudio: (url: string) => void;
  onStopTestAudio: () => void;
}) {
  const name = parts[0]?.slotName ?? roleLabel(parts[0]?.role ?? "custom");
  const isMouth = parts[0]?.role === "mouth";
  const averageRotation =
    parts.length > 0
      ? Math.round(parts.reduce((sum, part) => sum + part.rotation, 0) / parts.length)
      : 0;
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const wordNames = SAMPLE_WORDS.map((w) => w.toLowerCase());
  const wordHasAudio = (word: string) =>
    lipSyncSamples.some((s) => s.name.toLowerCase() === word.toLowerCase());
  // Clips not attached to a sample word are offered as standalone amplitude tests.
  const otherSamples = lipSyncSamples.filter((s) => !wordNames.includes(s.name.toLowerCase()));
  return (
    <div className="space-y-4">
      <section className="rounded border border-primary/50 bg-primary/10 p-3">
        <div className="mb-1 font-medium">{name} group</div>
        <div className="mb-3 text-[11px] text-muted-foreground">
          Move or resize all {parts.length} variants together. Edit one frame by selecting it below.
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="X"
            value={Math.round(bounds.x)}
            onChange={(x) => onMove(x - bounds.x, 0)}
          />
          <NumberField
            label="Y"
            value={Math.round(bounds.y)}
            onChange={(y) => onMove(0, y - bounds.y)}
          />
          <NumberField
            label="Width"
            value={Math.round(bounds.width)}
            onChange={(w) =>
              onScale({ x: bounds.x, y: bounds.y }, Math.max(8, w) / Math.max(1, bounds.width), 1)
            }
          />
          <NumberField
            label="Height"
            value={Math.round(bounds.height)}
            onChange={(h) =>
              onScale({ x: bounds.x, y: bounds.y }, 1, Math.max(8, h) / Math.max(1, bounds.height))
            }
          />
          <NumberField
            label="Rotate"
            value={averageRotation}
            onChange={(rotation) => onRotate(center, rotation - averageRotation)}
          />
        </div>
      </section>
      {isMouth && (
        <section className="rounded border border-border bg-panel-2 p-3">
          <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
            Test Lip Sync
          </div>
          <div className="mb-2 grid grid-cols-2 gap-2">
            {SAMPLE_WORDS.map((word) => {
              const hasAudio = wordHasAudio(word);
              return (
                <button
                  key={word}
                  type="button"
                  onClick={() => onTestWord(word)}
                  className="flex items-center justify-center gap-1 rounded border border-border px-2 py-1 hover:bg-panel"
                  title={
                    hasAudio ? `Play "${word}" with audio` : `${word} (silent — no clip attached)`
                  }
                >
                  {word}
                  {hasAudio && <span className="text-[9px] text-primary">♪</span>}
                </button>
              );
            })}
          </div>
          {otherSamples.length > 0 && (
            <>
              <div className="mb-1 text-[10px] text-muted-foreground">Or test with a clip:</div>
              <div className="grid grid-cols-2 gap-1">
                {otherSamples.map((sample) => (
                  <button
                    key={sample.url}
                    type="button"
                    onClick={() => (mouthTestPlaying ? onStopTestAudio() : onTestAudio(sample.url))}
                    className="truncate rounded border border-border bg-background px-2 py-1 text-[10px] hover:bg-panel"
                    title={sample.name}
                  >
                    ▶ {sample.name}
                  </button>
                ))}
              </div>
            </>
          )}
          {mouthTestPlaying && (
            <button
              type="button"
              onClick={onStopTestAudio}
              className="mt-2 w-full rounded border border-primary bg-primary/10 px-2 py-1 text-[10px] text-primary"
            >
              ■ Stop
            </button>
          )}
          {lipSyncSamples.length === 0 && (
            <div className="mt-2 rounded border border-dashed border-border p-2 text-[10px] text-muted-foreground">
              Drop audio into <code>src/studio/character/lipsync-samples/</code>. Name a file after
              a word above (e.g. <code>mommy.mp3</code>) to attach it to that button; other clips
              appear here as standalone tests.
            </div>
          )}
        </section>
      )}
      <section className="rounded border border-border bg-panel-2 p-3">
        <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
          Variants
        </div>
        <div className="grid grid-cols-3 gap-1">
          {orderVariants(parts).map((part) => (
            <button
              key={part.id}
              type="button"
              onClick={() => onSelectPart(part.id)}
              className="truncate rounded border border-border bg-background px-2 py-1 text-[10px] hover:bg-panel"
              title={`Edit ${variantLabel(part)}`}
            >
              {variantLabel(part)}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function PartLayer({
  part,
  selected,
  dimmed = false,
  blurred = false,
  preview,
  previewParentPart,
  allParts,
}: {
  part: CharacterPart;
  selected: boolean;
  dimmed?: boolean;
  blurred?: boolean;
  preview: PreviewState | null;
  previewParentPart?: CharacterPart;
  allParts: CharacterPart[];
}) {
  const url = useMediaUrl(part.mediaId);
  const sameSlotParts = allParts.filter((candidate) => getPartSlotId(candidate) === getPartSlotId(part));
  if (sameSlotParts.length > 1 && !selected) {
    const activeVariant =
      activePreviewVariantForPart(part, preview) ??
      defaultVariantForSlotParts(sameSlotParts, part.role);
    if (activeVariant && !partMatchesVariant(part, activeVariant)) return null;
  }
  if (!part.visible && !selected) return null;

  const previewTransform = previewDelta(part, preview, previewParentPart, allParts);
  const baseOpacity = part.visible ? previewTransform.opacity : 0.28;
  // In movement-range focus mode, fade everything except the layer being edited. While the
  // active layer is being edited, the others get a slight blur (and a touch of fade) instead.
  const opacity = dimmed ? baseOpacity * 0.12 : blurred ? baseOpacity * 0.7 : baseOpacity;
  const pivot = pivotForPart(part);

  return (
    <>
      {part.bounds && selected && <BoundsOverlay bounds={part.bounds} zIndex={part.zIndex - 1} />}
      <div
        className="absolute select-none"
        style={{
          left: part.x + previewTransform.dx,
          top: part.y + previewTransform.dy,
          width: part.width,
          height: part.height,
          zIndex: part.zIndex,
          opacity,
          filter: blurred && !dimmed ? "blur(2px)" : undefined,
          transition: "filter 120ms ease",
          pointerEvents: "none",
          transform: `rotate(${part.rotation + previewTransform.rotation}deg) scale(${previewTransform.scale}, ${previewTransform.scaleY ?? previewTransform.scale})`,
          transformOrigin: `${((pivot.x - part.x) / part.width) * 100}% ${((pivot.y - part.y) / part.height) * 100}%`,
        }}
      >
        {url && (
          <img
            src={url}
            alt={part.name}
            draggable={false}
            className="pointer-events-none h-full w-full object-contain"
          />
        )}
      </div>
    </>
  );
}

function PartControlsOverlay({
  part,
  canvasWidth,
  canvasHeight,
  scale,
  boundsMode,
  onBoundsModeChange,
  preview,
  previewParentPart,
  allParts,
  onBeginChange,
  onChange,
}: {
  part: CharacterPart;
  canvasWidth: number;
  canvasHeight: number;
  scale: number;
  boundsMode: EditorBoundsMode;
  onBoundsModeChange: (mode: EditorBoundsMode) => void;
  preview: PreviewState | null;
  previewParentPart?: CharacterPart;
  allParts: CharacterPart[];
  onBeginChange: () => void;
  onChange: (patch: Partial<CharacterPart>) => void;
}) {
  const previewTransform = previewDelta(part, preview, previewParentPart, allParts);
  const pivot = pivotForPart(part);
  const selection = editorSelectionBounds(part, boundsMode);
  const control = editorControlBounds(part, scale, boundsMode);
  const alpha = localAlphaBounds(part);
  const viewportScale = Math.max(0.0001, scale);
  const handleSize = 14 / viewportScale;
  const rotateSize = 24 / viewportScale;
  const toggleSize = 22 / viewportScale;
  const pivotSize = 10 / viewportScale;
  const margin = 12 / viewportScale;
  const origin = {
    x: part.x + previewTransform.dx,
    y: part.y + previewTransform.dy,
  };
  const handlePositions = controlHandlePositions(
    part,
    control,
    previewTransform,
    canvasWidth,
    canvasHeight,
    margin,
  );
  const rotatePosition = rotateHandlePosition(
    part,
    control,
    previewTransform,
    canvasWidth,
    canvasHeight,
    margin,
  );
  const togglePosition = clampLocalPointToCanvas(
    part,
    { x: control.x - margin * 1.8, y: control.y - margin * 1.8 },
    previewTransform,
    canvasWidth,
    canvasHeight,
    margin,
  );

  const resize = (corner: ResizeCorner) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0) return;
    onBeginChange();
    const startX = e.clientX;
    const startY = e.clientY;
    const move = (ev: PointerEvent) => {
      const delta = pointerDeltaToPartLocalDelta(
        ev.clientX - startX,
        ev.clientY - startY,
        scale,
        part,
        previewTransform,
      );
      onChange(resizePartFromLocalBounds(part, selection, corner, delta.x, delta.y));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const rotate = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0) return;
    onBeginChange();
    const canvas = e.currentTarget.closest("[data-editor-canvas]") as HTMLDivElement | null;
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return;
    const pivotScreen = {
      x: rect.left + (pivot.x + previewTransform.dx) * scale,
      y: rect.top + (pivot.y + previewTransform.dy) * scale,
    };
    const startAngle = Math.atan2(e.clientY - pivotScreen.y, e.clientX - pivotScreen.x);
    const baseRotation = part.rotation;
    const move = (ev: PointerEvent) => {
      const nextAngle = Math.atan2(ev.clientY - pivotScreen.y, ev.clientX - pivotScreen.x);
      const deltaDeg = ((nextAngle - startAngle) * 180) / Math.PI;
      onChange({ rotation: Math.round(baseRotation + deltaDeg) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      className="pointer-events-none absolute select-none"
      style={{
        left: origin.x,
        top: origin.y,
        width: part.width,
        height: part.height,
        zIndex: 10000,
        transform: `rotate(${part.rotation + previewTransform.rotation}deg) scale(${previewTransform.scale}, ${previewTransform.scaleY ?? previewTransform.scale})`,
        transformOrigin: `${((pivot.x - part.x) / part.width) * 100}% ${((pivot.y - part.y) / part.height) * 100}%`,
      }}
    >
      <div
        className="absolute border border-primary"
        style={{
          left: selection.x,
          top: selection.y,
          width: selection.width,
          height: selection.height,
          boxShadow: "0 0 0 1px rgba(255,255,255,0.45)",
        }}
      />
      {boundsMode === "frame" && part.alphaBounds && (
        <div
          className="absolute border border-dashed border-primary/60"
          style={{
            left: alpha.x,
            top: alpha.y,
            width: alpha.width,
            height: alpha.height,
          }}
        />
      )}
      {(["nw", "ne", "sw", "se"] as ResizeCorner[]).map((corner) => (
        <button
          key={corner}
          type="button"
          aria-label={`Resize ${part.name} from ${corner}`}
          onPointerDown={resize(corner)}
          className={`pointer-events-auto absolute rounded-sm border border-background bg-primary shadow-[0_1px_4px_rgba(0,0,0,0.35)] ${resizeCursor(corner)}`}
          style={{
            left: handlePositions[corner].x,
            top: handlePositions[corner].y,
            width: handleSize,
            height: handleSize,
            transform: "translate(-50%, -50%)",
          }}
        />
      ))}
      <button
        type="button"
        aria-label={`Rotate ${part.name}`}
        onPointerDown={rotate}
        className="pointer-events-auto absolute flex items-center justify-center rounded-full border border-background bg-primary text-primary-foreground shadow-[0_1px_5px_rgba(0,0,0,0.35)]"
        style={{
          left: rotatePosition.x,
          top: rotatePosition.y,
          width: rotateSize,
          height: rotateSize,
          transform: "translate(-50%, -50%)",
        }}
      >
        <RotateCw size={Math.max(10, rotateSize * 0.55)} strokeWidth={2.25} />
      </button>
      <button
        type="button"
        aria-label={
          boundsMode === "frame"
            ? `Use visible art bounds for ${part.name}`
            : `Use full registration bounds for ${part.name}`
        }
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onBoundsModeChange(boundsMode === "frame" ? "art" : "frame");
        }}
        className="pointer-events-auto absolute flex items-center justify-center rounded border border-background bg-panel text-foreground shadow-[0_1px_5px_rgba(0,0,0,0.35)]"
        style={{
          left: togglePosition.x,
          top: togglePosition.y,
          width: toggleSize,
          height: toggleSize,
          transform: "translate(-50%, -50%)",
        }}
        title={boundsMode === "frame" ? "Switch to art bounds" : "Switch to full frame bounds"}
      >
        {boundsMode === "frame" ? (
          <Minimize2 size={Math.max(10, toggleSize * 0.55)} />
        ) : (
          <Maximize2 size={Math.max(10, toggleSize * 0.55)} />
        )}
      </button>
      <div
        className="absolute rounded-full border-2 border-primary bg-background"
        style={{
          left: pivot.x - part.x,
          top: pivot.y - part.y,
          width: Math.max(8, pivotSize),
          height: Math.max(8, pivotSize),
          transform: "translate(-50%, -50%)",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.45)",
        }}
      />
    </div>
  );
}

function canvasPointToPartLocal(
  part: CharacterPart,
  canvasPoint: { x: number; y: number },
  previewTransform: ReturnType<typeof previewDelta>,
) {
  const pivot = pivotForPart(part);
  const pivotLocal = { x: pivot.x - part.x, y: pivot.y - part.y };
  const pivotCanvas = {
    x: part.x + previewTransform.dx + pivotLocal.x,
    y: part.y + previewTransform.dy + pivotLocal.y,
  };
  const angle = -(((part.rotation + previewTransform.rotation) * Math.PI) / 180);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const relX = canvasPoint.x - pivotCanvas.x;
  const relY = canvasPoint.y - pivotCanvas.y;
  const unrotatedX = relX * cos - relY * sin;
  const unrotatedY = relX * sin + relY * cos;
  return {
    x: pivotLocal.x + unrotatedX / Math.max(0.0001, previewTransform.scale),
    y:
      pivotLocal.y +
      unrotatedY / Math.max(0.0001, previewTransform.scaleY ?? previewTransform.scale),
  };
}

function partLocalPointToCanvas(
  part: CharacterPart,
  localPoint: { x: number; y: number },
  previewTransform: ReturnType<typeof previewDelta>,
) {
  const pivot = pivotForPart(part);
  const pivotLocal = { x: pivot.x - part.x, y: pivot.y - part.y };
  const pivotCanvas = {
    x: part.x + previewTransform.dx + pivotLocal.x,
    y: part.y + previewTransform.dy + pivotLocal.y,
  };
  const angle = ((part.rotation + previewTransform.rotation) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const relX = (localPoint.x - pivotLocal.x) * previewTransform.scale;
  const relY = (localPoint.y - pivotLocal.y) * (previewTransform.scaleY ?? previewTransform.scale);
  return {
    x: pivotCanvas.x + relX * cos - relY * sin,
    y: pivotCanvas.y + relX * sin + relY * cos,
  };
}

function pointerDeltaToPartLocalDelta(
  screenDx: number,
  screenDy: number,
  viewportScale: number,
  part: CharacterPart,
  previewTransform: ReturnType<typeof previewDelta>,
) {
  const canvasDx = screenDx / Math.max(0.0001, viewportScale);
  const canvasDy = screenDy / Math.max(0.0001, viewportScale);
  const angle = -(((part.rotation + previewTransform.rotation) * Math.PI) / 180);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const unrotatedX = canvasDx * cos - canvasDy * sin;
  const unrotatedY = canvasDx * sin + canvasDy * cos;
  return {
    x: unrotatedX / Math.max(0.0001, previewTransform.scale),
    y: unrotatedY / Math.max(0.0001, previewTransform.scaleY ?? previewTransform.scale),
  };
}

function controlHandlePositions(
  part: CharacterPart,
  control: ReturnType<typeof editorControlBounds>,
  previewTransform: ReturnType<typeof previewDelta>,
  canvasWidth: number,
  canvasHeight: number,
  margin: number,
): Record<ResizeCorner, { x: number; y: number }> {
  const clampLocal = (point: { x: number; y: number }) =>
    clampLocalPointToCanvas(part, point, previewTransform, canvasWidth, canvasHeight, margin);
  return {
    nw: clampLocal({ x: control.x, y: control.y }),
    ne: clampLocal({ x: control.x + control.width, y: control.y }),
    sw: clampLocal({ x: control.x, y: control.y + control.height }),
    se: clampLocal({ x: control.x + control.width, y: control.y + control.height }),
  };
}

function rotateHandlePosition(
  part: CharacterPart,
  control: ReturnType<typeof editorControlBounds>,
  previewTransform: ReturnType<typeof previewDelta>,
  canvasWidth: number,
  canvasHeight: number,
  margin: number,
) {
  const gap = margin * 2.4;
  const candidates = [
    { x: control.x + control.width / 2, y: control.y - gap },
    { x: control.x + control.width / 2, y: control.y + control.height + gap },
    { x: control.x - gap, y: control.y + control.height / 2 },
    { x: control.x + control.width + gap, y: control.y + control.height / 2 },
  ];
  const best =
    candidates
      .map((localPoint) => {
        const canvasPoint = partLocalPointToCanvas(part, localPoint, previewTransform);
        const overflow =
          Math.max(0, margin - canvasPoint.x) +
          Math.max(0, canvasPoint.x - (canvasWidth - margin)) +
          Math.max(0, margin - canvasPoint.y) +
          Math.max(0, canvasPoint.y - (canvasHeight - margin));
        const breathingRoom = Math.min(
          Math.abs(canvasPoint.x - margin),
          Math.abs(canvasWidth - margin - canvasPoint.x),
          Math.abs(canvasPoint.y - margin),
          Math.abs(canvasHeight - margin - canvasPoint.y),
        );
        return { localPoint, overflow, breathingRoom };
      })
      .sort((a, b) => a.overflow - b.overflow || b.breathingRoom - a.breathingRoom)[0]
      ?.localPoint ?? candidates[0];

  return clampLocalPointToCanvas(part, best, previewTransform, canvasWidth, canvasHeight, margin);
}

function resizeCursor(corner: ResizeCorner) {
  return corner === "nw" || corner === "se" ? "cursor-nwse-resize" : "cursor-nesw-resize";
}

function clampLocalPointToCanvas(
  part: CharacterPart,
  localPoint: { x: number; y: number },
  previewTransform: ReturnType<typeof previewDelta>,
  canvasWidth: number,
  canvasHeight: number,
  margin: number,
) {
  const canvasPoint = partLocalPointToCanvas(part, localPoint, previewTransform);
  const clampedCanvasPoint = {
    x: clamp(canvasPoint.x, margin, canvasWidth - margin),
    y: clamp(canvasPoint.y, margin, canvasHeight - margin),
  };
  return canvasPointToPartLocal(part, clampedCanvasPoint, previewTransform);
}

function resizePartFromLocalBounds(
  part: CharacterPart,
  bounds: { x: number; y: number; width: number; height: number },
  corner: ResizeCorner,
  dx: number,
  dy: number,
): Partial<CharacterPart> {
  const fractionX = bounds.x / Math.max(1, part.width);
  const fractionY = bounds.y / Math.max(1, part.height);
  const fractionWidth = bounds.width / Math.max(1, part.width);
  const fractionHeight = bounds.height / Math.max(1, part.height);

  const visibleLeft = part.x + bounds.x;
  const visibleTop = part.y + bounds.y;
  const visibleRight = visibleLeft + bounds.width;
  const visibleBottom = visibleTop + bounds.height;

  const nextVisibleLeft = corner.includes("w") ? visibleLeft + dx : visibleLeft;
  const nextVisibleTop = corner.includes("n") ? visibleTop + dy : visibleTop;
  const nextVisibleRight = corner.includes("e") ? visibleRight + dx : visibleRight;
  const nextVisibleBottom = corner.includes("s") ? visibleBottom + dy : visibleBottom;

  const nextVisibleWidth = Math.max(4, nextVisibleRight - nextVisibleLeft);
  const nextVisibleHeight = Math.max(4, nextVisibleBottom - nextVisibleTop);
  const width = Math.max(8, nextVisibleWidth / Math.max(0.0001, fractionWidth));
  const height = Math.max(8, nextVisibleHeight / Math.max(0.0001, fractionHeight));

  return {
    x: Math.round(nextVisibleLeft - fractionX * width),
    y: Math.round(nextVisibleTop - fractionY * height),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function BoundsOverlay({ bounds, zIndex }: { bounds: CharacterPartBounds; zIndex: number }) {
  return (
    <div
      className="pointer-events-none absolute border border-dashed border-primary/70 bg-primary/10"
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        borderRadius: bounds.type === "ellipse" ? "9999px" : 4,
        zIndex,
      }}
    />
  );
}

type ResizeCorner = "nw" | "ne" | "sw" | "se";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded border border-border bg-background px-2 py-1"
      />
    </Field>
  );
}

interface PreviewState {
  kind: "blink" | "talk" | "wave" | "kick" | "nod" | "bounce" | "raise";
  targetPartId: string;
  targetSlotId: string;
  targetRole: PartRole;
  startedAt: number;
  durationMs: number;
  visemes?: MouthViseme[];
  /** When set, "talk" shows exactly this viseme (live audio-driven test). */
  forcedViseme?: MouthViseme;
  /** Audio drives the preview frame-by-frame; lifetime is managed by playback. */
  audioDriven?: boolean;
}

function previewLabels(part: CharacterPart): Array<{ kind: PreviewState["kind"]; label: string }> {
  const out: Array<{ kind: PreviewState["kind"]; label: string }> = [];
  if (part.role === "eye" || (part.role === "custom" && part.motionBehavior === "blink"))
    out.push({ kind: "blink", label: "Test Blink" });
  if (part.role === "mouth" || (part.role === "custom" && part.motionBehavior === "lipSync"))
    out.push({ kind: "talk", label: "Test Talk" });
  if (part.role === "arm") out.push({ kind: "wave", label: "Test Wave" });
  if (part.role === "leg" || part.role === "foot") out.push({ kind: "kick", label: "Test Kick" });
  if (part.role === "custom" && part.motionBehavior === "rotate")
    out.push({ kind: "wave", label: "Test Wave" });
  if (part.role === "head") out.push({ kind: "nod", label: "Test Nod" });
  if (part.role === "hair" || (part.role === "custom" && part.motionBehavior === "bounce"))
    out.push({ kind: "bounce", label: "Test Bounce" });
  if (part.role === "eyebrow" || (part.role === "custom" && part.motionBehavior === "raise"))
    out.push({ kind: "raise", label: "Test Raise" });
  return out;
}

function editorPartPivot(part: CharacterPart) {
  return (
    part.pivot ?? {
      x: part.x + part.width * part.anchorX,
      y: part.y + part.height * part.anchorY,
    }
  );
}

function rotateCanvasPointAroundPivot(
  point: { x: number; y: number },
  pivot: { x: number; y: number },
  degrees: number,
) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const relX = point.x - pivot.x;
  const relY = point.y - pivot.y;
  return {
    x: pivot.x + relX * cos - relY * sin,
    y: pivot.y + relX * sin + relY * cos,
  };
}

function editorTransformPointAroundPivot(
  point: { x: number; y: number },
  pivot: { x: number; y: number },
  motion: { dx: number; dy: number; scale: number; rotation: number },
) {
  const radians = (motion.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const relX = (point.x - pivot.x) * motion.scale;
  const relY = (point.y - pivot.y) * motion.scale;
  return {
    x: pivot.x + motion.dx + relX * cos - relY * sin,
    y: pivot.y + motion.dy + relX * sin + relY * cos,
  };
}

function previewDelta(
  part: CharacterPart,
  preview: PreviewState | null,
  previewParentPart?: CharacterPart,
  allParts: CharacterPart[] = [],
) {
  if (!preview) return { dx: 0, dy: 0, rotation: 0, scale: 1, scaleY: 1, opacity: 1 };
  const targetsPart = part.id === preview.targetPartId || part.slotId === preview.targetSlotId;
  const elapsed = Date.now() - preview.startedAt;
  const t = Math.min(1, elapsed / preview.durationMs);
  const wave = Math.sin(t * Math.PI * 2);
  if (!targetsPart) {
    const ancestor =
      previewTargetAncestor(part, preview, allParts) ??
      (isLegacyHeadPreviewChild(part, preview) ? previewParentPart : undefined);
    const motion = ancestor ? previewMotionForPart(ancestor, preview, t, wave) : null;
    if (!ancestor || !motion || !hasGeometricPreviewMotion(motion)) {
      return { dx: 0, dy: 0, rotation: 0, scale: 1, scaleY: 1, opacity: 1 };
    }
    const childPivot = editorPartPivot(part);
    const transformedPivot = editorTransformPointAroundPivot(
      childPivot,
      editorPartPivot(ancestor),
      motion,
    );
    return {
      dx: transformedPivot.x - childPivot.x,
      dy: transformedPivot.y - childPivot.y,
      rotation: motion.rotation,
      scale: 1,
      scaleY: 1,
      opacity: 1,
    };
  }
  return previewMotionForPart(part, preview, t, wave);
}

function activePreviewVariantForPart(
  part: CharacterPart,
  preview: PreviewState | null,
): string | undefined {
  if (!preview || preview.targetSlotId !== getPartSlotId(part)) return undefined;
  if (preview.kind === "blink" && part.role === "eye") {
    const elapsed = Date.now() - preview.startedAt;
    const t = Math.min(1, elapsed / preview.durationMs);
    return t > 0.35 && t < 0.55 ? "closed" : "open";
  }
  if (preview.kind === "talk" && part.role === "mouth") {
    if (preview.forcedViseme) return preview.forcedViseme;
    const elapsed = Date.now() - preview.startedAt;
    const t = Math.min(1, elapsed / preview.durationMs);
    const visemes = preview.visemes ?? ["rest", "A", "E", "O", "MBP"];
    const idx = Math.floor(t * visemes.length * 1.1) % visemes.length;
    return visemes[idx];
  }
  return undefined;
}

function defaultVariantForSlotParts(parts: CharacterPart[], role: PartRole): string | undefined {
  const visible = parts.filter((part) => part.visible);
  const candidates = visible.length ? visible : parts;
  if (role === "mouth") {
    const rest = candidates.find((part) => partMatchesVariant(part, "rest"));
    if (rest) return variantKeyForPart(rest);
  }
  if (role === "eye") {
    const open = candidates.find((part) => partMatchesVariant(part, "open"));
    if (open) return variantKeyForPart(open);
  }
  const first = candidates.slice().sort((a, b) => a.zIndex - b.zIndex)[0];
  return first ? variantKeyForPart(first) : undefined;
}

function previewMotionForPart(part: CharacterPart, preview: PreviewState, t: number, wave: number) {
  if (preview.kind === "blink" && part.role === "eye") {
    const closedMoment = t > 0.35 && t < 0.55;
    if (part.eyeState || part.variant) {
      const target = closedMoment ? "closed" : "open";
      const shouldShow = partMatchesVariant(part, target);
      return { dx: 0, dy: 0, rotation: 0, scale: 1, scaleY: 1, opacity: shouldShow ? 1 : 0 };
    }
    return { dx: 0, dy: 0, rotation: 0, scale: 1, scaleY: closedMoment ? 0.12 : 1, opacity: 1 };
  }
  if (preview.kind === "wave" && (part.role === "arm" || part.motionBehavior === "rotate")) {
    return { dx: 0, dy: 0, rotation: wave * 18, scale: 1, opacity: 1 };
  }
  if (preview.kind === "kick" && (part.role === "leg" || part.role === "foot")) {
    return {
      dx: Math.round(Math.abs(wave) * 10),
      dy: 0,
      rotation: wave * 12,
      scale: 1,
      opacity: 1,
    };
  }
  if (preview.kind === "nod" && part.role === "head") {
    return { dx: 0, dy: Math.round(Math.abs(wave) * 8), rotation: wave * 3, scale: 1, opacity: 1 };
  }
  if (preview.kind === "bounce" && part.role === "hair") {
    return { dx: 0, dy: Math.round(wave * 6), rotation: wave * 2, scale: 1, opacity: 1 };
  }
  if (preview.kind === "raise" && part.role === "eyebrow") {
    return { dx: 0, dy: Math.round(-Math.abs(wave) * 12), rotation: 0, scale: 1, opacity: 1 };
  }
  if (preview.kind === "talk" && part.role === "mouth") {
    const active =
      preview.forcedViseme ??
      (() => {
        const visemes = preview.visemes ?? ["rest", "A", "E", "O", "MBP"];
        const idx = Math.floor(t * visemes.length * 1.1) % visemes.length;
        return visemes[idx];
      })();
    return {
      dx: 0,
      dy: 0,
      rotation: 0,
      scale: 1,
      opacity: !part.variant && !part.viseme ? 1 : partMatchesVariant(part, active) ? 1 : 0,
    };
  }
  return { dx: 0, dy: 0, rotation: 0, scale: 1, opacity: 1 };
}

function isLegacyHeadPreviewChild(part: CharacterPart, preview: PreviewState) {
  return (
    preview.kind === "nod" &&
    preview.targetRole === "head" &&
    (part.role === "eye" ||
      part.role === "eyebrow" ||
      part.role === "mouth" ||
      part.role === "hair")
  );
}

function hasGeometricPreviewMotion(motion: ReturnType<typeof previewMotionForPart>) {
  return (
    motion.dx !== 0 ||
    motion.dy !== 0 ||
    motion.rotation !== 0 ||
    motion.scale !== 1 ||
    (motion.scaleY ?? motion.scale) !== 1
  );
}

function previewTargetAncestor(
  part: CharacterPart,
  preview: PreviewState,
  allParts: CharacterPart[],
): CharacterPart | undefined {
  const byId = new Map(allParts.map((candidate) => [candidate.id, candidate]));
  let current = part.parentId ? byId.get(part.parentId) : undefined;
  const seen = new Set<ID>();
  while (current && !seen.has(current.id)) {
    if (current.id === preview.targetPartId || current.slotId === preview.targetSlotId) {
      return current;
    }
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return undefined;
}

function wordToVisemes(word: string): MouthViseme[] {
  const map: Record<string, MouthViseme> = {
    a: "A",
    e: "E",
    i: "E",
    o: "O",
    u: "U",
    m: "MBP",
    b: "MBP",
    p: "MBP",
    f: "FV",
    v: "FV",
    l: "L",
    w: "WQ",
    q: "WQ",
  };
  return [
    "rest",
    ...word
      .toLowerCase()
      .split("")
      .map((ch) => map[ch] ?? "E"),
    "rest",
  ];
}

function fitAsset(width = 0, height = 0, canvasWidth: number, canvasHeight: number) {
  const sourceWidth = width > 0 ? width : 240;
  const sourceHeight = height > 0 ? height : 240;
  const ratio = Math.min(1, (canvasWidth * 0.7) / sourceWidth, (canvasHeight * 0.7) / sourceHeight);
  const w = Math.max(16, Math.round(sourceWidth * ratio));
  const h = Math.max(16, Math.round(sourceHeight * ratio));
  return {
    x: Math.round((canvasWidth - w) / 2),
    y: Math.round((canvasHeight - h) / 2),
    width: w,
    height: h,
  };
}

function detectRole(filename: string): PartRole {
  const name = filename.toLowerCase();
  if (name.includes("head")) return "head";
  if (name.includes("body") || name.includes("torso")) return "body";
  if (name.includes("iris") || name.includes("pupil")) return "iris";
  if (name.includes("eye") && !name.includes("brow")) return "eye";
  if (name.includes("brow") || name.includes("eyebrow")) return "eyebrow";
  if (name.includes("nose")) return "nose";
  if (name.includes("mouth") || name.includes("viseme") || name.includes("lip")) return "mouth";
  if (name.includes("hand")) return "hand";
  if (name.includes("arm")) return "arm";
  if (name.includes("foot") || name.includes("feet")) return "foot";
  if (name.includes("leg")) return "leg";
  if (name.includes("hair")) return "hair";
  if (name.includes("hat") || name.includes("glasses") || name.includes("accessory"))
    return "accessory";
  return "custom";
}

function detectSide(filename: string): CharacterPart["side"] {
  const name = filename.toLowerCase();
  if (/(^|[_\-\s])left|_l\b|-l\b/.test(name)) return "left";
  if (/(^|[_\-\s])right|_r\b|-r\b/.test(name)) return "right";
  if (name.includes("front")) return "front";
  if (name.includes("back")) return "back";
  return undefined;
}

function detectViseme(filename: string): MouthViseme | undefined {
  const name = filename.toLowerCase();
  const found = MOUTH_VISEMES.find((v) => name.includes(v.toLowerCase()));
  if (found) return found;
  if (name.includes("rest")) return "rest";
  if (name.includes("smile")) return "Smile";
  return undefined;
}

function detectEyeState(filename: string): EyeState | undefined {
  const name = filename.toLowerCase();
  if (name.includes("closed") || name.includes("blink")) return "closed";
  if (name.includes("half")) return "half";
  if (name.includes("wink")) return "wink";
  if (name.includes("open")) return "open";
  return "open";
}

function detectVariantKey(
  filename: string,
  role: PartRole,
  side: CharacterPart["side"],
): string | undefined {
  const stem = filename.replace(/\.[^.]+$/i, "");
  const tokens = stem.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const ignored = new Set(["svg", "image", "asset", "part"]);
  if (side) ignored.add(side);
  if (side === "left") ignored.add("l");
  if (side === "right") ignored.add("r");
  for (const token of roleIgnoredTokens(role)) ignored.add(token);
  const kept = tokens.filter((token) => !ignored.has(token.toLowerCase()));
  return kept.length ? slug(kept.join("-")) : undefined;
}

function roleIgnoredTokens(role: PartRole): string[] {
  switch (role) {
    case "head":
      return ["head"];
    case "body":
      return ["body", "torso"];
    case "eye":
      return ["eye", "eyes"];
    case "iris":
      return ["iris", "pupil"];
    case "eyebrow":
      return ["brow", "eyebrow"];
    case "nose":
      return ["nose"];
    case "mouth":
      return ["mouth", "lip", "lips", "viseme"];
    case "arm":
      return ["arm"];
    case "hand":
      return ["hand"];
    case "leg":
      return ["leg"];
    case "foot":
      return ["foot", "feet"];
    case "hair":
      return ["hair"];
    case "accessory":
      return ["accessory", "prop"];
    case "static":
      return ["static"];
    case "custom":
      return ["custom"];
  }
}

function defaultVariantKindForRole(
  role: PartRole,
  viseme: MouthViseme | undefined,
  eyeState: EyeState | undefined,
): CharacterVariantKind {
  if (viseme) return "viseme";
  if (eyeState) return "eyeState";
  if (role === "hand") return "handShape";
  if (role === "mouth") return "mouthShape";
  return role === "eye" ? "eyeState" : "pose";
}

function slotIdForImport(
  role: PartRole,
  label: string,
  viseme: MouthViseme | undefined,
  id: ID,
  side: CharacterPart["side"],
) {
  if (role === "mouth") return "role:mouth";
  if (role === "eye" && (side === "left" || side === "right")) return `slot:${side}-eye`;
  if (role === "iris" && (side === "left" || side === "right")) return `slot:${side}-iris`;
  if (role === "nose") return "role:nose";
  if (role === "custom") return `custom:${id}`;
  return `slot:${slug(label || role)}${viseme ? `:${viseme}` : ""}`;
}

function slug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "part"
  );
}

function maxZ(parts: CharacterPart[]) {
  return parts.reduce((max, part) => Math.max(max, part.zIndex), 0);
}

/** Axis-aligned union of the parts' frame rectangles, in canvas space. */
function unionFrameBounds(parts: CharacterPart[]) {
  const minX = Math.min(...parts.map((p) => p.x));
  const minY = Math.min(...parts.map((p) => p.y));
  const maxX = Math.max(...parts.map((p) => p.x + p.width));
  const maxY = Math.max(...parts.map((p) => p.y + p.height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

// Union of the parts' tight visible-pixel bounds (ignores transparent layer padding) in canvas
// coords. Used to size the movement-range zone to actual art, not the full layer frame.
function unionAlphaBounds(parts: CharacterPart[]) {
  const rects = parts.map((p) => {
    const a = localAlphaBounds(p);
    return { x: p.x + a.x, y: p.y + a.y, right: p.x + a.x + a.width, bottom: p.y + a.y + a.height };
  });
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.right));
  const maxY = Math.max(...rects.map((r) => r.bottom));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function moveSlotSetFromSnapshot(
  parts: CharacterPart[],
  snapshot: Array<{ id: ID; x: number; y: number; pivot: { x: number; y: number } }>,
  slotIds: Set<ID>,
  dx: number,
  dy: number,
): CharacterPart[] {
  const snapshotById = new Map(snapshot.map((part) => [part.id, part]));
  return parts.map((part) => {
    if (!slotIds.has(getPartSlotId(part))) return part;
    const start = snapshotById.get(part.id);
    if (!start) return part;
    return {
      ...part,
      x: start.x + dx,
      y: start.y + dy,
      pivot: { x: start.pivot.x + dx, y: start.pivot.y + dy },
    };
  });
}

function clampSlotDeltaToHost(
  character: CharacterPreset,
  rig: CharacterRig,
  slotId: ID,
  dx: number,
  dy: number,
): { dx: number; dy: number; clamped: boolean } {
  const constraint = rig.hostConstraints.find((entry) => entry.slotId === slotId);
  if (!constraint || constraint.reachPolicy === "allow" || constraint.mode === "reach") {
    return { dx, dy, clamped: false };
  }
  const hostSlotId = constraint.hostSlotId;
  if (!hostSlotId || hostSlotId === slotId) return { dx, dy, clamped: false };
  const slotParts = character.parts.filter((part) => getPartSlotId(part) === slotId);
  const hostParts = character.parts.filter((part) => getPartSlotId(part) === hostSlotId);
  if (slotParts.length === 0 || hostParts.length === 0) return { dx, dy, clamped: false };

  const subject = unionAlphaBounds(slotParts);
  const host = unionAlphaBounds(hostParts);
  const next = clampRectInsideHost(subject, host, dx, dy);
  return { ...next, clamped: next.dx !== dx || next.dy !== dy };
}

function clampRectInsideHost(
  subject: { x: number; y: number; width: number; height: number },
  host: { x: number; y: number; width: number; height: number },
  dx: number,
  dy: number,
): { dx: number; dy: number } {
  let nextDx = dx;
  let nextDy = dy;

  if (subject.width > host.width) {
    const subjectCenter = subject.x + subject.width / 2 + nextDx;
    const hostCenter = host.x + host.width / 2;
    nextDx += hostCenter - subjectCenter;
  } else {
    if (subject.x + nextDx < host.x) nextDx += host.x - (subject.x + nextDx);
    if (subject.x + subject.width + nextDx > host.x + host.width) {
      nextDx -= subject.x + subject.width + nextDx - (host.x + host.width);
    }
  }

  if (subject.height > host.height) {
    const subjectCenter = subject.y + subject.height / 2 + nextDy;
    const hostCenter = host.y + host.height / 2;
    nextDy += hostCenter - subjectCenter;
  } else {
    if (subject.y + nextDy < host.y) nextDy += host.y - (subject.y + nextDy);
    if (subject.y + subject.height + nextDy > host.y + host.height) {
      nextDy -= subject.y + subject.height + nextDy - (host.y + host.height);
    }
  }

  return { dx: Math.round(nextDx), dy: Math.round(nextDy) };
}

function descendantPartIds(parts: CharacterPart[], parentIds: Set<ID>): Set<ID> {
  const out = new Set<ID>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const part of parts) {
      if (out.has(part.id)) continue;
      if (part.parentId && (parentIds.has(part.parentId) || out.has(part.parentId))) {
        out.add(part.id);
        changed = true;
      }
    }
  }
  return out;
}

function partAndDescendantIdsForSlot(parts: CharacterPart[], slotId: ID): Set<ID> {
  const rootIds = new Set(
    parts.filter((part) => getPartSlotId(part) === slotId).map((part) => part.id),
  );
  return new Set([...rootIds, ...descendantPartIds(parts, rootIds)]);
}

function normalizePartPatch(part: CharacterPart, patch: Partial<CharacterPart>): CharacterPart {
  const pivot =
    patch.x !== undefined ||
    patch.y !== undefined ||
    patch.width !== undefined ||
    patch.height !== undefined ||
    patch.alphaBounds !== undefined
      ? (part.pivot ?? alphaCenterForPart(part))
      : part.pivot;
  const anchorX = pivot ? clamp((pivot.x - part.x) / Math.max(1, part.width), 0, 1) : part.anchorX;
  const anchorY = pivot ? clamp((pivot.y - part.y) / Math.max(1, part.height), 0, 1) : part.anchorY;
  return {
    ...part,
    anchorX,
    anchorY,
    pivot,
    variant: normalizePartVariant(part),
    motionBehavior: part.motionBehavior ?? defaultMotionBehaviorForRole(part.role, part.viseme),
  };
}

const EYE_COLOR_PRESETS = [
  { label: "Black", value: "#1a1a1a" },
  { label: "Brown", value: "#6b4423" },
  { label: "Blue", value: "#1e40af" },
  { label: "Green", value: "#15803d" },
  { label: "Hazel", value: "#a67c52" },
] as const;

const MOUTH_COLOR_PRESETS = [
  { label: "Pink", value: "#e88a9a" },
  { label: "Rose", value: "#d05d6e" },
  { label: "Red", value: "#c0392b" },
  { label: "Deep red", value: "#8b2230" },
  { label: "Dark gray", value: "#4a4146" },
] as const;

function EyePresetSelector({
  onImport,
  canvasWidth,
  canvasHeight,
}: {
  onImport: (file: File, options?: ImportOptions) => void;
  canvasWidth: number;
  canvasHeight: number;
}) {
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState("#1a1a1a");
  const [customColor, setCustomColor] = useState("#1a1a1a");

  const handleApply = async () => {
    if (!selectedPreset) return;
    const preset = EYE_PRESETS.find((p) => p.id === selectedPreset);
    if (!preset) return;

    const color = customColor;
    const eyeStates: EyeState[] = ["open", "half", "closed", "wink"];
    const eyeWidth = Math.round(canvasWidth * 0.095);
    const eyeHeight = Math.round(eyeWidth * 0.68);
    const eyeY = Math.round(canvasHeight * 0.28 - eyeHeight / 2);
    const placementForSide = (side: "left" | "right") => {
      const centerX = Math.round(canvasWidth * (side === "left" ? 0.58 : 0.42));
      const centerY = Math.round(eyeY + eyeHeight / 2);
      return {
        x: Math.round(centerX - eyeWidth / 2),
        y: eyeY,
        width: eyeWidth,
        height: eyeHeight,
        pivot: { x: centerX, y: centerY },
      };
    };

    for (const side of ["left", "right"] as const) {
      for (const eyeState of eyeStates) {
        const svg = preset.generateForState(eyeState, color);
        const file = await generatePresetBlob(svg, `eye-${side}-${eyeState}.svg`);
        onImport(file, {
          role: "eye",
          side,
          eyeState,
          label: `${side === "left" ? "Left" : "Right"} ${eyeState}`,
          slotId: `slot:${side}-eye`,
          placement: placementForSide(side),
          zIndex: 50,
        });
      }
    }
    setSelectedPreset(null);
  };

  if (selectedPreset) {
    const preset = EYE_PRESETS.find((p) => p.id === selectedPreset);
    return (
      <div className="mb-3 rounded border border-primary/50 bg-primary/10 p-2">
        <div className="mb-2 text-[11px] font-medium">Configure {preset?.label} eyes</div>
        <div className="mb-2">
          <label className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">
            Color
          </label>
          <div className="flex gap-1 mb-2">
            {EYE_COLOR_PRESETS.map((color) => (
              <button
                key={color.value}
                type="button"
                onClick={() => {
                  setSelectedColor(color.value);
                  setCustomColor(color.value);
                }}
                className={`h-6 w-6 rounded border-2 ${
                  selectedColor === color.value ? "border-foreground" : "border-border"
                }`}
                style={{ backgroundColor: color.value }}
                title={color.label}
              />
            ))}
          </div>
          <div className="flex gap-1 items-center">
            <label className="text-[10px] text-muted-foreground">Custom:</label>
            <input
              type="color"
              value={customColor}
              onChange={(e) => {
                setCustomColor(e.target.value);
                setSelectedColor(e.target.value);
              }}
              className="h-6 w-10 cursor-pointer rounded border border-border"
            />
            <input
              type="text"
              value={customColor}
              onChange={(e) => {
                if (e.target.value.match(/^#[0-9a-f]{6}$/i)) {
                  setCustomColor(e.target.value);
                  setSelectedColor(e.target.value);
                }
              }}
              placeholder="#000000"
              className="text-[10px] rounded border border-border bg-background px-1 py-0.5 w-20"
            />
          </div>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={handleApply}
            className="flex-1 rounded bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:opacity-90"
          >
            Add all states
          </button>
          <button
            type="button"
            onClick={() => setSelectedPreset(null)}
            className="rounded border border-border px-2 py-1 text-[10px] hover:bg-panel"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3">
      <div className="mb-1 text-[10px] text-muted-foreground">Quick presets:</div>
      <div className="grid grid-cols-3 gap-1">
        {EYE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => {
              setSelectedPreset(preset.id);
              setCustomColor("#1a1a1a");
              setSelectedColor("#1a1a1a");
            }}
            className="rounded border border-border bg-panel px-2 py-1 text-[10px] hover:bg-primary/10"
            title={`Use ${preset.label} eye`}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MouthPresetSelector({
  onImport,
}: {
  onImport: (file: File, options?: ImportOptions) => void;
}) {
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState("#c0392b");
  const [customColor, setCustomColor] = useState("#c0392b");

  const handleApply = async () => {
    if (!selectedPreset) return;
    const preset = MOUTH_PRESETS.find((p) => p.id === selectedPreset);
    if (!preset) return;

    const color = customColor;

    for (const viseme of MOUTH_VISEMES) {
      const svg = preset.generateForViseme(viseme, color);
      const file = await generatePresetBlob(svg, `mouth-${viseme}.svg`);
      onImport(file, {
        role: "mouth",
        viseme,
        label: `Mouth ${viseme}`,
        slotId: "role:mouth",
        zIndex: 60,
      });
    }
    setSelectedPreset(null);
  };

  if (selectedPreset) {
    const preset = MOUTH_PRESETS.find((p) => p.id === selectedPreset);
    return (
      <div className="mb-3 rounded border border-primary/50 bg-primary/10 p-2">
        <div className="mb-2 text-[11px] font-medium">Configure {preset?.label} mouth</div>
        <div className="mb-2">
          <label className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">
            Color
          </label>
          <div className="flex gap-1 mb-2">
            {MOUTH_COLOR_PRESETS.map((color) => (
              <button
                key={color.value}
                type="button"
                onClick={() => {
                  setSelectedColor(color.value);
                  setCustomColor(color.value);
                }}
                className={`h-6 w-6 rounded border-2 ${
                  selectedColor === color.value ? "border-foreground" : "border-border"
                }`}
                style={{ backgroundColor: color.value }}
                title={color.label}
              />
            ))}
          </div>
          <div className="flex gap-1 items-center">
            <label className="text-[10px] text-muted-foreground">Custom:</label>
            <input
              type="color"
              value={customColor}
              onChange={(e) => {
                setCustomColor(e.target.value);
                setSelectedColor(e.target.value);
              }}
              className="h-6 w-10 cursor-pointer rounded border border-border"
            />
            <input
              type="text"
              value={customColor}
              onChange={(e) => {
                if (e.target.value.match(/^#[0-9a-f]{6}$/i)) {
                  setCustomColor(e.target.value);
                  setSelectedColor(e.target.value);
                }
              }}
              placeholder="#000000"
              className="text-[10px] rounded border border-border bg-background px-1 py-0.5 w-20"
            />
          </div>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={handleApply}
            className="flex-1 rounded bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:opacity-90"
          >
            Add all visemes
          </button>
          <button
            type="button"
            onClick={() => setSelectedPreset(null)}
            className="rounded border border-border px-2 py-1 text-[10px] hover:bg-panel"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3">
      <div className="mb-1 text-[10px] text-muted-foreground">Quick presets:</div>
      <div className="grid grid-cols-2 gap-1">
        {MOUTH_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => {
              setSelectedPreset(preset.id);
              setCustomColor("#c0392b");
              setSelectedColor("#c0392b");
            }}
            className="rounded border border-border bg-panel px-2 py-1 text-[10px] hover:bg-primary/10"
            title={`Use ${preset.label} mouth`}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
