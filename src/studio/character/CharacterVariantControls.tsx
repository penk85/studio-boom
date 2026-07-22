// Character variant diagnostics and pin controls used by the character editor inspectors.

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMediaUrl } from "../hooks/useMediaUrl";
import type { CharacterPart, CharacterPreset, ID } from "../types";
import {
  findCharacterSlot,
  variantKeyForPart,
  variantKeySourceForPart,
  variantLabelForPart,
  type VariantKeySource,
} from "./character-utils";
import { normalizeCharacterRig, parentSlotIdForSlot } from "./rig";
import {
  anchorEntryForChild,
  slotVariantKeys,
  type RigHealthReport,
  type VariantKeyIssue,
} from "./variant-pairing";

export const ANCHOR_SOURCE_COLORS = {
  pin: "#4ade80",
  fallback: "#fbbf24",
} as const;

function RigHealthWarningRow({
  warning,
  onClick,
}: {
  warning: RigHealthReport["warnings"][number];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full rounded border px-2 py-1 text-left text-[10px] leading-snug hover:bg-panel ${
        warning.severity === "warning"
          ? "border-amber-500/30 bg-amber-500/5 text-amber-300/90"
          : "border-border text-muted-foreground"
      }`}
    >
      {warning.message}
    </button>
  );
}

/** The whole-character anchor and variant-key verification checklist. */
export function RigHealthPanel({
  doc,
  report,
  defaultOpen = false,
  onJumpTo,
}: {
  doc: CharacterPreset;
  report: RigHealthReport;
  defaultOpen?: boolean;
  onJumpTo: (row: { childSlotId?: ID; parentSlotId?: ID; variantKey?: string }) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [otherAnglesOpen, setOtherAnglesOpen] = useState(false);
  const activeAngle = normalizeCharacterRig(doc).activeAngle;
  const warningCount = report.warnings.filter((entry) => entry.severity === "warning").length;
  const slotLabel = (slotId: ID) => findCharacterSlot(doc, slotId)?.name ?? slotId;
  const thisAngleWarnings = report.warnings.filter(
    (warning) => !warning.affectedAngle || warning.affectedAngle === activeAngle,
  );
  const otherAngleWarnings = report.warnings.filter(
    (warning) => warning.affectedAngle && warning.affectedAngle !== activeAngle,
  );

  if (report.anchorRows.length === 0 && report.warnings.length === 0) return null;

  return (
    <section className="rounded border border-border bg-panel-2 p-3">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-muted-foreground">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              warningCount > 0 ? "bg-amber-400" : "bg-emerald-400"
            }`}
          />
          Rig health
          {warningCount > 0 && <span className="text-amber-300">· {warningCount}</span>}
        </span>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          {thisAngleWarnings.length > 0 && (
            <div className="space-y-1">
              {thisAngleWarnings.map((warning, index) => (
                <RigHealthWarningRow
                  key={index}
                  warning={warning}
                  onClick={() => onJumpTo(warning)}
                />
              ))}
            </div>
          )}
          {otherAngleWarnings.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setOtherAnglesOpen((previous) => !previous)}
                className="flex w-full items-center gap-1 text-left text-[10px] text-muted-foreground/60 hover:text-muted-foreground"
              >
                {otherAnglesOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                {otherAngleWarnings.length} checklist item
                {otherAngleWarnings.length !== 1 ? "s" : ""} for other angles
              </button>
              {otherAnglesOpen && (
                <div className="mt-1 space-y-1 opacity-70">
                  {otherAngleWarnings.map((warning, index) => (
                    <RigHealthWarningRow
                      key={index}
                      warning={warning}
                      onClick={() => onJumpTo(warning)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
          {report.anchorRows.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Anchors
              </div>
              {report.anchorRows.map((row) => (
                <button
                  key={`${row.childSlotId}:${row.variantKey}`}
                  type="button"
                  onClick={() => onJumpTo(row)}
                  className="flex w-full items-center gap-1.5 rounded border border-border px-2 py-1 text-left text-[10px] hover:bg-panel"
                  title="Select the layer, preview the parent variant, and show the anchor"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: ANCHOR_SOURCE_COLORS[row.source] }}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {slotLabel(row.childSlotId)} ← {slotLabel(row.parentSlotId)}{" "}
                    <span className="font-mono">{row.variantKey}</span>
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {row.source} · {row.anchor.x}, {row.anchor.y}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Controls the authored child anchor for each variant of its parent slot. */
export function VariantAnchorSection({
  doc,
  childSlotId,
  variantPreview,
  pinPlacement,
  onPreviewVariant,
  onArmPinPlacement,
  onClearPin,
  onResetPin,
  onSetRotation,
}: {
  doc: CharacterPreset;
  childSlotId: ID;
  variantPreview: Record<ID, string>;
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
}) {
  const rig = normalizeCharacterRig(doc);
  const parentSlotId = parentSlotIdForSlot(rig, childSlotId);
  if (!parentSlotId) return null;
  const parentKeys = slotVariantKeys(doc, parentSlotId, rig.activeAngle);
  if (parentKeys.length === 0) return null;
  const parentName = findCharacterSlot(doc, parentSlotId)?.name ?? parentSlotId;
  const previewKey = variantPreview[parentSlotId] ?? "";
  const selectedKey = parentKeys.includes(previewKey)
    ? previewKey
    : parentKeys.length === 1
      ? parentKeys[0]
      : "";
  const anchorEntry = selectedKey ? anchorEntryForChild(doc, childSlotId, selectedKey) : undefined;
  const source = selectedKey ? (anchorEntry?.source ?? "fallback") : null;
  const armed = pinPlacement?.childSlotId === childSlotId;
  const sourceLabel = source === "pin" ? "authored pin" : "missing pin";

  return (
    <section className="rounded border border-border bg-panel-2 p-3">
      <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
        Variant pins
      </div>
      <div className="mb-2 text-[10px] leading-snug text-muted-foreground">
        Each <span className="text-foreground">{parentName}</span> variant provides the output pin
        used by this child bone. Picking one shows that artwork in place.
      </div>
      <label className="mb-2 grid grid-cols-[64px_1fr] items-center gap-2 text-[10px]">
        <span className="text-muted-foreground">Variant</span>
        <select
          value={selectedKey}
          onChange={(event) => {
            if (event.target.value) onPreviewVariant(parentSlotId, event.target.value);
            if (armed) onArmPinPlacement(null);
          }}
          className="w-full rounded border border-border bg-input px-2 py-1"
        >
          <option value="">— pick a {parentName} variant —</option>
          {parentKeys.map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
      </label>
      {selectedKey && source && (
        <div className="mb-2 flex items-center gap-1.5 text-[10px]">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: ANCHOR_SOURCE_COLORS[source] }}
          />
          <span className="text-muted-foreground">
            Resolves from <span className="text-foreground">{sourceLabel}</span>
          </span>
        </div>
      )}
      {selectedKey && (
        <label className="mb-2 grid grid-cols-[64px_1fr] items-center gap-2 text-[10px]">
          <span
            className="text-muted-foreground"
            title="How this layer is angled under the selected variant — a hand on an outstretched arm tilts differently than on a relaxed arm"
          >
            Angle
          </span>
          <input
            type="number"
            step={1}
            value={anchorEntry?.rotation ?? 0}
            onChange={(event) => {
              const rotation = Number(event.target.value);
              if (Number.isFinite(rotation)) {
                onSetRotation({ parentSlotId, variantKey: selectedKey, childSlotId }, rotation);
              }
            }}
            className="w-full rounded border border-border bg-input px-2 py-1"
          />
        </label>
      )}
      {selectedKey && !armed && (
        <div className="mb-2 text-[10px] leading-snug text-muted-foreground">
          Tip: while the variant is showing, drag the layer on the canvas (or its colored dot) to
          pin this anchor where you drop it.
        </div>
      )}
      {armed ? (
        <div className="space-y-1">
          <div className="rounded border border-primary/50 bg-primary/10 px-2 py-1 text-[10px] text-primary">
            Click the canvas where this layer should anchor under {parentName} : {selectedKey}.
          </div>
          <button
            type="button"
            onClick={() => onArmPinPlacement(null)}
            className="w-full rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex gap-1">
          <button
            type="button"
            disabled={!selectedKey}
            onClick={() =>
              selectedKey &&
              onArmPinPlacement({ childSlotId, parentSlotId, variantKey: selectedKey })
            }
            className="flex-1 rounded border border-border px-2 py-1 text-[10px] hover:bg-panel disabled:opacity-40"
            title="Then click the canvas where this layer should anchor — or just drag the layer while the variant is previewed"
          >
            Pin anchor{selectedKey ? ` under ${parentName} : ${selectedKey}` : ""}
          </button>
          {source === "pin" && selectedKey && (
            <button
              type="button"
              onClick={() => onResetPin({ parentSlotId, variantKey: selectedKey, childSlotId })}
              className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
              title="Recalculate this pin from the child artwork's authored pivot"
            >
              Reset
            </button>
          )}
          {source === "pin" && selectedKey && (
            <button
              type="button"
              onClick={() => onClearPin({ parentSlotId, variantKey: selectedKey, childSlotId })}
              className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
              title="Remove this variant's pin; the rig checklist will mark it unresolved"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** A variant selector with an artwork thumbnail and resolved runtime key. */
export function VariantGridButton({
  part,
  issues,
  previewed,
  onClick,
}: {
  part: CharacterPart;
  issues: VariantKeyIssue[];
  previewed: boolean;
  onClick: () => void;
}) {
  const url = useMediaUrl(part.mediaId);
  const hasWarning = issues.some((issue) => issue.severity === "warning");
  const resolvedKey = variantKeyForPart(part);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded border p-1.5 text-left text-[10px] hover:bg-panel ${
        previewed ? "border-primary bg-primary/15" : "border-border bg-background"
      }`}
      title={
        hasWarning
          ? issues.map((issue) => issue.message).join("\n")
          : `Show ${variantLabelForPart(part)} in place`
      }
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-white/90">
        {url ? (
          <img src={url} alt="" className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-[8px] text-muted-foreground">…</span>
        )}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1">
          {hasWarning && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />}
          <span className="truncate">{variantLabelForPart(part)}</span>
        </span>
        <span className="block truncate font-mono text-[9px] text-muted-foreground">
          {resolvedKey}
        </span>
      </span>
    </button>
  );
}

const VARIANT_KEY_SOURCE_LABELS: Record<VariantKeySource, string> = {
  explicitKey: "explicit key",
  package: "package",
  viseme: "viseme",
  eyeState: "eye state",
  pose: "pose",
  idFallback: "id fallback",
};

/** Shows the variant key used by the runtime and any pairing diagnostics. */
export function VariantKeyChip({
  part,
  issues,
}: {
  part: CharacterPart;
  issues: VariantKeyIssue[];
}) {
  const { key, source } = variantKeySourceForPart(part);
  const hasWarning = issues.some((issue) => issue.severity === "warning");
  const tone = hasWarning
    ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";

  return (
    <div className="space-y-1">
      <span
        className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone}`}
        title="The key this part answers to at runtime — parent/child pairing matches it exactly."
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            hasWarning ? "bg-amber-400" : "bg-emerald-400"
          }`}
        />
        <span className="truncate font-mono">{key}</span>
        <span className="shrink-0 text-muted-foreground">
          · {VARIANT_KEY_SOURCE_LABELS[source]}
        </span>
      </span>
      {issues.map((issue, index) => (
        <div
          key={index}
          className={`text-[10px] leading-snug ${
            issue.severity === "warning" ? "text-amber-300/90" : "text-muted-foreground"
          }`}
        >
          {issue.message}
        </div>
      ))}
    </div>
  );
}
