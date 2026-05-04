// Records all GSAP timeline calls made by buildCharacterTimeline and serializes
// them to a JS string suitable for embedding in exported HTML.
import type { CharacterClip, CharacterPreset, MotionPreset } from "../types";
import { buildCharacterTimeline, type GsapLike, type GsapTimelineLike } from "./timeline-builder";

// ─── Call record types ─────────────────────────────────────────────────────────

type SetCall = { method: "set"; targets: string; vars: object; position: number };
type ToCall = { method: "to"; targets: string; vars: object; position: number };
type FromToCall = {
  method: "fromTo";
  targets: string;
  fromVars: object;
  toVars: object;
  position: number;
};

export type TlCall = SetCall | ToCall | FromToCall;

// ─── Recording shim ────────────────────────────────────────────────────────────

function makeRecordingTimeline(calls: TlCall[]): GsapTimelineLike {
  const tl: GsapTimelineLike = {
    to(targets: unknown, vars: object, position: number = 0) {
      calls.push({ method: "to", targets: String(targets), vars, position });
      return tl;
    },
    set(targets: unknown, vars: object, position: number = 0) {
      calls.push({ method: "set", targets: String(targets), vars, position });
      return tl;
    },
    fromTo(targets: unknown, fromVars: object, toVars: object, position: number = 0) {
      calls.push({ method: "fromTo", targets: String(targets), fromVars, toVars, position });
      return tl;
    },
    seek() {
      return tl;
    },
    kill() {
      return tl;
    },
    duration() {
      return 0;
    },
  };
  return tl;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/** Run buildCharacterTimeline against a recording shim and return the captured calls. */
export function recordCharacterTimeline(
  clip: CharacterClip,
  character: CharacterPreset,
  presets: Map<string, MotionPreset>,
): TlCall[] {
  const calls: TlCall[] = [];
  const shim: GsapLike = { timeline: () => makeRecordingTimeline(calls) };
  buildCharacterTimeline(clip, character, presets, shim);
  return calls;
}

// ─── JS serialization ──────────────────────────────────────────────────────────

function stringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (v === undefined ? null : v));
}

function serializeCall(call: TlCall): string {
  if (call.method === "fromTo") {
    return `tl.fromTo(${stringify(call.targets)},${stringify(call.fromVars)},${stringify(call.toVars)},${call.position});`;
  }
  return `tl.${call.method}(${stringify(call.targets)},${stringify(call.vars)},${call.position});`;
}

/**
 * Returns a self-contained JS IIFE that rebuilds the character timeline and
 * registers it under `window.__timelines[clipId]`. Safe to embed in a <script> tag.
 */
export function serializeTimelineJs(calls: TlCall[], clipId: string): string {
  const lines = calls.map(serializeCall).join("\n  ");
  return `(function(){
  var tl=gsap.timeline({paused:true});
  ${lines}
  (window.__timelines||(window.__timelines={}))[${stringify(clipId)}]=tl;
})();`;
}
