import type { CharacterCommand } from "./schema";
import { parseHtmlDocument, parseTransform, serializeHtmlDocument } from "./parse";

export function applyCharacterCommand(html: string, command: CharacterCommand): string {
  return applyCharacterCommands(html, [command]);
}

export function applyCharacterCommands(html: string, commands: CharacterCommand[]): string {
  const doc = parseHtmlDocument(html);
  for (const command of commands) applyCommandToDocument(doc, command);
  return serializeHtmlDocument(doc);
}

function applyCommandToDocument(doc: Document, command: CharacterCommand): void {
  switch (command.type) {
    case "setBoneTransform":
      setBoneTransform(doc, command);
      return;
    case "setSlotBinding":
      setSlotBinding(doc, command);
      return;
    case "setSlotVariant":
      setSlotVariant(doc, command.slotId, command.variantId);
      return;
    case "setActiveAngle":
      setActiveAngle(doc, command.angleId);
      return;
  }
}

function setBoneTransform(
  doc: Document,
  command: Extract<CharacterCommand, { type: "setBoneTransform" }>,
): void {
  const bone = requireBone(doc, command.boneId);
  if (command.x !== undefined) bone.style.left = `${finite(command.x, "x")}px`;
  if (command.y !== undefined) bone.style.top = `${finite(command.y, "y")}px`;
  if (command.depth !== undefined)
    bone.setAttribute("data-character-depth", String(finite(command.depth, "depth")));

  const current = parseTransform(bone.style.transform);
  const rotation = command.rotation ?? current.rotation;
  bone.style.transform = `rotate(${finite(rotation, "rotation")}deg)`;
}

function setSlotBinding(
  doc: Document,
  command: Extract<CharacterCommand, { type: "setSlotBinding" }>,
): void {
  const slot = requireSlot(doc, command.slotId);
  if (command.boneId !== undefined) {
    const bone = requireBone(doc, command.boneId);
    slot.setAttribute("data-character-bound-bone-id", command.boneId);
    bone.appendChild(slot);
  }
  if (command.x !== undefined) slot.style.left = `${finite(command.x, "x")}px`;
  if (command.y !== undefined) slot.style.top = `${finite(command.y, "y")}px`;
  if (command.depth !== undefined)
    slot.setAttribute("data-character-depth", String(finite(command.depth, "depth")));

  const current = parseTransform(slot.style.transform);
  const rotation = command.rotation ?? current.rotation;
  const scaleX = command.scaleX ?? current.scaleX;
  const scaleY = command.scaleY ?? current.scaleY;
  slot.style.transform = `rotate(${finite(rotation, "rotation")}deg) scale(${finite(
    scaleX,
    "scaleX",
  )}, ${finite(scaleY, "scaleY")})`;
}

function setSlotVariant(doc: Document, slotId: string, variantId: string): void {
  const parts = Array.from(
    doc.querySelectorAll<HTMLElement>(
      `[data-character-part="true"][data-character-slot-id="${cssEscape(slotId)}"]`,
    ),
  );
  if (parts.length === 0) throw new Error(`Missing slot parts for "${slotId}".`);
  const target = parts.find((part) => part.getAttribute("data-character-variant") === variantId);
  if (!target) throw new Error(`Slot "${slotId}" has no variant "${variantId}".`);
  for (const part of parts) {
    part.style.opacity = part === target ? "1" : "0";
  }
}

function setActiveAngle(doc: Document, angleId: string): void {
  const root = doc.querySelector<HTMLElement>('[data-character-root="true"]');
  if (!root) throw new Error("Missing character document root.");
  root.setAttribute("data-character-angle", angleId);
}

function requireBone(doc: Document, boneId: string): HTMLElement {
  const bone = doc.querySelector<HTMLElement>(
    `[data-character-bone="true"][data-character-bone-id="${cssEscape(boneId)}"]`,
  );
  if (!bone) throw new Error(`Missing bone "${boneId}".`);
  return bone;
}

function requireSlot(doc: Document, slotId: string): HTMLElement {
  const slot = doc.querySelector<HTMLElement>(
    `[data-character-slot="true"][data-character-slot-id="${cssEscape(slotId)}"]`,
  );
  if (!slot) throw new Error(`Missing slot "${slotId}".`);
  return slot;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
  return value;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}
