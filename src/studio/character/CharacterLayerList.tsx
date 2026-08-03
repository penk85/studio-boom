// Character layer rail: slot hierarchy, variant expansion, and per-layer controls.
import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
  Plus,
  Trash2,
  Unlock,
} from "lucide-react";
import { useMediaUrl } from "../hooks/useMediaUrl";
import type {
  CharacterPart,
  CharacterRig,
  CharacterSlot,
  CharacterSlotRelation,
  ID,
  PartRole,
} from "../types";
import { listCharacterSlots, roleLabel, variantLabelForPart } from "./character-utils";
import { orderCharacterVariants } from "./character-variant-order";
import type { VariantKeyIssue } from "./variant-pairing";

export interface CharacterLayerVariantTarget {
  slotId: ID;
  role: PartRole;
  side?: CharacterPart["side"];
  name: string;
}

interface CharacterLayerListProps {
  parts: CharacterPart[];
  slots: CharacterSlot[];
  rig: CharacterRig;
  selectedId: ID | null;
  selectedSlotId: ID | null;
  keyIssues: Map<ID, VariantKeyIssue[]>;
  onSelect: (id: ID) => void;
  onSelectSlot: (slotId: ID) => void;
  onChange: (id: ID, patch: Partial<CharacterPart>) => void;
  onRemove: (id: ID) => void;
  onToggleSlotVisible: (slotId: ID) => void;
  onToggleSlotLocked: (slotId: ID) => void;
  onNudgeSlotZ: (slotId: ID, delta: number) => void;
  onRemoveSlot: (slotId: ID) => void;
  /** Upload another variant image into this slot (auto-placed on its art). */
  onAddVariant: (group: CharacterLayerVariantTarget) => void;
}

/** Slot-aware layer rail used by the character editor. */
export function CharacterLayerList({
  parts,
  slots,
  rig,
  selectedId,
  selectedSlotId,
  keyIssues,
  onSelect,
  onSelectSlot,
  onChange,
  onRemove,
  onToggleSlotVisible,
  onToggleSlotLocked,
  onNudgeSlotZ,
  onRemoveSlot,
  onAddVariant,
}: CharacterLayerListProps) {
  const [expanded, setExpanded] = useState<Set<ID>>(new Set());

  const groupList = listCharacterSlots({ parts, slots }, { includeEmpty: false })
    .map((slot) => ({
      slotId: slot.id,
      slotParts: slot.parts,
      topZ: Math.max(...slot.parts.map((part) => part.zIndex)),
      name: slot.name,
      role: slot.role,
      side: slot.side ?? slot.parts.find((part) => part.side)?.side,
    }))
    .sort((a, b) => b.topZ - a.topZ);
  type LayerGroup = (typeof groupList)[number];
  const hostedSlotIds = new Set<ID>();
  const groupBySlotId = new Map(groupList.map((group) => [group.slotId, group]));
  const hostedSlotsByHostSlotId = new Map<ID, LayerGroup[]>();
  for (const group of groupList) {
    const relation = rig.slotRelations.find((entry) => entry.childSlotId === group.slotId);
    const hostSlotId = relation ? parentSlotIdForEditorRelation(relation, groupList) : undefined;
    if (!hostSlotId || hostSlotId === group.slotId || !groupBySlotId.has(hostSlotId)) continue;
    hostedSlotIds.add(group.slotId);
    hostedSlotsByHostSlotId.set(hostSlotId, [
      ...(hostedSlotsByHostSlotId.get(hostSlotId) ?? []),
      group,
    ]);
  }
  const topLevelGroups = groupList.filter((group) => !hostedSlotIds.has(group.slotId));
  const roots = topLevelGroups.length > 0 ? topLevelGroups : groupList;

  const toggleExpanded = (slotId: ID) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(slotId)) next.delete(slotId);
      else next.add(slotId);
      return next;
    });

  const renderLayerGroup = (group: LayerGroup, depth = 0, ancestors = new Set<ID>()) => {
    if (ancestors.has(group.slotId)) return null;
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(group.slotId);
    const childGroups = hostedSlotsByHostSlotId.get(group.slotId) ?? [];
    const children =
      childGroups.length > 0
        ? childGroups.map((child) => renderLayerGroup(child, depth + 1, nextAncestors))
        : null;

    if (group.slotParts.length === 1) {
      const part = group.slotParts[0];
      return (
        <div key={group.slotId} className="space-y-1">
          <LayerPartRow
            part={part}
            selected={part.id === selectedId}
            indentLevel={depth}
            onSelect={() => onSelect(part.id)}
            onChange={(patch) => onChange(part.id, patch)}
            onRemove={() => onRemove(part.id)}
            onAddVariant={() => onAddVariant(group)}
          />
          {children}
        </div>
      );
    }

    const isOpen = expanded.has(group.slotId);
    const anyVisible = group.slotParts.some((part) => part.visible);
    const anyLocked = group.slotParts.some((part) => part.locked);
    return (
      <div key={group.slotId} className="space-y-1">
        <div
          onClick={() => onSelectSlot(group.slotId)}
          className={`flex cursor-pointer items-center gap-1 rounded border px-2 py-1.5 ${
            group.slotId === selectedSlotId
              ? "border-primary bg-primary/15"
              : "border-border bg-panel-2 hover:bg-panel"
          }`}
          style={depth > 0 ? { marginLeft: depth * 12 } : undefined}
        >
          <button
            onClick={(event) => {
              event.stopPropagation();
              toggleExpanded(group.slotId);
            }}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            title={isOpen ? "Collapse variants" : "Expand variants"}
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <span className="min-w-0 flex-1 truncate font-medium">
            {group.name}
            <span className="ml-1 text-ui-sm font-normal text-muted-foreground">
              {group.slotParts.length} variants
            </span>
          </span>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onAddVariant(group);
            }}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            title="Add a variant image to this part — it lands aligned with the current art"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onToggleSlotVisible(group.slotId);
            }}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            title={anyVisible ? "Hide all" : "Show all"}
          >
            {anyVisible ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onToggleSlotLocked(group.slotId);
            }}
            className={`rounded p-1 hover:text-foreground ${
              anyLocked ? "text-primary" : "text-muted-foreground"
            }`}
            title={anyLocked ? "Unlock all" : "Lock all"}
          >
            {anyLocked ? <Lock size={14} /> : <Unlock size={14} />}
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onNudgeSlotZ(group.slotId, 1);
            }}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            title="Bring all forward"
          >
            <ArrowUp size={14} />
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onNudgeSlotZ(group.slotId, -1);
            }}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            title="Send all backward"
          >
            <ArrowDown size={14} />
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onRemoveSlot(group.slotId);
            }}
            className="rounded p-1 text-destructive"
            title="Delete group"
          >
            <Trash2 size={14} />
          </button>
        </div>
        {isOpen && (
          <div className="space-y-1">
            {orderCharacterVariants(group.slotParts).map((part) => (
              <LayerPartRow
                key={part.id}
                part={part}
                selected={part.id === selectedId}
                indentLevel={depth + 1}
                label={variantLabelForPart(part)}
                warning={
                  keyIssues.get(part.id)?.some((issue) => issue.severity === "warning") ?? false
                }
                onSelect={() => onSelect(part.id)}
                onChange={(patch) => onChange(part.id, patch)}
                onRemove={() => onRemove(part.id)}
              />
            ))}
          </div>
        )}
        {children}
      </div>
    );
  };

  return <div className="space-y-1">{roots.map((group) => renderLayerGroup(group))}</div>;
}

function LayerPartRow({
  part,
  selected,
  indentLevel = 0,
  label,
  warning = false,
  onSelect,
  onChange,
  onRemove,
  onAddVariant,
}: {
  part: CharacterPart;
  selected: boolean;
  indentLevel?: number;
  label?: string;
  warning?: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<CharacterPart>) => void;
  onRemove: () => void;
  /** Upload another variant image into this part's slot. */
  onAddVariant?: () => void;
}) {
  const thumbnailUrl = useMediaUrl(part.mediaId);
  return (
    <div
      onClick={onSelect}
      className={`flex cursor-pointer items-center gap-1 rounded border px-2 py-1.5 ${
        selected ? "border-primary bg-primary/15" : "border-border bg-panel-2 hover:bg-panel"
      }`}
      style={indentLevel > 0 ? { marginLeft: indentLevel * 12 } : undefined}
    >
      {warning && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
          title="Variant key problem — select to see details"
        />
      )}
      <span className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-white/80">
        {thumbnailUrl && (
          <img src={thumbnailUrl} alt="" className="max-h-full max-w-full object-contain" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {label ?? part.slotName ?? part.name}
        {!label && (
          <span className="ml-1 text-ui-sm text-muted-foreground">{roleLabel(part.role)}</span>
        )}
      </span>
      {onAddVariant && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onAddVariant();
          }}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
          title="Add a variant image to this part — it lands aligned with the current art"
        >
          <Plus size={14} />
        </button>
      )}
      <button
        onClick={(event) => {
          event.stopPropagation();
          onChange({ visible: !part.visible });
        }}
        className="rounded p-1 text-muted-foreground hover:text-foreground"
        title={part.visible ? "Hide" : "Show"}
      >
        {part.visible ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>
      <button
        onClick={(event) => {
          event.stopPropagation();
          onChange({ locked: !part.locked });
        }}
        className={`rounded p-1 hover:text-foreground ${
          part.locked ? "text-primary" : "text-muted-foreground"
        }`}
        title={part.locked ? "Unlock" : "Lock"}
      >
        {part.locked ? <Lock size={14} /> : <Unlock size={14} />}
      </button>
      <button
        onClick={(event) => {
          event.stopPropagation();
          onChange({ zIndex: part.zIndex + 1 });
        }}
        className="rounded p-1 text-muted-foreground hover:text-foreground"
        title="Bring forward"
      >
        <ArrowUp size={14} />
      </button>
      <button
        onClick={(event) => {
          event.stopPropagation();
          onChange({ zIndex: part.zIndex - 1 });
        }}
        className="rounded p-1 text-muted-foreground hover:text-foreground"
        title="Send backward"
      >
        <ArrowDown size={14} />
      </button>
      <button
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        className="rounded p-1 text-destructive"
        title="Delete"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function parentSlotIdForEditorRelation(
  relation: CharacterSlotRelation,
  groups: Array<CharacterLayerVariantTarget & { slotParts: CharacterPart[] }>,
): ID | undefined {
  const parentRef = relation.parentRef;
  if (parentRef.type === "slot" || parentRef.type === "semanticSlot") {
    return parentRef.id;
  }
  if (parentRef.type === "role") {
    return groups.find(
      (group) =>
        group.role === parentRef.role &&
        (!parentRef.side ||
          group.side === parentRef.side ||
          group.slotParts.some((part) => part.side === parentRef.side)),
    )?.slotId;
  }
  return undefined;
}
