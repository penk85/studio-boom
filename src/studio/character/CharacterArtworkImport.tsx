// Character artwork intake controls: semantic part picker, SVG upload, and mouth presets.
import { useRef, useState } from "react";
import { Check, Plus, Upload } from "lucide-react";
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

const SLOT_DEFINITIONS: Array<{
  label: string;
  role: PartRole;
  side?: CharacterPart["side"];
}> = [
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
  { label: "Left Upper Arm", role: "upperArm", side: "left" },
  { label: "Right Upper Arm", role: "upperArm", side: "right" },
  { label: "Left Lower Arm", role: "lowerArm", side: "left" },
  { label: "Right Lower Arm", role: "lowerArm", side: "right" },
  { label: "Left Hand", role: "hand", side: "left" },
  { label: "Right Hand", role: "hand", side: "right" },
  { label: "Left Leg", role: "leg", side: "left" },
  { label: "Right Leg", role: "leg", side: "right" },
  { label: "Left Upper Leg", role: "upperLeg", side: "left" },
  { label: "Right Upper Leg", role: "upperLeg", side: "right" },
  { label: "Left Lower Leg", role: "lowerLeg", side: "left" },
  { label: "Right Lower Leg", role: "lowerLeg", side: "right" },
  { label: "Left Foot", role: "foot", side: "left" },
  { label: "Right Foot", role: "foot", side: "right" },
  { label: "Hair Back", role: "hair", side: "back" },
  { label: "Hair Front", role: "hair", side: "front" },
  { label: "Accessory", role: "accessory" },
];

type SlotDefinition = (typeof SLOT_DEFINITIONS)[number];

/** Main entry point for adding semantic SVG artwork to a character. */
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
  const missingDefinitions = SLOT_DEFINITIONS.filter(
    (definition) =>
      !doc.parts.some(
        (part) =>
          matchesSlotDefinition(part, definition) && partAvailableForAngle(part, activeAngle),
      ),
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
          <div className="flex flex-wrap gap-1">
            {missingDefinitions.map((definition) => (
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
        accept=".svg,image/svg+xml"
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
