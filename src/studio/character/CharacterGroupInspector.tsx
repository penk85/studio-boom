// Inspector for a selected character slot and all of its artwork variants.

import type {
  CharacterPart,
  CharacterPartDeform,
  CharacterPreset,
  CharacterSlot,
  ID,
  PartRole,
} from "../types";
import { SlotUpload } from "./CharacterArtworkImport";
import { FlexibleSection } from "./CharacterFlexibleSection";
import { Field, NumberField } from "./CharacterInspectorFields";
import { VariantAnchorSection, VariantGridButton } from "./CharacterVariantControls";
import {
  CHARACTER_EYE_STATE_ORDER,
  CHARACTER_VISEME_ORDER,
  orderCharacterVariants,
} from "./character-variant-order";
import {
  findCharacterSlot,
  partMatchesVariant,
  roleLabel,
  variantKeyForPart,
} from "./character-utils";
import { ROLE_OPTIONS, SAMPLE_WORDS, SLOT_SIDE_OPTIONS } from "./character-inspector-options";
import type { CharacterPartImportOptions } from "./character-part-import";
import type { MirrorSlotPlan } from "./mirror-parts";
import type { VariantKeyIssue } from "./variant-pairing";

export function GroupInspector({
  doc,
  slotId,
  parts,
  bounds,
  keyIssues,
  phase,
  onSwitchPhase,
  onImport,
  mirrorPlan,
  onMirror,
  onSetDeform,
  previewedKey,
  variantPreview,
  pinPlacement,
  onPreviewVariant,
  onClearPreview,
  onArmPinPlacement,
  onClearPin,
  onResetPin,
  onSetRotation,
  onUpdateSlot,
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
  keyIssues: Map<ID, VariantKeyIssue[]>;
  phase: "build" | "rig" | "pose";
  onSwitchPhase: (phase: "build" | "rig" | "pose") => void;
  onImport: (file: File, options?: CharacterPartImportOptions) => void;
  mirrorPlan: MirrorSlotPlan;
  onMirror: () => void;
  onSetDeform: (deform: CharacterPartDeform | undefined, options?: { history?: boolean }) => void;
  previewedKey?: string;
  variantPreview: Record<ID, string>;
  pinPlacement: { childSlotId: ID; parentSlotId: ID; variantKey: string } | null;
  onPreviewVariant: (slotId: ID, key: string) => void;
  onClearPreview: (slotId: ID) => void;
  onArmPinPlacement: (
    placement: { childSlotId: ID; parentSlotId: ID; variantKey: string } | null,
  ) => void;
  onClearPin: (context: { parentSlotId: ID; variantKey: string; childSlotId: ID }) => void;
  onResetPin: (context: { parentSlotId: ID; variantKey: string; childSlotId: ID }) => void;
  onSetRotation: (
    context: { parentSlotId: ID; variantKey: string; childSlotId: ID },
    rotation: number,
  ) => void;
  onUpdateSlot: (patch: Partial<CharacterSlot>) => void;
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
  const slot = findCharacterSlot(doc, slotId);
  const name = slot?.name ?? parts[0]?.slotName ?? roleLabel(parts[0]?.role ?? "custom");
  const role = slot?.role ?? parts[0]?.role ?? "custom";
  const side = slot?.side ?? parts.find((part) => part.side)?.side;
  const isMouth = role === "mouth";
  // The canonical shape set for this slot, with upload targets for the gaps —
  // lip sync needs every viseme, blinking needs open + closed.
  const expectedVariantSpecs: Array<{ key: string; options: CharacterPartImportOptions }> =
    role === "mouth"
      ? CHARACTER_VISEME_ORDER.map((viseme) => ({
          key: viseme,
          options: {
            role,
            viseme,
            slotId,
            side,
            label: `Mouth ${viseme}`,
            zIndex: parts[0]?.zIndex,
          },
        }))
      : role === "eye"
        ? CHARACTER_EYE_STATE_ORDER.map((state) => ({
            key: state,
            options: {
              role,
              eyeState: state,
              slotId,
              side,
              label: `${name} ${state}`,
              zIndex: parts[0]?.zIndex,
            },
          }))
        : [];
  const missingExpectedVariants = expectedVariantSpecs.filter(
    ({ key }) => !parts.some((part) => partMatchesVariant(part, key)),
  );
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
        <div className="mb-1">
          <span className="font-medium">{name} group</span>
        </div>
        {phase === "build" && (
          <div className="mb-3 grid gap-2 rounded border border-primary/20 bg-background/40 p-2">
            <Field label="Slot name">
              <input
                value={name}
                onChange={(e) => onUpdateSlot({ name: e.target.value })}
                className="w-full rounded border border-border bg-background px-2 py-1"
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Role">
                <select
                  value={role}
                  onChange={(e) => onUpdateSlot({ role: e.target.value as PartRole })}
                  className="w-full rounded border border-border bg-background px-2 py-1"
                >
                  {ROLE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {roleLabel(option)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Side">
                <select
                  value={side ?? ""}
                  onChange={(e) =>
                    onUpdateSlot({
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
              <div className="col-span-2 text-ui-sm text-muted-foreground">
                <span className="block uppercase tracking-wider">Slot id</span>
                <span className="font-mono text-ui-sm text-foreground">{slotId}</span>
              </div>
            </div>
          </div>
        )}
        {phase === "build" && (
          <>
            <div className="mb-3 text-ui-sm text-muted-foreground">
              Move or resize all {parts.length} variants together. Edit one frame by selecting it
              below.
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
                  onScale(
                    { x: bounds.x, y: bounds.y },
                    Math.max(8, w) / Math.max(1, bounds.width),
                    1,
                  )
                }
              />
              <NumberField
                label="Height"
                value={Math.round(bounds.height)}
                onChange={(h) =>
                  onScale(
                    { x: bounds.x, y: bounds.y },
                    1,
                    Math.max(8, h) / Math.max(1, bounds.height),
                  )
                }
              />
              <NumberField
                label="Rotate"
                value={averageRotation}
                onChange={(rotation) => onRotate(center, rotation - averageRotation)}
              />
            </div>
          </>
        )}
      </section>
      {phase === "build" && (
        <FlexibleSection
          doc={doc}
          slotId={slotId}
          role={role}
          parts={parts}
          onSetDeform={onSetDeform}
        />
      )}
      {phase === "pose" && isMouth && (
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
                  {hasAudio && <span className="text-ui-sm text-primary">♪</span>}
                </button>
              );
            })}
          </div>
          {otherSamples.length > 0 && (
            <>
              <div className="mb-1 text-ui-sm text-muted-foreground">Or test with a clip:</div>
              <div className="grid grid-cols-2 gap-1">
                {otherSamples.map((sample) => (
                  <button
                    key={sample.url}
                    type="button"
                    onClick={() => (mouthTestPlaying ? onStopTestAudio() : onTestAudio(sample.url))}
                    className="truncate rounded border border-border bg-background px-2 py-1 text-ui-sm hover:bg-panel"
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
              className="mt-2 w-full rounded border border-primary bg-primary/10 px-2 py-1 text-ui-sm text-primary"
            >
              ■ Stop
            </button>
          )}
          {lipSyncSamples.length === 0 && (
            <div className="mt-2 rounded border border-dashed border-border p-2 text-ui-sm text-muted-foreground">
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
        <div className="mb-2 text-ui-sm text-muted-foreground">
          Click a variant to show it in place — children re-anchor live.
          {previewedKey && (
            <button
              type="button"
              onClick={() => onClearPreview(slotId)}
              className="ml-1 rounded border border-border px-1.5 py-0.5 text-ui-sm text-muted-foreground hover:text-foreground"
            >
              Reset preview
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {orderCharacterVariants(parts).map((part) => (
            <VariantGridButton
              key={part.id}
              part={part}
              issues={keyIssues.get(part.id) ?? []}
              previewed={previewedKey === variantKeyForPart(part)}
              onClick={() => {
                onSelectPart(part.id);
                onPreviewVariant(slotId, variantKeyForPart(part));
              }}
            />
          ))}
        </div>
        {missingExpectedVariants.length > 0 && (
          <>
            <div className="mb-1 mt-2 text-ui-sm text-muted-foreground">
              {role === "mouth"
                ? "Missing mouth shapes — upload to complete lip sync:"
                : "Missing eye states — open and closed drive blinking:"}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {missingExpectedVariants.map(({ key, options }) => (
                <SlotUpload
                  key={key}
                  compact
                  label={key}
                  filled={false}
                  onUpload={(file) => onImport(file, options)}
                />
              ))}
            </div>
          </>
        )}
        {(mirrorPlan.ok || mirrorPlan.reason === "occupied") && (
          <button
            type="button"
            onClick={onMirror}
            disabled={!mirrorPlan.ok}
            className="mt-2 w-full rounded border border-border bg-background px-2 py-1 text-left text-ui-sm text-foreground hover:bg-panel disabled:cursor-default disabled:opacity-60"
            title={
              mirrorPlan.ok
                ? "Duplicate every layer of this slot to the other side with mirrored placement, pivots, and pins. The artwork itself is not flipped."
                : "The other side already has artwork."
            }
          >
            ⇄{" "}
            {mirrorPlan.ok
              ? `Mirror to ${mirrorPlan.targetSide} side`
              : `Other side already has artwork`}
          </button>
        )}
      </section>
      {phase === "rig" && (
        <VariantAnchorSection
          doc={doc}
          childSlotId={slotId}
          variantPreview={variantPreview}
          pinPlacement={pinPlacement}
          onPreviewVariant={onPreviewVariant}
          onArmPinPlacement={onArmPinPlacement}
          onClearPin={onClearPin}
          onResetPin={onResetPin}
          onSetRotation={onSetRotation}
        />
      )}
    </div>
  );
}
