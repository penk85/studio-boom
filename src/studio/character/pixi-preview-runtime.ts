import {
  Application,
  Assets,
  Container,
  Graphics,
  MeshPlane,
  MeshSimple,
  Sprite,
  type PlaneGeometry,
  type Texture,
} from "pixi.js";
import {
  bendPlanePositions,
  clampBendDegrees,
  limbRibbonIndices,
  limbRibbonPositions,
  limbRibbonUVs,
} from "./mesh-deform";
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
  destroy(): void;
}

interface BendableMeshEntry {
  mesh: MeshPlane;
  node: CharacterSceneMeshNode;
  /** Bend degrees accumulated from timeline vars this frame, on top of the authored base. */
  bendDelta: number;
}

interface RopeMeshEntry {
  mesh: MeshSimple;
  node: CharacterSceneMeshNode;
  basePathPoints: Array<{ x: number; y: number }>;
  width: number;
  crossVertices: number;
  positions: Float32Array;
  scratchPath: Array<{ x: number; y: number }>;
  pathEndX: number;
  pathEndY: number;
  pathCurveX: number;
  pathCurveY: number;
}

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
  await app.init({
    width: payload.scene.output.width,
    height: payload.scene.output.height,
    backgroundAlpha: 0,
    antialias: true,
    autoStart: false,
    autoDensity: true,
    resolution: typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
  });
  app.ticker.stop();
  app.stage.sortableChildren = true;
  app.stage.label = "character-scene-root";
  app.canvas.style.display = "block";
  app.canvas.style.width = "100%";
  app.canvas.style.height = "100%";

  const textures = await loadPreviewTextures(payload.scene, options.resolveAssetRef);
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
  renderPixiCharacterAt(ctx, payload.timelineScene, options.initialTime ?? 0);
  host.appendChild(app.canvas);

  let destroyed = false;
  return {
    renderAt(time: number) {
      if (destroyed) return;
      renderPixiCharacterAt(ctx, payload.timelineScene, time);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      app.destroy({ removeView: true, releaseGlobalResources: false }, { children: true });
    },
  };
}

async function loadPreviewTextures(
  scene: CharacterSceneGraph,
  resolveAssetRef: PixiCharacterPreviewOptions["resolveAssetRef"],
): Promise<Record<string, Texture>> {
  const textures: Record<string, Texture> = {};
  Assets.setPreferences({ preferCreateImageBitmap: false });
  await Promise.all(
    scene.assets.map(async (asset) => {
      const resolved = (await resolveAssetRef?.(asset)) ?? asset.ref;
      try {
        textures[asset.id] = await Assets.load<Texture>({
          src: resolved,
          parser: asset.parser || "texture",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to load character texture ${asset.id} for parts ${asset.partIds.join(", ")}: ${message}`,
        );
      }
    }),
  );
  return textures;
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
  Object.keys(scene.nodes).forEach((nodeId) => {
    const node = scene.nodes[nodeId];
    const built = createPixiNode(node, textures);
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
): { container: Container; meshEntry?: BendableMeshEntry; ropeEntry?: RopeMeshEntry } {
  if (node.kind === "sprite" || node.kind === "mesh") {
    const texture = textures[node.assetId];
    if (!texture) throw new Error(`Missing texture for character asset ${node.assetId}`);
    const container = new Container({ sortableChildren: true });
    // The parent container owns transforms, visibility, and timeline vars for
    // both leaf kinds; a mesh leaf only adds vertex-level bending inside it.
    if (node.kind === "mesh" && node.meshKind === "rope") {
      try {
        const basePathPoints = copyPathPoints(node.pathPoints);
        const rows = basePathPoints.length;
        const crossVertices = Math.max(2, node.crossVertices ?? 2);
        const width = node.ropeWidth ?? Math.min(texture.width || 1, texture.height || 1);
        const uvRect = node.uvRect ?? { u0: 0, v0: 0, u1: 1, v1: 1 };
        const positions = limbRibbonPositions(basePathPoints, width, crossVertices);
        // A textured ribbon (MeshSimple) preserves the full limb art along the
        // spine; a MeshRope pancakes it (texture height crushed into the width).
        const mesh = new MeshSimple({
          texture,
          vertices: positions,
          uvs: limbRibbonUVs(rows, crossVertices, uvRect, node.ribbonVertical !== false),
          indices: limbRibbonIndices(rows, crossVertices),
        });
        mesh.label = `${node.id}:${node.kind}`;
        container.addChild(mesh);
        return {
          container,
          ropeEntry: {
            mesh,
            node,
            basePathPoints,
            width,
            crossVertices,
            positions,
            scratchPath: basePathPoints.map((point) => ({ x: point.x, y: point.y })),
            pathEndX: 0,
            pathEndY: 0,
            pathCurveX: 0,
            pathCurveY: 0,
          },
        };
      } catch (error) {
        console.warn(
          "Falling back to Sprite for flexible limb mesh character part",
          node.partId,
          error,
        );
      }
    }
    if (node.kind === "mesh" && node.meshKind === "plane") {
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
  applyRopePathOffsets(ctx);
  applyMeshBends(ctx);
  ctx.app.render();
}

function copyPathPoints(points?: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const source =
    points && points.length >= 2
      ? points
      : [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ];
  return source.map((point) => ({ x: point.x, y: point.y }));
}

function applyRopePathOffsets(ctx: PixiCharacterPreviewContext): void {
  for (const entry of ctx.ropeEntries) {
    const count = entry.basePathPoints.length;
    if (count === 0) continue;
    const denom = Math.max(1, count - 1);
    // Rebuild the animated spine (base path + end/curve offsets), then rebuild
    // the ribbon geometry so the full limb art follows the curve.
    for (let i = 0; i < count; i += 1) {
      const t = i / denom;
      const curveWeight = 4 * t * (1 - t);
      const base = entry.basePathPoints[i];
      entry.scratchPath[i].x = base.x + entry.pathEndX * t + entry.pathCurveX * curveWeight;
      entry.scratchPath[i].y = base.y + entry.pathEndY * t + entry.pathCurveY * curveWeight;
    }
    limbRibbonPositions(entry.scratchPath, entry.width, entry.crossVertices, entry.positions);
    entry.mesh.vertices = entry.positions;
  }
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
  for (const entry of ctx.ropeEntries) {
    entry.pathEndX = 0;
    entry.pathEndY = 0;
    entry.pathCurveX = 0;
    entry.pathCurveY = 0;
  }
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
