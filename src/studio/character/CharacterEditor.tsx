import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { clamp } from "./mouth-morph";
import {
  type DrillPick,
  exceedsDragThreshold,
  resolveDragSubject,
  resolveDrillSelection,
} from "../interaction/select-drag";
import { startWindowPointerDrag } from "../interaction/pointer-drag";
import { ChevronDown, ChevronRight, Eye, EyeOff, Lock, RotateCw, Redo2, Undo2 } from "lucide-react";
import { db, getMediaUrl, importMediaFile, uid } from "../db";
import { useStudio } from "../store";
import {
  createBlankCharacter,
  defaultSlotIdForRole,
  defaultMotionBehaviorForRole,
  defaultVariantForSlotParts,
  findCharacterSlot,
  getPartSlotId,
  makePart,
  normalizeCharacterSlots,
  normalizePartVariant,
  partMatchesVariant,
  roleLabel,
  slotLabelForRoleSide,
  withUpdatedCharacterSlot,
  claimSharedPartsForAngles,
  partAvailableForAngle,
  removePartFromAngle,
  saveCharacter,
  variantKeyForPart,
  variantLabelForPart,
} from "./character-utils";
import { TransformMoveable } from "../interaction/TransformMoveable";
import type { ScreenRect } from "../interaction/transform-box";
import {
  anchorSourceForChild,
  buildRigHealthReport,
  collectVariantKeyIssues,
  migrateLegacyVariantSockets,
  renameVariantKeyEverywhere,
  variantPreviewDeltas,
  type RigHealthReport,
  type VariantKeyIssue,
  type VariantPreviewShift,
} from "./variant-pairing";
import { planVariantAlign } from "./variant-align";
import { smartImportPlacement } from "./placement-guide";
import { planMirrorSlot, type MirrorSlotPlan } from "./mirror-parts";
import { parentSlotIdForBone } from "./motion-constraints";
import {
  applyPosePreset,
  capturePosePreset,
  defaultPosePresetForCharacter,
  poseMatchesPreview,
  posePresetsForAngle,
  seedDefaultPosePreset,
} from "./pose-presets";
import {
  alphaMaskContains,
  alphaCenterForPart,
  createAlphaHitMaskFromBlob,
  editorControlBounds,
  editorSelectionBounds,
  localAuthoredBounds,
  localAlphaBounds,
  localRectCanvasBounds,
  measureAlphaBoundsFromBlob,
  pivotForPart,
  pointInEditorHitBounds,
  type AlphaHitMask,
} from "./alpha-bounds";
import {
  composeMatrices,
  invertMatrix,
  matrixAroundPoint,
  rectCorners,
  transformPoint,
  transformVector,
  translationMatrix,
} from "./geometry";
import type {
  CharacterAngle,
  CharacterPart,
  CharacterPartBounds,
  CharacterPartDeform,
  CharacterPosePreset,
  CharacterPreset,
  CharacterRig,
  CharacterSlot,
  ID,
  MouthViseme,
  PartRole,
} from "../types";
import {
  ANGLE_LABELS,
  CHARACTER_ANGLES,
  availableCharacterAngles,
  buildDefaultRig,
  rebuildRigPreservingConstraints,
  normalizeCharacterRig,
  parentSlotIdForSlot,
  resolveSlotBinding,
  setSlotReach,
  setSlotRotReach,
  slotIdsForBoneSubtree,
  clampMotionDeltaToReach,
} from "./rig";
import {
  buildCharacterRuntime,
  runtimeBoneWorldTransforms,
  runtimePartPlacement,
  type CharacterRuntime,
  type RuntimePartPlacement,
} from "./runtime";
import { buildCharacterRenderPayload } from "./composition";
import { PixiCharacterPreview } from "./PixiCharacterPreview";
import { limbPathBendSide, type CharacterSceneAsset } from "./scene";
import { limbPathPointAt, limbPathProjectPointT } from "./mesh-deform";
import {
  applyCharacterSceneCommand,
  rotatePointAroundAnchor,
  type CharacterSceneCommand,
} from "./scene-commands";
import { runtimeAncestorMotionTargets } from "./motion-targets";
import { CharacterPinRigError, upgradeCharacterRigV2, validateCharacterPinRig } from "./rig-v2";
import { AddPartMenu } from "./CharacterArtworkImport";
import { CharacterLayerList } from "./CharacterLayerList";
import {
  GroupInspector,
  Inspector,
  RestrictMovementPanel,
  type EditorBoundsMode,
  type EditorMode,
} from "./CharacterInspectorPanels";
import { CanvasSection, SkeletonCard } from "./CharacterRigSetupControls";
import { ANCHOR_SOURCE_COLORS, RigHealthPanel } from "./CharacterVariantControls";
import {
  defaultImportedVariantKind,
  detectImportedEyeState,
  detectImportedPartRole,
  detectImportedPartSide,
  detectImportedVariantKey,
  detectImportedViseme,
  fitImportedPartToCanvas,
  maxPartZIndex,
  slotIdForImportedPart,
  type CharacterPartImportOptions,
} from "./character-part-import";
import { wordToVisemes, type PreviewState } from "./character-editor-preview";

interface Props {
  characterId: string;
  onClose: () => void;
}

interface RenderBlockingRigFix {
  issue: string;
  parentSlotId: ID;
  parentSlotName: string;
  parentVariantKey: string;
  childSlotId: ID;
  childSlotName: string;
  instructions: string;
}

async function resolveCharacterEditorPreviewAssetRef(
  asset: CharacterSceneAsset,
): Promise<string | null> {
  return getMediaUrl(asset.id);
}

function renderBlockingRigFixForIssue(
  doc: CharacterPreset,
  issue: { path: string; message: string },
): RenderBlockingRigFix | null {
  const match = issue.path.match(/^parts\.([^.]+)\.pins\.(.+)$/);
  if (!match) return null;
  const [, parentPartId, pinName] = match;
  const childSlotId = pinName.startsWith("attach:") ? pinName.slice("attach:".length) : null;
  const parentPart = doc.parts.find((part) => part.id === parentPartId);
  if (!parentPart || !childSlotId) return null;
  const parentSlotId = getPartSlotId(parentPart);
  const parentSlotName = findCharacterSlot(doc, parentSlotId)?.name ?? parentPart.name;
  const childSlotName = findCharacterSlot(doc, childSlotId)?.name ?? childSlotId;
  const parentVariantKey = variantKeyForPart(parentPart);
  return {
    issue: issue.message,
    parentSlotId,
    parentSlotName,
    parentVariantKey,
    childSlotId,
    childSlotName,
    instructions: `Click the point on ${parentSlotName} (${parentVariantKey}) where ${childSlotName} should attach.`,
  };
}

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

type BoneDragMode = "calibrate" | "moveArt";

/** Focus-mode state while editing a layer's reach (sweep the layer to trace its limit). */
interface RangeEdit {
  slotId: ID;
}
export function CharacterEditor({ characterId, onClose }: Props) {
  const mediaAssets = useStudio((state) => state.mediaAssets);
  const [doc, setDoc] = useState<CharacterPreset | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<ID | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<ID | null>(null);
  const [selectedBoneId, setSelectedBoneId] = useState<ID | null>(null);
  const [showBones, setShowBones] = useState(false);
  const [boneDragMode, setBoneDragMode] = useState<BoneDragMode>("calibrate");
  const [scale, setScale] = useState(0.7);
  const [mode, setMode] = useState<EditorMode>("select");
  // Default to visible-art hit-testing: a click selects a layer by its actual pixels (plus a
  // small halo), not its whole transparent registration frame, so clicking empty space
  // between overlapping layers no longer grabs the wrong one. Toggle back to "frame" anytime.
  const [boundsMode, setBoundsMode] = useState<EditorBoundsMode>("art");
  // Focus mode for editing a layer's reach (hides bones/chrome, shows the traced reach outline).
  const [rangeEdit, setRangeEdit] = useState<RangeEdit | null>(null);
  // Focus mode for editing a flexible part's mesh path (joint/end/curve points).
  // While set, the part/group drag chrome is NOT rendered, so the path knobs
  // never compete with the move box for pointer events. Keyed by part id so
  // changing selection exits automatically.
  const [meshEditPartId, setMeshEditPartId] = useState<ID | null>(null);
  // The traced reach outline as absolute canvas points (convex hull), while editing.
  const [reachDraft, setReachDraft] = useState<{ x: number; y: number }[] | null>(null);
  // Live rotation reach (min/max degrees from rest) while twisting the layer.
  const [rotDraft, setRotDraft] = useState<{ min: number; max: number } | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  // True while a layer is actively being dragged / resized / rotated, so the other layers
  // can blur to keep focus on it. Set at gesture start; cleared globally on pointerup below.
  const [interacting, setInteracting] = useState(false);
  const [previewTick, setPreviewTick] = useState(0);
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
      const normalized = normalizeCharacterSlots(row);
      // One-time: legacy sockets become variant-local output pins; autosave persists rig v2.
      const migrated = upgradeCharacterRigV2(migrateLegacyVariantSockets(normalized));
      // A character should never sit in a non-pose: seed a "Standing" default once (the
      // autosave persists it), then park the editor on the default pose.
      const seeded = seedDefaultPosePreset(migrated) ?? migrated;
      setDoc({ ...seeded, rig: normalizeCharacterRig(seeded) });
      const defaultPose = defaultPosePresetForCharacter(seeded);
      setVariantPreview(defaultPose ? applyPosePreset(seeded, defaultPose) : {});
      setActivePoseId(defaultPose?.id ?? null);
      setEditorPhase(seeded.parts.length === 0 ? "build" : "pose");
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

  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  useEffect(() => {
    if (!doc) return;
    setSaveState("saving");
    const t = window.setTimeout(() => {
      void saveCharacter(doc).then((saved) => {
        useStudio.getState().registerCharacterPreset(saved);
        setSaveState("saved");
      });
    }, 450);
    return () => window.clearTimeout(t);
  }, [doc]);

  // Per-part variant key problems (near-miss pairing, id-fallback keys) surfaced as chips/dots.
  const variantKeyIssues = useMemo(
    () => (doc ? collectVariantKeyIssues(doc) : new Map<ID, VariantKeyIssue[]>()),
    [doc],
  );

  // The editor works in three phases: Build (get art in), Rig (skeleton & limits), Pose
  // (variants & poses). Phases change which panels/overlays show — never which gestures exist.
  const [editorPhase, setEditorPhase] = useState<"build" | "rig" | "pose">("build");
  const switchPhase = (phase: "build" | "rig" | "pose") => {
    setEditorPhase(phase);
    // Sensible overlay defaults per phase; the floating view toggles can override.
    setShowBones(phase === "rig");
    // Pins remain one click away, but do not cover the artwork while joints are aligned.
    setShowAnchors(false);
    if (phase !== "rig") setSelectedBoneId(null);
  };

  // Transient confirmations auto-dismiss; armed modes get the persistent ModeBanner instead.
  const [statusUndo, setStatusUndo] = useState(false);
  const setStatusUndoable = (text: string) => {
    setStatus(text);
    setStatusUndo(true);
  };
  useEffect(() => {
    if (!status) return;
    const t = window.setTimeout(() => {
      setStatus(null);
      setStatusUndo(false);
    }, 3500);
    return () => window.clearTimeout(t);
  }, [status]);

  // Hover identification chip state (the handler lives below with the other canvas handlers).
  const [hoverHit, setHoverHit] = useState<{ x: number; y: number; label: string } | null>(null);

  // Keyboard: Esc backs out of any armed mode (then clears selection); Delete removes the
  // selected part; arrows nudge; 1/2/3 switch phases. All no-ops while typing in a field.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      )
        return;
      if (e.key === "Escape") {
        if (pinPlacement) setPinPlacement(null);
        else if (rangeEdit) exitReachEdit();
        else if (mode !== "select") setMode("select");
        else {
          setSelectedPartId(null);
          setSelectedSlotId(null);
          setSelectedBoneId(null);
        }
        return;
      }
      if (e.key === "1") return switchPhase("build");
      if (e.key === "2") return switchPhase("rig");
      if (e.key === "3") return switchPhase("pose");
      if ((e.key === "Delete" || e.key === "Backspace") && selectedPartId) {
        e.preventDefault();
        removePart(selectedPartId);
        setStatusUndoable("Part deleted");
        return;
      }
      const nudge = e.shiftKey ? 10 : 1;
      const arrow =
        e.key === "ArrowLeft"
          ? { dx: -nudge, dy: 0 }
          : e.key === "ArrowRight"
            ? { dx: nudge, dy: 0 }
            : e.key === "ArrowUp"
              ? { dx: 0, dy: -nudge }
              : e.key === "ArrowDown"
                ? { dx: 0, dy: nudge }
                : null;
      if (arrow) {
        if (selectedPartId) {
          const part = doc?.parts.find((candidate) => candidate.id === selectedPartId);
          if (part) {
            e.preventDefault();
            updatePart(selectedPartId, { x: part.x + arrow.dx, y: part.y + arrow.dy });
          }
        } else if (selectedSlotId) {
          e.preventDefault();
          applyGroupMove(selectedSlotId, arrow.dx, arrow.dy);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // Sticky in-place variant preview per slot (arm "bent" + hand "fist" can hold together while
  // children are inspected or anchored). Display state only — never persisted.
  const [variantPreview, setVariantPreview] = useState<Record<ID, string>>({});
  // The pose preset the preview was last set from (null = Rest / manual). Display state only.
  const [activePoseId, setActivePoseId] = useState<ID | null>(null);
  // Which pose chip's "…" menu is open (toolbar popover).
  const [poseMenuId, setPoseMenuId] = useState<ID | null>(null);
  const [addAngleMenuOpen, setAddAngleMenuOpen] = useState(false);
  const [pendingDeleteAngle, setPendingDeleteAngle] = useState<CharacterAngle | null>(null);
  const [showAnchors, setShowAnchors] = useState(false);
  // One shared file picker for every "+" in the Parts rail. The armed options
  // carry slot/role/side, and smartImportPlacement drops the art in the right
  // spot (aligned with the slot's art, or into its body zone).
  const partImportInputRef = useRef<HTMLInputElement>(null);
  const pendingImportRef = useRef<CharacterPartImportOptions | null>(null);
  const variantShift = useMemo<VariantPreviewShift>(
    () =>
      doc ? variantPreviewDeltas(doc, variantPreview) : { parts: new Map(), bones: new Map() },
    [doc, variantPreview],
  );
  const previewVariant = (slotId: ID, key: string) =>
    setVariantPreview((prev) => (prev[slotId] === key ? prev : { ...prev, [slotId]: key }));
  const clearVariantPreview = (slotId?: ID) =>
    setVariantPreview((prev) => {
      if (!slotId) return {};
      if (!(slotId in prev)) return prev;
      const next = { ...prev };
      delete next[slotId];
      return next;
    });
  // Live anchor-edit drag: while a parent variant is previewed, dragging the child moves its
  // Variant output pin, not the child's rest artwork position. dx/dy are in-flight offsets.
  const [anchorDrag, setAnchorDrag] = useState<{
    childSlotId: ID;
    parentSlotId: ID;
    variantKey: string;
    dx: number;
    dy: number;
  } | null>(null);
  // One-shot "pin anchor" placement armed from the Anchor section: the next canvas click
  // writes the active parent artwork's output pin at the clicked point.
  const [pinPlacement, setPinPlacement] = useState<{
    childSlotId: ID;
    parentSlotId: ID;
    variantKey: string;
  } | null>(null);
  const rigHealthReport = useMemo<RigHealthReport>(
    () => (doc ? buildRigHealthReport(doc) : { anchorRows: [], warnings: [] }),
    [doc],
  );

  // ── Pose presets ──────────────────────────────────────────────────────────
  const activePose = useMemo(
    () =>
      doc && activePoseId
        ? (doc.posePresets?.find((preset) => preset.id === activePoseId) ?? null)
        : null,
    [doc, activePoseId],
  );
  /** The active pose as an applicable map (stale keys filtered) — null when on Rest/manual. */
  const appliedPoseMap = useMemo(
    () => (doc && activePose ? applyPosePreset(doc, activePose) : null),
    [doc, activePose],
  );
  const poseModified = useMemo(
    () => (doc && activePose ? !poseMatchesPreview(activePose, variantPreview, doc) : false),
    [doc, activePose, variantPreview],
  );

  const applyPose = (preset: CharacterPosePreset) => {
    if (!doc) return;
    setVariantPreview(applyPosePreset(doc, preset));
    setActivePoseId(preset.id);
  };
  const showRestPose = () => {
    setVariantPreview({});
    setActivePoseId(null);
  };
  // Inline naming popover (no native prompt dialogs).
  const [posePrompt, setPosePrompt] = useState<
    { kind: "new" } | { kind: "rename"; poseId: ID } | null
  >(null);
  const [posePromptValue, setPosePromptValue] = useState("");
  const savePoseAsNew = () => {
    setPosePromptValue("New pose");
    setPosePrompt({ kind: "new" });
  };
  const confirmPosePrompt = () => {
    if (!doc || !posePrompt) return;
    const name = posePromptValue.trim();
    if (!name) return;
    if (posePrompt.kind === "new") {
      const preset = capturePosePreset(doc, variantPreview, { name });
      updateDoc({ posePresets: [...(doc.posePresets ?? []), preset] });
      setActivePoseId(preset.id);
      setStatus(`Pose saved — ${name}`);
    } else {
      updateDoc({
        posePresets: (doc.posePresets ?? []).map((candidate) =>
          candidate.id === posePrompt.poseId ? { ...candidate, name } : candidate,
        ),
      });
    }
    setPosePrompt(null);
  };
  const updateActivePose = () => {
    if (!doc || !activePose) return;
    const captured = capturePosePreset(doc, variantPreview, {
      name: activePose.name,
      angleIds: activePose.angleIds,
    });
    updateDoc({
      posePresets: (doc.posePresets ?? []).map((preset) =>
        preset.id === activePose.id ? { ...captured, id: activePose.id } : preset,
      ),
    });
    setStatus(`Pose updated — ${activePose.name}`);
  };
  const renamePose = (poseId: ID) => {
    const preset = doc?.posePresets?.find((candidate) => candidate.id === poseId);
    if (!preset) return;
    setPosePromptValue(preset.name);
    setPosePrompt({ kind: "rename", poseId });
  };
  const setDefaultPose = (poseId: ID) => updateDoc({ defaultPoseId: poseId });
  const togglePoseAngleScope = (poseId: ID) => {
    if (!doc) return;
    const rig = normalizeCharacterRig(doc);
    updateDoc({
      posePresets: (doc.posePresets ?? []).map((preset) =>
        preset.id === poseId
          ? {
              ...preset,
              angleIds: preset.angleIds?.length ? undefined : [rig.activeAngle],
            }
          : preset,
      ),
    });
  };
  const deletePose = (poseId: ID) => {
    if (!doc) return;
    const remaining = (doc.posePresets ?? []).filter((preset) => preset.id !== poseId);
    updateDoc({
      posePresets: remaining,
      defaultPoseId: doc.defaultPoseId === poseId ? remaining[0]?.id : doc.defaultPoseId,
    });
    if (activePoseId === poseId) setActivePoseId(null);
  };
  /** Reset a deviating slot back to what the active pose says (or clear it). */
  const resetSlotToPose = (slotId: ID) => {
    const poseKey = appliedPoseMap?.[slotId];
    if (poseKey) previewVariant(slotId, poseKey);
    else clearVariantPreview(slotId);
  };

  const setActiveAngleFromToolbar = (activeAngle: CharacterAngle) => {
    if (!doc) return;
    const angles = availableCharacterAngles(doc);
    const addingNewAngle = !angles.includes(activeAngle);
    const nextAngles = CHARACTER_ANGLES.filter(
      (angle) => angle === activeAngle || angles.includes(angle),
    );
    pushUndoSnapshot();
    setDoc((d) => {
      if (!d) return d;
      // A new angle starts empty: implicitly-shared parts are claimed for the angles that
      // existed before, so front drawings stay on Front. Shared props opt back in explicitly.
      const claimed = addingNewAngle
        ? claimSharedPartsForAngles(d, availableCharacterAngles(d))
        : d;
      const next = {
        ...claimed,
        angles: nextAngles,
        rig: { ...normalizeCharacterRig(claimed), activeAngle },
        updatedAt: Date.now(),
      };
      return { ...next, rig: normalizeCharacterRig(next) };
    });
    if (addingNewAngle) {
      setStatus(
        `${ANGLE_LABELS[activeAngle]} starts empty — existing artwork stays on its angle. ` +
          `Upload ${ANGLE_LABELS[activeAngle]} drawings into the same slots, or mark a prop ` +
          `as Shared in its Angles row to show it on every angle.`,
      );
    }
    // Selection from another angle would point at art that is no longer on the canvas.
    const stillVisible = (partId: ID | null) => {
      const part = partId ? doc.parts.find((candidate) => candidate.id === partId) : null;
      return !!part && partAvailableForAngle(part, activeAngle);
    };
    if (selectedPartId && !stillVisible(selectedPartId)) {
      setSelectedPartId(null);
      setSelectedSlotId(null);
    } else if (
      selectedSlotId &&
      !doc.parts.some(
        (part) =>
          getPartSlotId(part) === selectedSlotId && partAvailableForAngle(part, activeAngle),
      )
    ) {
      setSelectedSlotId(null);
    }
    // variantPreview / pose stay: keys are angle-agnostic vocabulary; the new angle's own
    // skeleton and art realize the same pose (or fall back where a key has no art yet).
  };

  const deleteAngle = (angle: CharacterAngle) => {
    if (!doc) return;
    const remainingAngles = availableCharacterAngles(doc).filter((a) => a !== angle);
    if (remainingAngles.length === 0) return; // can't delete the last angle
    const fallback = remainingAngles[0];
    pushUndoSnapshot();
    setDoc((d) => {
      if (!d) return d;
      // Remove parts exclusively tagged to this angle; for parts tagged to this + others,
      // drop just this angle from the list (the part stays on its other angles).
      const parts = d.parts
        .filter((p) => {
          const ids = p.angleIds;
          return !(Array.isArray(ids) && ids.length === 1 && ids[0] === angle);
        })
        .map((p) => {
          const ids = p.angleIds;
          if (!Array.isArray(ids) || !ids.includes(angle)) return p;
          const next = ids.filter((a) => a !== angle);
          return { ...p, angleIds: next.length ? next : undefined };
        });
      // Prune rig.angles to avoid bloating the saved document with stale angle data.
      const prunedRigAngles = d.rig?.angles
        ? Object.fromEntries(Object.entries(d.rig.angles).filter(([a]) => a !== angle))
        : d.rig?.angles;
      const withFallback: CharacterPreset = {
        ...d,
        parts,
        angles: remainingAngles,
        rig: d.rig ? { ...d.rig, activeAngle: fallback, angles: prunedRigAngles } : undefined,
        updatedAt: Date.now(),
      };
      return { ...withFallback, rig: normalizeCharacterRig(withFallback) };
    });
    setPendingDeleteAngle(null);
    setStatusUndoable(`${ANGLE_LABELS[angle]} deleted`);
  };

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

  const editorRuntime = useMemo(() => (doc ? buildCharacterRuntime(doc) : null), [doc]);

  function restoreCharacterSnapshot(next: CharacterPreset) {
    setDoc(next);
    setSelectedPartId((id) => (id && next.parts.some((part) => part.id === id) ? id : null));
    setSelectedSlotId((id) => (id && findCharacterSlot(next, id) ? id : null));
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

  const renderBlockingRigIssues = useMemo(
    () =>
      doc
        ? validateCharacterPinRig(doc, { angle: editorRuntime?.angle }).filter(
            (issue) => issue.severity === "error",
          )
        : [],
    [doc, editorRuntime?.angle],
  );
  const renderBlockingRigFix = useMemo(
    () =>
      doc && renderBlockingRigIssues[0]
        ? renderBlockingRigFixForIssue(doc, renderBlockingRigIssues[0])
        : null,
    [doc, renderBlockingRigIssues],
  );
  const pixiEditorPreviewPayload = useMemo(() => {
    // The selected action preview is time-based; this state tick intentionally resamples it.
    void previewTick;
    if (!doc || renderBlockingRigIssues.length > 0) return null;
    const previewPoses = { ...variantPreview };
    if (preview) {
      const previewPart =
        doc.parts.find((part) => part.id === preview.targetPartId) ??
        doc.parts.find((part) => getPartSlotId(part) === preview.targetSlotId);
      const previewVariant = previewPart
        ? activePreviewVariantForPart(previewPart, preview)
        : undefined;
      if (previewVariant) previewPoses[preview.targetSlotId] = previewVariant;
    }
    try {
      return buildCharacterRenderPayload({
        compositionId: "character_editor_preview",
        clipId: "character-editor-preview-clip",
        width: doc.canvasWidth,
        height: doc.canvasHeight,
        duration: 1,
        character: doc,
        meta: {
          characterId: doc.id,
          poses: previewPoses,
          autoBlink: false,
        },
        mediaAssets,
        motionPresets: new Map(),
      });
    } catch (error) {
      if (error instanceof CharacterPinRigError) return null;
      throw error;
    }
  }, [doc, mediaAssets, preview, previewTick, renderBlockingRigIssues.length, variantPreview]);
  if (!doc) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        Loading character…
      </div>
    );
  }

  const withRig = (character: CharacterPreset, preserveRig = false): CharacterPreset => {
    const normalized = normalizeCharacterSlots(character);
    return {
      ...normalized,
      // A structural rebuild (preserveRig = false) recomputes bones/bindings from the parts but
      // must keep authored movement/rotation reaches — otherwise setting a pivot/area or moving a
      // layer would silently wipe a slot's drag boundary and rotation clipping.
      rig: preserveRig
        ? normalizeCharacterRig(normalized)
        : rebuildRigPreservingConstraints(normalized),
    };
  };

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

  const fitActiveAngleToCanvas = () => {
    pushUndoSnapshot();
    setDoc((d) => {
      if (!d) return d;
      const activeAngle = normalizeCharacterRig(d).activeAngle;
      const activeParts = d.parts.filter((part) => partAvailableForAngle(part, activeAngle));
      const fittedParts = fitPartsToCanvasFrame(activeParts, d.canvasWidth, d.canvasHeight);
      if (!fittedParts) return d;
      const fittedById = new Map(fittedParts.map((part) => [part.id, part]));
      return withRig({
        ...d,
        parts: d.parts.map((part) => fittedById.get(part.id) ?? part),
        updatedAt: Date.now(),
      });
    });
    setStatusUndoable("Fitted active angle to canvas");
  };

  const syncLiveCharacterPreset = (character: CharacterPreset) => {
    // Rebuild the canonical HyperFrames composition through the same runtime used by playback.
    // Direct DOM bone/slot commands cannot express registration and variant-local output pins.
    useStudio.getState().registerCharacterPreset(character);
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
      const semanticSlotChanged =
        !!original && (patch.role !== undefined || "side" in patch) && patch.slotId === undefined;
      const nextRole = patch.role ?? original?.role;
      const nextSide =
        "side" in patch ? patch.side : original ? (patch.side ?? original.side) : patch.side;
      const canonicalSlotId =
        original && semanticSlotChanged && nextRole
          ? defaultSlotIdForRole(nextRole, nextRole === "custom" ? id : undefined, nextSide)
          : undefined;
      const semanticSlot = canonicalSlotId ? findCharacterSlot(d, canonicalSlotId) : undefined;
      const semanticPatch =
        original && semanticSlotChanged && nextRole && canonicalSlotId
          ? {
              slotId: canonicalSlotId,
              slotName: semanticSlot?.name ?? slotLabelForRoleSide(nextRole, nextSide),
            }
          : {};
      const parentPivot = original ? pivotForPart(original) : null;
      const rig = normalizeCharacterRig(d);
      const originalSlotId = original ? getPartSlotId(original) : "";
      const descendantIds =
        original && rotationDelta !== 0
          ? partIdsForSlotSubtree(d.parts, rig, originalSlotId, rig.activeAngle, false)
          : new Set<ID>();
      return withRig({
        ...d,
        parts: d.parts.map((part) => {
          if (part.id === id)
            return normalizePartPatch({ ...part, ...patch, ...semanticPatch }, patch);
          if (!parentPivot || rotationDelta === 0 || !descendantIds.has(part.id)) return part;
          const pivot = pivotForPart(part);
          const rotatedPivot = rotatePointAroundAnchor(pivot, parentPivot, rotationDelta);
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

  // Explicit variant-key edits propagate: renaming "bent" follows through joint anchors, pose
  // presets, and gated relations instead of silently orphaning them (phase-one mitigation until
  // variants get stable internal ids). Semantic reassignment (viseme/eyeState/pose selects) is
  // NOT a rename and goes through plain updatePart.
  const updatePartVariant = (id: ID, patch: Partial<CharacterPart>) => {
    const original = doc?.parts.find((part) => part.id === id);
    if (!doc || !original) return;
    const isExplicitKeyEdit =
      "variant" in patch && !("viseme" in patch) && !("eyeState" in patch) && !("pose" in patch);
    const nextPart = normalizePartPatch({ ...original, ...patch }, patch);
    const oldKey = variantKeyForPart(original);
    const newKey = variantKeyForPart(nextPart);
    if (!isExplicitKeyEdit || oldKey === newKey) {
      updatePart(id, patch);
      return;
    }
    pushUndoSnapshot();
    setDoc((d) => {
      if (!d) return d;
      const withPart = {
        ...d,
        parts: d.parts.map((part) =>
          part.id === id ? normalizePartPatch({ ...part, ...patch }, patch) : part,
        ),
        updatedAt: Date.now(),
      };
      const renamed = renameVariantKeyEverywhere(withPart, getPartSlotId(original), oldKey, newKey);
      return { ...renamed, rig: normalizeCharacterRig(renamed) };
    });
  };

  const addPart = (part: CharacterPart) => {
    pushUndoSnapshot();
    setDoc((d) => (d ? withRig({ ...d, parts: [...d.parts, part], updatedAt: Date.now() }) : d));
    setSelectedPartId(part.id);
  };

  const removePart = (id: ID) => {
    const angle = currentAngle();
    pushUndoSnapshot();
    setDoc((d) => {
      if (!d) return d;
      const next = removePartFromAngle(d, id, angle).character;
      return withRig({ ...next, updatedAt: Date.now() });
    });
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
      zIndex: maxPartZIndex(doc.parts) + 1,
      parentId: undefined,
    });
  };

  const importSvg = async (file: File, options: CharacterPartImportOptions = {}) => {
    try {
      const asset = await importMediaFile(file, { scope: "character-part" });
      useStudio.getState().registerMediaAsset(asset);
      const role = options.role ?? detectImportedPartRole(file.name);
      const side = options.side ?? detectImportedPartSide(file.name);
      const viseme =
        options.viseme ?? (role === "mouth" ? detectImportedViseme(file.name) : undefined);
      const eyeState =
        options.eyeState ?? (role === "eye" ? detectImportedEyeState(file.name) : undefined);
      const fitted = fitImportedPartToCanvas(
        asset.width,
        asset.height,
        doc.canvasWidth,
        doc.canvasHeight,
      );
      const alphaBounds = await measureAlphaBoundsFromBlob(file, asset.width, asset.height);
      const id = uid();
      const label = options.label ?? asset.name;
      const slotId = options.slotId ?? slotIdForImportedPart(role, id, side);
      // Correct assembly by default: new variants land sized/centered on the
      // slot's current art, first art for a slot lands in its guide zone, and
      // an explicit placement (or no match) keeps today's behavior.
      const smartPlacement = options.placement
        ? null
        : smartImportPlacement({
            slotParts: partsInSlot(slotId),
            role,
            side,
            artWidth: asset.width ?? 0,
            artHeight: asset.height ?? 0,
            alphaBounds,
            canvasWidth: doc.canvasWidth,
            canvasHeight: doc.canvasHeight,
          });
      const variantKey =
        options.variantKey?.trim() ||
        viseme ||
        eyeState ||
        detectImportedVariantKey(file.name, role, side);
      const variant = variantKey
        ? {
            key: variantKey,
            ...(options.variantLabel?.trim() ? { name: options.variantLabel.trim() } : {}),
            kind: options.variantKind ?? defaultImportedVariantKind(role, viseme, eyeState),
          }
        : undefined;
      const part = makePart(role, asset.id, {
        id,
        name: label,
        slotId,
        slotName: label,
        side,
        variant,
        viseme,
        eyeState,
        alphaBounds,
        // Each angle owns its drawings: new art belongs to the angle it was uploaded into.
        angleIds: [normalizeCharacterRig(doc).activeAngle],
        ...fitted,
        ...(smartPlacement
          ? {
              x: smartPlacement.x,
              y: smartPlacement.y,
              width: smartPlacement.width,
              height: smartPlacement.height,
              pivot: smartPlacement.pivot,
            }
          : {}),
        ...options.placement,
        zIndex: options.zIndex ?? maxPartZIndex(doc.parts) + 1,
        motionBehavior: defaultMotionBehaviorForRole(role, viseme),
      });
      addPart(part);
      setStatus(
        smartPlacement?.mode === "variant"
          ? `${file.name} added — aligned with the slot's current art`
          : smartPlacement?.mode === "zone"
            ? `${file.name} added — placed in the ${roleLabel(role)} guide zone`
            : `${file.name} added`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not import SVG.");
    }
  };

  const selectedPart = doc.parts.find((p) => p.id === selectedPartId) ?? null;
  const orderedParts = doc.parts.slice().sort((a, b) => a.zIndex - b.zIndex);

  const selectPart = (id: ID) => {
    const part = doc.parts.find((candidate) => candidate.id === id);
    if (part) {
      const slotId = getPartSlotId(part);
      if (partsInSlot(slotId).length > 1) previewVariant(slotId, variantKeyForPart(part));
    }
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

  const currentAngle = () => normalizeCharacterRig(doc).activeAngle;
  const partsInSlot = (slotId: ID, angle: CharacterAngle = currentAngle()) =>
    doc.parts.filter((p) => getPartSlotId(p) === slotId && partAvailableForAngle(p, angle));
  const slotNameFor = (slotId: ID) => findCharacterSlot(doc, slotId)?.name ?? slotId;

  const updateSlotRecord = (slotId: ID, patch: Partial<CharacterSlot>) => {
    pushUndoSnapshot();
    setDoc((d) => {
      if (!d) return d;
      return withRig({ ...withUpdatedCharacterSlot(d, slotId, patch), updatedAt: Date.now() });
    });
  };

  const toggleSlotVisible = (slotId: ID) => {
    const activeParts = partsInSlot(slotId);
    const targetIds = new Set(activeParts.map((part) => part.id));
    const anyVisible = activeParts.some((p) => p.visible);
    pushUndoSnapshot();
    setDoc((d) =>
      d
        ? withRig({
            ...d,
            parts: d.parts.map((p) => (targetIds.has(p.id) ? { ...p, visible: !anyVisible } : p)),
            updatedAt: Date.now(),
          })
        : d,
    );
  };

  // Lock cascades across a slot's variants — a locked slot ignores canvas clicks/drags
  // (still selectable from the Layers list so it can be unlocked).
  const toggleSlotLocked = (slotId: ID) => {
    const activeParts = partsInSlot(slotId);
    const targetIds = new Set(activeParts.map((part) => part.id));
    const anyLocked = activeParts.some((p) => p.locked);
    pushUndoSnapshot();
    setDoc((d) =>
      d
        ? withRig({
            ...d,
            parts: d.parts.map((p) => (targetIds.has(p.id) ? { ...p, locked: !anyLocked } : p)),
            updatedAt: Date.now(),
          })
        : d,
    );
  };

  const nudgeSlotZ = (slotId: ID, delta: number) => {
    const targetIds = new Set(partsInSlot(slotId).map((part) => part.id));
    pushUndoSnapshot();
    setDoc((d) =>
      d
        ? withRig({
            ...d,
            parts: d.parts.map((p) =>
              targetIds.has(p.id) ? { ...p, zIndex: p.zIndex + delta } : p,
            ),
            updatedAt: Date.now(),
          })
        : d,
    );
  };

  const removeSlot = (slotId: ID) => {
    const angle = currentAngle();
    const targetIds = partsInSlot(slotId, angle).map((part) => part.id);
    pushUndoSnapshot();
    setDoc((d) => {
      if (!d) return d;
      const next = targetIds.reduce(
        (current, partId) => removePartFromAngle(current, partId, angle).character,
        d,
      );
      return withRig({ ...next, updatedAt: Date.now() });
    });
    if (selectedSlotId === slotId) setSelectedSlotId(null);
  };

  // Commit a one-shot group move (used by the Inspector numeric fields).
  const applyGroupMove = (slotId: ID, dx: number, dy: number) => {
    pushUndoSnapshot();
    setDoc((d) => {
      if (!d) return d;
      const rig = normalizeCharacterRig(d);
      const limited = clampSlotDragDelta(d, rig, slotId, dx, dy);
      const angle = rig.activeAngle;
      const result = applyCharacterSceneCommand(d, {
        kind: "move-slot",
        slotId,
        dx: limited.dx,
        dy: limited.dy,
        angle,
        rig,
      });
      return withRig(result.character, true);
    });
  };

  // Commit a one-shot group scale around a fixed anchor corner.
  const applyGroupScale = (
    slotId: ID,
    anchor: { x: number; y: number },
    scaleX: number,
    scaleY: number,
  ) => {
    const angle = currentAngle();
    pushUndoSnapshot();
    setDoc((d) =>
      d
        ? withRig(
            applyCharacterSceneCommand(d, {
              kind: "scale-slot",
              slotId,
              anchor,
              scaleX,
              scaleY,
              angle,
            }).character,
            true,
          )
        : d,
    );
  };

  const applyGroupRotate = (slotId: ID, anchor: { x: number; y: number }, degrees: number) => {
    if (!Number.isFinite(degrees) || degrees === 0) return;
    const angle = currentAngle();
    pushUndoSnapshot();
    setDoc((d) => {
      if (!d) return d;
      return withRig(
        applyCharacterSceneCommand(d, {
          kind: "rotate-slot",
          slotId,
          anchor,
          degrees,
          angle,
          rig: normalizeCharacterRig(d),
        }).character,
        true,
      );
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

  // Each angle owns its drawings: the canvas and layer list show only the active angle's parts.
  const resolvedEditorRuntime = editorRuntime!;
  const editorActiveAngle = resolvedEditorRuntime.angle;
  const editorAngleParts = orderedParts.filter((part) =>
    partAvailableForAngle(part, editorActiveAngle),
  );
  const previewParentPart =
    preview?.targetRole === "head"
      ? editorAngleParts.find((part) => part.id === preview.targetPartId)
      : undefined;
  const visibleEditorParts = editorAngleParts;
  const selectedEditorPart = selectedPart
    ? visibleEditorParts.find((part) => part.id === selectedPart.id)
    : null;
  const selectedSlotParts = selectedSlotId
    ? doc.parts.filter(
        (part) =>
          getPartSlotId(part) === selectedSlotId && partAvailableForAngle(part, editorActiveAngle),
      )
    : [];
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

  // Re-anchor shift for a part: the variant-preview offset/rotation plus the in-flight anchor drag.
  const partShift = (
    part: CharacterPart,
  ): { dx: number; dy: number; rotation: number } | undefined => {
    const base = variantShift.parts.get(part.id);
    if (anchorDrag && getPartSlotId(part) === anchorDrag.childSlotId) {
      return {
        dx: (base?.dx ?? 0) + anchorDrag.dx,
        dy: (base?.dy ?? 0) + anchorDrag.dy,
        rotation: base?.rotation ?? 0,
      };
    }
    return base;
  };

  const runtimePlacementForPart = (part: CharacterPart): RuntimePartPlacement | undefined => {
    const slotId = getPartSlotId(part);
    const slot = resolvedEditorRuntime.slotById.get(slotId);
    if (!slot) return undefined;
    return runtimePartPlacement(slot, part, resolvedEditorRuntime, {
      poseKey:
        variantPreview[slotId] ??
        activePreviewVariantForPart(part, preview) ??
        variantKeyForPart(part),
    });
  };

  // The animation-test delta plus the variant-preview re-anchor shift — every hit test and
  // local-point mapping must use this so clicks land on the art where it is actually drawn.
  const partPreviewTransform = (part: CharacterPart) => {
    const base = previewDelta(
      part,
      preview,
      previewParentPart,
      editorAngleParts,
      resolvedEditorRuntime,
    );
    const shift = partShift(part);
    return composeEditorPartTransform(part, base, shift, runtimePlacementForPart(part));
  };

  const selectedSlotBounds =
    selectedSlotParts.length > 0
      ? unionSelectionBounds(selectedSlotParts, boundsMode, partPreviewTransform)
      : null;
  const selectedDeformPathPart = (() => {
    const slotId =
      selectedSlotId ?? (selectedEditorPart ? getPartSlotId(selectedEditorPart) : null);
    if (!slotId) return null;
    if (
      selectedEditorPart &&
      getPartSlotId(selectedEditorPart) === slotId &&
      selectedEditorPart.deform?.mode === "limb-path"
    ) {
      return selectedEditorPart;
    }
    const parts = visibleEditorParts.filter((part) => getPartSlotId(part) === slotId);
    const activeKey =
      variantPreview[slotId] ??
      (selectedEditorPart && getPartSlotId(selectedEditorPart) === slotId
        ? variantKeyForPart(selectedEditorPart)
        : parts[0]
          ? defaultVariantForSlotParts(parts, parts[0].role)
          : undefined);
    return (
      parts.find(
        (part) =>
          part.deform?.mode === "limb-path" && (!activeKey || partMatchesVariant(part, activeKey)),
      ) ??
      parts.find((part) => part.deform?.mode === "limb-path") ??
      null
    );
  })();

  // Mesh-path focus mode is active only while the SAME flexible part stays
  // selected; a stale id simply stops matching (no cleanup effect needed).
  const meshPathEditing = !!selectedDeformPathPart && meshEditPartId === selectedDeformPathPart.id;

  const localPointForPart = (part: CharacterPart, point: { x: number; y: number }) =>
    canvasPointToPartLocal(part, point, partPreviewTransform(part));

  // Ordered stack of parts under a point, topmost first (alpha-exact before padded
  // hits), with locked parts excluded — the candidate list the select/drag model
  // drills through. `pickPartAt` keeps returning just the topmost for other callers.
  const hitPartsAt = (point: { x: number; y: number }) => {
    const exact: CharacterPart[] = [];
    const padded: CharacterPart[] = [];
    const candidates = visibleEditorParts
      .filter((part) => (part.visible || part.id === selectedPartId) && !part.locked)
      .slice()
      .sort(
        (a, b) =>
          (runtimePlacementForPart(b)?.drawOrder ?? b.zIndex) -
          (runtimePlacementForPart(a)?.drawOrder ?? a.zIndex),
      );

    for (const part of candidates) {
      // Skip non-active variants: invisible slot siblings must not intercept clicks.
      // Mirrors PartLayer's rendering decision so hit testing and drawing always agree.
      if (part.id !== selectedPartId) {
        const slotId = getPartSlotId(part);
        const sameSlotParts = visibleEditorParts.filter((c) => getPartSlotId(c) === slotId);
        if (sameSlotParts.length > 1) {
          const activeVariant =
            variantPreview[slotId] ??
            activePreviewVariantForPart(part, preview) ??
            defaultVariantForSlotParts(sameSlotParts, part.role);
          if (activeVariant && !partMatchesVariant(part, activeVariant)) continue;
        }
      }
      const transform = partPreviewTransform(part);
      if (transform.opacity <= 0.05 && part.id !== selectedPartId) continue;
      const local = canvasPointToPartLocal(part, point, transform);
      const inEditorBounds = pointInEditorHitBounds(part, local, scale, boundsMode);
      if (boundsMode === "frame") {
        if (inEditorBounds) exact.push(part);
      } else if (
        inEditorBounds &&
        alphaMaskContains(alphaMaskRef.current.get(part.id), part, local)
      ) {
        exact.push(part);
      } else if (inEditorBounds) {
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

  // Snap the selected variant's art onto the slot's default variant by aligning
  // visible-pixel centers. Variant swaps (blinks, visemes) render at authored
  // offsets, so misaligned imports show up offset from the character until the
  // author fixes them — this is the one-click fix. Moves every layer of the
  // variant by the same delta in a single undo step.
  const selectedAlignPlan = selectedPart
    ? planVariantAlign(partsInSlot(getPartSlotId(selectedPart)), selectedPart)
    : null;

  const armPartImport = (options: CharacterPartImportOptions) => {
    pendingImportRef.current = options;
    partImportInputRef.current?.click();
  };

  // Duplicate a sided slot's layers to the other side with mirrored placement,
  // pivots, pins, and motion bounds (the art itself is not flipped — parts have
  // no flip transform yet). One undo step; the mirrored slot gets selected.
  const mirrorPlanForSlot = (slotId: ID): MirrorSlotPlan =>
    planMirrorSlot({
      docParts: doc.parts,
      slotId,
      angle: currentAngle(),
      canvasWidth: doc.canvasWidth,
      makeId: uid,
    });
  const mirrorSlotToOtherSide = (slotId: ID) => {
    const plan = mirrorPlanForSlot(slotId);
    if (!plan.ok) return;
    pushUndoSnapshot();
    setDoc((d) => {
      if (!d) return d;
      return withRig({
        ...d,
        parts: [...d.parts, ...plan.newParts.map((part) => normalizePartPatch(part, part))],
        updatedAt: Date.now(),
      });
    });
    setStatus(
      `Mirrored ${plan.newParts.length} layer${plan.newParts.length === 1 ? "" : "s"} to the ${plan.targetSide} side`,
    );
    selectSlot(plan.targetSlotId);
  };
  // Flexible is slot-level: every variant of the layer must use the same
  // deform model so variant swaps stay consistent. Deform does not move bones,
  // so the rig is preserved as-is.
  const setSlotDeform = (
    slotId: ID,
    deform: CharacterPartDeform | undefined,
    options: { history?: boolean } = {},
  ) => {
    commitSceneCommand({ kind: "set-slot-deform", slotId, deform }, options);
  };
  const alignSelectedVariantArt = () => {
    const plan = selectedAlignPlan;
    if (!doc || !selectedPart || !plan || plan.aligned) return;
    const ids = new Set(plan.moveIds);
    pushUndoSnapshot();
    setDoc((d) => {
      if (!d) return d;
      return withRig({
        ...d,
        parts: d.parts.map((part) => {
          if (!ids.has(part.id)) return part;
          const x = Math.round(part.x + plan.dx);
          const y = Math.round(part.y + plan.dy);
          return normalizePartPatch({ ...part, x, y }, { x, y });
        }),
        updatedAt: Date.now(),
      });
    });
    setStatus(
      `Aligned "${variantLabelForPart(selectedPart)}" with "${variantLabelForPart(plan.referencePart)}"`,
    );
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
    const slotId = getPartSlotId(part);
    const rigSnapshot = normalizeCharacterRig(doc);
    const angle = rigSnapshot.activeAngle;
    const binding = resolveSlotBinding(rigSnapshot, slotId, angle);
    const subtreeSlotIds = binding
      ? slotIdsForBoneSubtree(rigSnapshot, binding.effectiveBoneId, angle)
      : new Set<ID>([slotId]);
    let latestCharacter = doc;
    const snapshot = doc.parts.map((snapshotPart) => {
      const pivot = pivotForPart(snapshotPart);
      return { id: snapshotPart.id, x: snapshotPart.x, y: snapshotPart.y, pivot };
    });
    const partSnapshot = new Map(snapshot.map((snapshotPart) => [snapshotPart.id, snapshotPart]));
    const movesBone = subtreeSlotIds.size > 1;
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
        const limited = clampSlotDragDelta(
          { ...d, parts: snapshotParts },
          rigSnapshot,
          slotId,
          dx,
          dy,
        );
        const appliedDx = limited.dx;
        const appliedDy = limited.dy;
        if (movesBone && binding) {
          const moved = applyCharacterSceneCommand(
            { ...d, parts: snapshotParts, rig: rigSnapshot },
            {
              kind: "move-bone-rest",
              boneId: binding.effectiveBoneId,
              dx: appliedDx,
              dy: appliedDy,
              angle,
              activeVariants: variantPreview,
            },
          ).character;
          latestCharacter = { ...moved, updatedAt: Date.now() };
          return latestCharacter;
        }
        const result = applyCharacterSceneCommand(
          { ...d, parts: snapshotParts, rig: rigSnapshot },
          {
            kind: "move-slot",
            slotId,
            dx: appliedDx,
            dy: appliedDy,
            angle,
            rig: rigSnapshot,
          },
        );
        latestCharacter = withRig(result.character, true);
        return latestCharacter;
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      syncLiveCharacterPreset(latestCharacter);
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
    const angle = rigSnapshot.activeAngle;
    let latestCharacter = doc;
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
        const limited = clampSlotDragDelta(
          { ...d, parts: snapshotParts },
          rigSnapshot,
          slotId,
          dx,
          dy,
        );
        latestCharacter = withRig(
          applyCharacterSceneCommand(
            { ...d, parts: snapshotParts, rig: rigSnapshot },
            {
              kind: "move-slot",
              slotId,
              dx: limited.dx,
              dy: limited.dy,
              angle,
              rig: rigSnapshot,
            },
          ).character,
          true,
        );
        return latestCharacter;
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      syncLiveCharacterPreset(latestCharacter);
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
    const keepArtwork = boneDragMode === "calibrate";
    const snapshot = doc;
    let latest = snapshot;
    const move = (ev: PointerEvent) => {
      const dx = Math.round((ev.clientX - sx) / scale);
      const dy = Math.round((ev.clientY - sy) / scale);
      latest = applyCharacterSceneCommand(snapshot, {
        kind: "move-bone-rest",
        boneId,
        dx,
        dy,
        angle: currentAngle(),
        keepArtwork,
        activeVariants: variantPreview,
      }).character;
      setDoc({ ...latest, updatedAt: Date.now() });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      syncLiveCharacterPreset(latest);
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
    const box = unionSelectionBounds(parts, boundsMode);
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
    startWindowPointerDrag({ onMove: move });
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
    const box = unionSelectionBounds(parts, boundsMode);
    const anchor = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    if (!rect) return;
    const anchorScreen = {
      x: rect.left + anchor.x * scale,
      y: rect.top + anchor.y * scale,
    };
    const startAngle = Math.atan2(e.clientY - anchorScreen.y, e.clientX - anchorScreen.x);
    const angle = currentAngle();
    const targetIds = partIdsForSlotSubtree(doc.parts, normalizeCharacterRig(doc), slotId, angle);
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
                const rotatedPivot = rotatePointAroundAnchor(base.pivot, anchor, degrees);
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
    startWindowPointerDrag({ onMove: move });
  };

  // Once a select-mode drag actually begins, dispatch to a slot-group drag (multi-variant
  // slots) or a single-part drag. Both select the subject and install their own listeners.
  // When a child's parent slot previews a non-default variant, dragging that child edits its
  // variant output pin instead of its rest position — the user-chosen "small corrections"
  // gesture. Returns null when ordinary rest-position dragging should apply.
  const anchorDragContextForSlot = (
    slotId: ID,
  ): { childSlotId: ID; parentSlotId: ID; variantKey: string } | null => {
    const rig = normalizeCharacterRig(doc);
    const boneId = rig.slotBindings.find((binding) => binding.slotId === slotId)?.boneId;
    const parentSlotId = boneId ? parentSlotIdForBone(rig, boneId) : undefined;
    if (!parentSlotId) return null;
    const previewKey = variantPreview[parentSlotId];
    if (!previewKey) return null;
    const parentParts = doc.parts.filter((part) => getPartSlotId(part) === parentSlotId);
    const defaultKey = defaultVariantForSlotParts(parentParts, parentParts[0]?.role ?? "custom");
    // Previewing the rest variant means the art sits at its rest anchor — drags stay rest edits.
    if (!previewKey || previewKey === defaultKey) return null;
    return { childSlotId: slotId, parentSlotId, variantKey: previewKey };
  };

  const slotDisplayName = (slotId: ID) => slotNameFor(slotId);

  const commitSceneCommand = (
    command: CharacterSceneCommand,
    options: { history?: boolean } = {},
  ) => {
    const result = applyCharacterSceneCommand(doc, command);
    if (!result.changed) return result;
    updateDoc(
      { parts: result.character.parts, rig: result.character.rig },
      { history: options.history },
    );
    return result;
  };

  const startAnchorDrag = (
    e: React.PointerEvent,
    context: { childSlotId: ID; parentSlotId: ID; variantKey: string },
  ) => {
    e.preventDefault();
    pushUndoSnapshot();
    const childName = slotDisplayName(context.childSlotId);
    const parentName = slotDisplayName(context.parentSlotId);
    setAnchorDrag({ ...context, dx: 0, dy: 0 });
    const startX = e.clientX;
    const startY = e.clientY;
    // The anchor's current canvas position: the child bone at rest plus the preview shift.
    const runtime = buildCharacterRuntime(doc);
    const previewWorld = runtimeBoneWorldTransforms(runtime, variantPreview);
    const boneId = runtime.angleRig.slotBindings.find(
      (binding) => binding.slotId === context.childSlotId,
    )?.boneId;
    const boneWorld = boneId ? previewWorld.get(boneId) : undefined;
    const startAnchor = boneWorld ? { x: boneWorld.x, y: boneWorld.y } : null;

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      setAnchorDrag((current) => (current ? { ...current, dx, dy } : current));
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setAnchorDrag(null);
      if (!startAnchor) return;
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      commitSceneCommand(
        {
          kind: "place-variant-pin",
          parentSlotId: context.parentSlotId,
          variantKey: context.variantKey,
          childSlotId: context.childSlotId,
          anchorPoint: { x: startAnchor.x + dx, y: startAnchor.y + dy },
        },
        { history: false },
      );
      setStatus(`Pin placed — ${childName} follows ${parentName} : ${context.variantKey}`);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const clearPin = (context: { parentSlotId: ID; variantKey: string; childSlotId: ID }) => {
    pushUndoSnapshot();
    commitSceneCommand({ kind: "clear-variant-pin", ...context }, { history: false });
    setStatus(
      `Pin removed — ${slotDisplayName(context.childSlotId)} is unresolved for this variant`,
    );
  };

  const resetPinToArtwork = (context: {
    parentSlotId: ID;
    variantKey: string;
    childSlotId: ID;
  }) => {
    pushUndoSnapshot();
    commitSceneCommand({ kind: "reset-variant-pin", ...context }, { history: false });
    setStatus(
      `Pin reset from artwork — ${slotDisplayName(context.childSlotId)} now uses its authored pivot`,
    );
  };

  const setAnchorRotation = (
    context: { parentSlotId: ID; variantKey: string; childSlotId: ID },
    rotation: number,
  ) => {
    pushUndoSnapshot();
    commitSceneCommand(
      { kind: "set-variant-pin-rotation", ...context, rotation },
      { history: false },
    );
    setStatus(
      `Anchor angle — ${slotDisplayName(context.childSlotId)} at ${rotation}° under ` +
        `${slotDisplayName(context.parentSlotId)} : ${context.variantKey}`,
    );
  };

  const armRenderBlockingRigFix = (fix: RenderBlockingRigFix) => {
    selectSlot(fix.childSlotId);
    switchPhase("rig");
    previewVariant(fix.parentSlotId, fix.parentVariantKey);
    setShowAnchors(true);
    setPinPlacement({
      childSlotId: fix.childSlotId,
      parentSlotId: fix.parentSlotId,
      variantKey: fix.parentVariantKey,
    });
    setStatus(fix.instructions);
  };

  const startCanvasDragForSubject = (
    e: React.PointerEvent,
    part: CharacterPart,
    point: { x: number; y: number },
  ) => {
    const slotId = getPartSlotId(part);
    const anchorContext = anchorDragContextForSlot(slotId);
    if (anchorContext) {
      startAnchorDrag(e, anchorContext);
      return;
    }
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
    commitSceneCommand({ kind: "clear-slot-reach", slotId });
    setReachDraft(null);
    setRotDraft(null);
    setStatus("Reach cleared");
  };

  const setSlotHost = (slotId: ID, hostSlotId: ID | "") => {
    commitSceneCommand({ kind: "set-slot-host", slotId, hostSlotId: hostSlotId || undefined });
  };

  const setSlotHostMode = (slotId: ID, mode: "insideHostMask" | "insideHostBounds") => {
    const current = normalizeCharacterRig(doc).hostConstraints.find(
      (constraint) => constraint.slotId === slotId,
    );
    commitSceneCommand({
      kind: "set-slot-host",
      slotId,
      hostSlotId: current?.hostSlotId,
      mode,
      reachPolicy: current?.reachPolicy ?? "scaleToFit",
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
            const rp = rotatePointAroundAnchor(base.pivot, anchor, degrees);
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

  // Set the child bone's parent for the active angle. The bone graph is the hierarchy; parent
  // artwork supplies the named output pin that derives the child joint.
  const setSlotAttachTo = (slotId: ID, parentSlotId: ID | "") => {
    commitSceneCommand({
      kind: "set-slot-parent",
      childSlotId: slotId,
      parentSlotId: parentSlotId || undefined,
      angle: currentAngle(),
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
        return applyCharacterSceneCommand(
          { ...d, parts: restored },
          {
            kind: "move-slot",
            slotId,
            dx,
            dy,
            angle: currentAngle(),
            updateRig: false,
          },
        ).character;
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

    // One-shot anchor placement armed from the Anchor section: the click point becomes the
    // child's anchor under the armed parent variant. Mirrors the pivot tool's act-and-disarm.
    if (pinPlacement) {
      pushUndoSnapshot();
      commitSceneCommand(
        {
          kind: "place-variant-pin",
          parentSlotId: pinPlacement.parentSlotId,
          variantKey: pinPlacement.variantKey,
          childSlotId: pinPlacement.childSlotId,
          anchorPoint: point,
        },
        { history: false },
      );
      setStatus(
        `Pin placed — ${slotDisplayName(pinPlacement.childSlotId)} follows ` +
          `${slotDisplayName(pinPlacement.parentSlotId)} : ${pinPlacement.variantKey}`,
      );
      setPinPlacement(null);
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

  const handleCanvasPointerDownCapture = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (!pinPlacement && mode === "select") return;
    if (rangeEdit) return;
    e.preventDefault();
    e.stopPropagation();
    handleCanvasPointerDown(e);
  };

  // Hover identification: name the art under the cursor without clicking.
  const handleCanvasHover = (e: React.PointerEvent) => {
    if (mode !== "select" || interacting || anchorDrag || rangeEdit) {
      if (hoverHit) setHoverHit(null);
      return;
    }
    const point = canvasPointFromEvent(e);
    if (!point) return;
    const top = hitPartsAt(point)[0];
    if (!top) {
      if (hoverHit) setHoverHit(null);
      return;
    }
    const slotName = slotNameFor(getPartSlotId(top));
    const variant = variantLabelForPart(top);
    setHoverHit({
      x: point.x,
      y: point.y,
      label: variant && variant !== slotName ? `${slotName} · ${variant}` : slotName,
    });
  };

  // One consistent banner for every armed mode — what's happening, and how to get out.
  const modeBanner = (() => {
    if (anchorDrag)
      return {
        text: `Editing anchor — ${slotDisplayName(anchorDrag.childSlotId)} rides ${slotDisplayName(
          anchorDrag.parentSlotId,
        )} : ${anchorDrag.variantKey}. Release to pin.`,
      };
    if (pinPlacement)
      return {
        text: `Click where ${slotDisplayName(pinPlacement.childSlotId)} should anchor under ${slotDisplayName(
          pinPlacement.parentSlotId,
        )} : ${pinPlacement.variantKey}.`,
        cancel: () => setPinPlacement(null),
      };
    if (rangeEdit)
      return {
        text: "Tracing reach — sweep the layer to its farthest comfortable spots; drag the blue knob to set twist.",
        cancel: exitReachEdit,
        cancelLabel: "Done",
      };
    if (mode === "pivot")
      return {
        text: "Click where this part should rotate around.",
        cancel: () => setMode("select"),
      };
    if (mode === "bounds-rect" || mode === "bounds-ellipse")
      return {
        text: "Click the canvas to place the allowed-movement area.",
        cancel: () => setMode("select"),
      };
    return null;
  })();

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
        <div className="flex items-center justify-center">
          <div className="flex overflow-hidden rounded border border-border">
            {(
              [
                { phase: "build", label: "Build", hint: "Upload and arrange artwork" },
                { phase: "rig", label: "Rig", hint: "Skeleton, anchors, and movement limits" },
                { phase: "pose", label: "Pose", hint: "Variants and saved poses" },
              ] as const
            ).map(({ phase, label, hint }) => (
              <button
                key={phase}
                type="button"
                aria-pressed={editorPhase === phase}
                onClick={() => switchPhase(phase)}
                className={`px-3 py-1 text-xs ${
                  editorPhase === phase
                    ? "bg-primary/25 text-foreground"
                    : "text-muted-foreground hover:bg-panel-2"
                }`}
                title={hint}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
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
          <span
            className={`text-[10px] ${
              saveState === "saved" ? "text-emerald-400" : "text-muted-foreground"
            }`}
            title="The editor saves automatically as you work"
          >
            {saveState === "saved" ? "✓ Saved" : "Saving…"}
          </span>
          <button
            onClick={async () => {
              const saved = await saveCharacter(doc);
              useStudio.getState().registerCharacterPreset(saved);
              setDoc(saved);
              onClose();
            }}
            className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
            title="Everything is already saved — this just closes the editor"
          >
            Done
          </button>
        </div>
      </header>

      {/* Angle → pose toolbar: the angle picks the rig, the pose picks the limb arrangement. */}
      <div className="flex items-stretch border-b border-border bg-panel text-xs">
        {/* Angle tabs — each angle is a separate artwork/rig workspace */}
        <div className="flex items-stretch">
          {availableCharacterAngles(doc).map((angle) => {
            const active = normalizeCharacterRig(doc).activeAngle === angle;
            const canDelete = active && availableCharacterAngles(doc).length > 1;
            const confirmingDelete = pendingDeleteAngle === angle;
            return (
              <span key={angle} className="relative flex items-stretch">
                <button
                  type="button"
                  onClick={() => setActiveAngleFromToolbar(angle)}
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
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirmingDelete) {
                        deleteAngle(angle);
                      } else {
                        setPendingDeleteAngle(angle);
                      }
                    }}
                    onBlur={() => {
                      setTimeout(() => setPendingDeleteAngle((p) => (p === angle ? null : p)), 200);
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
        {CHARACTER_ANGLES.some((angle) => !availableCharacterAngles(doc).includes(angle)) && (
          <span className="relative flex items-center">
            <button
              type="button"
              onClick={() => setAddAngleMenuOpen((open) => !open)}
              className="border-b-2 border-transparent px-3 py-2 text-[11px] text-muted-foreground hover:text-foreground"
              title="Add another view of this character — it starts with its own empty set of drawings"
            >
              + Add angle
            </button>
            {addAngleMenuOpen && (
              <div className="absolute left-0 top-full z-[70] mt-1 min-w-32 rounded border border-border bg-panel p-1 text-[11px] shadow-xl">
                {CHARACTER_ANGLES.filter(
                  (angle) => !availableCharacterAngles(doc).includes(angle),
                ).map((angle) => (
                  <button
                    key={angle}
                    type="button"
                    onClick={() => {
                      setAddAngleMenuOpen(false);
                      setActiveAngleFromToolbar(angle);
                      switchPhase("build");
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
        {editorPhase === "pose" && (
          <div className="flex min-w-0 flex-1 items-center gap-1 border-l border-border px-4">
            <span className="mr-1 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
              Pose
            </span>
            <button
              type="button"
              onClick={showRestPose}
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
              const rigAngle = normalizeCharacterRig(doc).activeAngle;
              const availableHere = !preset.angleIds?.length || preset.angleIds.includes(rigAngle);
              const isActive = preset.id === activePoseId;
              const isDefault = preset.id === doc.defaultPoseId;
              return (
                <span key={preset.id} className="relative inline-flex">
                  <button
                    type="button"
                    disabled={!availableHere}
                    onClick={() => applyPose(preset)}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                      isActive
                        ? "border-primary bg-primary/20 text-foreground"
                        : "border-border text-muted-foreground hover:bg-panel-2"
                    } ${availableHere ? "" : "opacity-40"}`}
                    title={
                      availableHere
                        ? `Apply ${preset.name}`
                        : `Saved for ${(preset.angleIds ?? []).map((a) => ANGLE_LABELS[a]).join(", ")}`
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
                      onClick={() => setPoseMenuId(poseMenuId === preset.id ? null : preset.id)}
                      className="ml-0.5 rounded px-1 text-muted-foreground hover:text-foreground"
                      title="Pose options"
                    >
                      …
                    </button>
                  )}
                  {poseMenuId === preset.id && (
                    <div className="absolute left-0 top-full z-[70] mt-1 min-w-36 rounded border border-border bg-panel p-1 text-[11px] shadow-xl">
                      {[
                        { label: "Rename", action: () => renamePose(preset.id) },
                        {
                          label: isDefault ? "Default pose ✓" : "Set as default",
                          action: () => setDefaultPose(preset.id),
                        },
                        {
                          label: preset.angleIds?.length
                            ? "Available on all angles"
                            : `Only ${ANGLE_LABELS[rigAngle]}`,
                          action: () => togglePoseAngleScope(preset.id),
                        },
                        { label: "Delete", action: () => deletePose(preset.id), danger: true },
                      ].map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => {
                            setPoseMenuId(null);
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
                onClick={updateActivePose}
                className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300 hover:bg-amber-500/20"
                title={`Save the current arrangement into "${activePose.name}"`}
              >
                Update {activePose.name}
              </button>
            )}
            <span className="relative inline-flex">
              <button
                type="button"
                onClick={savePoseAsNew}
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
                    onChange={(e) => setPosePromptValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmPosePrompt();
                      if (e.key === "Escape") setPosePrompt(null);
                    }}
                    onFocus={(e) => e.target.select()}
                    placeholder="Pose name"
                    className="w-32 rounded border border-border bg-input px-2 py-0.5 text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={confirmPosePrompt}
                    className="rounded border border-primary/50 bg-primary/15 px-2 py-0.5 text-[11px]"
                  >
                    {posePrompt.kind === "new" ? "Save" : "Rename"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPosePrompt(null)}
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

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-panel text-xs">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
            <span className="font-semibold uppercase tracking-wider text-muted-foreground">
              Parts
            </span>
            <span
              className="rounded-full border border-border px-2 py-0.5 text-[9px] text-muted-foreground"
              title="Each angle has its own drawings — new artwork goes into this view"
            >
              {ANGLE_LABELS[editorActiveAngle]}
            </span>
          </div>
          <div className="flex-1 overflow-auto p-3">
            <CharacterLayerList
              parts={orderedParts.filter((part) => partAvailableForAngle(part, editorActiveAngle))}
              slots={doc.slots ?? []}
              rig={normalizeCharacterRig(doc)}
              selectedId={selectedPartId}
              selectedSlotId={selectedSlotId}
              keyIssues={variantKeyIssues}
              onSelect={selectPart}
              onSelectSlot={selectSlot}
              onChange={updatePart}
              onRemove={removePart}
              onToggleSlotVisible={toggleSlotVisible}
              onToggleSlotLocked={toggleSlotLocked}
              onNudgeSlotZ={nudgeSlotZ}
              onRemoveSlot={removeSlot}
              onAddVariant={(group) =>
                armPartImport({
                  slotId: group.slotId,
                  role: group.role,
                  side: group.side,
                  label: group.name,
                })
              }
            />
            <AddPartMenu
              doc={doc}
              activeAngle={editorActiveAngle}
              onPickImport={armPartImport}
              onImport={importSvg}
            />
          </div>
          <input
            ref={partImportInputRef}
            className="hidden"
            type="file"
            accept=".svg,image/svg+xml"
            onChange={(e) => {
              const file = e.target.files?.[0];
              const options = pendingImportRef.current;
              pendingImportRef.current = null;
              if (file) void importSvg(file, options ?? {});
              e.currentTarget.value = "";
            }}
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
              onPointerDownCapture={handleCanvasPointerDownCapture}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasHover}
              onPointerLeave={() => setHoverHit(null)}
              className="absolute left-0 top-0 origin-top-left"
              style={{
                width: doc.canvasWidth,
                height: doc.canvasHeight,
                transform: `scale(${scale})`,
              }}
            >
              {pixiEditorPreviewPayload && (
                <PixiCharacterPreview
                  payload={pixiEditorPreviewPayload}
                  time={0}
                  resetKey={`${doc.id}:${doc.updatedAt}:${editorActiveAngle}:${activePoseId ?? "manual"}`}
                  staleBehavior="hold"
                  loadingLabel="Loading render preview..."
                  resolveAssetRef={resolveCharacterEditorPreviewAssetRef}
                  className="pointer-events-none absolute inset-0 block h-full w-full bg-transparent"
                />
              )}
              {hoverHit && (
                <div
                  className="pointer-events-none absolute z-[10050] -translate-y-full whitespace-nowrap rounded border border-border bg-panel/95 px-1.5 py-0.5 text-muted-foreground"
                  style={{
                    left: hoverHit.x + 12 / Math.max(0.0001, scale),
                    top: hoverHit.y - 8 / Math.max(0.0001, scale),
                    fontSize: 11 / Math.max(0.0001, scale),
                  }}
                >
                  {hoverHit.label}
                </div>
              )}
              {visibleEditorParts.map((part) => (
                <PartLayer
                  key={part.id}
                  part={part}
                  selected={part.id === selectedPartId}
                  dimmed={focusEditing && getPartSlotId(part) !== rangeEdit?.slotId}
                  blurred={editingActive && getPartSlotId(part) !== restrictSlotId}
                  ghosted={
                    !!selectedPart &&
                    part.id !== selectedPartId &&
                    getPartSlotId(part) === getPartSlotId(selectedPart)
                  }
                  preview={preview}
                  previewParentPart={previewParentPart}
                  allParts={editorAngleParts}
                  runtime={resolvedEditorRuntime}
                  previewVariantKey={variantPreview[getPartSlotId(part)]}
                  shift={partShift(part)}
                  placement={runtimePlacementForPart(part)}
                />
              ))}
              {showBones && !focusEditing && mode === "select" && (
                <RigBonesOverlay
                  doc={doc}
                  variantPreview={variantPreview}
                  selectedBoneId={selectedBoneId}
                  scale={scale}
                  onSelectBone={selectBone}
                  onStartBoneDrag={startBoneDrag}
                />
              )}
              {showAnchors && !focusEditing && mode === "select" && (
                <VariantAnchorOverlay
                  doc={doc}
                  variantPreview={variantPreview}
                  anchorDrag={anchorDrag}
                  emphasisSlotId={
                    restrictSlotId ??
                    selectedSlotId ??
                    (selectedPart ? getPartSlotId(selectedPart) : null)
                  }
                  scale={scale}
                  onStartAnchorDrag={startAnchorDrag}
                />
              )}
              {selectedDeformPathPart?.deform?.mode === "limb-path" && !focusEditing && (
                <DeformPathOverlay
                  part={selectedDeformPathPart}
                  deform={selectedDeformPathPart.deform}
                  previewTransform={partPreviewTransform(selectedDeformPathPart)}
                  scale={scale}
                  canvasWidth={doc.canvasWidth}
                  canvasHeight={doc.canvasHeight}
                  editing={meshPathEditing}
                  onToggleEditing={() =>
                    setMeshEditPartId(meshPathEditing ? null : selectedDeformPathPart.id)
                  }
                  onSetDeform={(deform, options) =>
                    setSlotDeform(getPartSlotId(selectedDeformPathPart), deform, options)
                  }
                />
              )}
              {selectedSlotId &&
                selectedSlotBounds &&
                !focusEditing &&
                // While mesh-path editing, the group box would swallow the path
                // knobs' pointer events, so it is not rendered at all.
                !meshPathEditing &&
                // One-shot tools (pivot / bounds) take the next canvas click; the
                // group box would otherwise swallow it over the selected art.
                mode === "select" &&
                (() => {
                  return (
                    <GroupControlsOverlay
                      bounds={selectedSlotBounds}
                      scale={scale}
                      onStartMove={(e) => {
                        // Same gesture as dragging the art: while the parent previews a
                        // non-default variant, moving the group edits the anchor.
                        const anchorContext = anchorDragContextForSlot(selectedSlotId);
                        if (anchorContext) startAnchorDrag(e, anchorContext);
                        else startGroupDrag(e, selectedSlotId);
                      }}
                      onStartResize={(e, corner) => startGroupResize(e, selectedSlotId, corner)}
                      onStartRotate={(e) => startGroupRotate(e, selectedSlotId)}
                    />
                  );
                })()}
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
          {selectedEditorPart && !focusEditing && !meshPathEditing && mode === "select" && (
            // Hidden while a one-shot tool (pivot / bounds) is armed: its proxy
            // sits over the selected art and would otherwise capture the tool's
            // placement click before it reaches the canvas. Also hidden during
            // mesh-path editing — react-moveable portals its box outside the
            // canvas stacking context, so it cannot be layered under the knobs.
            <CharacterPartMoveable
              part={selectedEditorPart}
              previewTransform={partPreviewTransform(selectedEditorPart)}
              canvasRef={canvasRef}
              wrapRef={wrapRef}
              scale={scale}
              boundsMode={boundsMode}
              onBegin={() => {
                setInteracting(true);
                pushUndoSnapshot();
              }}
              onPatch={(patch) => updatePart(selectedEditorPart.id, patch, { history: false })}
              onEnd={() => setInteracting(false)}
            />
          )}
          <div className="pointer-events-none absolute bottom-2 right-3 rounded bg-panel/80 px-2 py-1 text-[10px] text-muted-foreground">
            {doc.canvasWidth}×{doc.canvasHeight} · {Math.round(scale * 100)}%
          </div>
          <div className="absolute bottom-2 left-3 flex gap-1">
            {editorPhase !== "build" && (
              <>
                <button
                  type="button"
                  aria-pressed={showBones}
                  onClick={toggleBones}
                  className={`flex items-center gap-1 rounded border bg-panel/90 px-2 py-1 text-[10px] ${
                    showBones
                      ? "border-primary text-primary"
                      : "border-border text-muted-foreground"
                  }`}
                  title={
                    showBones
                      ? "Hide the skeleton"
                      : "Show the skeleton — calibrate joints or move joints with art"
                  }
                >
                  {showBones ? <Eye size={11} /> : <EyeOff size={11} />}
                  Bones
                </button>
                {showBones && (
                  <div
                    role="group"
                    aria-label="Bone drag mode"
                    className="flex overflow-hidden rounded border border-border bg-panel/90 text-[10px]"
                  >
                    <button
                      type="button"
                      aria-pressed={boneDragMode === "calibrate"}
                      onClick={() => setBoneDragMode("calibrate")}
                      className={`px-2 py-1 ${
                        boneDragMode === "calibrate"
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      title="Drag bones onto the artwork while images stay pinned"
                    >
                      Calibrate
                    </button>
                    <button
                      type="button"
                      aria-pressed={boneDragMode === "moveArt"}
                      onClick={() => setBoneDragMode("moveArt")}
                      className={`border-l border-border px-2 py-1 ${
                        boneDragMode === "moveArt"
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      title="Drag the joint and attached artwork together"
                    >
                      Move art
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  aria-pressed={showAnchors}
                  onClick={() => setShowAnchors((shown) => !shown)}
                  className={`flex items-center gap-1 rounded border bg-panel/90 px-2 py-1 text-[10px] ${
                    showAnchors
                      ? "border-primary text-primary"
                      : "border-border text-muted-foreground"
                  }`}
                  title="Show where each child re-anchors per parent variant"
                >
                  {showAnchors ? <Eye size={11} /> : <EyeOff size={11} />}
                  Anchors
                </button>
              </>
            )}
          </div>
          {modeBanner && (
            <div
              role="status"
              className="absolute left-1/2 top-3 z-[80] flex -translate-x-1/2 items-center gap-3 rounded-full border border-primary/50 bg-panel/95 px-4 py-1.5 text-xs text-foreground shadow-[var(--shadow-panel)]"
            >
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary" />
              {modeBanner.text}
              {modeBanner.cancel && (
                <button
                  type="button"
                  onClick={modeBanner.cancel}
                  className="rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  {modeBanner.cancelLabel ?? "Cancel"} (Esc)
                </button>
              )}
            </div>
          )}
          {!modeBanner && renderBlockingRigIssues.length > 0 && (
            <div
              role="status"
              className="absolute left-1/2 top-3 z-[80] flex max-w-[min(720px,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded border border-amber-500/50 bg-panel/95 px-3 py-2 text-xs text-foreground shadow-[var(--shadow-panel)]"
            >
              <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-amber-200">Render preview paused.</span>{" "}
                <span className="text-muted-foreground">
                  {renderBlockingRigFix
                    ? `${renderBlockingRigFix.childSlotName} needs an attach point on ${renderBlockingRigFix.parentSlotName} (${renderBlockingRigFix.parentVariantKey}).`
                    : renderBlockingRigIssues[0]?.message}
                  {renderBlockingRigIssues.length > 1
                    ? ` (+${renderBlockingRigIssues.length - 1} more)`
                    : ""}
                </span>
              </span>
              {renderBlockingRigFix && (
                <button
                  type="button"
                  onClick={() => armRenderBlockingRigFix(renderBlockingRigFix)}
                  className="shrink-0 rounded border border-amber-400/60 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-100 hover:bg-amber-400/15"
                  title={renderBlockingRigFix.instructions}
                >
                  Fix this pin
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setShowAnchors(true);
                  switchPhase("rig");
                }}
                className="shrink-0 rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
              >
                Show rig tools
              </button>
            </div>
          )}
          {status && (
            <div
              role="status"
              className="absolute bottom-10 left-3 flex items-center gap-2 rounded border border-border bg-panel/95 px-3 py-2 text-xs shadow-[var(--shadow-panel)]"
            >
              {status}
              {statusUndo && (
                <button
                  type="button"
                  onClick={() => {
                    undoCharacterHistory();
                    setStatus(null);
                    setStatusUndo(false);
                  }}
                  className="rounded border border-border px-2 py-0.5 text-[10px] text-primary hover:bg-panel-2"
                >
                  Undo
                </button>
              )}
            </div>
          )}
          {visibleEditorParts.length === 0 && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="max-w-xs rounded border border-dashed border-border bg-panel/80 p-4 text-center text-xs text-muted-foreground">
                {doc.parts.length === 0 ? (
                  <>
                    <div className="mb-1 font-medium text-foreground">Drop SVG drawings here</div>
                    …or use the Upload slots on the left. You're building the{" "}
                    {ANGLE_LABELS[editorActiveAngle]} view.
                  </>
                ) : (
                  <>
                    <div className="mb-1 font-medium text-foreground">
                      {ANGLE_LABELS[editorActiveAngle]} has no drawings yet
                    </div>
                    Upload {ANGLE_LABELS[editorActiveAngle]} versions into the same slots — other
                    angles keep their own artwork.
                  </>
                )}
              </div>
            </div>
          )}
          {(Object.keys(variantPreview).length > 0 || activePose) && (
            <div className="absolute right-4 top-4 flex max-w-72 flex-col items-end gap-1">
              {activePose && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-panel/95 px-2 py-0.5 text-[10px] text-primary shadow-[var(--shadow-panel)]">
                  <span className="truncate">
                    Pose: {activePose.name}
                    {poseModified ? " · edited" : ""}
                  </span>
                  <button
                    type="button"
                    onClick={showRestPose}
                    className="rounded text-muted-foreground hover:text-foreground"
                    title="Back to rest (no pose)"
                  >
                    ×
                  </button>
                </span>
              )}
              {Object.entries(variantPreview)
                // With a pose active, only call out slots deviating from it.
                .filter(([slotId, key]) => !appliedPoseMap || appliedPoseMap[slotId] !== key)
                .map(([slotId, key]) => (
                  <span
                    key={slotId}
                    className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-panel/95 px-2 py-0.5 text-[10px] text-primary shadow-[var(--shadow-panel)]"
                  >
                    <span className="truncate">{slotNameFor(slotId)}</span>
                    <span className="font-mono">{key}</span>
                    <button
                      type="button"
                      onClick={() =>
                        appliedPoseMap ? resetSlotToPose(slotId) : clearVariantPreview(slotId)
                      }
                      className="rounded text-muted-foreground hover:text-foreground"
                      title={
                        appliedPoseMap
                          ? "Back to the pose's variant"
                          : "Stop previewing this variant"
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              {activePose && poseModified && appliedPoseMap && (
                <button
                  type="button"
                  onClick={() => setVariantPreview({ ...appliedPoseMap })}
                  className="rounded border border-border bg-panel/95 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Reset to pose
                </button>
              )}
              {!activePose && Object.keys(variantPreview).length > 1 && (
                <button
                  type="button"
                  onClick={() => clearVariantPreview()}
                  className="rounded border border-border bg-panel/95 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Reset all previews
                </button>
              )}
            </div>
          )}
        </main>

        <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-panel text-xs">
          <div className="flex shrink-0 border-b border-border">
            {(
              [
                { ph: "build", label: "Build" },
                { ph: "rig", label: "Rig" },
                { ph: "pose", label: "Pose" },
              ] as const
            ).map(({ ph, label }) => (
              <button
                key={ph}
                type="button"
                onClick={() => switchPhase(ph)}
                className={`flex-1 py-2 text-[11px] font-medium ${
                  editorPhase === ph
                    ? "border-b-2 border-primary text-foreground"
                    : "border-b-2 border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-auto p-3">
            <div className="space-y-4">
              {editorPhase === "build" && (
                <CanvasSection
                  doc={doc}
                  onChange={(patch) => updateDoc(patch)}
                  onFitActiveAngle={fitActiveAngleToCanvas}
                />
              )}
              {editorPhase === "rig" && (
                <>
                  <SkeletonCard
                    doc={doc}
                    selectedBoneId={selectedBoneId}
                    selectedSlotId={
                      selectedSlotId ?? (selectedPart ? getPartSlotId(selectedPart) : null)
                    }
                    selectedPart={selectedPart}
                    showBones={showBones}
                    activeVariants={variantPreview}
                    onSceneCommand={(command) => commitSceneCommand(command)}
                    onRigChange={(rig) => updateDoc({ rig })}
                    onResetRig={() => {
                      updateDoc({ rig: buildDefaultRig(doc) });
                      setStatusUndoable("Skeleton reset to default");
                    }}
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
                  <RigHealthPanel
                    doc={doc}
                    report={rigHealthReport}
                    defaultOpen
                    onJumpTo={(row) => {
                      if (row.childSlotId) selectSlot(row.childSlotId);
                      if (row.parentSlotId && row.variantKey)
                        previewVariant(row.parentSlotId, row.variantKey);
                      setShowAnchors(true);
                    }}
                  />
                </>
              )}
              {selectedSlotId && selectedSlotBounds ? (
                <GroupInspector
                  doc={doc}
                  slotId={selectedSlotId}
                  parts={selectedSlotParts}
                  bounds={selectedSlotBounds}
                  keyIssues={variantKeyIssues}
                  phase={editorPhase}
                  onSwitchPhase={switchPhase}
                  onImport={importSvg}
                  mirrorPlan={mirrorPlanForSlot(selectedSlotId)}
                  onMirror={() => mirrorSlotToOtherSide(selectedSlotId)}
                  onSetDeform={(deform, options) => setSlotDeform(selectedSlotId, deform, options)}
                  previewedKey={variantPreview[selectedSlotId]}
                  variantPreview={variantPreview}
                  pinPlacement={pinPlacement}
                  onPreviewVariant={previewVariant}
                  onClearPreview={clearVariantPreview}
                  onArmPinPlacement={setPinPlacement}
                  onClearPin={clearPin}
                  onResetPin={resetPinToArtwork}
                  onSetRotation={setAnchorRotation}
                  onUpdateSlot={(patch) => updateSlotRecord(selectedSlotId, patch)}
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
                  keyIssues={variantKeyIssues}
                  phase={editorPhase}
                  onSwitchPhase={switchPhase}
                  onSelectSlot={selectSlot}
                  variantPreview={variantPreview}
                  alignPlan={selectedAlignPlan}
                  onAlignVariant={alignSelectedVariantArt}
                  onSetDeform={(deform, options) =>
                    selectedPart && setSlotDeform(getPartSlotId(selectedPart), deform, options)
                  }
                  anchorDragContext={
                    selectedPart ? anchorDragContextForSlot(getPartSlotId(selectedPart)) : null
                  }
                  pinPlacement={pinPlacement}
                  onPreviewVariant={previewVariant}
                  onArmPinPlacement={setPinPlacement}
                  onClearPin={clearPin}
                  onResetPin={resetPinToArtwork}
                  onSetRotation={setAnchorRotation}
                  onModeChange={setMode}
                  onBoundsModeChange={setBoundsMode}
                  onAttachSlot={setSlotAttachTo}
                  onChange={updatePartVariant}
                  onRemove={removePart}
                  onDuplicate={duplicatePart}
                  onPreview={setPreview}
                />
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
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

function DeformPathOverlay({
  part,
  deform,
  previewTransform,
  scale,
  canvasWidth,
  canvasHeight,
  editing,
  onToggleEditing,
  onSetDeform,
}: {
  part: CharacterPart;
  deform: Extract<CharacterPartDeform, { mode: "limb-path" }>;
  previewTransform: EditorPartTransform;
  scale: number;
  canvasWidth: number;
  canvasHeight: number;
  editing?: boolean;
  onToggleEditing?: () => void;
  onSetDeform?: (deform: CharacterPartDeform | undefined, options?: { history?: boolean }) => void;
}) {
  const stroke = Math.max(1.5, 2 / Math.max(0.0001, scale));
  const knob = Math.max(4, 5 / Math.max(0.0001, scale));
  const toCanvas = (point: { x: number; y: number }) =>
    partLocalPointToCanvas(part, point, previewTransform);
  const samples = deformPathSamples(deform);
  const pathPoints = samples.map(toCanvas);
  const pathD = pathPoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const start = toCanvas(deform.start);
  const end = toCanvas(deform.end);
  const curveLocal = deform.curve ?? {
    x: (deform.start.x + deform.end.x) / 2,
    y: (deform.start.y + deform.end.y) / 2,
  };
  const curve = deform.curve ? toCanvas(deform.curve) : null;
  // While editing, an unset curve shows as a ghost dot at the chord midpoint;
  // dragging it authors deform.curve.
  const curveGhost = !deform.curve && editing ? toCanvas(curveLocal) : null;
  const locks = (deform.locks ?? []).map(toCanvas);
  const interactive = editing && !!onSetDeform;
  const knobClass = interactive ? "pointer-events-auto cursor-grab" : undefined;
  // The joint (elbow/knee) marker slides along the spine; default is midway.
  const jointLocal = deform.joint ?? limbPathPointAt(samples, 0.5);
  const joint = toCanvas(jointLocal);
  // Fold-direction arrow: which side the elbow will swing toward. Solid when
  // the direction is locked, faded when it is only implied by the curve point.
  const foldSide = deform.side === 1 || deform.side === -1 ? deform.side : limbPathBendSide(deform);
  let foldArrow: { from: { x: number; y: number }; to: { x: number; y: number } } | null = null;
  if (foldSide) {
    const jointT = Math.max(0.05, Math.min(0.95, limbPathProjectPointT(samples, jointLocal)));
    const ahead = limbPathPointAt(samples, Math.min(1, jointT + 0.05));
    const behind = limbPathPointAt(samples, Math.max(0, jointT - 0.05));
    const tangentLength = Math.hypot(ahead.x - behind.x, ahead.y - behind.y) || 1;
    const nx = -(ahead.y - behind.y) / tangentLength;
    const ny = (ahead.x - behind.x) / tangentLength;
    const reach = Math.max(16, (deform.width ?? 30) * 0.75);
    foldArrow = {
      from: joint,
      to: toCanvas({
        x: jointLocal.x + nx * foldSide * reach,
        y: jointLocal.y + ny * foldSide * reach,
      }),
    };
  }
  const foldArrowHead = (() => {
    if (!foldArrow) return null;
    const dx = foldArrow.to.x - foldArrow.from.x;
    const dy = foldArrow.to.y - foldArrow.from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const size = knob * 1.4;
    const baseX = foldArrow.to.x - ux * size;
    const baseY = foldArrow.to.y - uy * size;
    return `${foldArrow.to.x},${foldArrow.to.y} ${baseX - uy * size * 0.6},${baseY + ux * size * 0.6} ${baseX + uy * size * 0.6},${baseY - ux * size * 0.6}`;
  })();

  const startPointDrag = (e: React.PointerEvent<SVGElement>, kind: "joint" | "end" | "curve") => {
    if (e.button !== 0 || !interactive || !onSetDeform) return;
    e.preventDefault();
    e.stopPropagation();
    const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement;
    const rect = svg?.getBoundingClientRect();
    if (!rect) return;
    const pxPerUnitX = rect.width / Math.max(1, canvasWidth);
    const pxPerUnitY = rect.height / Math.max(1, canvasHeight);
    const round1 = (value: number) => Math.round(value * 10) / 10;
    // One undo checkpoint for the whole drag: history on the first patch only.
    let first = true;
    const move = (ev: PointerEvent) => {
      const canvasPoint = {
        x: (ev.clientX - rect.left) / pxPerUnitX,
        y: (ev.clientY - rect.top) / pxPerUnitY,
      };
      const local = canvasPointToPartLocal(part, canvasPoint, previewTransform);
      const point = { x: round1(local.x), y: round1(local.y) };
      if (kind === "joint") {
        // The joint slides along the spine rather than floating free.
        const t = Math.max(0.05, Math.min(0.95, limbPathProjectPointT(samples, local)));
        const snapped = limbPathPointAt(samples, t);
        onSetDeform(
          { ...deform, joint: { x: round1(snapped.x), y: round1(snapped.y) } },
          { history: first },
        );
      } else if (kind === "end") {
        onSetDeform({ ...deform, end: point }, { history: first });
      } else {
        onSetDeform({ ...deform, curve: point }, { history: first });
      }
      first = false;
    };
    startWindowPointerDrag({
      onMove: move,
      onEnd: (event) => {
        if (event) move(event);
      },
    });
  };

  const chipFont = 11 / Math.max(0.0001, scale);
  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0"
        width={canvasWidth}
        height={canvasHeight}
        // Above the group-move surface (10000) and bone markers (11000) so the
        // joint knob receives pointer events instead of starting an art drag.
        style={{ zIndex: 11500 }}
        aria-hidden="true"
      >
        <path
          d={pathD}
          fill="none"
          stroke="#14b8a6"
          strokeWidth={stroke}
          strokeDasharray={`${stroke * 3} ${stroke * 2}`}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {foldArrow && (
          <g opacity={deform.side === 1 || deform.side === -1 ? 1 : 0.45}>
            <line
              x1={foldArrow.from.x}
              y1={foldArrow.from.y}
              x2={foldArrow.to.x}
              y2={foldArrow.to.y}
              stroke="#a855f7"
              strokeWidth={stroke * 1.2}
            />
            {foldArrowHead && <polygon points={foldArrowHead} fill="#a855f7" />}
          </g>
        )}
        <circle
          cx={start.x}
          cy={start.y}
          r={knob}
          fill="#ffffff"
          stroke="#111827"
          strokeWidth={stroke}
        />
        {locks.map((lock, index) => (
          <circle
            key={index}
            cx={lock.x}
            cy={lock.y}
            r={knob * 0.9}
            fill="#facc15"
            stroke="#7c2d12"
            strokeWidth={stroke}
          />
        ))}
        {curve && (
          <circle
            cx={curve.x}
            cy={curve.y}
            r={knob * (editing ? 1.15 : 0.9)}
            fill="#f59e0b"
            stroke="#7c2d12"
            strokeWidth={stroke}
            className={knobClass}
            onPointerDown={interactive ? (e) => startPointDrag(e, "curve") : undefined}
          >
            {interactive && <title>Curve — drag to give the limb its natural bend</title>}
          </circle>
        )}
        {curveGhost && (
          <circle
            cx={curveGhost.x}
            cy={curveGhost.y}
            r={knob * 1.15}
            fill="rgba(245, 158, 11, 0.35)"
            stroke="#f59e0b"
            strokeWidth={stroke}
            strokeDasharray={`${stroke * 2} ${stroke * 2}`}
            className={knobClass}
            onPointerDown={interactive ? (e) => startPointDrag(e, "curve") : undefined}
          >
            <title>Curve — drag to give the limb its natural bend</title>
          </circle>
        )}
        <circle
          cx={end.x}
          cy={end.y}
          r={knob * (editing ? 1.4 : 1.15)}
          fill="#14b8a6"
          stroke="#0f766e"
          strokeWidth={stroke}
          className={knobClass}
          onPointerDown={interactive ? (e) => startPointDrag(e, "end") : undefined}
        >
          {interactive && <title>End — drag to where this limb's tip sits in the artwork</title>}
        </circle>
        <g transform={`translate(${joint.x} ${joint.y}) rotate(45)`}>
          <rect
            x={-knob * (editing ? 1.3 : 1)}
            y={-knob * (editing ? 1.3 : 1)}
            width={knob * 2 * (editing ? 1.3 : 1)}
            height={knob * 2 * (editing ? 1.3 : 1)}
            fill="#a855f7"
            stroke="#581c87"
            strokeWidth={stroke}
            className={knobClass}
            onPointerDown={interactive ? (e) => startPointDrag(e, "joint") : undefined}
          >
            <title>Joint — drag along the path to set where this limb bends</title>
          </rect>
        </g>
      </svg>
      {onToggleEditing && (
        <button
          type="button"
          className="pointer-events-auto absolute -translate-x-1/2 rounded-full border font-semibold shadow"
          style={{
            left: start.x,
            top: start.y - 36 / Math.max(0.0001, scale),
            zIndex: 11500,
            fontSize: chipFont,
            padding: `${3 / Math.max(0.0001, scale)}px ${9 / Math.max(0.0001, scale)}px`,
            background: editing ? "#a855f7" : "rgba(24, 24, 27, 0.92)",
            color: editing ? "#fff" : "#e9d5ff",
            borderColor: "#a855f7",
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onToggleEditing}
          title={
            editing
              ? "Finish editing the mesh path and restore normal move controls"
              : "Edit the mesh path: drag the joint, end, and curve points (art dragging pauses)"
          }
        >
          {editing ? "✓ Done" : "✎ Edit path"}
        </button>
      )}
    </>
  );
}

function deformPathSamples(deform: Extract<CharacterPartDeform, { mode: "limb-path" }>) {
  const count = Math.max(2, Math.round(deform.segments ?? 12));
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    if (!deform.curve) {
      points.push({
        x: deform.start.x + (deform.end.x - deform.start.x) * t,
        y: deform.start.y + (deform.end.y - deform.start.y) * t,
      });
      continue;
    }
    const inv = 1 - t;
    points.push({
      x: inv * inv * deform.start.x + 2 * inv * t * deform.curve.x + t * t * deform.end.x,
      y: inv * inv * deform.start.y + 2 * inv * t * deform.curve.y + t * t * deform.end.y,
    });
  }
  return points;
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

/**
 * Editor chrome marking, for every bone whose anchor depends on its parent slot's variant, the
 * parent pivot (white) and the currently resolved child anchor — colored by resolution path
 * (pin green / paired art blue / missing amber), matching the Motion Editor's overlay.
 */
function VariantAnchorOverlay({
  doc,
  variantPreview,
  anchorDrag,
  emphasisSlotId,
  scale,
  onStartAnchorDrag,
}: {
  doc: CharacterPreset;
  variantPreview: Record<ID, string>;
  anchorDrag: { childSlotId: ID; dx: number; dy: number } | null;
  emphasisSlotId: ID | null;
  scale: number;
  onStartAnchorDrag: (
    e: React.PointerEvent,
    context: { childSlotId: ID; parentSlotId: ID; variantKey: string },
  ) => void;
}) {
  const runtime = buildCharacterRuntime(doc);
  const world = runtimeBoneWorldTransforms(runtime, variantPreview);
  const slotName = (slotId: ID) => findCharacterSlot(doc, slotId)?.name ?? slotId;
  const dotRadius = Math.max(4, 5 / Math.max(0.0001, scale));
  const fontSize = Math.max(9, 10 / Math.max(0.0001, scale));
  const markers: Array<{
    boneId: string;
    x: number;
    y: number;
    parentX: number;
    parentY: number;
    color: string;
    label: string;
    faded: boolean;
    focused: boolean;
    /** Set when a parent variant is previewed — the marker is then a draggable anchor handle. */
    dragContext: { childSlotId: ID; parentSlotId: ID; variantKey: string } | null;
  }> = [];
  for (const bone of runtime.angleRig.bones) {
    if (!bone.parentId) continue;
    const at = world.get(bone.id);
    const parentAt = world.get(bone.parentId);
    const childSlotId = runtime.angleRig.slotBindings.find(
      (binding) => binding.boneId === bone.id,
    )?.slotId;
    const parentSlotId = bone.restSource?.slotId;
    if (!at || !parentAt || !childSlotId || !parentSlotId) continue;
    const activeKey = variantPreview[parentSlotId];
    const source = activeKey ? anchorSourceForChild(doc, childSlotId, activeKey) : "pin";
    const dragShift =
      anchorDrag && anchorDrag.childSlotId === childSlotId
        ? { dx: anchorDrag.dx, dy: anchorDrag.dy }
        : { dx: 0, dy: 0 };
    markers.push({
      boneId: bone.id,
      x: at.x + dragShift.dx,
      y: at.y + dragShift.dy,
      parentX: parentAt.x,
      parentY: parentAt.y,
      color: activeKey ? ANCHOR_SOURCE_COLORS[source] : "#94a3b8",
      label: `${slotName(childSlotId)} ← ${slotName(parentSlotId)} : ${activeKey ?? "rest"}${
        activeKey ? ` (${source})` : ""
      }`,
      faded: !!emphasisSlotId && childSlotId !== emphasisSlotId && parentSlotId !== emphasisSlotId,
      focused:
        (!!emphasisSlotId && (childSlotId === emphasisSlotId || parentSlotId === emphasisSlotId)) ||
        anchorDrag?.childSlotId === childSlotId,
      dragContext: activeKey ? { childSlotId, parentSlotId, variantKey: activeKey } : null,
    });
  }
  if (markers.length === 0) return null;
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={doc.canvasWidth}
      height={doc.canvasHeight}
      style={{ zIndex: 11000 }}
    >
      {markers.map((marker) => (
        <g key={marker.boneId} className="group" opacity={marker.faded ? 0.18 : 1}>
          <line
            x1={marker.parentX}
            y1={marker.parentY}
            x2={marker.x}
            y2={marker.y}
            stroke={marker.color}
            strokeDasharray={`${4 / Math.max(0.0001, scale)} ${3 / Math.max(0.0001, scale)}`}
            strokeWidth={Math.max(1, 1.5 / Math.max(0.0001, scale))}
          />
          <circle
            cx={marker.parentX}
            cy={marker.parentY}
            r={dotRadius * 0.7}
            fill="rgba(255,255,255,0.85)"
            stroke="#0f172a"
            strokeWidth={Math.max(0.75, 1 / Math.max(0.0001, scale))}
          />
          {marker.dragContext ? (
            <g
              className="pointer-events-auto cursor-move"
              role="button"
              aria-label={`Drag to move the ${marker.label} anchor`}
              onPointerDown={(e) => {
                e.stopPropagation();
                onStartAnchorDrag(e, marker.dragContext!);
              }}
            >
              {/* Generous invisible hit area — the visible dot is small at editor zoom. */}
              <circle cx={marker.x} cy={marker.y} r={dotRadius * 2.4} fill="transparent" />
              <circle
                cx={marker.x}
                cy={marker.y}
                r={dotRadius}
                fill={marker.color}
                stroke="#0f172a"
                strokeWidth={Math.max(0.75, 1 / Math.max(0.0001, scale))}
              />
              <title>Drag to move this variant pin</title>
            </g>
          ) : (
            <>
              <circle
                className="pointer-events-auto"
                cx={marker.x}
                cy={marker.y}
                r={dotRadius * 2.2}
                fill="transparent"
              />
              <circle
                cx={marker.x}
                cy={marker.y}
                r={dotRadius}
                fill={marker.color}
                stroke="#0f172a"
                strokeWidth={Math.max(0.75, 1 / Math.max(0.0001, scale))}
              />
            </>
          )}
          <text
            className={
              marker.focused
                ? "opacity-100"
                : "opacity-0 transition-opacity group-hover:opacity-100"
            }
            x={marker.x + dotRadius + 3}
            y={marker.y - dotRadius - 3}
            fill={marker.color}
            stroke="rgba(15,23,42,0.85)"
            strokeWidth={3}
            paintOrder="stroke"
            fontSize={fontSize}
          >
            {marker.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function RigBonesOverlay({
  doc,
  variantPreview,
  selectedBoneId,
  scale,
  onSelectBone,
  onStartBoneDrag,
}: {
  doc: CharacterPreset;
  variantPreview: Readonly<Record<ID, string>>;
  selectedBoneId: ID | null;
  scale: number;
  onSelectBone: (boneId: ID) => void;
  onStartBoneDrag: (e: React.PointerEvent, boneId: ID) => void;
}) {
  const runtime = buildCharacterRuntime(doc);
  const world = runtimeBoneWorldTransforms(runtime, variantPreview);
  const bones = runtime.angleRig.bones;
  const radius = Math.max(6, 8 / Math.max(0.0001, scale));
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={doc.canvasWidth}
      height={doc.canvasHeight}
      style={{ zIndex: 12000 }}
    >
      {bones.map((bone) => {
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
      {bones.map((bone) => {
        const point = world.get(bone.id);
        if (!point) return null;
        const selected = bone.id === selectedBoneId;
        return (
          <g
            key={bone.id}
            role="button"
            tabIndex={0}
            aria-label={`Select ${bone.name} bone`}
            className="group pointer-events-auto cursor-move"
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
              className={
                selected
                  ? "opacity-100"
                  : "opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100"
              }
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

/**
 * Slot-level "Flexible" path-mesh control. Shown in both the part Inspector
 * (single-image limbs) and the GroupInspector (multi-variant slots) so it is
 * reachable however the layer is selected. Deform is written to every variant
 * of the slot so swaps stay consistent; face builders are excluded.
 */

type EditorPartTransform = ReturnType<typeof previewDelta>;

function composeEditorPartTransform(
  part: CharacterPart,
  base: EditorPartTransform,
  shift?: { dx: number; dy: number; rotation?: number },
  placement?: RuntimePartPlacement,
): EditorPartTransform {
  return {
    ...base,
    dx: base.dx + (placement ? placement.x - part.x : 0) + (shift?.dx ?? 0),
    dy: base.dy + (placement ? placement.y - part.y : 0) + (shift?.dy ?? 0),
    rotation:
      base.rotation + (placement ? placement.rotation - part.rotation : 0) + (shift?.rotation ?? 0),
    scale: base.scale * (placement?.scaleX ?? 1),
    scaleY: (base.scaleY ?? base.scale) * (placement?.scaleY ?? 1),
  };
}

function PartLayer({
  part,
  selected,
  dimmed = false,
  blurred = false,
  ghosted = false,
  preview,
  previewParentPart,
  allParts,
  runtime,
  previewVariantKey,
  shift,
  placement,
}: {
  part: CharacterPart;
  selected: boolean;
  dimmed?: boolean;
  blurred?: boolean;
  /**
   * A sibling variant of this slot is selected: render this variant as a crisp faint ghost
   * so the selected variant can be aligned against it (instead of hiding it, or stacking
   * the default at full opacity).
   */
  ghosted?: boolean;
  preview: PreviewState | null;
  previewParentPart?: CharacterPart;
  allParts: CharacterPart[];
  runtime: CharacterRuntime;
  /** The slot's in-place variant preview key — wins over the default variant resolution. */
  previewVariantKey?: string;
  /** Variant-preview re-anchor offset (canvas px) + rotation when a parent previews a variant. */
  shift?: { dx: number; dy: number; rotation?: number };
  /** Resolved registration/pin placement shared with generated output. */
  placement?: RuntimePartPlacement;
}) {
  const sameSlotParts = allParts.filter(
    (candidate) => getPartSlotId(candidate) === getPartSlotId(part),
  );
  const ghost = ghosted && sameSlotParts.length > 1 && part.visible;
  const activeVariant =
    sameSlotParts.length > 1
      ? (previewVariantKey ??
        activePreviewVariantForPart(part, preview) ??
        defaultVariantForSlotParts(sameSlotParts, part.role))
      : undefined;
  if (sameSlotParts.length > 1 && !selected && !ghost) {
    if (activeVariant && !partMatchesVariant(part, activeVariant)) return null;
  }
  if (!part.visible && !selected && !previewVariantKey) return null;

  const baseTransform = previewDelta(part, preview, previewParentPart, allParts, runtime);
  const previewTransform = composeEditorPartTransform(part, baseTransform, shift, placement);
  const baseOpacity = part.visible ? previewTransform.opacity : 0.28;
  // In movement-range focus mode, fade everything except the layer being edited. While the
  // active layer is being edited, the others get a slight blur (and a touch of fade) instead.
  // Ghosted sibling variants stay crisp (no blur) so misaligned variant art can be
  // aligned against them by eye.
  const opacity = ghost
    ? baseOpacity * 0.35
    : dimmed
      ? baseOpacity * 0.12
      : blurred
        ? baseOpacity * 0.7
        : baseOpacity;
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
          zIndex: placement?.drawOrder ?? part.zIndex,
          opacity,
          filter: !ghost && blurred && !dimmed ? "blur(2px)" : undefined,
          transition: "filter 120ms ease",
          pointerEvents: "none",
          transform: `rotate(${part.rotation + previewTransform.rotation}deg) scale(${previewTransform.scale}, ${previewTransform.scaleY ?? previewTransform.scale})`,
          transformOrigin: `${((pivot.x - part.x) / part.width) * 100}% ${((pivot.y - part.y) / part.height) * 100}%`,
        }}
        data-character-editor-chrome="part-frame"
        aria-label={selected ? `${part.name} selection frame` : undefined}
      />
    </>
  );
}

function editorPartMatrix(part: CharacterPart, previewTransform: ReturnType<typeof previewDelta>) {
  const pivot = pivotForPart(part);
  const pivotLocal = { x: pivot.x - part.x, y: pivot.y - part.y };
  return composeMatrices(
    translationMatrix(
      part.x + previewTransform.dx + pivotLocal.x,
      part.y + previewTransform.dy + pivotLocal.y,
    ),
    matrixAroundPoint(
      { x: 0, y: 0 },
      {
        rotation: part.rotation + previewTransform.rotation,
        scaleX: previewTransform.scale,
        scaleY: previewTransform.scaleY ?? previewTransform.scale,
      },
    ),
    translationMatrix(-pivotLocal.x, -pivotLocal.y),
  );
}

function canvasPointToPartLocal(
  part: CharacterPart,
  canvasPoint: { x: number; y: number },
  previewTransform: ReturnType<typeof previewDelta>,
) {
  return transformPoint(invertMatrix(editorPartMatrix(part, previewTransform)), canvasPoint);
}

function partLocalPointToCanvas(
  part: CharacterPart,
  localPoint: { x: number; y: number },
  previewTransform: ReturnType<typeof previewDelta>,
) {
  return transformPoint(editorPartMatrix(part, previewTransform), localPoint);
}

function resizeCursor(corner: ResizeCorner) {
  return corner === "nw" || corner === "se" ? "cursor-nwse-resize" : "cursor-nesw-resize";
}

/**
 * Selection chrome for the selected part — a thin adapter over the shared
 * `TransformMoveable` (the same control the Stage and motion recorder use). The box hugs the
 * part's SELECTION bounds (`editorSelectionBounds`, i.e. alpha/art in "art" mode, the full
 * transparent frame in "frame" mode) instead of the raw image frame, so it no longer spans the
 * canvas or eats clicks meant for layers underneath. Every gesture converts back to canvas units
 * through one patch path: one undo snapshot at gesture start, history-off part patches while it runs.
 */
function CharacterPartMoveable({
  part,
  previewTransform,
  canvasRef,
  wrapRef,
  scale,
  boundsMode,
  onBegin,
  onPatch,
  onEnd,
}: {
  part: CharacterPart;
  previewTransform: EditorPartTransform;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  wrapRef: React.RefObject<HTMLDivElement | null>;
  scale: number;
  boundsMode: EditorBoundsMode;
  onBegin: () => void;
  onPatch: (patch: Partial<CharacterPart>) => void;
  onEnd: () => void;
}) {
  // The editor canvas's top-left within the wrap element — the origin all screen rects are
  // measured from. Re-measured every render (cheap) and only committed when it actually changes;
  // updates from a layout effect are flushed by React before paint, so there is no visible flash.
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const viewScale = Math.max(0.0001, scale);

  // Re-measure after every render because surrounding editor chrome can move without changing refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const canvasBox = canvas.getBoundingClientRect();
    const wrapBox = wrap.getBoundingClientRect();
    const x = canvasBox.left - wrapBox.left;
    const y = canvasBox.top - wrapBox.top;
    setOrigin((prev) => (prev && prev.x === x && prev.y === y ? prev : { x, y }));
  });

  if (!origin) return null;

  const dx = previewTransform.dx;
  const dy = previewTransform.dy;
  const toScreen = (rect: { x: number; y: number; width: number; height: number }): ScreenRect => ({
    left: origin.x + rect.x * viewScale,
    top: origin.y + rect.y * viewScale,
    width: Math.max(1, rect.width * viewScale),
    height: Math.max(1, rect.height * viewScale),
  });
  // A screen frame rect back to a part patch (canvas units, preview shift removed).
  const frameToCanvasPatch = (frame: ScreenRect) => ({
    x: Math.round((frame.left - origin.x) / viewScale - dx),
    y: Math.round((frame.top - origin.y) / viewScale - dy),
    width: Math.max(1, Math.round(frame.width / viewScale)),
    height: Math.max(1, Math.round(frame.height / viewScale)),
  });

  const sel = editorSelectionBounds(part, boundsMode);
  const contentRect = toScreen({
    x: part.x + dx + sel.x,
    y: part.y + dy + sel.y,
    width: sel.width,
    height: sel.height,
  });
  const frameRect = toScreen({
    x: part.x + dx,
    y: part.y + dy,
    width: part.width,
    height: part.height,
  });
  const pivotCanvas = pivotForPart(part);
  const pivot = {
    x: origin.x + (pivotCanvas.x + dx) * viewScale,
    y: origin.y + (pivotCanvas.y + dy) * viewScale,
  };

  return (
    <TransformMoveable
      contentRect={contentRect}
      frameRect={frameRect}
      rotationDeg={part.rotation + previewTransform.rotation}
      pivot={pivot}
      onInteractingChange={(interacting) => (interacting ? onBegin() : onEnd())}
      onMove={(frame) => {
        const patch = frameToCanvasPatch(frame);
        onPatch({ x: patch.x, y: patch.y });
      }}
      onResize={(frame) => {
        const patch = frameToCanvasPatch(frame);
        onPatch(patch);
      }}
      onRotate={(deg) => {
        onPatch({ rotation: Math.round((deg - previewTransform.rotation) * 10) / 10 });
      }}
    />
  );
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

function editorPartPivot(part: CharacterPart) {
  return (
    part.pivot ?? {
      x: part.x + part.width * part.anchorX,
      y: part.y + part.height * part.anchorY,
    }
  );
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
  runtime?: CharacterRuntime,
) {
  if (!preview) return { dx: 0, dy: 0, rotation: 0, scale: 1, scaleY: 1, opacity: 1 };
  const targetsPart = part.id === preview.targetPartId || part.slotId === preview.targetSlotId;
  const elapsed = Date.now() - preview.startedAt;
  const t = Math.min(1, elapsed / preview.durationMs);
  const wave = Math.sin(t * Math.PI * 2);
  if (!targetsPart) {
    const ancestor =
      previewTargetAncestor(part, preview, allParts, runtime) ??
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
  if (
    preview.kind === "wave" &&
    (part.role === "arm" ||
      part.role === "upperArm" ||
      part.role === "lowerArm" ||
      part.motionBehavior === "rotate")
  ) {
    return { dx: 0, dy: 0, rotation: wave * 18, scale: 1, opacity: 1 };
  }
  if (
    preview.kind === "kick" &&
    (part.role === "leg" ||
      part.role === "upperLeg" ||
      part.role === "lowerLeg" ||
      part.role === "foot")
  ) {
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
  runtime?: CharacterRuntime,
): CharacterPart | undefined {
  if (
    runtime &&
    runtimeAncestorMotionTargets(runtime, getPartSlotId(part)).some(
      (target) => target.slotId === preview.targetSlotId,
    )
  ) {
    return allParts.find(
      (candidate) =>
        candidate.id === preview.targetPartId || getPartSlotId(candidate) === preview.targetSlotId,
    );
  }
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

/** Axis-aligned union of the parts' frame rectangles, in canvas space. */
function unionFrameBounds(
  parts: CharacterPart[],
  transformForPart?: (part: CharacterPart) => EditorPartTransform,
) {
  const rects = parts.map((p) => {
    const bounds = { x: 0, y: 0, width: p.width, height: p.height };
    const transform = transformForPart?.(p);
    return transform
      ? localRectCanvasBoundsWithTransform(p, bounds, transform)
      : localRectCanvasBounds(p, bounds);
  });
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

// Union of the parts' SELECTION bounds in canvas coords — art/alpha bounds in "art" mode, the full
// registration frame in "frame" mode. This is what the group selection box hugs, so (like the
// single-part box) it tracks the visible art instead of spanning the whole transparent canvas.
function unionSelectionBounds(
  parts: CharacterPart[],
  boundsMode: EditorBoundsMode,
  transformForPart?: (part: CharacterPart) => EditorPartTransform,
) {
  const rects = parts.map((p) => {
    const local = editorSelectionBounds(p, boundsMode);
    const transform = transformForPart?.(p);
    return transform
      ? localRectCanvasBoundsWithTransform(p, local, transform)
      : localRectCanvasBounds(p, local);
  });
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function fitPartsToCanvasFrame(
  parts: CharacterPart[],
  canvasWidth: number,
  canvasHeight: number,
): CharacterPart[] | null {
  const visibleParts = parts.filter((part) => part.visible);
  const scopedParts = visibleParts.length > 0 ? visibleParts : parts;
  if (scopedParts.length === 0) return null;
  const bounds = unionFrameBounds(scopedParts);
  const padding = Math.max(16, Math.min(canvasWidth, canvasHeight) * 0.04);
  const targetWidth = Math.max(1, canvasWidth - padding * 2);
  const targetHeight = Math.max(1, canvasHeight - padding * 2);
  const scale = Math.min(targetWidth / bounds.width, targetHeight / bounds.height);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const left = (canvasWidth - bounds.width * scale) / 2;
  const top = (canvasHeight - bounds.height * scale) / 2;
  const targetIds = new Set(scopedParts.map((part) => part.id));
  return parts.map((part) => {
    if (!targetIds.has(part.id)) return part;
    const pivot = pivotForPart(part);
    const nextX = left + (part.x - bounds.x) * scale;
    const nextY = top + (part.y - bounds.y) * scale;
    const nextPivot = {
      x: left + (pivot.x - bounds.x) * scale,
      y: top + (pivot.y - bounds.y) * scale,
    };
    const pins = part.pins
      ? Object.fromEntries(
          Object.entries(part.pins).map(([name, pin]) => [
            name,
            {
              ...pin,
              x: pin.x * scale,
              y: pin.y * scale,
            },
          ]),
        )
      : part.pins;
    const authoredBounds = part.bounds
      ? {
          ...part.bounds,
          x: left + (part.bounds.x - bounds.x) * scale,
          y: top + (part.bounds.y - bounds.y) * scale,
          width: Math.max(1, part.bounds.width * scale),
          height: Math.max(1, part.bounds.height * scale),
        }
      : part.bounds;
    return normalizePartPatch(
      {
        ...part,
        x: Math.round(nextX),
        y: Math.round(nextY),
        width: Math.max(1, Math.round(part.width * scale)),
        height: Math.max(1, Math.round(part.height * scale)),
        pivot: { x: Math.round(nextPivot.x), y: Math.round(nextPivot.y) },
        pins,
        bounds: authoredBounds,
      },
      {
        x: nextX,
        y: nextY,
        width: part.width * scale,
        height: part.height * scale,
        pivot: nextPivot,
        pins,
        bounds: authoredBounds,
      },
    );
  });
}

function localRectCanvasBoundsWithTransform(
  part: CharacterPart,
  bounds: { x: number; y: number; width: number; height: number },
  transform: EditorPartTransform,
) {
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  ].map((point) => partLocalPointToCanvas(part, point, transform));
  const minX = Math.min(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxX = Math.max(...corners.map((point) => point.x));
  const maxY = Math.max(...corners.map((point) => point.y));
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

// Union of the parts' editor art bounds in canvas coords. Manual authored bounds win over
// measured alpha bounds so drag boundaries match the user's visible orange bounds.
function unionEditorArtBounds(parts: CharacterPart[]) {
  const rects = parts.map((p) => {
    const a = localAuthoredBounds(p) ?? localAlphaBounds(p);
    return localRectCanvasBounds(p, a);
  });
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function unionAlphaBounds(parts: CharacterPart[]) {
  if (parts.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const rects = parts.map((part) => localRectCanvasBounds(part, localAlphaBounds(part)));
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function unionHostClampBounds(parts: CharacterPart[], mode: "insideHostMask" | "insideHostBounds") {
  return mode === "insideHostBounds" ? unionFrameBounds(parts) : unionEditorArtBounds(parts);
}

function clampSlotDragDelta(
  character: CharacterPreset,
  rig: CharacterRig,
  slotId: ID,
  dx: number,
  dy: number,
): { dx: number; dy: number; clamped: boolean } {
  const reach = rig.reaches.find((entry) => entry.slotId === slotId);
  const reachLimited = clampMotionDeltaToReach(reach, dx, dy, 0);
  let nextDx = reachLimited.dx;
  let nextDy = reachLimited.dy;
  let clamped = reachLimited.clamped;

  const constraint = rig.hostConstraints.find((entry) => entry.slotId === slotId);
  if (!constraint || constraint.reachPolicy === "allow" || constraint.mode === "reach") {
    return { dx: nextDx, dy: nextDy, clamped };
  }
  const hostSlotId = constraint.hostSlotId;
  if (!hostSlotId || hostSlotId === slotId) return { dx: nextDx, dy: nextDy, clamped };
  const activeAngle = rig.activeAngle;
  const slotParts = character.parts.filter(
    (part) => getPartSlotId(part) === slotId && partAvailableForAngle(part, activeAngle),
  );
  const hostParts = character.parts.filter(
    (part) => getPartSlotId(part) === hostSlotId && partAvailableForAngle(part, activeAngle),
  );
  if (slotParts.length === 0 || hostParts.length === 0) {
    return { dx: nextDx, dy: nextDy, clamped };
  }

  const subject = unionHostClampBounds(slotParts, constraint.mode);
  const host = unionHostClampBounds(hostParts, constraint.mode);
  const hostLimited = clampRectInsideHost(subject, host, nextDx, nextDy);
  nextDx = hostLimited.dx;
  nextDy = hostLimited.dy;
  clamped = clamped || nextDx !== dx || nextDy !== dy;
  return { dx: nextDx, dy: nextDy, clamped };
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

function partIdsForSlotSubtree(
  parts: CharacterPart[],
  rig: CharacterRig,
  slotId: ID,
  angle: CharacterAngle,
  includeRoot = true,
): Set<ID> {
  const binding = resolveSlotBinding(rig, slotId, angle);
  const subtreeSlots = binding
    ? slotIdsForBoneSubtree(rig, binding.effectiveBoneId, angle)
    : new Set<ID>([slotId]);
  if (!includeRoot) subtreeSlots.delete(slotId);
  const scopedParts = parts.filter((part) => partAvailableForAngle(part, angle));
  return new Set(
    scopedParts.filter((part) => subtreeSlots.has(getPartSlotId(part))).map((part) => part.id),
  );
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
    registration: pivot
      ? {
          x: pivot.x - part.x,
          y: pivot.y - part.y,
          rotation: part.rotation,
          space: "part-local-pixels",
        }
      : part.registration,
    variant: normalizePartVariant(part),
    motionBehavior: part.motionBehavior ?? defaultMotionBehaviorForRole(part.role, part.viseme),
  };
}
