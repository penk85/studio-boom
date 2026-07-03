import type { CharacterPart, CharacterPartAlphaBounds, PartRole } from "../types";
import { defaultVariantForSlotParts, partMatchesVariant } from "./character-utils";
import { unionCanvasAlphaRect } from "./variant-align";

/**
 * Canonical front-facing humanoid placement map. Imported artwork is fitted into
 * its role's zone instead of landing centered on the canvas, and the editor can
 * draw the zones as a setup guide (Cartoon-Animator-style "fit art into the
 * template"). Zones are normalized 0..1 rects; "left" means screen-left.
 */
export interface PlacementGuideZone {
  role: PartRole;
  side?: "left" | "right";
  label: string;
  rect: { x: number; y: number; width: number; height: number };
}

interface ZoneSpec {
  role: PartRole;
  sided?: boolean;
  label: string;
  /** Left-side (or unsided) normalized rect; the right side mirrors it. */
  rect: { x: number; y: number; width: number; height: number };
}

const ZONE_SPECS: ZoneSpec[] = [
  { role: "hair", label: "Hair", rect: { x: 0.24, y: 0.0, width: 0.52, height: 0.24 } },
  { role: "head", label: "Head", rect: { x: 0.28, y: 0.03, width: 0.44, height: 0.3 } },
  {
    role: "eyebrow",
    sided: true,
    label: "Brow",
    rect: { x: 0.31, y: 0.115, width: 0.115, height: 0.035 },
  },
  {
    role: "eye",
    sided: true,
    label: "Eye",
    rect: { x: 0.31, y: 0.15, width: 0.115, height: 0.055 },
  },
  {
    role: "iris",
    sided: true,
    label: "Iris",
    rect: { x: 0.345, y: 0.158, width: 0.045, height: 0.038 },
  },
  { role: "nose", label: "Nose", rect: { x: 0.45, y: 0.175, width: 0.1, height: 0.06 } },
  { role: "mouth", label: "Mouth", rect: { x: 0.4, y: 0.235, width: 0.2, height: 0.06 } },
  { role: "body", label: "Body", rect: { x: 0.3, y: 0.315, width: 0.4, height: 0.42 } },
  { role: "arm", sided: true, label: "Arm", rect: { x: 0.13, y: 0.33, width: 0.17, height: 0.33 } },
  {
    role: "upperArm",
    sided: true,
    label: "Upper arm",
    rect: { x: 0.15, y: 0.33, width: 0.15, height: 0.18 },
  },
  {
    role: "lowerArm",
    sided: true,
    label: "Lower arm",
    rect: { x: 0.12, y: 0.48, width: 0.15, height: 0.18 },
  },
  {
    role: "hand",
    sided: true,
    label: "Hand",
    rect: { x: 0.09, y: 0.64, width: 0.14, height: 0.1 },
  },
  {
    role: "leg",
    sided: true,
    label: "Leg",
    rect: { x: 0.325, y: 0.72, width: 0.15, height: 0.24 },
  },
  {
    role: "upperLeg",
    sided: true,
    label: "Upper leg",
    rect: { x: 0.325, y: 0.72, width: 0.15, height: 0.13 },
  },
  {
    role: "lowerLeg",
    sided: true,
    label: "Lower leg",
    rect: { x: 0.325, y: 0.85, width: 0.15, height: 0.11 },
  },
  {
    role: "foot",
    sided: true,
    label: "Foot",
    rect: { x: 0.3, y: 0.94, width: 0.17, height: 0.055 },
  },
];

function mirrorRect(rect: ZoneSpec["rect"]): ZoneSpec["rect"] {
  return { ...rect, x: 1 - rect.x - rect.width };
}

/** Every guide zone, sided roles expanded into left + right. */
export function placementGuideZones(): PlacementGuideZone[] {
  const zones: PlacementGuideZone[] = [];
  for (const spec of ZONE_SPECS) {
    if (!spec.sided) {
      zones.push({ role: spec.role, label: spec.label, rect: spec.rect });
      continue;
    }
    zones.push({ role: spec.role, side: "left", label: `Left ${spec.label}`, rect: spec.rect });
    zones.push({
      role: spec.role,
      side: "right",
      label: `Right ${spec.label}`,
      rect: mirrorRect(spec.rect),
    });
  }
  return zones;
}

export function placementZoneFor(
  role: PartRole,
  side?: CharacterPart["side"],
): PlacementGuideZone | undefined {
  const spec = ZONE_SPECS.find((candidate) => candidate.role === role);
  if (!spec) return undefined;
  if (!spec.sided) return { role: spec.role, label: spec.label, rect: spec.rect };
  if (side !== "left" && side !== "right") return undefined;
  return {
    role: spec.role,
    side,
    label: `${side === "left" ? "Left" : "Right"} ${spec.label}`,
    rect: side === "left" ? spec.rect : mirrorRect(spec.rect),
  };
}

export function zoneCanvasRect(
  zone: PlacementGuideZone,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: zone.rect.x * canvasWidth,
    y: zone.rect.y * canvasHeight,
    width: zone.rect.width * canvasWidth,
    height: zone.rect.height * canvasHeight,
  };
}

/** Contain-fit art into a zone rect, centered (scales up or down, aspect kept). */
export function fitArtInZone(
  artWidth: number,
  artHeight: number,
  zoneRect: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const sourceWidth = Math.max(1, artWidth);
  const sourceHeight = Math.max(1, artHeight);
  const scale = Math.min(zoneRect.width / sourceWidth, zoneRect.height / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  return {
    x: Math.round(zoneRect.x + (zoneRect.width - width) / 2),
    y: Math.round(zoneRect.y + (zoneRect.height - height) / 2),
    width,
    height,
  };
}

export interface SmartImportPlacementArgs {
  /** Existing parts of the target slot (visible, current angle). */
  slotParts: CharacterPart[];
  role: PartRole;
  side?: CharacterPart["side"];
  /** Natural media dimensions of the imported art. */
  artWidth: number;
  artHeight: number;
  alphaBounds?: CharacterPartAlphaBounds;
  canvasWidth: number;
  canvasHeight: number;
}

export type SmartImportPlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
  mode: "variant" | "zone";
};

/**
 * Where newly imported art should land so correct assembly is the default:
 * - A new variant for an occupied slot sizes to the default variant's
 *   visible-pixel width and centers on its visible-pixel center, so blinks and
 *   viseme swaps line up without manual alignment.
 * - Art for an empty slot fits into that role's guide zone.
 * - Returns null when there is no reference and no zone (caller keeps the
 *   plain centered-on-canvas default).
 */
export function smartImportPlacement(args: SmartImportPlacementArgs): SmartImportPlacement | null {
  const artWidth = Math.max(1, args.artWidth || 1);
  const artHeight = Math.max(1, args.artHeight || 1);

  const visibleSlotParts = args.slotParts.filter((part) => part.visible);
  if (visibleSlotParts.length > 0) {
    const referenceKey = defaultVariantForSlotParts(visibleSlotParts, args.role);
    const referenceParts = referenceKey
      ? visibleSlotParts.filter((part) => partMatchesVariant(part, referenceKey))
      : visibleSlotParts;
    const reference = unionCanvasAlphaRect(
      referenceParts.length ? referenceParts : visibleSlotParts,
    );
    if (reference.width > 0 && reference.height > 0) {
      // The imported art's visible pixels, in art pixels.
      const bounds = args.alphaBounds;
      const sourceWidth = Math.max(1, bounds?.sourceWidth || artWidth);
      const sourceHeight = Math.max(1, bounds?.sourceHeight || artHeight);
      const alpha =
        bounds && bounds.width > 0 && bounds.height > 0
          ? {
              x: (bounds.x / sourceWidth) * artWidth,
              y: (bounds.y / sourceHeight) * artHeight,
              width: (bounds.width / sourceWidth) * artWidth,
              height: (bounds.height / sourceHeight) * artHeight,
            }
          : { x: 0, y: 0, width: artWidth, height: artHeight };
      const scale = Math.min(50, Math.max(0.02, reference.width / Math.max(1, alpha.width)));
      const width = Math.max(1, Math.round(artWidth * scale));
      const height = Math.max(1, Math.round(artHeight * scale));
      const alphaCenterX = (alpha.x + alpha.width / 2) * scale;
      const alphaCenterY = (alpha.y + alpha.height / 2) * scale;
      return {
        x: Math.round(reference.x + reference.width / 2 - alphaCenterX),
        y: Math.round(reference.y + reference.height / 2 - alphaCenterY),
        width,
        height,
        mode: "variant",
      };
    }
  }

  const zone = placementZoneFor(args.role, args.side);
  if (!zone) return null;
  return {
    ...fitArtInZone(artWidth, artHeight, zoneCanvasRect(zone, args.canvasWidth, args.canvasHeight)),
    mode: "zone",
  };
}
