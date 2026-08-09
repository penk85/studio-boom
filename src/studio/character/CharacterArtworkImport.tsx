// Character artwork intake controls: semantic part picker, artwork upload, and mouth presets.
import { useRef, useState } from "react";
import { Check, Plus, Upload } from "lucide-react";
import { CHARACTER_PART_ACCEPT } from "../db";
import { MOUTH_VISEMES } from "../lipsync/viseme-schema";
import type {
  CharacterAngle,
  CharacterPart,
  CharacterPreset,
  CharacterSlot,
  PartRole,
} from "../types";
import { defaultSlotIdForRole, listCharacterSlots, partAvailableForAngle } from "./character-utils";
import { slugCharacterPartKey, type CharacterPartImportOptions } from "./character-part-import";
import { MOUTH_PRESETS, generatePresetBlob } from "./presets";

interface SlotDefinition {
  label: string;
  role: PartRole;
  side?: CharacterPart["side"];
}

/**
 * The part vocabulary, grouped.
 *
 * Every part is optional — a character is whatever you give it, and the rig drops
 * movement for anything absent. So these are not requirements or a checklist;
 * they are the named things the rig understands, arranged so you can find one.
 *
 * Limbs are the subtle case. "Arm" and "Upper arm + Lower arm" are not two ways
 * to say the same thing: one is a single rigid piece, the other bends at the
 * joint. That is a rig decision, so it is asked as a question in `LIMB_GROUPS`
 * rather than hidden among look-alike chips.
 */
const PART_GROUPS: { title: string; parts: SlotDefinition[] }[] = [
  {
    title: "Face",
    parts: [
      { label: "Left eye", role: "eye", side: "left" },
      { label: "Right eye", role: "eye", side: "right" },
      { label: "Left pupil", role: "iris", side: "left" },
      { label: "Right pupil", role: "iris", side: "right" },
      { label: "Left eyebrow", role: "eyebrow", side: "left" },
      { label: "Right eyebrow", role: "eyebrow", side: "right" },
      { label: "Nose", role: "nose" },
    ],
  },
  {
    title: "Head & body",
    parts: [
      { label: "Head", role: "head" },
      { label: "Body", role: "body" },
      { label: "Hair (front)", role: "hair", side: "front" },
      { label: "Hair (behind)", role: "hair", side: "back" },
    ],
  },
  {
    title: "Hands & feet",
    parts: [
      { label: "Left hand", role: "hand", side: "left" },
      { label: "Right hand", role: "hand", side: "right" },
      { label: "Left foot", role: "foot", side: "left" },
      { label: "Right foot", role: "foot", side: "right" },
    ],
  },
  { title: "Anything else", parts: [{ label: "Accessory", role: "accessory" }] },
];

/** A limb the user chooses the structure of before adding artwork. */
interface LimbGroup {
  title: string;
  side: "left" | "right";
  whole: SlotDefinition;
  jointed: [SlotDefinition, SlotDefinition];
  jointName: string;
}

const LIMB_GROUPS: LimbGroup[] = [
  {
    title: "Left arm",
    side: "left",
    whole: { label: "Left arm", role: "arm", side: "left" },
    jointed: [
      { label: "Left upper arm", role: "upperArm", side: "left" },
      { label: "Left lower arm", role: "lowerArm", side: "left" },
    ],
    jointName: "elbow",
  },
  {
    title: "Right arm",
    side: "right",
    whole: { label: "Right arm", role: "arm", side: "right" },
    jointed: [
      { label: "Right upper arm", role: "upperArm", side: "right" },
      { label: "Right lower arm", role: "lowerArm", side: "right" },
    ],
    jointName: "elbow",
  },
  {
    title: "Left leg",
    side: "left",
    whole: { label: "Left leg", role: "leg", side: "left" },
    jointed: [
      { label: "Left upper leg", role: "upperLeg", side: "left" },
      { label: "Left lower leg", role: "lowerLeg", side: "left" },
    ],
    jointName: "knee",
  },
  {
    title: "Right leg",
    side: "right",
    whole: { label: "Right leg", role: "leg", side: "right" },
    jointed: [
      { label: "Right upper leg", role: "upperLeg", side: "right" },
      { label: "Right lower leg", role: "lowerLeg", side: "right" },
    ],
    jointName: "knee",
  },
];

const SLOT_DEFINITIONS: SlotDefinition[] = [
  ...PART_GROUPS.flatMap((group) => group.parts),
  ...LIMB_GROUPS.flatMap((limb) => [limb.whole, ...limb.jointed]),
];

/** Main entry point for adding semantic artwork to a character. */
export function AddPartMenu({
  doc,
  activeAngle,
  onPickImport,
  onImport,
}: {
  doc: CharacterPreset;
  activeAngle: CharacterAngle;
  onPickImport: (options: CharacterPartImportOptions) => void;
  onImport: (file: File, options?: CharacterPartImportOptions) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [showMouthPresets, setShowMouthPresets] = useState(false);
  const slotRecords = listCharacterSlots(doc, { includeEmpty: true });
  const isMissing = (definition: SlotDefinition) =>
    !doc.parts.some(
      (part) => matchesSlotDefinition(part, definition) && partAvailableForAngle(part, activeAngle),
    );
  const pick = (definition: SlotDefinition) => {
    const slotRecord = slotRecords.find((slot) => matchesSlotDefinition(slot, definition));
    setOpen(false);
    onPickImport({
      role: definition.role,
      side: definition.side,
      label: definition.label,
      slotId: slotRecord?.id ?? defaultSlotIdForRole(definition.role, undefined, definition.side),
    });
  };
  const pickCustom = () => {
    const name = customName.trim();
    if (!name) return;
    setCustomName("");
    setOpen(false);
    onPickImport({ role: "custom", label: name, slotId: `custom:${slugCharacterPartKey(name)}` });
  };

  return (
    <div className="mt-2 space-y-2">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`flex w-full items-center justify-center gap-1 rounded border border-dashed px-2 py-2 ${
          open
            ? "border-primary text-primary"
            : "border-border text-muted-foreground hover:border-primary/60 hover:text-foreground"
        }`}
        title="Add a body part — pick what it is, then choose its image"
      >
        <Plus size={13} />
        Add part
      </button>
      {open && (
        <>
          <p className="text-ui-sm text-muted-foreground">
            Every part is optional — add only what your character has.
          </p>

          {LIMB_GROUPS.filter((limb) =>
            [limb.whole, ...limb.jointed].some((definition) => isMissing(definition)),
          ).map((limb) => (
            <LimbChoice key={limb.title} limb={limb} isMissing={isMissing} onPick={pick} />
          ))}

          {PART_GROUPS.map((group) => {
            const available = group.parts.filter(isMissing);
            if (available.length === 0) return null;
            return (
              <div key={group.title}>
                <div className="mb-1 text-ui-sm uppercase tracking-wider text-muted-foreground">
                  {group.title}
                </div>
                <div className="flex flex-wrap gap-1">
                  {available.map((definition) => (
                    <button
                      key={`${definition.role}:${definition.side ?? "center"}`}
                      type="button"
                      onClick={() => pick(definition)}
                      className="rounded border border-border px-1.5 py-1 text-ui-sm text-muted-foreground hover:bg-panel hover:text-foreground"
                    >
                      {definition.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="flex items-center gap-1">
            <input
              value={customName}
              onChange={(event) => setCustomName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") pickCustom();
              }}
              placeholder="Custom part name…"
              className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1"
            />
            <button
              type="button"
              onClick={pickCustom}
              disabled={!customName.trim()}
              className="rounded border border-border p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
              title="Add the custom part, then choose its image"
            >
              <Plus size={13} />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowMouthPresets((current) => !current)}
            className="w-full rounded border border-border px-2 py-1 text-left text-ui-sm text-muted-foreground hover:text-foreground"
          >
            {showMouthPresets ? "Hide mouth presets" : "Talking mouth from a preset…"}
          </button>
          {showMouthPresets && <MouthPresetSelector onImport={onImport} />}
        </>
      )}
    </div>
  );
}

/**
 * Asks the one rig question a limb carries: is it a single rigid piece, or does
 * it bend? Previously "Left arm", "Left upper arm" and "Left lower arm" sat side
 * by side as look-alike chips, so the choice was made by accident and only
 * discovered later, when the arm would not bend.
 */
function LimbChoice({
  limb,
  isMissing,
  onPick,
}: {
  limb: LimbGroup;
  isMissing: (definition: SlotDefinition) => boolean;
  onPick: (definition: SlotDefinition) => void;
}) {
  const wholeMissing = isMissing(limb.whole);
  const jointedMissing = limb.jointed.filter(isMissing);
  // Once artwork exists for one structure, the other is no longer an option —
  // offering it would silently create a second, conflicting limb.
  const startedJointed = jointedMissing.length < limb.jointed.length;
  const startedWhole = !wholeMissing;

  return (
    <div className="rounded border border-border bg-panel-2 p-2">
      <div className="mb-1 text-ui-sm font-medium text-foreground">{limb.title}</div>
      {!startedJointed && !startedWhole && (
        <p className="mb-1.5 text-ui-sm text-muted-foreground">
          One piece, or two so it bends at the {limb.jointName}?
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        {wholeMissing && !startedJointed && (
          <button
            type="button"
            onClick={() => onPick(limb.whole)}
            title={`One image for the whole ${limb.title.toLowerCase()} — it moves as a single piece`}
            className="rounded border border-border px-1.5 py-1 text-ui-sm text-muted-foreground hover:bg-panel hover:text-foreground"
          >
            One piece
          </button>
        )}
        {!startedWhole &&
          jointedMissing.map((definition) => (
            <button
              key={definition.role}
              type="button"
              onClick={() => onPick(definition)}
              title={`Bends at the ${limb.jointName} — add both halves`}
              className="rounded border border-border px-1.5 py-1 text-ui-sm text-muted-foreground hover:bg-panel hover:text-foreground"
            >
              {definition.label.replace(`${limb.side === "left" ? "Left" : "Right"} `, "")}
            </button>
          ))}
      </div>
    </div>
  );
}

export function SlotUpload({
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
        type="button"
        onClick={() => {
          if (!disabled) inputRef.current?.click();
        }}
        disabled={disabled}
        title={filled ? `${label}: artwork is assigned for this angle` : `Upload ${label} artwork`}
        className={`flex items-center justify-between gap-2 rounded border px-2 text-left hover:bg-panel disabled:cursor-not-allowed disabled:opacity-50 ${
          compact ? "py-1" : "py-2"
        } ${filled ? "border-primary/60 bg-primary/10" : "border-border bg-panel-2"}`}
      >
        <span className="truncate">{label}</span>
        {filled ? (
          <Check size={13} className="shrink-0 text-primary" aria-label="Artwork assigned" />
        ) : (
          <Upload size={13} className="shrink-0 text-muted-foreground" />
        )}
      </button>
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        accept={CHARACTER_PART_ACCEPT}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onUpload(file);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
    </>
  );
}

const MOUTH_COLOR_PRESETS = [
  { label: "Pink", value: "#e88a9a" },
  { label: "Rose", value: "#d05d6e" },
  { label: "Red", value: "#c0392b" },
  { label: "Deep red", value: "#8b2230" },
  { label: "Dark gray", value: "#4a4146" },
] as const;

function MouthPresetSelector({
  onImport,
}: {
  onImport: (file: File, options?: CharacterPartImportOptions) => void;
}) {
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState("#c0392b");
  const [customColor, setCustomColor] = useState("#c0392b");

  const handleApply = async () => {
    if (!selectedPreset) return;
    const preset = MOUTH_PRESETS.find((candidate) => candidate.id === selectedPreset);
    if (!preset) return;

    for (const viseme of MOUTH_VISEMES) {
      const svg = preset.generateForViseme(viseme, customColor);
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
    const preset = MOUTH_PRESETS.find((candidate) => candidate.id === selectedPreset);
    return (
      <div className="mb-3 rounded border border-primary/50 bg-primary/10 p-2">
        <div className="mb-2 text-ui-sm font-medium">Configure {preset?.label} mouth</div>
        <div className="mb-2">
          <label className="mb-1 block text-ui-sm font-semibold uppercase text-muted-foreground">
            Color
          </label>
          <div className="mb-2 flex gap-1">
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
          <div className="flex items-center gap-1">
            <label className="text-ui-sm text-muted-foreground">Custom:</label>
            <input
              type="color"
              value={customColor}
              onChange={(event) => {
                setCustomColor(event.target.value);
                setSelectedColor(event.target.value);
              }}
              className="h-6 w-10 cursor-pointer rounded border border-border"
            />
            <input
              type="text"
              value={customColor}
              onChange={(event) => {
                if (event.target.value.match(/^#[0-9a-f]{6}$/i)) {
                  setCustomColor(event.target.value);
                  setSelectedColor(event.target.value);
                }
              }}
              placeholder="#000000"
              className="w-20 rounded border border-border bg-background px-1 py-0.5 text-ui-sm"
            />
          </div>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={handleApply}
            className="flex-1 rounded bg-primary px-2 py-1 text-ui-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Add all visemes
          </button>
          <button
            type="button"
            onClick={() => setSelectedPreset(null)}
            className="rounded border border-border px-2 py-1 text-ui-sm hover:bg-panel"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3">
      <div className="mb-1 text-ui-sm text-muted-foreground">Quick presets:</div>
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
            className="rounded border border-border bg-panel px-2 py-1 text-ui-sm hover:bg-primary/10"
            title={`Use ${preset.label} mouth`}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function matchesSlotDefinition(
  value: Pick<CharacterPart, "role" | "side"> | Pick<CharacterSlot, "role" | "side">,
  definition: SlotDefinition,
): boolean {
  return (
    value.role === definition.role &&
    (definition.side === undefined || value.side === definition.side)
  );
}
