import { generateHyperframesHtml } from "@hyperframes/core";
import type { CharacterClipMeta, CharacterPreset, MotionPreset } from "../types";
import { validateCompositionSourceHtml } from "../hyperframes/composition-source";
import { normalizeNativeHyperframesHtml } from "../hyperframes/native";
import {
  MAX_BEND_DEGREES,
  bendPlanePositions,
  limbRibbonIndices,
  limbRibbonPositions,
  limbRibbonUVs,
} from "./mesh-deform";
import type { CharacterSceneGraph } from "./scene";
import type { CharacterTimelineScene } from "./timeline-scene";

const PIXI_RUNTIME_CDN = "https://pixijs.download/release/pixi.min.js";

export interface BuildPixiCharacterCompositionArgs {
  compositionId: string;
  clipId: string;
  width: number;
  height: number;
  duration: number;
  character: CharacterPreset;
  meta: CharacterClipMeta;
  motionPresets: Map<string, MotionPreset>;
  scene: CharacterSceneGraph;
  timelineScene: CharacterTimelineScene;
  audioSpeeches?: PixiCharacterAudioSpeech[];
}

export interface PixiCharacterAudioSpeech {
  audioId: string;
  start: number;
  duration: number;
  volume?: number;
  mediaStart?: number;
}

export function buildPixiCharacterCompositionHtml(args: BuildPixiCharacterCompositionArgs): string {
  const width = positiveNumber(args.width, 1);
  const height = positiveNumber(args.height, 1);
  const duration = positiveNumber(args.duration, 0.1);
  const resolution = width >= height ? "landscape" : "portrait";
  const baseHtml = generateHyperframesHtml([], duration, {
    compositionId: args.compositionId,
    resolution,
    includeStyles: true,
    includeScripts: true,
  });

  const doc = parseCompositionBase(baseHtml, args.compositionId, duration, width, height);
  const stage = ensureStage(doc, args.compositionId, duration, width, height);
  stage.innerHTML = "";
  stage.insertAdjacentHTML(
    "beforeend",
    `<div id="${esc(pixiRootId(args.compositionId))}" data-character-root="true" data-character-renderer="pixi" data-character-id="${esc(
      args.character.id,
    )}" data-character-angle="${esc(args.scene.angle)}"></div>`,
  );
  args.audioSpeeches?.forEach((speech, index) => {
    stage.insertAdjacentHTML(
      "beforeend",
      buildSpeechAudio(
        `${args.compositionId}-speech-${index}`,
        speech.audioId,
        speech.start,
        speech.duration,
        index,
        speech.volume,
        speech.mediaStart,
      ),
    );
  });
  appendPixiStyles(doc);
  appendPixiRuntimeScript(doc);
  appendPixiCharacterScript(doc, {
    compositionId: args.compositionId,
    duration,
    rootId: pixiRootId(args.compositionId),
    scene: args.scene,
    timelineScene: args.timelineScene,
  });

  const normalized = normalizeNativeHyperframesHtml(
    "<!DOCTYPE html>\n" + doc.documentElement.outerHTML,
    {
      width,
      height,
    },
  );
  const validation = validateCompositionSourceHtml(normalized, {
    compositionId: args.compositionId,
    duration,
    width,
    height,
  });
  if (!validation.ok || !validation.html) {
    throw new Error(
      `Generated Pixi character composition is invalid:\n${validation.errors
        .map((error) => `- ${error}`)
        .join("\n")}`,
    );
  }
  return validation.html;
}

function parseCompositionBase(
  html: string,
  compositionId: string,
  duration: number,
  width: number,
  height: number,
): Document {
  if (typeof DOMParser === "undefined") {
    throw new Error("DOMParser is required to build character compositions.");
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.documentElement;
  root.setAttribute("data-composition-id", compositionId);
  root.setAttribute("data-composition-duration", String(duration));
  root.setAttribute("data-composition-width", String(width));
  root.setAttribute("data-composition-height", String(height));
  root.setAttribute("data-width", String(width));
  root.setAttribute("data-height", String(height));
  root.setAttribute("data-resolution", width >= height ? "landscape" : "portrait");
  if (doc.body) {
    doc.body.style.margin = "0";
    doc.body.style.overflow = "hidden";
    doc.body.style.background = "transparent";
  }
  return doc;
}

function ensureStage(
  doc: Document,
  compositionId: string,
  duration: number,
  width: number,
  height: number,
): HTMLElement {
  let stage = doc.getElementById("stage") as HTMLElement | null;
  if (!stage) {
    stage = doc.createElement("div");
    stage.id = "stage";
    doc.body?.appendChild(stage);
  }
  stage.setAttribute("data-composition-id", compositionId);
  stage.setAttribute("data-start", "0");
  stage.setAttribute("data-duration", String(duration));
  stage.setAttribute("data-width", String(width));
  stage.setAttribute("data-height", String(height));
  stage.removeAttribute("data-track-index");
  stage.style.position = "relative";
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  stage.style.overflow = "hidden";
  stage.style.background = "transparent";
  return stage;
}

function appendPixiStyles(doc: Document): void {
  const style = doc.createElement("style");
  style.textContent = `
[data-character-renderer="pixi"] {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}
[data-character-renderer="pixi"] canvas {
  display: block;
}`;
  doc.head?.appendChild(style);
}

function appendPixiRuntimeScript(doc: Document): void {
  const script = doc.createElement("script");
  script.src = PIXI_RUNTIME_CDN;
  doc.head?.appendChild(script);
}

function appendPixiCharacterScript(
  doc: Document,
  args: {
    compositionId: string;
    duration: number;
    rootId: string;
    scene: CharacterSceneGraph;
    timelineScene: CharacterTimelineScene;
  },
): void {
  const script = doc.createElement("script");
  const payload = safeJson({
    compositionId: args.compositionId,
    duration: args.duration,
    rootId: args.rootId,
    scene: args.scene,
    timelineScene: args.timelineScene,
  });
  const hasRopeMesh = Object.values(args.scene.nodes).some(
    (node) => node.kind === "mesh" && node.meshKind === "rope",
  );
  const hasPlaneMesh = Object.values(args.scene.nodes).some(
    (node) => node.kind === "mesh" && node.meshKind === "plane",
  );
  // Mesh support is emitted only when the scene actually contains flexible
  // (deform) parts, so default characters stay mesh-free end to end. The
  // plane-bend runtime is legacy-only; new limb-path parts render as MeshRope.
  const meshRuntime = hasPlaneMesh
    ? `
  // Shared bend math, embedded from mesh-deform.ts (locked by mesh-deform.test.ts).
  const bendPlanePositions = ${bendPlanePositions.toString()};
  const clampBend = function(value) {
    const bend = Number(value) || 0;
    return bend > ${MAX_BEND_DEGREES} ? ${MAX_BEND_DEGREES} : bend < ${-MAX_BEND_DEGREES} ? ${-MAX_BEND_DEGREES} : bend;
  };
  const applyMeshBends = function(ctx) {
    (ctx.meshEntries || []).forEach(function(entry) {
      const geometry = entry.mesh.geometry;
      const buffer = geometry.getBuffer("aPosition");
      bendPlanePositions({
        width: geometry.width,
        height: geometry.height,
        verticesX: geometry.verticesX,
        verticesY: geometry.verticesY,
        axis: entry.node.stretchAxis,
        anchor: entry.node.bendAnchor,
        originX: (entry.node.bendOriginX == null ? 0.5 : entry.node.bendOriginX) * geometry.width,
        originY: (entry.node.bendOriginY == null ? 0.5 : entry.node.bendOriginY) * geometry.height,
        bend: clampBend((entry.node.bend || 0) + entry.bendDelta),
        out: buffer.data
      });
      buffer.update();
    });
  };`
    : "";
  const ropeRuntime = hasRopeMesh
    ? `
  // Ribbon geometry math, embedded from mesh-deform.ts (locked by mesh-deform.test.ts).
  const limbRibbonPositions = ${limbRibbonPositions.toString()};
  const limbRibbonUVs = ${limbRibbonUVs.toString()};
  const limbRibbonIndices = ${limbRibbonIndices.toString()};
  const clonePathPoints = function(points) {
    const source = points && points.length >= 2 ? points : [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    return source.map(function(point) { return { x: point.x, y: point.y }; });
  };
  const applyRopePathOffsets = function(ctx) {
    (ctx.ropeEntries || []).forEach(function(entry) {
      const count = entry.basePathPoints.length;
      if (count === 0) return;
      const denom = Math.max(1, count - 1);
      for (let i = 0; i < count; i += 1) {
        const t = i / denom;
        const curveWeight = 4 * t * (1 - t);
        const base = entry.basePathPoints[i];
        entry.scratchPath[i].x = base.x + entry.pathEndX * t + entry.pathCurveX * curveWeight;
        entry.scratchPath[i].y = base.y + entry.pathEndY * t + entry.pathCurveY * curveWeight;
      }
      limbRibbonPositions(entry.scratchPath, entry.width, entry.crossVertices, entry.positions);
      entry.mesh.vertices = entry.positions;
    });
  };`
    : "";
  script.textContent = `(function(){
  const S = ${payload};
  const toRadians = function(degrees) { return (Number(degrees) || 0) * Math.PI / 180; };${meshRuntime}${ropeRuntime}
  const applyContainerFrame = function(displayObject, frame) {
    displayObject.position.set(frame.x + frame.originX, frame.y + frame.originY);
    displayObject.pivot.set(frame.originX, frame.originY);
    displayObject.rotation = toRadians(frame.rotation);
    displayObject.scale.set(frame.scaleX || 1, frame.scaleY || 1);
  };
  const applyTexturedFrame = function(displayObject, frame, sourceWidth, sourceHeight) {
    const sx = frame.width / Math.max(1, sourceWidth || frame.width || 1);
    const sy = frame.height / Math.max(1, sourceHeight || frame.height || 1);
    displayObject.position.set(frame.x + frame.originX, frame.y + frame.originY);
    displayObject.pivot.set(sx ? frame.originX / sx : frame.originX, sy ? frame.originY / sy : frame.originY);
    displayObject.rotation = toRadians(frame.rotation);
    displayObject.scale.set(sx * (frame.scaleX || 1), sy * (frame.scaleY || 1));
  };
  const texturedFrameSize = function(node, texture) {
    if (node.kind === "mesh" && node.meshKind === "rope") {
      return {
        width: node.sourceWidth || (texture && texture.width) || node.frame.width,
        height: node.sourceHeight || (texture && texture.height) || node.frame.height
      };
    }
    return {
      width: (texture && texture.width) || node.frame.width,
      height: (texture && texture.height) || node.frame.height
    };
  };
  const svgAttr = function(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  };
  const svgForVectorNode = function(node) {
    const stroke = node.stroke
      ? ' stroke="' + svgAttr(node.stroke) + '" stroke-width="' + svgAttr(node.strokeWidth || 1) + '" stroke-linecap="' + svgAttr(node.strokeLinecap || "round") + '" stroke-linejoin="' + svgAttr(node.strokeLinejoin || "round") + '"'
      : "";
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + svgAttr(node.viewBox || ("0 0 " + node.frame.width + " " + node.frame.height)) + '" width="' + svgAttr(Math.max(0.0001, node.frame.width || 0)) + '" height="' + svgAttr(Math.max(0.0001, node.frame.height || 0)) + '"><path d="' + svgAttr(node.path || "") + '" fill="' + svgAttr(node.fill || "#733f43") + '"' + stroke + '/></svg>';
  };
  const createTexturedLeaf = function(PIXI, node, texture) {${
    hasRopeMesh
      ? `
    if (node.kind === "mesh" && node.meshKind === "rope" && PIXI.MeshSimple) {
      try {
        const basePathPoints = clonePathPoints(node.pathPoints);
        const rows = basePathPoints.length;
        const crossVertices = Math.max(2, node.crossVertices || 2);
        const width = node.ropeWidth || Math.min(texture.width || 1, texture.height || 1);
        const uvRect = node.uvRect || { u0: 0, v0: 0, u1: 1, v1: 1 };
        const positions = limbRibbonPositions(basePathPoints, width, crossVertices);
        // A textured ribbon (MeshSimple) preserves the full limb art along the
        // spine; MeshRope pancakes it (texture height crushed into the width).
        const mesh = new PIXI.MeshSimple({
          texture: texture,
          vertices: positions,
          uvs: limbRibbonUVs(rows, crossVertices, uvRect, node.ribbonVertical !== false),
          indices: limbRibbonIndices(rows, crossVertices)
        });
        mesh.__ribbon = {
          basePathPoints: basePathPoints,
          width: width,
          crossVertices: crossVertices,
          positions: positions,
          scratchPath: basePathPoints.map(function(point) { return { x: point.x, y: point.y }; })
        };
        return mesh;
      } catch (error) {
        if (typeof console !== "undefined" && console.warn) {
          console.warn("Falling back to Sprite for flexible limb mesh character part " + (node.partId || node.id), error);
        }
      }
    }`
      : ""
  }${
    hasPlaneMesh
      ? `
    if (node.kind === "mesh" && node.meshKind === "plane" && PIXI.MeshPlane) {
      try {
        return new PIXI.MeshPlane({ texture: texture, verticesX: node.verticesX || 2, verticesY: node.verticesY || 2 });
      } catch (error) {
        if (typeof console !== "undefined" && console.warn) {
          console.warn("Falling back to Sprite for mesh character part " + (node.partId || node.id), error);
        }
      }
    }
    // Legacy MeshPlane deforms degrade to a rigid sprite instead of failing export capture.`
      : ""
  }
    return new PIXI.Sprite({ texture: texture });
  };
  const applyVectorFrame = function(container, frame) {
    container.position.set(frame.x + frame.originX, frame.y + frame.originY);
    container.pivot.set(frame.originX, frame.originY);
    container.rotation = toRadians(frame.rotation);
    container.scale.set(frame.scaleX || 1, frame.scaleY || 1);
  };
  const applyBaseScene = function(ctx) {${
    hasPlaneMesh
      ? `
    (ctx.meshEntries || []).forEach(function(entry) { entry.bendDelta = 0; });`
      : ""
  }${
    hasRopeMesh
      ? `
    (ctx.ropeEntries || []).forEach(function(entry) {
      entry.pathEndX = 0;
      entry.pathEndY = 0;
      entry.pathCurveX = 0;
      entry.pathCurveY = 0;
    });`
      : ""
  }
    Object.keys(S.scene.nodes).forEach(function(nodeId) {
      const node = S.scene.nodes[nodeId];
      const displayObject = ctx.nodes[nodeId];
      if (!node || !displayObject) return;
      displayObject.visible = node.visible !== false;
      displayObject.alpha = node.opacity == null ? 1 : node.opacity;
      displayObject.zIndex = node.zIndex || 0;
      if (node.kind === "sprite" || node.kind === "mesh") {
        const size = texturedFrameSize(node, ctx.textures[node.assetId]);
        applyTexturedFrame(displayObject, node.frame, size.width, size.height);
      } else if (node.kind === "vector") {
        applyVectorFrame(displayObject, node.frame);
      } else {
        applyContainerFrame(displayObject, node.frame);
      }
    });
  };
  const latestEventsAt = function(time) {
    return (S.timelineScene.slotEvents || []).filter(function(event) {
      return (event.time || 0) <= time + 0.0001;
    });
  };
  const applySlotEvent = function(ctx, event) {
    if (event.variant) {
      (event.variant.hideSceneNodeIds || []).forEach(function(nodeId) {
        const displayObject = ctx.nodes[nodeId];
        if (displayObject) displayObject.alpha = 0;
      });
      (event.variant.showSceneNodeIds || []).forEach(function(nodeId) {
        const displayObject = ctx.nodes[nodeId];
        if (displayObject) {
          displayObject.visible = true;
          displayObject.alpha = 1;
        }
      });
    }
    (event.boneAnchors || []).forEach(function(anchor) {
      const displayObject = anchor.sceneNodeId ? ctx.nodes[anchor.sceneNodeId] : null;
      if (!displayObject) return;
      displayObject.position.set(anchor.left, anchor.top);
      displayObject.pivot.set(0, 0);
      displayObject.rotation = toRadians(anchor.rotation);
    });
  };
  const cloneVars = function(vars) {
    return Object.assign({}, vars || {});
  };
  const lerpVars = function(from, to, progress) {
    const out = {};
    Object.keys(Object.assign({}, from || {}, to || {})).forEach(function(key) {
      const a = from ? from[key] : undefined;
      const b = to ? to[key] : undefined;
      if (typeof a === "number" && typeof b === "number") {
        out[key] = a + (b - a) * progress;
      } else if (b !== undefined) {
        out[key] = progress >= 1 ? b : a !== undefined ? a : b;
      } else if (a !== undefined) {
        out[key] = a;
      }
    });
    return out;
  };
  const targetVarsAt = function(time) {
    const varsByNodeId = {};
    (S.timelineScene.initialTargets || []).forEach(function(target) {
      if (!target.sceneNodeId) return;
      varsByNodeId[target.sceneNodeId] = cloneVars(target.vars);
    });
    (S.timelineScene.motionSegments || []).forEach(function(segment) {
      const start = Number(segment.start) || 0;
      const duration = Math.max(0.0001, Number(segment.duration) || 0);
      const end = start + duration;
      if (time < start - 0.0001) return;
      (segment.targets || []).forEach(function(target) {
        if (!target.sceneNodeId) return;
        const current = varsByNodeId[target.sceneNodeId] || {};
        if (time >= end - 0.0001) {
          varsByNodeId[target.sceneNodeId] = cloneVars(target.vars);
        } else {
          varsByNodeId[target.sceneNodeId] = lerpVars(current, target.vars, (time - start) / duration);
        }
      });
    });
    return varsByNodeId;
  };
  const applyTargetVars = function(ctx, varsByNodeId) {
    Object.keys(varsByNodeId).forEach(function(nodeId) {
      const displayObject = ctx.nodes[nodeId];
      const vars = varsByNodeId[nodeId];
      if (!displayObject || !vars) return;
      if (typeof vars.x === "number") displayObject.x += vars.x;
      if (typeof vars.y === "number") displayObject.y += vars.y;
      const scale = typeof vars.scale === "number" ? vars.scale : 1;
      if (typeof vars.scaleX === "number") displayObject.scale.x *= scale * vars.scaleX;
      else displayObject.scale.x *= scale;
      if (typeof vars.scaleY === "number") displayObject.scale.y *= scale * vars.scaleY;
      else displayObject.scale.y *= scale;
      if (typeof vars.skewX === "number") displayObject.skew.x = toRadians(vars.skewX);
      if (typeof vars.skewY === "number") displayObject.skew.y = toRadians(vars.skewY);
      // Pixi has no CSS perspective, so 3D turn vars flatten to an orthographic
      // cos() squash; without this, head/face turn motions would not move at all.
      if (typeof vars.rotationY === "number") displayObject.scale.x *= Math.cos(toRadians(vars.rotationY));
      if (typeof vars.rotationX === "number") displayObject.scale.y *= Math.cos(toRadians(vars.rotationX));
      if (typeof vars.rotation === "number") displayObject.rotation = toRadians(vars.rotation);
      if (typeof vars.opacity === "number") displayObject.alpha = vars.opacity;${
        hasPlaneMesh
          ? `
      if (typeof vars.bend === "number") {
        ((ctx.meshEntriesByNodeId || {})[nodeId] || []).forEach(function(entry) {
          entry.bendDelta += vars.bend;
        });
      }`
          : ""
      }${
        hasRopeMesh
          ? `
      ((ctx.ropeEntriesByNodeId || {})[nodeId] || []).forEach(function(entry) {
        entry.pathEndX += vars.pathEndX || 0;
        entry.pathEndY += vars.pathEndY || 0;
        entry.pathCurveX += vars.pathCurveX || 0;
        entry.pathCurveY += vars.pathCurveY || 0;
      });`
          : ""
      }
    });
  };
  const renderAt = function(ctx, time) {
    const t = Math.max(0, Math.min(S.timelineScene.duration || S.duration, Number(time) || 0));
    applyBaseScene(ctx);
    latestEventsAt(t).forEach(function(event) { applySlotEvent(ctx, event); });
    applyTargetVars(ctx, targetVarsAt(t));${
      hasRopeMesh
        ? `
    applyRopePathOffsets(ctx);`
        : ""
    }${
      hasPlaneMesh
        ? `
    applyMeshBends(ctx);`
        : ""
    }
    ctx.app.render();
  };
  const state = { ctx: null, pendingTime: 0, readyResolve: null, readyReject: null };
  const readyPromise = new Promise(function(resolve, reject) {
    state.readyResolve = resolve;
    state.readyReject = reject;
  });
  window.__studioBoomPixiReady = window.__studioBoomPixiReady || {};
  window.__studioBoomPixiReady[S.compositionId] = readyPromise;
  const installHyperframesReadinessGate = function() {
    const w = window;
    if (w.__studioBoomPixiHfGateInstalled) return;
    w.__studioBoomPixiHfGateInstalled = true;
    let hfValue = w.__hf;
    const pixiReadyPromises = function() {
      return Object.values(w.__studioBoomPixiReady || {}).filter(function(promise) {
        return promise && typeof promise.then === "function";
      });
    };
    const installOnHf = function(hf) {
      if (!hf || hf.__studioBoomPixiReadyGate) return hf;
      let released = false;
      let durationValue = Number(hf.duration) || 0;
      const originalSeek = typeof hf.seek === "function" ? hf.seek.bind(hf) : null;
      Object.defineProperty(hf, "duration", {
        configurable: true,
        get: function() { return released ? durationValue : 0; },
        set: function(value) { durationValue = Number(value) || 0; }
      });
      if (originalSeek) {
        hf.seek = function(time) {
          if (!released) return;
          return originalSeek(time);
        };
      }
      hf.__studioBoomPixiReadyGate = true;
      Promise.all(pixiReadyPromises()).then(function() {
        released = true;
      }).catch(function(error) {
        console.error(error);
      });
      return hf;
    };
    Object.defineProperty(w, "__hf", {
      configurable: true,
      get: function() { return hfValue; },
      set: function(value) { hfValue = installOnHf(value); }
    });
    if (hfValue) hfValue = installOnHf(hfValue);
  };
  installHyperframesReadinessGate();
  const renderIfReady = function(time) {
    state.pendingTime = Math.max(0, Math.min(S.timelineScene.duration || S.duration, Number(time) || 0));
    if (!state.ctx) return;
    renderAt(state.ctx, state.pendingTime);
  };
  const tl = gsap.timeline({ paused: true });
  tl.to({}, { duration: S.timelineScene.duration || S.duration }, 0);
  const originalSeek = tl.seek;
  tl.seek = function(time, suppressEvents) {
    const result = originalSeek.call(this, time, suppressEvents);
    renderIfReady(Number(time) || 0);
    return result;
  };
  tl.eventCallback("onStart", function() { renderIfReady(tl.time()); });
  tl.eventCallback("onUpdate", function() { renderIfReady(tl.time()); });
  tl.eventCallback("onReverseComplete", function() { renderIfReady(0); });
  window.__timelines = window.__timelines || {};
  window.__timelines[${JSON.stringify(args.compositionId)}] = tl;
  const start = async function() {
    if (!window.PIXI) throw new Error("PixiJS runtime is required for character composition " + S.compositionId);
    const PIXI = window.PIXI;
    const root = document.getElementById(S.rootId);
    if (!root) throw new Error("Missing Pixi character root " + S.rootId);
    const app = new PIXI.Application();
    await app.init({
      width: S.scene.output.width,
      height: S.scene.output.height,
      backgroundAlpha: 0,
      antialias: true,
      autoStart: false
    });
    app.ticker.stop();
    root.textContent = "";
    root.appendChild(app.canvas || app.view);
    app.stage.sortableChildren = true;
    app.stage.label = "character-scene-root";
    if (PIXI.Assets && PIXI.Assets.setPreferences) {
      PIXI.Assets.setPreferences({ preferCreateImageBitmap: false });
    }
    const textures = {};
    await Promise.all((S.scene.assets || []).map(async function(asset) {
      try {
        textures[asset.id] = await PIXI.Assets.load({
          src: asset.ref,
          parser: asset.parser || "texture"
        });
      } catch (error) {
        throw new Error(
          "Failed to load character texture " + asset.id +
          " for parts " + (asset.partIds || []).join(", ") +
          ": " + (error && error.message ? error.message : String(error))
        );
      }
    }));
    const nodes = {};${
      hasPlaneMesh
        ? `
    const meshEntries = [];
    const meshEntriesByNodeId = {};`
        : ""
    }${
      hasRopeMesh
        ? `
    const ropeEntries = [];
    const ropeEntriesByNodeId = {};`
        : ""
    }
    Object.keys(S.scene.nodes).forEach(function(nodeId) {
      const node = S.scene.nodes[nodeId];
      if (node.kind === "sprite" || node.kind === "mesh") {
        nodes[nodeId] = new PIXI.Container({ sortableChildren: true });
        const leaf = createTexturedLeaf(PIXI, node, textures[node.assetId]);
        leaf.label = nodeId + ":" + node.kind;
        nodes[nodeId].addChild(leaf);${
          hasRopeMesh
            ? `
        if (node.kind === "mesh" && node.meshKind === "rope" && leaf && leaf.__ribbon) {
          ropeEntries.push({
            mesh: leaf,
            node: node,
            basePathPoints: leaf.__ribbon.basePathPoints,
            width: leaf.__ribbon.width,
            crossVertices: leaf.__ribbon.crossVertices,
            positions: leaf.__ribbon.positions,
            scratchPath: leaf.__ribbon.scratchPath,
            pathEndX: 0,
            pathEndY: 0,
            pathCurveX: 0,
            pathCurveY: 0
          });
        }`
            : ""
        }${
          hasPlaneMesh
            ? `
        if (node.kind === "mesh" && node.meshKind === "plane" && PIXI.MeshPlane && leaf instanceof PIXI.MeshPlane) {
          meshEntries.push({ mesh: leaf, node: node, bendDelta: 0 });
        }`
            : ""
        }
      } else if (node.kind === "vector") {
        nodes[nodeId] = new PIXI.Container({ sortableChildren: true });
        const graphic = new PIXI.Graphics();
        graphic.svg(svgForVectorNode(node));
        graphic.label = nodeId + ":graphics";
        nodes[nodeId].addChild(graphic);
      } else {
        nodes[nodeId] = new PIXI.Container({ sortableChildren: true });
      }
      nodes[nodeId].label = nodeId;
    });
    Object.keys(S.scene.nodes).forEach(function(nodeId) {
      const node = S.scene.nodes[nodeId];
      const displayObject = nodes[nodeId];
      if (!displayObject) return;
      const parent = node.parentId ? nodes[node.parentId] : app.stage;
      (parent || app.stage).addChild(displayObject);
    });${
      hasRopeMesh
        ? `
    ropeEntries.forEach(function(entry) {
      let cursor = entry.node.id;
      while (cursor) {
        (ropeEntriesByNodeId[cursor] = ropeEntriesByNodeId[cursor] || []).push(entry);
        const sceneNode = S.scene.nodes[cursor];
        cursor = sceneNode ? sceneNode.parentId : null;
      }
    });`
        : ""
    }${
      hasPlaneMesh
        ? `
    // Timeline vars address slot/bone containers; map every ancestor node id
    // to the mesh leaves beneath it so a bend var reaches the deformable art.
    meshEntries.forEach(function(entry) {
      let cursor = entry.node.id;
      while (cursor) {
        (meshEntriesByNodeId[cursor] = meshEntriesByNodeId[cursor] || []).push(entry);
        const sceneNode = S.scene.nodes[cursor];
        cursor = sceneNode ? sceneNode.parentId : null;
      }
    });`
        : ""
    }
    const ctx = { app: app, nodes: nodes, textures: textures${
      hasPlaneMesh ? ", meshEntries: meshEntries, meshEntriesByNodeId: meshEntriesByNodeId" : ""
    }${hasRopeMesh ? ", ropeEntries: ropeEntries, ropeEntriesByNodeId: ropeEntriesByNodeId" : ""} };
    state.ctx = ctx;
    window.__studioBoomPixiScenes = window.__studioBoomPixiScenes || {};
    window.__studioBoomPixiScenes[S.compositionId] = ctx;
    renderIfReady(state.pendingTime);
    if (state.readyResolve) state.readyResolve(true);
  };
  start().catch(function(error) {
    console.error(error);
    if (state.readyReject) state.readyReject(error);
    throw error;
  });
})();`;
  doc.body?.appendChild(script);
}

function pixiRootId(compositionId: string): string {
  return `pixi-character-${safeId(compositionId)}`;
}

function buildSpeechAudio(
  id: string,
  mediaId: string,
  start: number,
  duration: number,
  trackIndex: number,
  volume?: number,
  mediaStart?: number,
): string {
  const volumeAttr = volume !== undefined && volume !== 1 ? ` data-volume="${esc(volume)}"` : "";
  const mediaStartAttr =
    mediaStart !== undefined && mediaStart > 0 ? ` data-media-start="${esc(mediaStart)}"` : "";
  return `<audio id="${esc(safeId(id))}" data-character-speech="true" data-start="${esc(
    start,
  )}" data-duration="${esc(duration)}" data-track-index="${esc(
    trackIndex,
  )}"${volumeAttr}${mediaStartAttr} src="asset:${esc(mediaId)}" preload="auto"></audio>`;
}

function positiveNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
