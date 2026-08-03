import { useState } from "react";
import { X } from "lucide-react";
import { MOUTH_VISEMES } from "../lipsync/viseme-schema";
import type { MouthPose, MouthRig, MouthViseme } from "../types";
import {
  createDefaultMouthRig,
  DEFAULT_INTERIOR_COLOR,
  DEFAULT_LIP_COLOR,
  DEFAULT_TEETH_COLOR,
  DEFAULT_TONGUE_COLOR,
  MOUTH_VIEWBOX,
  poseToTransforms,
  RIG_STYLES,
  VISEME_POSES,
  type RigStyle,
} from "./mouth-libraries";

interface MouthCreatorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (rig: MouthRig) => void;
  initialRig?: MouthRig;
}

export function MouthCreator({ isOpen, onClose, onSave, initialRig }: MouthCreatorProps) {
  const [styleId, setStyleId] = useState(initialRig?.styleId ?? RIG_STYLES[0].id);
  const [widthScale, setWidthScale] = useState(initialRig?.widthScale ?? 1.0);
  const [upperCurve, setUpperCurve] = useState(initialRig?.upperCurve ?? 0);
  const [lowerCurve, setLowerCurve] = useState(initialRig?.lowerCurve ?? 0);
  const [lipColor, setLipColor] = useState(initialRig?.lipColor ?? DEFAULT_LIP_COLOR);
  const [teethColor, setTeethColor] = useState(initialRig?.teethColor ?? DEFAULT_TEETH_COLOR);
  const [tongueColor, setTongueColor] = useState(initialRig?.tongueColor ?? DEFAULT_TONGUE_COLOR);
  const [interiorColor, setInteriorColor] = useState(
    initialRig?.interiorColor ?? DEFAULT_INTERIOR_COLOR,
  );
  const [poses, setPoses] = useState<Record<MouthViseme, MouthPose>>(() =>
    initialRig?.poses ? { ...initialRig.poses } : { ...VISEME_POSES },
  );
  const [selectedViseme, setSelectedViseme] = useState<MouthViseme | null>(null);

  if (!isOpen) return null;

  const style = RIG_STYLES.find((s) => s.id === styleId) ?? RIG_STYLES[0];

  const setPoseParam = (viseme: MouthViseme, param: keyof MouthPose, value: number) => {
    setPoses((prev) => ({ ...prev, [viseme]: { ...prev[viseme], [param]: value } }));
  };

  const handleSave = () => {
    const rig = createDefaultMouthRig(styleId, initialRig?.placement);
    rig.widthScale = widthScale;
    rig.upperCurve = upperCurve;
    rig.lowerCurve = lowerCurve;
    rig.lipColor = lipColor;
    rig.teethColor = teethColor;
    rig.tongueColor = tongueColor;
    rig.interiorColor = interiorColor;
    rig.poses = { ...poses };
    onSave(rig);
  };

  const handleReset = (viseme: MouthViseme) => {
    setPoses((prev) => ({ ...prev, [viseme]: { ...VISEME_POSES[viseme] } }));
  };

  const colors = { lipColor, teethColor, tongueColor, interiorColor };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex max-h-[95vh] w-[700px] flex-col rounded-lg bg-panel shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Choose Generated Mouth Style</h2>
            <p className="text-ui-sm text-muted-foreground">
              Generated SVG mouth slot — all 10 visemes animate smoothly via GSAP.
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-panel-2">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
          {/* Style selector */}
          <div>
            <div className="mb-2 text-ui-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Style
            </div>
            <div className="grid grid-cols-3 gap-2">
              {RIG_STYLES.map((s) => (
                <StyleCard
                  key={s.id}
                  style={s}
                  pose={poses.rest}
                  colors={colors}
                  widthScale={widthScale}
                  upperCurve={upperCurve}
                  lowerCurve={lowerCurve}
                  selected={s.id === styleId}
                  onClick={() => setStyleId(s.id)}
                />
              ))}
            </div>
          </div>

          {/* Viseme board — all 10 poses, click to edit */}
          <div>
            <div className="mb-2 text-ui-sm font-semibold uppercase tracking-wider text-muted-foreground">
              All visemes — click to edit pose
            </div>
            <div className="grid grid-cols-5 gap-2">
              {MOUTH_VISEMES.map((viseme) => (
                <VisemeCell
                  key={viseme}
                  viseme={viseme}
                  style={style}
                  pose={poses[viseme]}
                  colors={colors}
                  widthScale={widthScale}
                  upperCurve={upperCurve}
                  lowerCurve={lowerCurve}
                  selected={viseme === selectedViseme}
                  onClick={() => setSelectedViseme(viseme === selectedViseme ? null : viseme)}
                />
              ))}
            </div>
          </div>

          {/* Per-viseme pose editor */}
          {selectedViseme && (
            <PoseEditor
              viseme={selectedViseme}
              pose={poses[selectedViseme]}
              style={style}
              colors={colors}
              widthScale={widthScale}
              upperCurve={upperCurve}
              lowerCurve={lowerCurve}
              onChange={(param, value) => setPoseParam(selectedViseme, param, value)}
              onReset={() => handleReset(selectedViseme)}
            />
          )}

          {/* Controls */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <ShapeSlider
              label="Width"
              value={widthScale}
              min={0.7}
              max={1.3}
              step={0.05}
              onChange={setWidthScale}
            />
            <ShapeSlider
              label="Upper lip arch"
              value={upperCurve}
              min={-1}
              max={1}
              step={0.05}
              onChange={setUpperCurve}
            />
            <ShapeSlider
              label="Lower lip arch"
              value={lowerCurve}
              min={-1}
              max={1}
              step={0.05}
              onChange={setLowerCurve}
            />
            {/* Colour pickers */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <ColorPicker label="Lips" value={lipColor} onChange={setLipColor} />
              <ColorPicker label="Teeth" value={teethColor} onChange={setTeethColor} />
              <ColorPicker label="Tongue" value={tongueColor} onChange={setTongueColor} />
              <ColorPicker label="Interior" value={interiorColor} onChange={setInteriorColor} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={onClose}
            className="rounded border border-border px-4 py-2 text-sm hover:bg-panel-2"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Save Mouth Style
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface Colors {
  lipColor: string;
  teethColor: string;
  tongueColor: string;
  interiorColor: string;
}

function StyleCard({
  style,
  pose,
  colors,
  widthScale,
  upperCurve,
  lowerCurve,
  selected,
  onClick,
}: {
  style: RigStyle;
  pose: MouthPose;
  colors: Colors;
  widthScale: number;
  upperCurve: number;
  lowerCurve: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 rounded border px-2 py-2 text-ui-sm transition-colors ${
        selected
          ? "border-primary bg-primary/15 text-primary"
          : "border-border bg-background hover:bg-panel-2"
      }`}
    >
      <div className="w-full" style={{ aspectRatio: "100/60" }}>
        <RigPreview
          style={style}
          pose={pose}
          colors={colors}
          widthScale={widthScale}
          upperCurve={upperCurve}
          lowerCurve={lowerCurve}
        />
      </div>
      {style.label}
    </button>
  );
}

function VisemeCell({
  viseme,
  style,
  pose,
  colors,
  widthScale,
  upperCurve,
  lowerCurve,
  selected,
  onClick,
}: {
  viseme: MouthViseme;
  style: RigStyle;
  pose: MouthPose;
  colors: Colors;
  widthScale: number;
  upperCurve: number;
  lowerCurve: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1 rounded border p-1 transition-colors ${
        selected
          ? "border-primary bg-primary/15"
          : "border-border bg-background hover:border-primary/50"
      }`}
    >
      <div className="w-full" style={{ aspectRatio: "100/60" }}>
        <RigPreview
          style={style}
          pose={pose}
          colors={colors}
          widthScale={widthScale}
          upperCurve={upperCurve}
          lowerCurve={lowerCurve}
        />
      </div>
      <span className="text-ui-sm uppercase tracking-wider text-muted-foreground">{viseme}</span>
    </button>
  );
}

function PoseEditor({
  viseme,
  pose,
  style,
  colors,
  widthScale,
  upperCurve,
  lowerCurve,
  onChange,
  onReset,
}: {
  viseme: MouthViseme;
  pose: MouthPose;
  style: RigStyle;
  colors: Colors;
  widthScale: number;
  upperCurve: number;
  lowerCurve: number;
  onChange: (param: keyof MouthPose, value: number) => void;
  onReset: () => void;
}) {
  const params: { key: keyof MouthPose; label: string; min: number; max: number; step: number }[] =
    [
      { key: "open", label: "Open", min: -0.2, max: 1, step: 0.05 },
      { key: "wide", label: "Wide", min: -0.6, max: 1, step: 0.05 },
      { key: "round", label: "Round", min: 0, max: 1, step: 0.05 },
      { key: "smile", label: "Smile", min: 0, max: 1, step: 0.05 },
      { key: "teeth", label: "Teeth", min: 0, max: 1, step: 0.05 },
      { key: "tongue", label: "Tongue", min: 0, max: 1, step: 0.05 },
      { key: "fvBite", label: "FV Bite", min: 0, max: 1, step: 0.05 },
    ];

  return (
    <div className="rounded border border-primary/30 bg-primary/5 p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-ui-sm font-semibold uppercase tracking-wider text-primary">
          Editing: {viseme}
        </span>
        <div className="flex items-center gap-3">
          <div className="h-10 w-16 shrink-0">
            <RigPreview
              style={style}
              pose={pose}
              colors={colors}
              widthScale={widthScale}
              upperCurve={upperCurve}
              lowerCurve={lowerCurve}
            />
          </div>
          <button
            type="button"
            onClick={onReset}
            className="text-ui-sm text-muted-foreground underline hover:text-foreground"
          >
            Reset
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        {params.map(({ key, label, min, max, step }) => (
          <div key={key} className="flex flex-col gap-0.5">
            <div className="flex justify-between text-ui-sm">
              <span className="text-muted-foreground">{label}</span>
              <span className="tabular-nums text-muted-foreground">{pose[key].toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={pose[key]}
              onChange={(e) => onChange(key, Number(e.target.value))}
              className="w-full accent-primary"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function ShapeSlider({
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
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex justify-between text-ui-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}

function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-ui-sm text-muted-foreground">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-8 cursor-pointer rounded border border-border"
      />
    </div>
  );
}

// ─── Rig preview (pure SVG, no DOM IDs, no GSAP) ─────────────────────────────
// Used only in the MouthCreator UI; legacy generated mouth rigs are no longer rendered.
export function RigPreview({
  style,
  pose,
  colors,
  widthScale = 1,
  upperCurve = 0,
  lowerCurve = 0,
}: {
  style: RigStyle;
  pose: MouthPose;
  colors: Colors;
  widthScale?: number;
  upperCurve?: number;
  lowerCurve?: number;
}) {
  const t = poseToTransforms(pose, style, { upperCurve, lowerCurve });

  const ux = t.upperLip.scaleX * widthScale;
  const lx = t.lowerLip.scaleX * widthScale;
  const ix = t.interior.scaleX * widthScale;

  const cx = 50; // horizontal transform origin (centre of viewBox)
  const cy = 30; // vertical transform origin (lip line)

  const transform = (y: number, sx: number, sy = 1) =>
    `translate(${cx} ${cy + y}) scale(${sx} ${sy}) translate(${-cx} ${-cy})`;

  return (
    <svg viewBox={MOUTH_VIEWBOX} className="h-full w-full" aria-hidden>
      <path
        d={style.interiorPath}
        fill={colors.interiorColor}
        opacity={t.interior.opacity}
        transform={transform(0, ix, Math.max(0.01, t.interior.scaleY))}
      />
      <path
        d={style.tonguePath}
        fill={colors.tongueColor}
        opacity={t.tongue.opacity}
        transform={transform(t.tongue.y, lx)}
      />
      <path
        d={style.teethPath}
        fill={colors.teethColor}
        opacity={t.teeth.opacity}
        transform={transform(t.teeth.y, ux)}
      />
      <path
        d={style.lowerLipPath}
        fill={colors.lipColor}
        transform={transform(t.lowerLip.y, lx, t.lowerLip.scaleY)}
      />
      <path
        d={style.upperLipPath}
        fill={colors.lipColor}
        transform={transform(t.upperLip.y, ux, t.upperLip.scaleY)}
      />
    </svg>
  );
}
