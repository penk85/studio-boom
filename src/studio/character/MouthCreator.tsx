import { useRef, useState, useCallback } from "react";
import { X, Image as ImageIcon } from "lucide-react";
import { MOUTH_VISEMES } from "../lipsync/viseme-schema";
import { absolutizeAndMorphPath, MOUTH_MORPH_PRESETS, parseViewBox } from "./mouth-morph";

const VIEW_W = 100;
const VIEW_H = 60;
const VIEWBOX = `0 0 ${VIEW_W} ${VIEW_H}`;
const STROKE_W = 2.5;

// Parameters that drive the mouth shape
interface MouthParams {
  width: number;        // 0.4 narrow → 1.6 wide
  topHeight: number;    // 0.0 flat → 1.5 arched upper lip
  bottomHeight: number; // 0.0 flat → 1.5 drooping lower lip
  upperArch: number;    // 0.0 smooth → 2.0 peaked
  lowerArch: number;    // 0.0 smooth → 2.0 full
}

const DEFAULT_PARAMS: MouthParams = {
  width: 1.0,
  topHeight: 0.2,
  bottomHeight: 0.3,
  upperArch: 0.3,
  lowerArch: 0.3,
};

const MOUTH_STYLES: Array<{ id: string; label: string; params: MouthParams }> = [
  {
    id: "natural",
    label: "Natural",
    params: { width: 1.0, topHeight: 0.2, bottomHeight: 0.3, upperArch: 0.3, lowerArch: 0.3 },
  },
  {
    id: "wide",
    label: "Wide",
    params: { width: 1.45, topHeight: 0.1, bottomHeight: 0.18, upperArch: 0.1, lowerArch: 0.2 },
  },
  {
    id: "round",
    label: "Round",
    params: { width: 0.72, topHeight: 0.6, bottomHeight: 0.72, upperArch: 0.9, lowerArch: 1.0 },
  },
  {
    id: "petite",
    label: "Petite",
    params: { width: 0.55, topHeight: 0.25, bottomHeight: 0.35, upperArch: 0.5, lowerArch: 0.4 },
  },
  {
    id: "pouty",
    label: "Pouty",
    params: { width: 0.9, topHeight: 0.1, bottomHeight: 1.0, upperArch: 0.15, lowerArch: 1.5 },
  },
  {
    id: "cartoon",
    label: "Cartoon",
    params: { width: 1.2, topHeight: 0.55, bottomHeight: 0.75, upperArch: 1.4, lowerArch: 1.7 },
  },
];

// Two stroke arcs sharing the same corner anchors.
// At rest the arcs are nearly on top of each other (natural closed mouth).
// The morph system moves them apart for open-mouth visemes.
// Structure: M C C  M C C  — compound path, no fill, stroke only.
function generateMouthPath(p: MouthParams, lipColor: string): string {
  const cx = VIEW_W / 2;
  const cy = VIEW_H / 2;
  const halfW = 30 * p.width;
  const left = cx - halfW;
  const right = cx + halfW;

  // Upper lip apex — sits slightly above the corner baseline
  const upperMid = cy - 7 * p.topHeight;
  // Control point height drives the cupid's-bow sharpness
  const upperCtrl = upperMid - 4 * p.upperArch;

  // Lower lip nadir — sits slightly below the corner baseline
  const lowerMid = cy + 7 * p.bottomHeight;
  // Control point depth drives lower-lip fullness
  const lowerCtrl = lowerMid + 5 * p.lowerArch;

  const innerX = halfW * 0.35;
  const outerX = halfW * 0.3;

  const f = (n: number) => Number(n.toFixed(3)).toString();

  const d = [
    // Upper lip: left corner → apex → right corner
    `M ${f(left)} ${f(cy)}`,
    `C ${f(left + outerX)} ${f(upperCtrl)} ${f(cx - innerX)} ${f(upperMid)} ${f(cx)} ${f(upperMid)}`,
    `C ${f(cx + innerX)} ${f(upperMid)} ${f(right - outerX)} ${f(upperCtrl)} ${f(right)} ${f(cy)}`,
    // Lower lip: right corner → nadir → left corner
    `M ${f(right)} ${f(cy)}`,
    `C ${f(right - outerX)} ${f(lowerCtrl)} ${f(cx + innerX)} ${f(lowerMid)} ${f(cx)} ${f(lowerMid)}`,
    `C ${f(cx - innerX)} ${f(lowerMid)} ${f(left + outerX)} ${f(lowerCtrl)} ${f(left)} ${f(cy)}`,
  ].join(" ");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX}"><path d="${d}" fill="none" stroke="${lipColor}" stroke-width="${STROKE_W}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function morphedPath(restSvg: string, viseme: string): string {
  const match = restSvg.match(/d="([^"]+)"/);
  if (!match) return "";
  try {
    return absolutizeAndMorphPath(match[1], parseViewBox(VIEWBOX), MOUTH_MORPH_PRESETS[viseme as keyof typeof MOUTH_MORPH_PRESETS]);
  } catch {
    return match[1];
  }
}

interface MouthCreatorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (svg: string, name: string) => void;
}

export function MouthCreator({ isOpen, onClose, onSave }: MouthCreatorProps) {
  const [params, setParams] = useState<MouthParams>(DEFAULT_PARAMS);
  const [lipColor, setLipColor] = useState("#C98255");
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [imageOpacity, setImageOpacity] = useState(0.25);
  const [activeStyle, setActiveStyle] = useState("natural");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const applyStyle = useCallback((style: typeof MOUTH_STYLES[number]) => {
    setActiveStyle(style.id);
    setParams(style.params);
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReferenceImage(URL.createObjectURL(file));
  };

  const setParam = (key: keyof MouthParams) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setActiveStyle("");
    setParams((prev) => ({ ...prev, [key]: Number(e.target.value) }));
  };

  const handleSave = () => {
    const svg = generateMouthPath(params, lipColor);
    onSave(svg, "Mouth rest");
    onClose();
  };

  if (!isOpen) return null;

  const restSvg = generateMouthPath(params, lipColor);
  const restPathD = restSvg.match(/d="([^"]+)"/)?.[1] ?? "";

  const strokeProps = {
    fill: "none" as const,
    stroke: lipColor,
    strokeWidth: STROKE_W,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex max-h-[95vh] w-[780px] flex-col rounded-lg bg-panel shadow-xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Design Rest Mouth</h2>
            <p className="text-[11px] text-muted-foreground">
              Pick a style, adjust sliders, then save — all other visemes are generated automatically.
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-panel-2">
            <X size={18} />
          </button>
        </div>

        {/* Main area */}
        <div className="flex flex-1 gap-4 overflow-hidden p-4">

          {/* Left — canvas preview */}
          <div className="flex flex-col gap-3">
            {/* Style gallery */}
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Start with a style
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {MOUTH_STYLES.map((style) => (
                  <button
                    key={style.id}
                    onClick={() => applyStyle(style)}
                    className={`flex flex-col items-center gap-1 rounded border px-2 py-1.5 text-[10px] transition-colors ${
                      activeStyle === style.id
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-background hover:bg-panel-2"
                    }`}
                  >
                    <svg viewBox={VIEWBOX} className="h-6 w-12" aria-hidden>
                      <path
                        d={(() => {
                          const svg = generateMouthPath(style.params, lipColor);
                          return svg.match(/d="([^"]+)"/)?.[1] ?? "";
                        })()}
                        {...strokeProps}
                      />
                    </svg>
                    {style.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Canvas */}
            <div className="relative overflow-hidden rounded border border-border bg-background" style={{ width: 300, height: 180 }}>
              {referenceImage && (
                <img
                  src={referenceImage}
                  alt="Reference"
                  className="absolute inset-0 h-full w-full object-contain"
                  style={{ opacity: imageOpacity }}
                />
              )}
              <svg viewBox={VIEWBOX} className="absolute inset-0 h-full w-full">
                <path d={restPathD} {...strokeProps} />
              </svg>
            </div>

            {/* Reference image controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-panel-2"
              >
                <ImageIcon size={13} />
                {referenceImage ? "Change reference" : "Upload reference image"}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              {referenceImage && (
                <>
                  <input
                    type="range"
                    min="0.05"
                    max="0.6"
                    step="0.05"
                    value={imageOpacity}
                    onChange={(e) => setImageOpacity(Number(e.target.value))}
                    className="w-20"
                    title="Reference opacity"
                  />
                  <button
                    onClick={() => setReferenceImage(null)}
                    className="text-[10px] text-muted-foreground hover:text-destructive"
                  >
                    <X size={12} />
                  </button>
                </>
              )}
            </div>

            {/* Lip color */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">Lip colour</span>
              <input
                type="color"
                value={lipColor}
                onChange={(e) => setLipColor(e.target.value)}
                className="h-6 w-8 cursor-pointer rounded border border-border"
              />
            </div>
          </div>

          {/* Right — sliders */}
          <div className="flex flex-1 flex-col gap-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Fine-tune
            </div>

            <SliderRow
              label="Width"
              hint="Narrow → Wide"
              min={0.4} max={1.6} step={0.05}
              value={params.width}
              onChange={setParam("width")}
            />
            <SliderRow
              label="Upper lip height"
              hint="Flat → Arched"
              min={0.0} max={1.5} step={0.05}
              value={params.topHeight}
              onChange={setParam("topHeight")}
            />
            <SliderRow
              label="Lower lip fullness"
              hint="Thin → Full"
              min={0.0} max={1.5} step={0.05}
              value={params.bottomHeight}
              onChange={setParam("bottomHeight")}
            />
            <SliderRow
              label="Upper lip curve"
              hint="Smooth → Peaked"
              min={0.0} max={2.0} step={0.05}
              value={params.upperArch}
              onChange={setParam("upperArch")}
            />
            <SliderRow
              label="Lower lip curve"
              hint="Smooth → Full"
              min={0.0} max={2.0} step={0.05}
              value={params.lowerArch}
              onChange={setParam("lowerArch")}
            />

            <button
              onClick={() => { setParams(DEFAULT_PARAMS); setActiveStyle("natural"); }}
              className="mt-1 w-full rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-panel-2 hover:text-foreground"
            >
              Reset to defaults
            </button>
          </div>
        </div>

        {/* Viseme preview strip */}
        <div className="border-t border-border px-4 py-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            How it morphs — all visemes generated from your rest shape
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {MOUTH_VISEMES.map((viseme) => {
              const d = viseme === "rest" ? restPathD : morphedPath(restSvg, viseme);
              return (
                <div key={viseme} className="flex flex-shrink-0 flex-col items-center gap-1">
                  <div className="rounded border border-border bg-background p-1" style={{ width: 60, height: 36 }}>
                    <svg viewBox={VIEWBOX} className="h-full w-full">
                      <path d={d} {...strokeProps} />
                    </svg>
                  </div>
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                    {viseme}
                  </span>
                </div>
              );
            })}
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
            Save Rest Mouth
          </button>
        </div>
      </div>
    </div>
  );
}

function SliderRow({
  label,
  hint,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-medium">{label}</span>
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        className="w-full accent-primary"
      />
    </div>
  );
}

export function createMouthSvgFile(svgContent: string, viseme: string): File {
  const blob = new Blob([svgContent], { type: "image/svg+xml" });
  return new File([blob], `mouth-${viseme}.svg`, { type: "image/svg+xml" });
}
