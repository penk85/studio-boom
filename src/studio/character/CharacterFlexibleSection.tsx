// Slot-level flexible mesh controls shared by part and group inspectors.

import type { CharacterPart, CharacterPartDeform, CharacterPreset, ID, PartRole } from "../types";
import { defaultLimbPathDeformForPart, roleSupportsBend } from "./character-utils";
import { defaultLimbPathDeformForSlot } from "./deform-fit";
import { limbPathBendSide } from "./scene";

export function FlexibleSection({
  doc,
  slotId,
  role,
  parts,
  onSetDeform,
}: {
  doc: CharacterPreset;
  slotId: ID;
  role: PartRole;
  parts: CharacterPart[];
  onSetDeform: (deform: CharacterPartDeform | undefined, options?: { history?: boolean }) => void;
}) {
  // Face builders sit at authored offsets and never bend; flexibility is for
  // textured limb-like art (arms, legs, tails, hair, accessories).
  const faceRole = !roleSupportsBend(role);
  const texturedParts = parts.filter((part) => !part.morph?.primaryPath);
  if (faceRole || texturedParts.length === 0) return null;
  const deform = texturedParts.find((part) => part.deform)?.deform;
  const neutralDeform = () => defaultLimbPathDeformForPart(texturedParts[0]);
  const fittedDeform = () => defaultLimbPathDeformForSlot(doc, slotId, texturedParts[0]);
  return (
    <section className="rounded border border-border bg-panel-2 p-3">
      <label className="flex cursor-pointer items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-wider text-muted-foreground">
          〰 Flexible
        </span>
        <input
          type="checkbox"
          checked={!!deform}
          onChange={(e) => onSetDeform(e.target.checked ? neutralDeform() : undefined)}
        />
      </label>
      <div className="mt-1 text-ui-sm text-muted-foreground">
        Uses a point path for stretch-ready limb art instead of swinging like a stiff card — made
        for arms, legs, tails, and hair.
      </div>
      {deform?.mode === "limb-path" && (
        <div className="mt-2 grid gap-2 rounded border border-border bg-panel p-2 text-ui-sm text-muted-foreground">
          <div>Path mesh ready. Start and end points are stored on the character, not actions.</div>
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => onSetDeform(neutralDeform())}
              className="rounded border border-border bg-background px-2 py-1 text-foreground hover:bg-panel-2"
              title="Reset the flexible path so the artwork renders exactly like the original sprite"
            >
              Reset to artwork
            </button>
            <button
              type="button"
              onClick={() => onSetDeform(fittedDeform())}
              className="rounded border border-border bg-background px-2 py-1 text-foreground hover:bg-panel-2"
              title="Snap the flexible path to this slot's rig joint and child socket"
            >
              Fit mesh to rig
            </button>
          </div>
          <label className="flex cursor-pointer items-center justify-between gap-2">
            <span title="Keeps the joint folding one way (no backwards elbows) and lets dragging just the end point bend the limb like a puppet">
              Lock bend direction
            </span>
            <input
              type="checkbox"
              checked={deform.side === 1 || deform.side === -1}
              onChange={(e) =>
                onSetDeform(
                  e.target.checked
                    ? { ...deform, side: limbPathBendSide(deform) === -1 ? -1 : 1 }
                    : { ...deform, side: undefined },
                )
              }
            />
          </label>
          {(deform.side === 1 || deform.side === -1) && (
            <button
              type="button"
              onClick={() => onSetDeform({ ...deform, side: deform.side === 1 ? -1 : 1 })}
              className="rounded border border-border bg-background px-2 py-1 text-foreground hover:bg-panel-2"
              title="Bend the joint toward the other side"
            >
              ⇄ Flip bend direction
            </button>
          )}
        </div>
      )}
    </section>
  );
}
