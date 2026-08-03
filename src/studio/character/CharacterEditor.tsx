import { useEffect, useMemo, useRef, useState } from "react";
import {
  type DrillPick,
  exceedsDragThreshold,
  resolveDragSubject,
  resolveDrillSelection,
} from "../interaction/select-drag";
import { startWindowPointerDrag } from "../interaction/pointer-drag";
import { ChevronDown, ChevronRight, Eye, EyeOff, Lock } from "lucide-react";
import { getMediaUrl, importMediaFile, uid } from "../db";
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
  partMatchesVariant,
  roleLabel,
  slotLabelForRoleSide,
  withUpdatedCharacterSlot,
  claimSharedPartsForAngles,
  partAvailableForAngle,
  removePartFromAngle,
  variantKeyForPart,
  variantLabelForPart,
} from "./character-utils";
import { loadCharacter, saveCharacter } from "./character-persistence";
import {
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
  editorControlBounds,
  editorSelectionBounds,
  localAlphaBounds,
  measureAlphaBoundsFromBlob,
  pivotForPart,
} from "./alpha-bounds";
import type {
  CharacterAngle,
  CharacterPart,
  CharacterPartDeform,
  CharacterPosePreset,
  CharacterPreset,
  CharacterSlot,
  ID,
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
import type { CharacterSceneAsset } from "./scene";
import {
  applyCharacterSceneCommand,
  rotatePointAroundAnchor,
  type CharacterSceneCommand,
} from "./scene-commands";
import { CharacterPinRigError, upgradeCharacterRigV2, validateCharacterPinRig } from "./rig-v2";
import { AddPartMenu } from "./CharacterArtworkImport";
import { CharacterLayerList } from "./CharacterLayerList";
import {
  DeformPathOverlay,
  GroupControlsOverlay,
  ReachOverlay,
  RigBonesOverlay,
  RotationReachOverlay,
  VariantAnchorOverlay,
} from "./CharacterEditorOverlays";
import {
  GroupInspector,
  Inspector,
  RestrictMovementPanel,
  type EditorBoundsMode,
  type EditorMode,
} from "./CharacterInspectorPanels";
import { CanvasSection, SkeletonCard } from "./CharacterRigSetupControls";
import { RigHealthPanel } from "./CharacterVariantControls";
import { CharacterPartMoveable, PartLayer } from "./CharacterEditorCanvasChrome";
import { CharacterAnglePoseToolbar, CharacterEditorHeader } from "./CharacterEditorToolbar";
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
import {
  activePreviewVariantForPart,
  previewDelta,
  wordToVisemes,
  type PreviewState,
} from "./character-editor-preview";
import {
  canvasPointToPartLocal,
  clampSlotDragDelta,
  composeEditorPartTransform,
  convexHull,
  fitPartsToCanvasFrame,
  normalizePartPatch,
  partIdsForSlotSubtree,
  unionAlphaBounds,
  unionSelectionBounds,
  type ResizeCorner,
} from "./character-editor-geometry";
import {
  hitTestCharacterEditorParts,
  resizeAnchorForCorner,
  resizeScaleForPointerDelta,
  restoreCharacterPartsFromSnapshot,
  rotateCharacterPartsFromSnapshot,
  scaleCharacterPartsFromSnapshot,
  snapshotCharacterPartTransforms,
} from "./character-editor-interactions";
import { useCharacterPreviewController } from "./use-character-preview-controller";
import { useCharacterDocument } from "./use-character-document";
import { useCharacterArtworkAnalysis } from "./use-character-artwork-analysis";

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
  // True while a layer is actively being dragged / resized / rotated, so the other layers
  // can blur to keep focus on it. Set at gesture start; cleared globally on pointerup below.
  const [interacting, setInteracting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const {
    doc,
    setDoc,
    saveState,
    canUndo,
    canRedo,
    pushUndoSnapshot,
    resetHistory,
    undoCharacterHistory,
    redoCharacterHistory,
    saveNow,
  } = useCharacterDocument({
    onRestore: (next) => {
      setSelectedPartId((id) => (id && next.parts.some((part) => part.id === id) ? id : null));
      setSelectedSlotId((id) => (id && findCharacterSlot(next, id) ? id : null));
      setSelectedBoneId((id) =>
        id && normalizeCharacterRig(next).bones.some((bone) => bone.id === id) ? id : null,
      );
    },
    onStatus: setStatus,
  });
  const alphaMaskForPart = useCharacterArtworkAnalysis(doc, setDoc);
  const {
    preview,
    setPreview,
    previewTick,
    mouthTestPlaying,
    playMouthClip: playMouthPreviewClip,
    stopMouthTestAudio,
  } = useCharacterPreviewController({ onError: setStatus });
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  // Remembers the last canvas click so a repeat click in the same spot drills the z-stack.
  const canvasLastPickRef = useRef<DrillPick | null>(null);

  // Leave reach-edit focus mode whenever the selection changes.
  useEffect(() => {
    setRangeEdit(null);
    setReachDraft(null);
    setRotDraft(null);
  }, [selectedPartId, selectedSlotId]);

  useEffect(() => {
    (async () => {
      let row = await loadCharacter(characterId);
      if (!row) {
        row = createBlankCharacter();
        row.id = characterId;
        row = await saveCharacter(row);
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
      resetHistory();
    })();
  }, [characterId, resetHistory, setDoc]);

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

  // Play a clip and drive the mouth slot's visemes. With `scriptedVisemes` the
  // sequence is timed to the clip's duration (correct shapes synced to audio);
  // without it, the mouth is driven by live amplitude (rough, for arbitrary clips).
  const playMouthClip = (slotId: ID, url: string, scriptedVisemes?: PreviewState["visemes"]) =>
    playMouthPreviewClip({
      slotId,
      targetPartId: mouthSlotRepId(slotId),
      url,
      scriptedVisemes,
    });

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
  const hitPartsAt = (point: { x: number; y: number }) =>
    hitTestCharacterEditorParts({
      parts: visibleEditorParts,
      point,
      selectedPartId,
      viewportScale: scale,
      boundsMode,
      transformForPart: partPreviewTransform,
      drawOrderForPart: (part) => runtimePlacementForPart(part)?.drawOrder ?? part.zIndex,
      activeVariantForPart: (part, slotParts) => {
        const slotId = getPartSlotId(part);
        return (
          variantPreview[slotId] ??
          activePreviewVariantForPart(part, preview) ??
          defaultVariantForSlotParts(slotParts, part.role)
        );
      },
      alphaMaskForPart: (part) => alphaMaskForPart(part.id),
    });

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
    const finish = () => {
      setInteracting(false);
      syncLiveCharacterPreset(latestCharacter);
    };
    startWindowPointerDrag({ onMove: move, onEnd: finish, onCancel: finish });
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
    const finish = () => {
      setInteracting(false);
      syncLiveCharacterPreset(latestCharacter);
    };
    startWindowPointerDrag({ onMove: move, onEnd: finish, onCancel: finish });
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
    const finish = () => syncLiveCharacterPreset(latest);
    startWindowPointerDrag({ onMove: move, onEnd: finish, onCancel: finish });
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
    const anchor = resizeAnchorForCorner(box, corner);
    const snapshot = snapshotCharacterPartTransforms(parts);
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / scale;
      const dy = (ev.clientY - sy) / scale;
      const { scaleX, scaleY } = resizeScaleForPointerDelta(box, corner, anchor, dx, dy);
      setDoc((d) =>
        d
          ? withRig({
              ...d,
              parts: scaleCharacterPartsFromSnapshot(d.parts, snapshot, anchor, scaleX, scaleY),
              updatedAt: Date.now(),
            })
          : d,
      );
    };
    const finish = () => setInteracting(false);
    startWindowPointerDrag({ onMove: move, onEnd: finish, onCancel: finish });
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
    const snapshot = snapshotCharacterPartTransforms(
      doc.parts.filter((part) => targetIds.has(part.id)),
    );
    const move = (ev: PointerEvent) => {
      const nextAngle = Math.atan2(ev.clientY - anchorScreen.y, ev.clientX - anchorScreen.x);
      const degrees = ((nextAngle - startAngle) * 180) / Math.PI;
      setDoc((d) =>
        d
          ? withRig({
              ...d,
              parts: rotateCharacterPartsFromSnapshot(d.parts, snapshot, anchor, degrees),
              updatedAt: Date.now(),
            })
          : d,
      );
    };
    const finish = () => setInteracting(false);
    startWindowPointerDrag({ onMove: move, onEnd: finish, onCancel: finish });
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
    const onEnd = (ev: PointerEvent | null) => {
      setAnchorDrag(null);
      if (!ev || !startAnchor) return;
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
    startWindowPointerDrag({
      onMove,
      onEnd,
      onCancel: () => setAnchorDrag(null),
    });
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
    const snapshot = snapshotCharacterPartTransforms(parts);
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
        return {
          ...d,
          parts: rotateCharacterPartsFromSnapshot(d.parts, snapshot, anchor, degrees),
        };
      });
    };
    const finish = () => {
      const rotReach = { min: Math.round(minD), max: Math.round(maxD) };
      setRotDraft(rotReach);
      setDoc((d) => {
        if (!d) return d;
        const restored = restoreCharacterPartsFromSnapshot(d.parts, snapshot);
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
    startWindowPointerDrag({ onMove: move, onEnd: finish, onCancel: finish });
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
    const finish = () => {
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
    startWindowPointerDrag({ onMove: move, onEnd: finish, onCancel: finish });
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

    let cancelPress = () => {};
    function onMove(ev: PointerEvent) {
      if (dragging || !subject) return;
      if (!exceedsDragThreshold({ x: startX, y: startY }, { x: ev.clientX, y: ev.clientY })) return;
      dragging = true;
      cancelPress();
      // Deltas are measured from the original pointerdown, so handing off here is seamless.
      startCanvasDragForSubject(e, subject, dragPoint);
    }
    function onEnd(event: PointerEvent | null) {
      if (!event || dragging) return;
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
    cancelPress = startWindowPointerDrag({ onMove, onEnd });
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
      <CharacterEditorHeader
        name={doc.name}
        phase={editorPhase}
        canUndo={canUndo}
        canRedo={canRedo}
        saveState={saveState}
        onClose={onClose}
        onNameChange={(name) => updateDoc({ name })}
        onPhaseChange={switchPhase}
        onUndo={undoCharacterHistory}
        onRedo={redoCharacterHistory}
        onDone={() => {
          void saveNow().then((saved) => {
            if (saved) onClose();
          });
        }}
      />
      <CharacterAnglePoseToolbar
        doc={doc}
        phase={editorPhase}
        activePoseId={activePoseId}
        activePose={activePose}
        poseModified={poseModified}
        poseMenuId={poseMenuId}
        posePrompt={posePrompt}
        posePromptValue={posePromptValue}
        pendingDeleteAngle={pendingDeleteAngle}
        addAngleMenuOpen={addAngleMenuOpen}
        onActiveAngleChange={setActiveAngleFromToolbar}
        onPhaseChange={switchPhase}
        onPendingDeleteAngleChange={setPendingDeleteAngle}
        onDeleteAngle={deleteAngle}
        onAddAngleMenuOpenChange={setAddAngleMenuOpen}
        onShowRestPose={showRestPose}
        onApplyPose={applyPose}
        onPoseMenuIdChange={setPoseMenuId}
        onRenamePose={renamePose}
        onSetDefaultPose={setDefaultPose}
        onTogglePoseAngleScope={togglePoseAngleScope}
        onDeletePose={deletePose}
        onUpdateActivePose={updateActivePose}
        onSavePoseAsNew={savePoseAsNew}
        onPosePromptValueChange={setPosePromptValue}
        onConfirmPosePrompt={confirmPosePrompt}
        onCancelPosePrompt={() => setPosePrompt(null)}
      />

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-panel text-xs">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
            <span className="font-semibold uppercase tracking-wider text-muted-foreground">
              Parts
            </span>
            <span
              className="rounded-full border border-border px-2 py-0.5 text-ui-sm text-muted-foreground"
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
          <div className="pointer-events-none absolute bottom-2 right-3 rounded bg-panel/80 px-2 py-1 text-ui-sm text-muted-foreground">
            {doc.canvasWidth}×{doc.canvasHeight} · {Math.round(scale * 100)}%
          </div>
          <div className="absolute bottom-2 left-3 flex gap-1">
            {editorPhase !== "build" && (
              <>
                <button
                  type="button"
                  aria-pressed={showBones}
                  onClick={toggleBones}
                  className={`flex items-center gap-1 rounded border bg-panel/90 px-2 py-1 text-ui-sm ${
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
                    className="flex overflow-hidden rounded border border-border bg-panel/90 text-ui-sm"
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
                  className={`flex items-center gap-1 rounded border bg-panel/90 px-2 py-1 text-ui-sm ${
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
                  className="rounded border border-border px-2 py-0.5 text-ui-sm text-muted-foreground hover:text-foreground"
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
                  className="shrink-0 rounded border border-amber-400/60 bg-amber-400/10 px-2 py-0.5 text-ui-sm text-amber-100 hover:bg-amber-400/15"
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
                className="shrink-0 rounded border border-border px-2 py-0.5 text-ui-sm text-muted-foreground hover:text-foreground"
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
                  className="rounded border border-border px-2 py-0.5 text-ui-sm text-primary hover:bg-panel-2"
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
                <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-panel/95 px-2 py-0.5 text-ui-sm text-primary shadow-[var(--shadow-panel)]">
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
                    className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-panel/95 px-2 py-0.5 text-ui-sm text-primary shadow-[var(--shadow-panel)]"
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
                  className="rounded border border-border bg-panel/95 px-2 py-0.5 text-ui-sm text-muted-foreground hover:text-foreground"
                >
                  Reset to pose
                </button>
              )}
              {!activePose && Object.keys(variantPreview).length > 1 && (
                <button
                  type="button"
                  onClick={() => clearVariantPreview()}
                  className="rounded border border-border bg-panel/95 px-2 py-0.5 text-ui-sm text-muted-foreground hover:text-foreground"
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
                className={`flex-1 py-2 text-ui-sm font-medium ${
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
