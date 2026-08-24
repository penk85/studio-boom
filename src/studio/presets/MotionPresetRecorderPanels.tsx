// Keypose strip, part rail, and transform properties for the action recorder.

import { Eye, EyeOff, FlipHorizontal2, FlipVertical2, Lock, RotateCcw, Unlock } from "lucide-react";
import { limbPathBendSide } from "../character/scene";
import type { CharacterBone, CharacterPart, PartRole, RecordedKeypose } from "../types";
import {
  flexibleActionControlState,
  flexibleBendPatch,
  flexibleReachPatch,
} from "./flexible-action-controls";
import {
  isDirtyOverride,
  recorderActionLimbPathForPart,
  roleLabel,
  round,
  scaleMagnitude,
  signedScaleValue,
  toggleSignedScale,
  variantOptionsForSlot,
  type CharacterSlot,
  type RecorderControlState,
  type RecorderPartState,
  isDirtyControlOverride,
} from "./motion-recorder-state";

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

export function KeyposeStrip({
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
          className="rounded border border-border px-2 py-1 text-ui-sm text-muted-foreground hover:bg-panel-2 disabled:opacity-40"
        >
          Space evenly
        </button>
      </div>

      {keyposes.length === 0 ? (
        <div className="rounded border border-dashed border-border p-3 text-center text-ui-sm text-muted-foreground">
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
                    <div className="flex h-full items-center justify-center text-ui-sm text-muted-foreground">
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
                    className="mt-1 w-full rounded border border-border bg-input px-1 py-0.5 text-ui-sm"
                  />
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemove(keypose.t);
                    }}
                    className="mt-1 text-ui-sm text-destructive"
                  >
                    Remove
                  </button>
                </div>

                {next && (
                  <div className="w-28 shrink-0 text-center text-ui-sm text-muted-foreground">
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

export function PartList({
  controls,
  controlOverrides,
  selectedControlId,
  slots,
  selectedSlotId,
  overrides,
  activePartForSlot,
  isLocked,
  onToggleLocked,
  onSelect,
  onToggleHidden,
  onSelectControl,
}: {
  controls: CharacterBone[];
  controlOverrides: Map<string, RecorderControlState>;
  selectedControlId: string | null;
  slots: CharacterSlot[];
  selectedSlotId: string | null;
  overrides: Map<string, RecorderPartState>;
  activePartForSlot: (slot: CharacterSlot) => CharacterPart | undefined;
  isLocked: (id: string) => boolean;
  onToggleLocked: (id: string) => void;
  onSelect: (id: string) => void;
  onToggleHidden: (id: string) => void;
  onSelectControl: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      {controls.length > 0 && (
        <section>
          <div className="mb-1 text-ui-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Controls
          </div>
          <div className="space-y-1">
            {controls.map((control) => {
              const override = controlOverrides.get(control.id);
              const dirty = isDirtyControlOverride(override);
              return (
                <button
                  key={control.id}
                  type="button"
                  onClick={() => onSelectControl(control.id)}
                  className={`flex w-full items-center gap-1 rounded px-1.5 py-1 text-left ${
                    selectedControlId === control.id
                      ? "bg-primary/20 text-foreground"
                      : "text-muted-foreground hover:bg-panel-2 hover:text-foreground"
                  }`}
                >
                  <span className="w-2">{dirty ? "•" : ""}</span>
                  <span className="min-w-0 flex-1 truncate">{control.name}</span>
                  <span className="rounded bg-background/60 px-1 text-ui-sm">
                    {control.controlKind === "ikTarget" ? "IK" : "FK / IK"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
      {ROLE_GROUPS.map((group) => {
        const groupSlots = slots.filter((slot) => group.roles.includes(slot.role));
        if (groupSlots.length === 0) return null;
        return (
          <section key={group.title}>
            <div className="mb-1 text-ui-sm font-semibold uppercase tracking-wider text-muted-foreground">
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
                      <span className="rounded bg-background/60 px-1 text-ui-sm">{slot.role}</span>
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

export function PropertiesPanel({
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
      <div className="rounded border border-dashed border-border p-3 text-center text-ui-sm text-muted-foreground">
        Select a part.
      </div>
    );
  }
  const variantOptions = variantOptionsForSlot(slot);
  const mirrored = override.scaleX < 0;
  const flipped = override.scaleY < 0;
  const flexiblePath =
    part.deform?.mode === "limb-path" ? recorderActionLimbPathForPart(part, part.deform) : null;
  const flexibleControls = flexiblePath
    ? flexibleActionControlState(flexiblePath, override, limbPathBendSide(flexiblePath))
    : null;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground">{slot.name ?? part.name}</div>
          <div className="text-ui-sm text-muted-foreground">{slot.role}</div>
        </div>
        <button
          onClick={onResetAll}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-ui-sm hover:bg-panel-2"
        >
          <RotateCcw size={11} />
          Reset all
        </button>
      </div>

      <div className="space-y-2">
        {variantOptions.length > 1 && (
          <label className="grid grid-cols-[64px_1fr] items-center gap-2 text-ui-sm">
            <span className="text-muted-foreground">Variant</span>
            <select
              value={override.poseSwap ?? ""}
              onChange={(event) => onChange({ poseSwap: event.target.value || undefined })}
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
          value={scaleMagnitude(override.scaleX)}
          min={0.1}
          max={3}
          step={0.01}
          rest={1}
          onChange={(value) => onChange({ scaleX: signedScaleValue(override.scaleX, value) })}
        />
        <PropertyRow
          label="Height"
          value={scaleMagnitude(override.scaleY)}
          min={0.1}
          max={3}
          step={0.01}
          rest={1}
          onChange={(value) => onChange({ scaleY: signedScaleValue(override.scaleY, value) })}
        />
        <div className="grid grid-cols-[64px_1fr] items-center gap-2 text-ui-sm">
          <span className="text-muted-foreground">Orient</span>
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              aria-pressed={mirrored}
              onClick={() => onChange({ scaleX: toggleSignedScale(override.scaleX) })}
              className={`flex items-center justify-center gap-1 rounded border px-2 py-1 ${
                mirrored
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border hover:bg-panel-2"
              }`}
              title="Mirror horizontally for this action keyframe"
            >
              <FlipHorizontal2 size={12} />
              Mirror
            </button>
            <button
              type="button"
              aria-pressed={flipped}
              onClick={() => onChange({ scaleY: toggleSignedScale(override.scaleY) })}
              className={`flex items-center justify-center gap-1 rounded border px-2 py-1 ${
                flipped
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border hover:bg-panel-2"
              }`}
              title="Flip vertically for this action keyframe"
            >
              <FlipVertical2 size={12} />
              Flip
            </button>
          </div>
        </div>
        <PropertyRow
          label="Rotation"
          value={override.rotation}
          min={-180}
          max={180}
          step={1}
          rest={0}
          onChange={(value) => onChange({ rotation: value })}
        />
        {flexiblePath && flexibleControls && (
          <>
            <PropertyRow
              label="Bend"
              value={flexibleControls.bend}
              min={0}
              max={flexibleControls.bendLimit}
              step={1}
              rest={0}
              modified={flexibleControls.bendModified}
              onChange={(value) =>
                onChange(
                  flexibleBendPatch(flexiblePath, override, value, limbPathBendSide(flexiblePath)),
                )
              }
              onReset={() => onChange({ pathCurveX: 0, pathCurveY: 0 })}
            />
            <PropertyRow
              label="Reach"
              value={flexibleControls.reach}
              min={-flexibleControls.reachLimit}
              max={flexibleControls.reachLimit}
              step={1}
              rest={0}
              modified={flexibleControls.reachModified}
              onChange={(value) => onChange(flexibleReachPatch(flexiblePath, override, value))}
              onReset={() => onChange({ pathEndX: 0, pathEndY: 0 })}
            />
          </>
        )}
        {rotationLimit && (
          <div className="flex items-center justify-between gap-2 pl-[72px] text-ui-sm text-muted-foreground">
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
                onChange={(event) => onAllowOutOfBoundsChange(event.target.checked)}
              />
              Allow out of bounds
            </label>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => onAdvancedOpenChange(!advancedOpen)}
        className="mt-3 flex w-full items-center justify-between rounded border border-border px-2 py-1 text-left text-ui-sm hover:bg-panel-2"
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

export function ControlPropertiesPanel({
  control,
  override,
  onChange,
  onReset,
}: {
  control: CharacterBone | null;
  override: RecorderControlState | null;
  onChange: (patch: Partial<RecorderControlState>) => void;
  onReset: () => void;
}) {
  if (!control || !override) {
    return (
      <div className="rounded border border-dashed border-border p-3 text-center text-ui-sm text-muted-foreground">
        Select a Part or Control.
      </div>
    );
  }
  const input = (label: string, value: number, patch: keyof RecorderControlState) => (
    <label className="grid grid-cols-[72px_1fr] items-center gap-2 text-ui-sm">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="number"
        step={1}
        value={value}
        onChange={(event) => onChange({ [patch]: Number(event.target.value) || 0 })}
        className="w-full rounded border border-border bg-input px-1 py-0.5"
      />
    </label>
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground">{control.name}</div>
          <div className="text-ui-sm text-muted-foreground">
            {control.controlKind === "ikTarget" ? "IK end control" : "Pelvis control"}
          </div>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="rounded border border-border px-2 py-1 text-ui-sm hover:bg-panel-2"
        >
          Reset
        </button>
      </div>
      {input("X", override.dx, "dx")}
      {input("Y", override.dy, "dy")}
      {input("Rotation°", override.rotation, "rotation")}
      <div className="rounded border border-border bg-panel-2 p-2 text-ui-sm text-muted-foreground">
        {control.controlKind === "ikTarget"
          ? "Move this Control in an IK Action to place the foot. In FK Actions, pose the leg bones directly."
          : "Pelvis carries the torso and legs. Its transform works in both FK and IK Actions."}
      </div>
    </div>
  );
}

export function PropertyRow({
  label,
  value,
  min,
  max,
  step,
  rest,
  modified,
  onChange,
  onReset,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  rest: number;
  modified?: boolean;
  onChange: (value: number) => void;
  onReset?: () => void;
}) {
  const isModified = modified ?? Math.abs(value - rest) > 0.0001;
  return (
    <label className="grid grid-cols-[64px_1fr_56px_22px] items-center gap-2 text-ui-sm">
      <span
        className={`flex items-center gap-1 ${isModified ? "text-primary" : "text-muted-foreground"}`}
      >
        {label}
        {isModified && <span className="h-1 w-1 rounded-full bg-primary" aria-hidden="true" />}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full"
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className={`w-full rounded border bg-input px-1 py-0.5 ${
          isModified ? "border-primary/60" : "border-border"
        }`}
      />
      <button
        type="button"
        onClick={() => (onReset ? onReset() : onChange(rest))}
        disabled={!isModified}
        className="rounded border border-border px-1 py-0.5 hover:bg-panel-2 disabled:cursor-default disabled:opacity-30"
        title={isModified ? `Reset ${label.toLowerCase()}` : `${label} is at rest`}
        aria-label={`Reset ${label}`}
      >
        <RotateCcw size={10} />
      </button>
    </label>
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
      <span className="block text-ui-sm text-muted-foreground">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded border border-border bg-input px-1 py-0.5"
      />
    </label>
  );
}
