import {
  Application,
  Container,
  Graphics,
  MeshPlane,
  MeshSimple,
  Sprite,
  type PlaneGeometry,
  type Texture,
} from "pixi.js";
import { bendPlanePositions, clampBendDegrees } from "./mesh-deform";
import { createLimbRuntime, type LimbRopeEntry } from "./limb-runtime";
import { acquirePixiPreviewTextures, type PixiPreviewTextureLease } from "./pixi-preview-assets";
import type {
  CharacterSceneAsset,
  CharacterSceneGraph,
  CharacterSceneMeshNode,
  CharacterSceneNode,
  CharacterSceneVectorNode,
} from "./scene";
import type { CharacterTimelineScene, CharacterTimelineVars } from "./timeline-scene";

export interface PixiCharacterPreviewPayload {
  scene: CharacterSceneGraph;
  timelineScene: CharacterTimelineScene;
}

export interface PixiCharacterPreviewOptions {
  resolveAssetRef?: (asset: CharacterSceneAsset) => string | null | Promise<string | null>;
  initialTime?: number;
}

export interface PixiCharacterPreviewController {
  renderAt(time: number): void;
  updateTimelineScene(timelineScene: CharacterTimelineScene): void;
  destroy(): void;
}

interface BendableMeshEntry {
  mesh: MeshPlane;
  node: CharacterSceneMeshNode;
  /** Bend degrees accumulated from timeline vars this frame, on top of the authored base. */
  bendDelta: number;
}

/** Shared limb runtime instance; the composition script embeds the same factory. */
const limb = createLimbRuntime();

type RopeMeshEntry = LimbRopeEntry<MeshSimple, CharacterSceneMeshNode>;

interface PixiCharacterPreviewContext {
  app: Application;
  scene: CharacterSceneGraph;
  nodes: Record<string, Container>;
  textures: Record<string, Texture>;
  /** Every mesh leaf, plus reverse lookup from each ancestor node id (motion targets). */
  meshEntries: BendableMeshEntry[];
  meshEntriesByNodeId: Record<string, BendableMeshEntry[]>;
  ropeEntries: RopeMeshEntry[];
  ropeEntriesByNodeId: Record<string, RopeMeshEntry[]>;
}

export async function createPixiCharacterPreview(
  host: HTMLElement,
  payload: PixiCharacterPreviewPayload,
  options: PixiCharacterPreviewOptions = {},
): Promise<PixiCharacterPreviewController> {
  const app = new Application();
  let initialized = false;
  let textureLease: PixiPreviewTextureLease | null = null;
  try {
    await app.init({
      width: payload.scene.output.width,
      height: payload.scene.output.height,
      backgroundAlpha: 0,
      antialias: true,
      autoStart: false,
      autoDensity: true,
      resolution: typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
    });
    initialized = true;
    app.ticker.stop();
    app.stage.sortableChildren = true;
    app.stage.label = "character-scene-root";
    app.canvas.style.display = "block";
    app.canvas.style.width = "100%";
    app.canvas.style.height = "100%";

    textureLease = await acquirePixiPreviewTextures(payload.scene, options.resolveAssetRef);
    const textures = textureLease.textures;
    const { nodes, meshEntries, meshEntriesByNodeId, ropeEntries, ropeEntriesByNodeId } =
      buildPixiScene(app, payload.scene, textures);
    const ctx: PixiCharacterPreviewContext = {
      app,
      scene: payload.scene,
      nodes,
      textures,
      meshEntries,
      meshEntriesByNodeId,
      ropeEntries,
      ropeEntriesByNodeId,
    };
    let timelineScene = payload.timelineScene;
    let currentTime = options.initialTime ?? 0;
    renderPixiCharacterAt(ctx, timelineScene, currentTime);
    host.appendChild(app.canvas);

    let destroyed = false;
    return {
      renderAt(time: number) {
        if (destroyed) return;
        currentTime = time;
        renderPixiCharacterAt(ctx, timelineScene, currentTime);
      },
      updateTimelineScene(nextTimelineScene: CharacterTimelineScene) {
        if (destroyed) return;
        timelineScene = nextTimelineScene;
        renderPixiCharacterAt(ctx, timelineScene, currentTime);
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        const lease = textureLease;
        textureLease = null;
        try {
          app.destroy({ removeView: true, releaseGlobalResources: false }, { children: true });
        } finally {
          void lease?.release();
        }
      },
    };
  } catch (error) {
    if (initialized) {
      try {
        app.destroy({ removeView: true, releaseGlobalResources: false }, { children: true });
      } catch (destroyError) {
        console.warn("Failed to destroy a broken Pixi character preview", destroyError);
      }
    }
    await textureLease?.release();
    throw error;
  }
}

function buildPixiScene(
  app: Application,
  scene: CharacterSceneGraph,
  textures: Record<string, Texture>,
): {
  nodes: Record<string, Container>;
  meshEntries: BendableMeshEntry[];
  meshEntriesByNodeId: Record<string, BendableMeshEntry[]>;
  ropeEntries: RopeMeshEntry[];
  ropeEntriesByNodeId: Record<string, RopeMeshEntry[]>;
} {
  const nodes: Record<string, Container> = {};
  const meshEntries: BendableMeshEntry[] = [];
  const meshEntriesByNodeId: Record<string, BendableMeshEntry[]> = {};
  const ropeEntries: RopeMeshEntry[] = [];
  const ropeEntriesByNodeId: Record<string, RopeMeshEntry[]> = {};
  const supportsMesh = hasPixiMeshPipe(app);
  Object.keys(scene.nodes).forEach((nodeId) => {
    const node = scene.nodes[nodeId];
    const built = createPixiNode(node, textures, supportsMesh);
    nodes[nodeId] = built.container;
    nodes[nodeId].label = nodeId;
    if (built.meshEntry) meshEntries.push(built.meshEntry);
    if (built.ropeEntry) ropeEntries.push(built.ropeEntry);
  });

  Object.keys(scene.nodes).forEach((nodeId) => {
    const node = scene.nodes[nodeId];
    const displayObject = nodes[nodeId];
    const parent = node.parentId ? nodes[node.parentId] : app.stage;
    (parent || app.stage).addChild(displayObject);
  });

  // Timeline vars address slot/bone containers; map every ancestor node id to
  // the mesh leaves beneath it so a `bend` var reaches the deformable art.
  for (const entry of meshEntries) {
    let cursor: string | undefined = entry.node.id;
    while (cursor) {
      (meshEntriesByNodeId[cursor] ??= []).push(entry);
      cursor = scene.nodes[cursor]?.parentId;
    }
  }

  for (const entry of ropeEntries) {
    let cursor: string | undefined = entry.node.id;
    while (cursor) {
      (ropeEntriesByNodeId[cursor] ??= []).push(entry);
      cursor = scene.nodes[cursor]?.parentId;
    }
  }

  return { nodes, meshEntries, meshEntriesByNodeId, ropeEntries, ropeEntriesByNodeId };
}

function createPixiNode(
  node: CharacterSceneNode,
  textures: Record<string, Texture>,
  supportsMesh: boolean,
): { container: Container; meshEntry?: BendableMeshEntry; ropeEntry?: RopeMeshEntry } {
  if (node.kind === "sprite" || node.kind === "mesh") {
    const texture = textures[node.assetId];
    if (!texture) throw new Error(`Missing texture for character asset ${node.assetId}`);
    const container = new Container({ sortableChildren: true });
    // The parent container owns transforms, visibility, and timeline vars for
    // both leaf kinds; a mesh leaf only adds vertex-level bending inside it.
    if (supportsMesh && node.kind === "mesh" && node.meshKind === "rope") {
      try {
        const built = limb.buildRopeRibbon({ MeshSimple, texture, node });
        built.mesh.label = `${node.id}:${node.kind}`;
        container.addChild(built.mesh);
        return { container, ropeEntry: built.entry };
      } catch (error) {
        console.warn(
          "Falling back to Sprite for flexible limb mesh character part",
          node.partId,
          error,
        );
      }
    }
    if (supportsMesh && node.kind === "mesh" && node.meshKind === "plane") {
      try {
        const mesh = new MeshPlane({
          texture,
          verticesX: node.verticesX ?? 2,
          verticesY: node.verticesY ?? 2,
        });
        mesh.label = `${node.id}:${node.kind}`;
        container.addChild(mesh);
        return { container, meshEntry: { mesh, node, bendDelta: 0 } };
      } catch (error) {
        console.warn("Falling back to Sprite for mesh character part", node.partId, error);
      }
    }
    const leaf = new Sprite({ texture });
    leaf.label = `${node.id}:${node.kind}`;
    container.addChild(leaf);
    return { container };
  }
  if (node.kind === "vector") {
    const container = new Container({ sortableChildren: true });
    const graphic = new Graphics();
    graphic.svg(svgForVectorNode(node));
    graphic.label = `${node.id}:graphics`;
    container.addChild(graphic);
    return { container };
  }
  return { container: new Container({ sortableChildren: true }) };
}

/** CanvasRenderer exposes mesh classes but has no mesh render pipe; use rigid sprites there. */
function hasPixiMeshPipe(app: Application): boolean {
  const renderer = app.renderer as unknown as {
    renderPipes?: { mesh?: { validateRenderable?: unknown } };
  };
  return typeof renderer.renderPipes?.mesh?.validateRenderable === "function";
}

export function renderPixiCharacterAt(
  ctx: PixiCharacterPreviewContext,
  timelineScene: CharacterTimelineScene,
  time: number,
): void {
  const duration = timelineScene.duration;
  const t = Math.max(0, Math.min(duration, Number(time) || 0));
  applyBaseScene(ctx);
  latestEventsAt(timelineScene, t).forEach((event) => applySlotEvent(ctx, event));
  applyTargetVars(ctx, targetVarsAt(timelineScene, t));
  limb.applyRopePathOffsets(ctx.ropeEntries);
  limb.applyRopePathAttachments(ctx.ropeEntries, ctx.nodes);
  applyMeshBends(ctx);
  ctx.app.render();
}

function applyMeshBends(ctx: PixiCharacterPreviewContext): void {
  for (const entry of ctx.meshEntries) {
    const bend = clampBendDegrees((entry.node.bend || 0) + entry.bendDelta);
    const geometry = entry.mesh.geometry as PlaneGeometry;
    const buffer = geometry.getBuffer("aPosition");
    bendPlanePositions({
      width: geometry.width,
      height: geometry.height,
      verticesX: geometry.verticesX,
      verticesY: geometry.verticesY,
      axis: entry.node.stretchAxis ?? "y",
      anchor: entry.node.bendAnchor ?? "start",
      originX: (entry.node.bendOriginX ?? 0.5) * geometry.width,
      originY: (entry.node.bendOriginY ?? 0.5) * geometry.height,
      bend,
      out: buffer.data as Float32Array,
    });
    buffer.update();
  }
}

function applyBaseScene(ctx: PixiCharacterPreviewContext): void {
  for (const entry of ctx.meshEntries) entry.bendDelta = 0;
  limb.resetRopeEntries(ctx.ropeEntries);
  Object.keys(ctx.nodes).forEach((nodeId) => {
    const node = ctx.scene.nodes[nodeId];
    const displayObject = ctx.nodes[nodeId];
    if (!node || !displayObject) return;
    displayObject.visible = node.visible !== false;
    displayObject.alpha = node.opacity == null ? 1 : node.opacity;
    displayObject.zIndex = node.zIndex || 0;
    if (node.kind === "sprite" || node.kind === "mesh") {
      // Rope geometry is authored in part-local px, so it scales by the part's
      // source size; sprite/plane geometry is texture-sized.
      const texture = ctx.textures[node.assetId];
      const sizeW =
        node.kind === "mesh" && node.meshKind === "rope"
          ? (node.sourceWidth ?? texture?.width ?? node.frame.width)
          : (texture?.width ?? node.frame.width);
      const sizeH =
        node.kind === "mesh" && node.meshKind === "rope"
          ? (node.sourceHeight ?? texture?.height ?? node.frame.height)
          : (texture?.height ?? node.frame.height);
      applyTexturedFrame(displayObject, node.frame, sizeW, sizeH);
    } else if (node.kind === "vector") {
      applyVectorFrame(displayObject, node.frame);
    } else {
      applyContainerFrame(displayObject, node.frame);
    }
  });
}

function applyContainerFrame(displayObject: Container, frame: CharacterSceneNode["frame"]): void {
  displayObject.position.set(frame.x + frame.originX, frame.y + frame.originY);
  displayObject.pivot.set(frame.originX, frame.originY);
  displayObject.rotation = toRadians(frame.rotation);
  displayObject.scale.set(frame.scaleX || 1, frame.scaleY || 1);
}

function applyTexturedFrame(
  displayObject: Container,
  frame: CharacterSceneNode["frame"],
  sourceWidth: number,
  sourceHeight: number,
): void {
  const sx = frame.width / Math.max(1, sourceWidth || frame.width || 1);
  const sy = frame.height / Math.max(1, sourceHeight || frame.height || 1);
  displayObject.position.set(frame.x + frame.originX, frame.y + frame.originY);
  displayObject.pivot.set(
    sx ? frame.originX / sx : frame.originX,
    sy ? frame.originY / sy : frame.originY,
  );
  displayObject.rotation = toRadians(frame.rotation);
  displayObject.scale.set(sx * (frame.scaleX || 1), sy * (frame.scaleY || 1));
}

function applyVectorFrame(displayObject: Container, frame: CharacterSceneNode["frame"]): void {
  displayObject.position.set(frame.x + frame.originX, frame.y + frame.originY);
  displayObject.pivot.set(frame.originX, frame.originY);
  displayObject.rotation = toRadians(frame.rotation);
  displayObject.scale.set(frame.scaleX || 1, frame.scaleY || 1);
}

function latestEventsAt(timelineScene: CharacterTimelineScene, time: number) {
  return (timelineScene.slotEvents || []).filter((event) => (event.time || 0) <= time + 0.0001);
}

function applySlotEvent(
  ctx: PixiCharacterPreviewContext,
  event: ReturnType<typeof latestEventsAt>[number],
): void {
  if (!event.variant) return;
  (event.variant.hideSceneNodeIds || []).forEach((nodeId) => {
    const displayObject = ctx.nodes[nodeId];
    if (displayObject) displayObject.alpha = 0;
  });
  (event.variant.showSceneNodeIds || []).forEach((nodeId) => {
    const displayObject = ctx.nodes[nodeId];
    if (displayObject) {
      displayObject.visible = true;
      displayObject.alpha = 1;
    }
  });
  (event.boneAnchors || []).forEach((anchor) => {
    const displayObject = anchor.sceneNodeId ? ctx.nodes[anchor.sceneNodeId] : null;
    if (!displayObject) return;
    displayObject.position.set(anchor.left, anchor.top);
    displayObject.pivot.set(0, 0);
    displayObject.rotation = toRadians(anchor.rotation);
  });
}

function targetVarsAt(
  timelineScene: CharacterTimelineScene,
  time: number,
): Record<string, CharacterTimelineVars> {
  const varsByNodeId: Record<string, CharacterTimelineVars> = {};
  (timelineScene.initialTargets || []).forEach((target) => {
    if (!target.sceneNodeId) return;
    varsByNodeId[target.sceneNodeId] = cloneVars(target.vars);
  });
  (timelineScene.motionSegments || []).forEach((segment) => {
    const start = Number(segment.start) || 0;
    const duration = Math.max(0.0001, Number(segment.duration) || 0);
    const end = start + duration;
    if (time < start - 0.0001) return;
    (segment.targets || []).forEach((target) => {
      if (!target.sceneNodeId) return;
      const current = varsByNodeId[target.sceneNodeId] || {};
      if (time >= end - 0.0001) {
        varsByNodeId[target.sceneNodeId] = cloneVars(target.vars);
      } else {
        varsByNodeId[target.sceneNodeId] = lerpVars(
          current,
          target.vars,
          (time - start) / duration,
        );
      }
    });
  });
  return varsByNodeId;
}

function applyTargetVars(
  ctx: PixiCharacterPreviewContext,
  varsByNodeId: Record<string, CharacterTimelineVars>,
): void {
  Object.keys(varsByNodeId).forEach((nodeId) => {
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
    if (typeof vars.rotationY === "number")
      displayObject.scale.x *= Math.cos(toRadians(vars.rotationY));
    if (typeof vars.rotationX === "number")
      displayObject.scale.y *= Math.cos(toRadians(vars.rotationX));
    if (typeof vars.rotation === "number") displayObject.rotation = toRadians(vars.rotation);
    if (typeof vars.opacity === "number") displayObject.alpha = vars.opacity;
    if (typeof vars.bend === "number") {
      for (const entry of ctx.meshEntriesByNodeId[nodeId] || []) {
        entry.bendDelta += vars.bend;
      }
    }
    const ropeEntries = ctx.ropeEntriesByNodeId[nodeId] || [];
    if (ropeEntries.length > 0) {
      for (const entry of ropeEntries) {
        entry.pathEndX += vars.pathEndX ?? 0;
        entry.pathEndY += vars.pathEndY ?? 0;
        entry.pathCurveX += vars.pathCurveX ?? 0;
        entry.pathCurveY += vars.pathCurveY ?? 0;
      }
    }
  });
}

function cloneVars(vars: CharacterTimelineVars): CharacterTimelineVars {
  return { ...(vars || {}) };
}

function lerpVars(
  from: CharacterTimelineVars,
  to: CharacterTimelineVars,
  progress: number,
): CharacterTimelineVars {
  const out: Record<string, number | string | undefined> = {};
  Object.keys({ ...(from || {}), ...(to || {}) }).forEach((key) => {
    const typedKey = key as keyof CharacterTimelineVars;
    const a = from ? from[typedKey] : undefined;
    const b = to ? to[typedKey] : undefined;
    if (typeof a === "number" && typeof b === "number") {
      out[typedKey] = a + (b - a) * progress;
    } else if (b !== undefined) {
      out[typedKey] = progress >= 1 ? b : a !== undefined ? a : b;
    } else if (a !== undefined) {
      out[typedKey] = a;
    }
  });
  return out as CharacterTimelineVars;
}

function svgForVectorNode(node: CharacterSceneVectorNode): string {
  const stroke = node.stroke
    ? ` stroke="${svgAttr(node.stroke)}" stroke-width="${svgAttr(
        node.strokeWidth || 1,
      )}" stroke-linecap="${svgAttr(node.strokeLinecap || "round")}" stroke-linejoin="${svgAttr(
        node.strokeLinejoin || "round",
      )}"`
    : "";
  const width = Math.max(0.0001, node.frame.width || 0);
  const height = Math.max(0.0001, node.frame.height || 0);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${svgAttr(
    node.viewBox || `0 0 ${node.frame.width} ${node.frame.height}`,
  )}" width="${svgAttr(width)}" height="${svgAttr(height)}"><path d="${svgAttr(
    node.path || "",
  )}" fill="${svgAttr(node.fill || "#733f43")}"${stroke}/></svg>`;
}

function svgAttr(value: string | number | null | undefined): string {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toRadians(degrees: number | undefined): number {
  return ((Number(degrees) || 0) * Math.PI) / 180;
}
