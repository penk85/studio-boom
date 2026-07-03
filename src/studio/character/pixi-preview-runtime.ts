import { Application, Assets, Container, Graphics, Sprite, type Texture } from "pixi.js";
import type {
  CharacterSceneAsset,
  CharacterSceneGraph,
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

interface PixiCharacterPreviewContext {
  app: Application;
  scene: CharacterSceneGraph;
  nodes: Record<string, Container>;
  textures: Record<string, Texture>;
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
  const nodes = buildPixiScene(app, payload.scene, textures);
  const ctx = { app, scene: payload.scene, nodes, textures };
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
): Record<string, Container> {
  const nodes: Record<string, Container> = {};
  Object.keys(scene.nodes).forEach((nodeId) => {
    const node = scene.nodes[nodeId];
    nodes[nodeId] = createPixiNode(node, textures);
    nodes[nodeId].label = nodeId;
  });

  Object.keys(scene.nodes).forEach((nodeId) => {
    const node = scene.nodes[nodeId];
    const displayObject = nodes[nodeId];
    const parent = node.parentId ? nodes[node.parentId] : app.stage;
    (parent || app.stage).addChild(displayObject);
  });

  return nodes;
}

function createPixiNode(node: CharacterSceneNode, textures: Record<string, Texture>): Container {
  if (node.kind === "sprite" || node.kind === "mesh") {
    const texture = textures[node.assetId];
    if (!texture) throw new Error(`Missing texture for character asset ${node.assetId}`);
    const container = new Container({ sortableChildren: true });
    const leaf = createTexturedLeaf(node, texture);
    leaf.label = `${node.id}:${node.kind}`;
    container.addChild(leaf);
    return container;
  }
  if (node.kind === "vector") {
    const container = new Container({ sortableChildren: true });
    const graphic = new Graphics();
    graphic.svg(svgForVectorNode(node));
    graphic.label = `${node.id}:graphics`;
    container.addChild(graphic);
    return container;
  }
  return new Container({ sortableChildren: true });
}

function createTexturedLeaf(node: CharacterSceneNode, texture: Texture): Container {
  // Mesh nodes intentionally share the same container contract as sprites. Today
  // they render as sprite leaves until mesh export parity is explicitly enabled;
  // the parent node already owns transforms, visibility, and timeline vars.
  if (node.kind === "sprite" || node.kind === "mesh") return new Sprite({ texture });
  return new Container();
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
  ctx.app.render();
}

function applyBaseScene(ctx: PixiCharacterPreviewContext): void {
  Object.keys(ctx.nodes).forEach((nodeId) => {
    const node = ctx.scene.nodes[nodeId];
    const displayObject = ctx.nodes[nodeId];
    if (!node || !displayObject) return;
    displayObject.visible = node.visible !== false;
    displayObject.alpha = node.opacity == null ? 1 : node.opacity;
    displayObject.zIndex = node.zIndex || 0;
    if (node.kind === "sprite" || node.kind === "mesh") {
      applyTexturedFrame(displayObject, node.frame, ctx.textures[node.assetId]);
    } else if (node.kind === "vector") {
      applyVectorFrame(displayObject, node.frame);
    } else {
      applyContainerFrame(displayObject, node.frame);
    }
  });
}

function applyContainerFrame(
  displayObject: Container,
  frame: CharacterSceneNode["frame"],
): void {
  displayObject.position.set(frame.x + frame.originX, frame.y + frame.originY);
  displayObject.pivot.set(frame.originX, frame.originY);
  displayObject.rotation = toRadians(frame.rotation);
  displayObject.scale.set(frame.scaleX || 1, frame.scaleY || 1);
}

function applyTexturedFrame(
  displayObject: Container,
  frame: CharacterSceneNode["frame"],
  texture: Texture,
): void {
  const sx = frame.width / Math.max(1, texture.width || frame.width || 1);
  const sy = frame.height / Math.max(1, texture.height || frame.height || 1);
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
        varsByNodeId[target.sceneNodeId] = lerpVars(current, target.vars, (time - start) / duration);
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
    if (typeof vars.rotationY === "number") displayObject.scale.x *= Math.cos(toRadians(vars.rotationY));
    if (typeof vars.rotationX === "number") displayObject.scale.y *= Math.cos(toRadians(vars.rotationX));
    if (typeof vars.rotation === "number") displayObject.rotation = toRadians(vars.rotation);
    if (typeof vars.opacity === "number") displayObject.alpha = vars.opacity;
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
  return (Number(degrees) || 0) * Math.PI / 180;
}
