// Character attachment, drag-boundary, and reach inspector controls.

import { Lock } from "lucide-react";
import type { CharacterPreset, ID } from "../types";
import { Field } from "./CharacterInspectorFields";
import { getPartSlotId, listCharacterSlots, partAvailableForAngle } from "./character-utils";
import { normalizeCharacterRig, parentSlotIdForSlot } from "./rig";

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

/**
 * Configures a layer's parent and movement reach. Reach guides generated motion while manual
 * canvas dragging remains unrestricted.
 */
export function RestrictMovementPanel({
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
  const slots = listCharacterSlots(doc, { angle: rig.activeAngle, includeEmpty: false });
  const slot = slots.find((s) => s.id === slotId);
  const parentSlotId = parentSlotIdForSlot(rig, slotId) ?? "";
  const parentName = slots.find((s) => s.id === parentSlotId)?.name;
  const parentOptions = slots.filter((s) => s.id !== slotId);
  const binding = rig.slotBindings.find((entry) => entry.slotId === slotId);
  const bone = binding ? rig.bones.find((entry) => entry.id === binding.boneId) : undefined;
  const pinName = bone?.restSource?.pinName;
  const parentParts = parentSlotId
    ? doc.parts.filter(
        (part) =>
          getPartSlotId(part) === parentSlotId && partAvailableForAngle(part, rig.activeAngle),
      )
    : [];
  const pinsReady = !!pinName && parentParts.every((part) => !!part.pins?.[pinName]);
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
          Attachment & reach
        </span>
      </div>

      {/* At-a-glance status: green = set, amber = still needs setting. */}
      <div className="mb-3 flex flex-wrap gap-1">
        <ConstraintPill set={pinsReady} label="Pins" />
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

      <Field label="Attached to">
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
        {parentName && pinName
          ? `${pinName} on ${parentName}${pinsReady ? "" : " needs placement on every variant"}.`
          : parentName
            ? `Carried by ${parentName}; place its required output pin.`
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
