// Inspector — edits the currently selected clip's properties.
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useStudio } from "../store";
import type { CharacterClip, CharacterPreset } from "../types";
import { VoiceLipSyncPanel } from "./VoiceLipSyncPanel";
import { ActionsPanel } from "./ActionsPanel";

export function Inspector() {
  const project = useStudio((s) => s.project);
  const id = useStudio((s) => s.selectedClipId);
  const update = useStudio((s) => s.updateClip);
  const remove = useStudio((s) => s.removeClip);
  const clip = project?.clips.find((c) => c.id === id);
  const characterId = clip?.kind === "character" ? (clip as CharacterClip).characterId : undefined;
  const character = useLiveQuery<CharacterPreset | undefined>(
    () => (characterId ? db.characters.get(characterId) : Promise.resolve(undefined)),
    [characterId],
  );
  const linkedSpeechAudio =
    clip?.kind === "audio" &&
    !!clip.linkedCharacterClipId &&
    !!project?.clips.some((c) => c.id === clip.linkedCharacterClipId);

  if (!project) return null;

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Inspector
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!clip && (
          <div className="text-xs text-muted-foreground">
            Select a clip on the stage or timeline to edit its properties.
          </div>
        )}
        {clip && (
          <div className="space-y-3 text-xs">
            <Field label="Name">
              <input
                value={clip.name}
                onChange={(e) => update(clip.id, { name: e.target.value })}
                className="w-full rounded border border-border bg-input px-2 py-1 text-foreground"
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Start (s)">
                <NumberInput
                  value={clip.start}
                  step={0.1}
                  disabled={linkedSpeechAudio}
                  onChange={(v) => update(clip.id, { start: Math.max(0, v) })}
                />
              </Field>
              <Field label="Duration (s)">
                <NumberInput
                  value={clip.duration}
                  step={0.1}
                  disabled={linkedSpeechAudio}
                  onChange={(v) => update(clip.id, { duration: Math.max(0.1, v) })}
                />
              </Field>
              <Field label="X">
                <NumberInput value={clip.x} onChange={(v) => update(clip.id, { x: v })} />
              </Field>
              <Field label="Y">
                <NumberInput value={clip.y} onChange={(v) => update(clip.id, { y: v })} />
              </Field>
              <Field label="Width">
                <NumberInput value={clip.width} onChange={(v) => update(clip.id, { width: v })} />
              </Field>
              <Field label="Height">
                <NumberInput value={clip.height} onChange={(v) => update(clip.id, { height: v })} />
              </Field>
              <Field label="Rotation°">
                <NumberInput
                  value={clip.rotation}
                  onChange={(v) => update(clip.id, { rotation: v })}
                />
              </Field>
              <Field label="Opacity">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={clip.opacity}
                  onChange={(e) => update(clip.id, { opacity: Number(e.target.value) })}
                  className="w-full"
                />
              </Field>
              <Field label="Z-Index">
                <NumberInput value={clip.zIndex} onChange={(v) => update(clip.id, { zIndex: v })} />
              </Field>
              <Field label="Track">
                <select
                  value={clip.trackIndex}
                  disabled={linkedSpeechAudio}
                  onChange={(e) => update(clip.id, { trackIndex: Number(e.target.value) })}
                  className="w-full rounded border border-border bg-input px-2 py-1 text-foreground"
                >
                  {project.tracks.map((t, i) => (
                    <option key={t.id} value={i}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {linkedSpeechAudio && (
              <p className="rounded border border-border bg-panel-2 px-2 py-1 text-[11px] text-muted-foreground">
                This speech audio is locked to its character. Move the character clip to move the
                voice line.
              </p>
            )}
            <button
              onClick={() => {
                if (!linkedSpeechAudio) remove(clip.id);
              }}
              disabled={linkedSpeechAudio}
              className="w-full rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Delete clip
            </button>
            {clip.kind === "character" && (
              <>
                <div className="rounded border border-border bg-panel-2 p-3">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={(clip as CharacterClip).autoBlink !== false}
                      onChange={(e) =>
                        update((clip as CharacterClip).id, { autoBlink: e.target.checked })
                      }
                    />
                    Auto blink
                  </label>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    Adds a subtle regular blink during playback when the eyes are otherwise open.
                  </p>
                </div>
                {character && <ActionsPanel clip={clip as CharacterClip} character={character} />}
                <VoiceLipSyncPanel clip={clip as CharacterClip} />
              </>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-border p-3 text-xs">
        <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
          Project
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Name">
            <input
              value={project.name}
              onChange={(e) => useStudio.getState().setProjectMeta({ name: e.target.value })}
              className="w-full rounded border border-border bg-input px-2 py-1 text-foreground"
            />
          </Field>
          <Field label="Duration (s)">
            <NumberInput
              value={project.duration}
              onChange={(v) => useStudio.getState().setProjectMeta({ duration: Math.max(1, v) })}
            />
          </Field>
          <Field label="Width">
            <NumberInput
              value={project.width}
              onChange={(v) => useStudio.getState().setProjectMeta({ width: v })}
            />
          </Field>
          <Field label="Height">
            <NumberInput
              value={project.height}
              onChange={(v) => useStudio.getState().setProjectMeta({ height: v })}
            />
          </Field>
          <Field label="FPS">
            <NumberInput
              value={project.fps}
              onChange={(v) => useStudio.getState().setProjectMeta({ fps: v })}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  step = 1,
  disabled = false,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
      step={step}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full rounded border border-border bg-input px-2 py-1 text-foreground disabled:cursor-not-allowed disabled:opacity-60"
    />
  );
}
