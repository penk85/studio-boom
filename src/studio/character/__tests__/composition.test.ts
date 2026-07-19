import { describe, expect, it, vi } from "vitest";
import { validateCompositionSourceHtml } from "../../hyperframes/composition-source";
import type { CharacterClipMeta, CharacterPreset, MotionPreset } from "../../types";
import { createBlankCharacter, makePart } from "../character-utils";
import { buildCharacterCompositionHtml, buildCharacterRenderPayload } from "../composition";
import { blinkWindowsForClip } from "../eye-state";
import { createDefaultMouthRig } from "../mouth-libraries";
import { buildDefaultRig } from "../rig";
import { buildCharacterRuntime, resolveRuntimeSlotPart, runtimePartPlacement } from "../runtime";
import { setVariantPinRotation, upsertVariantPinAtPoint } from "../variant-pairing";
import { makeVariantArmCharacter, withFistVariant } from "./fixtures";

function makeCharacter() {
  return {
    ...createBlankCharacter("Actor"),
    id: "char-1",
    parts: [
      makePart("body", "body-media", {
        id: "body-idle",
        slotId: "role:body",
        pose: "idle",
        x: 100,
        y: 120,
        width: 220,
        height: 360,
        zIndex: 1,
      }),
      makePart("eye", "eye-open-media", {
        id: "eye-open",
        slotId: "slot:left-eye",
        eyeState: "open",
        side: "left",
        x: 180,
        y: 180,
        width: 48,
        height: 28,
        zIndex: 4,
      }),
      makePart("eye", "eye-closed-media", {
        id: "eye-closed",
        slotId: "slot:left-eye",
        eyeState: "closed",
        side: "left",
        x: 180,
        y: 184,
        width: 48,
        height: 12,
        zIndex: 4,
      }),
      makePart("mouth", "mouth-rest-media", {
        id: "mouth-rest",
        slotId: "role:mouth",
        viseme: "rest",
        x: 210,
        y: 260,
        width: 90,
        height: 42,
        zIndex: 5,
      }),
      makePart("mouth", "mouth-a-media", {
        id: "mouth-a",
        slotId: "role:mouth",
        viseme: "A",
        x: 210,
        y: 260,
        width: 90,
        height: 54,
        zIndex: 5,
      }),
      makePart("mouth", "mouth-raspberry-media", {
        id: "mouth-raspberry",
        slotId: "role:mouth",
        pose: "raspberry",
        x: 190,
        y: 250,
        width: 150,
        height: 70,
        zIndex: 5,
      }),
    ],
  };
}

function build(
  meta: Partial<CharacterClipMeta> = {},
  motionPresets = new Map<string, MotionPreset>(),
  character = makeCharacter(),
) {
  return buildCharacterCompositionHtml({
    compositionId: "char_clip-1",
    clipId: "clip-1",
    width: 300,
    height: 450,
    duration: 4,
    character,
    meta: {
      characterId: "char-1",
      poses: {},
      autoBlink: true,
      ...meta,
    },
    motionPresets,
  });
}

function buildPayload(
  meta: Partial<CharacterClipMeta> = {},
  motionPresets = new Map<string, MotionPreset>(),
  character = makeCharacter(),
) {
  return buildCharacterRenderPayload({
    compositionId: "char_clip-1",
    clipId: "clip-1",
    width: 300,
    height: 450,
    duration: 4,
    character,
    meta: {
      characterId: "char-1",
      poses: {},
      autoBlink: true,
      ...meta,
    },
    motionPresets,
  });
}

interface PayloadSceneNode {
  kind: string;
  parentId?: string;
  childIds: string[];
  slotId?: string;
  boneId?: string;
  partId?: string;
  role?: string;
  depth?: number;
  drawOrder?: number;
  active?: boolean;
  visible?: boolean;
  opacity?: number;
  zIndex?: number;
  variantKey?: string;
  variantAliases?: string[];
  assetId?: string;
  assetRef?: string;
  meshKind?: string;
  verticesX?: number;
  verticesY?: number;
  stretchAxis?: string;
  bendAnchor?: string;
  bend?: number;
  pathPoints?: Array<{ x: number; y: number }>;
  pathLockTs?: number[];
  ropeWidth?: number;
  frame: {
    x: number;
    y: number;
    width: number;
    height: number;
    originX: number;
    originY: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
  };
  placement?: {
    x: number;
    y: number;
    pivotX: number;
    pivotY: number;
    rotation: number;
    drawOrder: number;
  };
  variantAnchors?: {
    initial: { x: number; y: number; rotation: number };
    anchors: Record<string, { x: number; y: number; rotation: number }>;
  };
}

function extractPixiPayload(html: string) {
  const match = html.match(/const S = (\{.*?\});\n\s+const toRadians/s);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]) as {
    scene: {
      angle: string;
      output: { width: number; height: number; scaleX: number; scaleY: number };
      nodes: Record<string, PayloadSceneNode>;
      boneNodeIds: Record<string, string>;
      slotNodeIds: Record<string, string>;
      partNodeIds: Record<string, string>;
      boneAnchorTracks: Record<
        string,
        {
          boneId: string;
          parentSlotId: string;
          base: { x: number; y: number; rotation: number };
          initial: { x: number; y: number; rotation: number };
          anchors: Record<string, { x: number; y: number; rotation: number }>;
        }
      >;
      assets: Array<{
        id: string;
        parser: string;
        ref: string;
        partIds: string[];
        rasterWidth?: number;
        rasterHeight?: number;
      }>;
    };
    timelineScene: {
      duration: number;
      initialTargets: Array<{
        selector: string;
        sceneNodeId?: string;
        vars: Record<string, number | string>;
      }>;
      motionSegments: Array<{
        start: number;
        duration: number;
        targets: Array<{
          selector: string;
          sceneNodeId?: string;
          vars: Record<string, number | string>;
        }>;
      }>;
      slotEvents: Array<{
        time: number;
        slotId: string;
        key: string;
        variant?: {
          show?: string[];
          hide?: string[];
          showSceneNodeIds?: string[];
          hideSceneNodeIds?: string[];
        };
        boneAnchors?: Array<{
          selector: string;
          sceneNodeId?: string;
          left: number;
          top: number;
          rotation: number;
        }>;
      }>;
    };
  };
}

/** The renderer-neutral timeline payload (same data the retired DOM script consumed). */
function extractScene(html: string) {
  return extractPixiPayload(html).timelineScene;
}

function eventShowsVariant(event: { variant?: { show?: string[] } }, value: string) {
  return (event.variant?.show ?? []).some((id) => id.includes(value));
}

function cssNumber(value: number) {
  return String(Math.round(value * 1000) / 1000);
}

describe("buildCharacterCompositionHtml", () => {
  it("exposes the same Pixi scene and timeline payload used by generated HTML", () => {
    const payload = buildPayload();
    const embedded = extractPixiPayload(build());

    expect(payload.scene).toEqual(embedded.scene);
    expect(payload.timelineScene).toEqual(embedded.timelineScene);
    expect(payload.character.id).toBe("char-1");
    expect(payload.width).toBe(300);
    expect(payload.height).toBe(450);
    expect(payload.duration).toBe(4);
  });

  it("generates explicit Pixi character source, asset refs, dimensions, and timeline registration", () => {
    const html = build();
    const validation = validateCompositionSourceHtml(html, {
      compositionId: "char_clip-1",
      duration: 4,
      width: 300,
      height: 450,
    });

    expect(validation.ok).toBe(true);
    expect(html).toContain('data-composition-id="char_clip-1"');
    expect(html).toContain('data-width="300"');
    expect(html).toContain('data-height="450"');
    expect(html).toContain('data-character-root="true"');
    expect(html).toContain('data-character-renderer="pixi"');
    expect(html).toContain('"assetRef":"asset:body-media"');
    expect(html).toContain('"assetRef":"asset:eye-open-media"');
    expect(html).toContain('window.__timelines["char_clip-1"]');
    // The duration anchor is load-bearing: the hyperframes runtime clamps a
    // composition clip's visibility window to min(data-duration, timeline.duration()),
    // so the character timeline must span the full composition duration.
    expect(html).toContain("tl.to({}, { duration: S.timelineScene.duration || S.duration }, 0);");
    expect(html).toContain("const originalSeek = tl.seek;");
    expect(html).toContain("tl.seek = function(time, suppressEvents)");
    expect(html).toContain('tl.eventCallback("onStart"');
    expect(html).not.toMatch(/repeat\s*:\s*-1/);

    const payload = extractPixiPayload(html);
    expect(payload.scene.slotNodeIds["role:body"]).toBeTruthy();
    expect(payload.scene.partNodeIds["body-idle"]).toBeTruthy();
  });

  it("can generate a Pixi-backed render-ready character composition from the scene graph", () => {
    const transformPreset: MotionPreset = {
      id: "pixi-body-motion",
      name: "Pixi body motion",
      category: "gesture",
      duration: 1,
      loop: false,
      tracks: [
        {
          partRole: "body",
          slotId: "role:body",
          keyframes: [
            { t: 0, dx: 0, rotation: 0, ease: "linear" },
            { t: 1, dx: 24, rotation: 12, ease: "linear" },
          ],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const variantPreset: MotionPreset = {
      id: "pixi-mouth-variant",
      name: "Pixi mouth variant",
      category: "expression",
      duration: 1,
      loop: false,
      tracks: [],
      keyposes: [
        {
          t: 0,
          parts: [{ partRole: "mouth", slotId: "role:mouth", poseSwap: "raspberry" }],
        },
        {
          t: 1,
          parts: [{ partRole: "mouth", slotId: "role:mouth", poseSwap: "raspberry" }],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = buildCharacterCompositionHtml({
      compositionId: "char_clip-1",
      clipId: "clip-1",
      width: 300,
      height: 450,
      duration: 4,
      character: makeCharacter(),
      meta: {
        characterId: "char-1",
        poses: {},
        autoBlink: false,
        motions: [
          { id: "applied-pixi-body", presetId: transformPreset.id, offset: 0, intensity: 1 },
          { id: "applied-pixi-mouth", presetId: variantPreset.id, offset: 0, intensity: 1 },
        ],
      },
      motionPresets: new Map([
        [transformPreset.id, transformPreset],
        [variantPreset.id, variantPreset],
      ]),
    });
    const validation = validateCompositionSourceHtml(html, {
      compositionId: "char_clip-1",
      duration: 4,
      width: 300,
      height: 450,
    });

    expect(validation.ok).toBe(true);
    expect(html).toContain('data-character-renderer="pixi"');
    expect(html).toContain('data-character-composition-id="char_clip-1"');
    expect(html).toContain("https://pixijs.download/release/pixi.min.js");
    expect(html).toContain("new PIXI.Application()");
    expect(html).toContain("PIXI.Assets.load");
    expect(html).toContain("preferCreateImageBitmap: false");
    expect(html).toContain(
      "{ width: asset.rasterWidth, height: asset.rasterHeight, resolution: 1 }",
    );
    expect(html).toContain("Failed to load character texture");
    expect(html).toContain("let initialized = false");
    expect(html).toContain("if (initialized) {");
    expect(html).toContain(
      "app.destroy({ removeView: true, releaseGlobalResources: false }, { children: true })",
    );
    expect(html).not.toContain("alias: asset.id");
    expect(html).toContain("new PIXI.Sprite");
    expect(html).toContain("createTexturedLeaf(PIXI, node, textures[node.assetId], supportsMesh)");
    expect(html).toContain("nodes[nodeId].addChild(leaf)");
    expect(html).not.toContain("new PIXI.MeshPlane");
    expect(html).toContain('"assetRef":"asset:body-media"');
    expect(html).toContain('window.__timelines["char_clip-1"] = tl');
    expect(html).toContain("window.__studioBoomPixiReady");
    expect(html).toContain("installHyperframesReadinessGate");
    expect(html).toContain("expectedPixiCompositionIds");
    expect(html).toContain("__studioBoomPixiReadyRegistrationListeners");
    expect(html).toContain("waitForPixiReady().then");
    expect(html).toContain("webgl: { preserveDrawingBuffer: true }");
    expect(html).not.toContain("useBackBuffer");
    expect(html).toContain('document.createElement("canvas")');
    expect(html).toContain('presentationCanvas.getContext("2d")');
    expect(html).toContain("ctx.presentationContext.drawImage(ctx.renderCanvas, 0, 0)");
    expect(html).toContain('typeof gl.finish === "function"');
    expect(html).toContain("targetVarsAt");
    expect(html).toContain("showSceneNodeIds");
    expect(html).not.toContain("<img ");
    expect(html.indexOf('window.__timelines["char_clip-1"] = tl')).toBeLessThan(
      html.indexOf("const start = async function()"),
    );
    expect(html.indexOf("const tl = gsap.timeline")).toBeLessThan(html.indexOf("await app.init"));

    const payload = extractPixiPayload(html);
    expect(Object.values(payload.scene.nodes).some((node) => node.kind === "mesh")).toBe(false);
    const bodyMotionTargets = payload.timelineScene.motionSegments.flatMap((segment) =>
      segment.targets.filter((target) => target.sceneNodeId?.includes("role:body")),
    );
    const bodyMotionSegments = payload.timelineScene.motionSegments.filter((segment) =>
      segment.targets.some((target) => target.sceneNodeId?.includes("role:body")),
    );
    const mouthVariantEvent = payload.timelineScene.slotEvents.find(
      (event) => event.slotId === "role:mouth" && event.key === "raspberry",
    );

    expect(bodyMotionTargets.some((target) => Number(target.vars.x) > 0)).toBe(true);
    expect(bodyMotionTargets.every((target) => target.sceneNodeId)).toBe(true);
    expect(Math.max(...bodyMotionSegments.map((segment) => segment.duration))).toBeLessThanOrEqual(
      0.034,
    );
    expect(
      mouthVariantEvent?.variant?.showSceneNodeIds?.some((id) => id.includes("raspberry")),
    ).toBe(true);
  });

  it("renders vector/morph character parts in the Pixi scene instead of dropping them", () => {
    const base = makeCharacter();
    const character: CharacterPreset = {
      ...base,
      parts: base.parts.map((part) =>
        part.id === "mouth-rest"
          ? {
              ...part,
              morph: {
                primaryPath: "M10 20 Q45 40 80 20 Q45 60 10 20Z",
                viewBox: "0 0 90 42",
                fill: "#733f43",
                stroke: "#2a1012",
                strokeWidth: "2",
              },
            }
          : part,
      ),
    };
    const html = buildCharacterCompositionHtml({
      compositionId: "char_clip-1",
      clipId: "clip-1",
      width: 300,
      height: 450,
      duration: 4,
      character,
      meta: {
        characterId: "char-1",
        poses: {},
        autoBlink: false,
      },
      motionPresets: new Map(),
    });
    const payload = extractPixiPayload(html);
    const vectorNode = Object.values(payload.scene.nodes).find(
      (node) => node.kind === "vector" && node.partId === "mouth-rest",
    );

    expect(vectorNode).toBeDefined();
    expect(html).toContain("new PIXI.Graphics()");
    expect(html).toContain("graphic.svg(svgForVectorNode(node))");
    expect(html).not.toContain('if (node.kind === "vector") return');
  });

  it("renders flexible limb-path parts as rope meshes with a sprite fallback", () => {
    const base = makeCharacter();
    const character: CharacterPreset = {
      ...base,
      parts: base.parts.map((part) =>
        part.id === "body-idle"
          ? {
              ...part,
              deform: {
                mode: "limb-path" as const,
                start: { x: 110, y: 20 },
                locks: [{ x: 130, y: 185 }],
                end: { x: 110, y: 360 },
                curve: { x: 150, y: 180 },
                width: 180,
                segments: 6,
              },
            }
          : part,
      ),
    };
    const html = buildCharacterCompositionHtml({
      compositionId: "char_clip-1",
      clipId: "clip-1",
      width: 300,
      height: 450,
      duration: 4,
      character,
      meta: {
        characterId: "char-1",
        poses: {},
        autoBlink: false,
      },
      motionPresets: new Map(),
    });
    const validation = validateCompositionSourceHtml(html, {
      compositionId: "char_clip-1",
      duration: 4,
      width: 300,
      height: 450,
    });
    expect(validation.ok).toBe(true);

    // The generated source renders the limb as a textured MeshSimple ribbon
    // (a MeshRope would pancake the art) plus a rigid-sprite fallback so
    // capture environments without the mesh pipe cannot fail.
    expect(html).toContain("MeshSimple: PIXI.MeshSimple");
    expect(html).toContain("app.renderer.renderPipes.mesh.validateRenderable");
    expect(html).toContain('if (supportsMesh && node.kind === "mesh" && node.meshKind === "rope"');
    expect(html).toContain("textures[node.assetId], supportsMesh");
    expect(html).toContain("buildRopeRibbon");
    expect(html).toContain("createLimbRuntime");
    expect(html).not.toContain("new PIXI.MeshRope");
    expect(html).toContain('node.meshKind === "rope"');
    expect(html).toContain("applyRopePathOffsets");
    expect(html).toContain("ropeEntriesByNodeId");
    // The ribbon follows the spine and rebuilds its full vertex grid per seek.
    expect(html).toContain("limbRibbonPositions");
    expect(html).toContain("limbRibbonUVs");
    expect(html).toContain("limbPathBendPoints");
    expect(html).toContain("limbPathLockFloor");
    expect(html).toContain("limbPathProjectPointT");
    expect(html).toContain("basePoints: entry.basePathPoints");
    expect(html).toContain("applyRopePathAttachments");
    expect(html).toContain("lockTs: node.pathLockTs");
    expect(html).toContain("pathAttachments: node.pathAttachments");
    expect(html).toContain("entry.mesh.vertices = entry.positions");
    // Rope frames scale by the part's source size, not the texture's size.
    expect(html).toContain("texturedFrameSize");
    expect(html).not.toContain("new PIXI.MeshPlane");
    expect(html).not.toContain("bendPlanePositions");
    expect(html).toContain("try {");
    expect(html).toContain("Falling back to Sprite for flexible limb mesh character part");
    expect(html).toContain("new PIXI.Sprite");

    const payload = extractPixiPayload(html);
    const meshNode = Object.values(payload.scene.nodes).find((node) => node.kind === "mesh");
    expect(meshNode).toBeDefined();
    expect(meshNode).toMatchObject({
      meshKind: "rope",
      partId: "body-idle",
      ropeWidth: 220,
      sourceWidth: 220,
      sourceHeight: 360,
    });
    // Render sampling is decoupled from the authored `segments` so bent
    // silhouettes stay smooth.
    expect(meshNode?.pathPoints?.length).toBe(33);
    expect(meshNode?.pathLockTs).toHaveLength(1);
  });

  it("marks SVG character media with the Pixi SVG asset parser", () => {
    const html = buildCharacterCompositionHtml({
      compositionId: "char_clip-1",
      clipId: "clip-1",
      width: 300,
      height: 450,
      duration: 4,
      character: makeCharacter(),
      meta: {
        characterId: "char-1",
        poses: {},
        autoBlink: false,
      },
      motionPresets: new Map(),
      mediaAssets: new Map([
        ["body-media", { filename: "body.svg", mimeType: "image/svg+xml" }],
        ["eye-open-media", { filename: "eye.png", mimeType: "image/png" }],
      ]),
    });
    const payload = extractPixiPayload(html);
    const bodyAsset = payload.scene.assets.find((asset) => asset.id === "body-media");
    const eyeAsset = payload.scene.assets.find((asset) => asset.id === "eye-open-media");

    expect(bodyAsset?.parser).toBe("svg");
    expect(bodyAsset).toMatchObject({ rasterWidth: 110, rasterHeight: 180 });
    expect(eyeAsset?.parser).toBe("texture");
  });

  it("keeps placed speech audio and lip-sync events in Pixi-backed character compositions", () => {
    const html = buildCharacterCompositionHtml({
      compositionId: "char_clip-1",
      clipId: "clip-1",
      width: 300,
      height: 450,
      duration: 4,
      character: makeCharacter(),
      meta: {
        characterId: "char-1",
        poses: {},
        autoBlink: false,
      },
      motionPresets: new Map(),
      speeches: [
        {
          audioId: "voice-pixi",
          start: 0.5,
          duration: 1.5,
          volume: 0.4,
          mediaStartTime: 0.25,
          visemes: [{ t: 0.5, v: "A" }],
        },
      ],
    });

    expect(html).toContain('data-character-renderer="pixi"');
    expect(html).toContain('data-character-speech="true"');
    expect(html).toContain('data-start="0.5"');
    expect(html).toContain('data-duration="1.5"');
    expect(html).toContain('data-volume="0.4"');
    expect(html).toContain('data-media-start="0.25"');
    expect(html).toContain('src="asset:voice-pixi"');

    const payload = extractPixiPayload(html);
    const lipSyncEvent = payload.timelineScene.slotEvents.find(
      (event) => event.slotId === "role:mouth" && event.key === "A",
    );
    expect(lipSyncEvent?.variant?.showSceneNodeIds?.some((id) => id.includes("mouth-a"))).toBe(
      true,
    );
  });

  it("ignores a legacy generated mouth rig and lets mouth parts drive lip sync", () => {
    const character = {
      ...makeCharacter(),
      mouthStyle: "rig" as const,
      mouthRig: createDefaultMouthRig("natural", {
        x: 190,
        y: 250,
        width: 150,
        height: 70,
        zIndex: 5,
      }),
    };
    const html = buildCharacterCompositionHtml({
      compositionId: "char_mouth_rig_pixi",
      clipId: "clip-mouth-rig-pixi",
      width: 300,
      height: 450,
      duration: 4,
      character,
      meta: {
        characterId: "char-1",
        poses: {},
        autoBlink: false,
        visemes: [{ t: 0.3, v: "A" }],
      },
      motionPresets: new Map(),
    });
    const validation = validateCompositionSourceHtml(html, {
      compositionId: "char_mouth_rig_pixi",
      duration: 4,
      width: 300,
      height: 450,
    });

    // The generated mouth rig existed only as puppet DOM and is retired; the
    // character's real mouth parts take over viseme swaps.
    expect(validation.ok).toBe(true);
    expect(html).toContain('data-character-renderer="pixi"');
    expect(html).not.toContain("generatedMouth");
    const scene = extractScene(html);
    const visemeEvent = scene.slotEvents.find(
      (event) => event.slotId === "role:mouth" && event.key === "A",
    );
    expect(visemeEvent?.variant?.showSceneNodeIds?.some((id) => id.includes("mouth-a"))).toBe(true);
  });

  it("warns and builds without a mouth when only the legacy generated rig exists", () => {
    const character = {
      ...makeCharacter(),
      parts: makeCharacter().parts.filter((part) => part.role !== "mouth"),
      mouthStyle: "rig" as const,
      mouthRig: createDefaultMouthRig("natural", {
        x: 190,
        y: 250,
        width: 150,
        height: 70,
        zIndex: 5,
      }),
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const html = buildCharacterCompositionHtml({
        compositionId: "char_mouth_rig_only",
        clipId: "clip-mouth-rig-only",
        width: 300,
        height: 450,
        duration: 4,
        character,
        meta: {
          characterId: "char-1",
          poses: {},
          autoBlink: false,
          visemes: [{ t: 0.3, v: "A" }],
        },
        motionPresets: new Map(),
      });
      expect(html).toContain('data-character-renderer="pixi"');
      expect(extractScene(html).slotEvents.some((event) => event.slotId.includes("mouth"))).toBe(
        false,
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("generated mouth rig"));
    } finally {
      warn.mockRestore();
    }
  });

  it("applies 3D turn vars as a 2.5D squash in the Pixi runtime", () => {
    const character = {
      ...createBlankCharacter("Flipper"),
      id: "flipper-pixi",
      parts: [
        makePart("body", "body-media", {
          id: "body",
          slotId: "role:body",
          x: 100,
          y: 120,
          width: 180,
          height: 260,
          zIndex: 1,
        }),
        makePart("leg", "leg-media", {
          id: "left-leg",
          slotId: "slot:left-leg",
          side: "left",
          x: 120,
          y: 350,
          width: 44,
          height: 140,
          zIndex: 0,
        }),
      ],
    };
    const preset: MotionPreset = {
      id: "cardflip",
      name: "Card Flip",
      category: "gesture",
      region: "lowerBody",
      duration: 1,
      loop: false,
      tracks: [
        {
          target: "bone",
          boneId: "bone:slot:left-leg",
          partRole: "leg",
          keyframes: [
            { t: 0, rotationY: 0, transformPerspective: 800, ease: "linear" },
            { t: 1, rotationY: 360, transformPerspective: 800, ease: "linear" },
          ],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = buildCharacterCompositionHtml({
      compositionId: "char_cardflip_pixi",
      clipId: "clip-cardflip-pixi",
      width: 300,
      height: 450,
      duration: 2,
      character,
      meta: {
        characterId: "flipper-pixi",
        poses: {},
        autoBlink: false,
        motions: [{ id: "applied-flip", presetId: "cardflip", offset: 0, intensity: 1 }],
      },
      motionPresets: new Map([["cardflip", preset]]),
    });

    // The runtime maps rotationX/rotationY to a cos() squash; without it the
    // 3D turn vars would be silently dropped and the flip would not move.
    expect(html).toContain("Math.cos(toRadians(vars.rotationY))");
    expect(html).toContain("Math.cos(toRadians(vars.rotationX))");

    const payload = extractPixiPayload(html);
    const turnTargets = [
      ...payload.timelineScene.initialTargets,
      ...payload.timelineScene.motionSegments.flatMap((segment) => segment.targets),
    ].filter((target) => typeof target.vars.rotationY === "number");
    expect(turnTargets.length).toBeGreaterThan(0);
    expect(turnTargets.every((target) => target.sceneNodeId)).toBe(true);
    expect(turnTargets.some((target) => target.vars.rotationY === 360)).toBe(true);
  });

  it("repairs a stale cross-side hand attachment before generating the character scene", () => {
    const character: CharacterPreset = {
      ...createBlankCharacter("Cross-side repair"),
      id: "cross-side-repair",
      parts: [
        makePart("body", "body-media", {
          id: "body",
          slotId: "role:body",
          x: 100,
          y: 120,
          width: 200,
          height: 320,
        }),
        makePart("arm", "left-arm-media", {
          id: "left-arm",
          slotId: "slot:left-arm",
          side: "left",
          x: 70,
          y: 180,
          width: 60,
          height: 180,
        }),
        makePart("arm", "right-arm-media", {
          id: "right-arm",
          slotId: "slot:right-arm",
          side: "right",
          x: 270,
          y: 180,
          width: 60,
          height: 180,
        }),
        makePart("hand", "right-hand-media", {
          id: "right-hand",
          slotId: "slot:right-hand",
          side: "right",
          parentId: "left-arm",
          x: 285,
          y: 345,
          width: 40,
          height: 40,
        }),
      ],
    };
    const rig = buildDefaultRig(character);
    const front = rig.angles?.front;
    if (!front) throw new Error("Expected front rig.");
    const staleFront = {
      ...front,
      bones: front.bones.map((bone) =>
        bone.id === "bone:slot:right-hand" ? { ...bone, parentId: "bone:slot:left-arm" } : bone,
      ),
      sockets: (front.sockets ?? []).map((socket) =>
        socket.childSlotId === "slot:right-hand" ? { ...socket, slotId: "slot:left-arm" } : socket,
      ),
      slotRelations: front.slotRelations.map((relation) =>
        relation.childSlotId === "slot:right-hand"
          ? { ...relation, parentRef: { type: "slot" as const, id: "slot:left-arm" } }
          : relation,
      ),
    };
    const html = build({ autoBlink: false }, new Map(), {
      ...character,
      rig: {
        ...rig,
        bones: staleFront.bones,
        sockets: staleFront.sockets,
        slotRelations: staleFront.slotRelations,
        angles: { ...rig.angles, front: staleFront },
      },
    });
    const payload = extractPixiPayload(html);
    const handBoneNode = payload.scene.nodes[payload.scene.boneNodeIds["bone:slot:right-hand"]];

    expect(handBoneNode?.parentId).toBe(payload.scene.boneNodeIds["bone:slot:right-arm"]);
  });

  it("nests iris slots inside the open eye variant", () => {
    const clipId = "clip-iris-nested";
    const character = {
      ...createBlankCharacter("Eye actor"),
      id: "eye-char",
      parts: [
        makePart("body", "body-media", {
          id: "body",
          slotId: "role:body",
          x: 80,
          y: 130,
          width: 180,
          height: 280,
          zIndex: 1,
        }),
        makePart("head", "head-media", {
          id: "head",
          slotId: "role:head",
          x: 110,
          y: 70,
          width: 120,
          height: 120,
          zIndex: 4,
        }),
        makePart("eye", "eye-open-media", {
          id: "eye-open",
          slotId: "slot:left-eye",
          side: "left",
          eyeState: "open",
          x: 140,
          y: 112,
          width: 32,
          height: 20,
          zIndex: 6,
        }),
        makePart("eye", "eye-closed-media", {
          id: "eye-closed",
          slotId: "slot:left-eye",
          side: "left",
          eyeState: "closed",
          x: 140,
          y: 116,
          width: 32,
          height: 8,
          zIndex: 6,
        }),
        makePart("iris", "iris-media", {
          id: "left-iris",
          slotId: "slot:left-iris",
          side: "left",
          x: 152,
          y: 116,
          width: 8,
          height: 8,
          zIndex: 7,
        }),
      ],
    };
    const html = buildCharacterCompositionHtml({
      compositionId: "char_iris_nested",
      clipId,
      width: 300,
      height: 450,
      duration: 10,
      character: { ...character, rig: buildDefaultRig(character) },
      meta: {
        characterId: "eye-char",
        poses: {},
        autoBlink: true,
      },
      motionPresets: new Map(),
    });

    const payload = extractPixiPayload(html);
    const irisPartNodeId = payload.scene.partNodeIds["left-iris"];
    const irisBoneId = payload.scene.boneNodeIds["bone:slot:left-iris"];
    const eyeBoneId = payload.scene.boneNodeIds["bone:slot:left-eye"];
    expect(
      blinkWindowsForClip({ id: clipId, duration: 10, autoBlink: true }).length,
    ).toBeGreaterThan(0);
    expect(payload.scene.nodes[irisBoneId]?.parentId).toBe(eyeBoneId);
    expect(payload.scene.nodes[payload.scene.slotNodeIds["slot:left-iris"]]?.parentId).toBe(
      irisBoneId,
    );
    // The nested guarantee: the iris re-anchors whenever the eye variant swaps.
    const eyeEvent = payload.timelineScene.slotEvents.find(
      (event) => event.slotId === "slot:left-eye",
    );
    expect(eyeEvent?.boneAnchors?.some((anchor) => anchor.sceneNodeId === irisBoneId)).toBe(true);
    const closedEyeEvent = payload.timelineScene.slotEvents.find(
      (event) => event.slotId === "slot:left-eye" && event.key === "closed",
    );
    const reopenedEyeEvent = payload.timelineScene.slotEvents.find(
      (event) =>
        event.slotId === "slot:left-eye" &&
        event.key === "open" &&
        (event.time || 0) > (closedEyeEvent?.time || 0),
    );
    expect(closedEyeEvent?.variant?.hideSceneNodeIds).toContain(irisPartNodeId);
    expect(closedEyeEvent?.variant?.showSceneNodeIds ?? []).not.toContain(irisPartNodeId);
    expect(reopenedEyeEvent?.variant?.showSceneNodeIds).toContain(irisPartNodeId);
  });

  it("positions nested child slots from runtime socket placement, not raw art offsets", () => {
    const character = {
      ...createBlankCharacter("Eye actor"),
      id: "eye-char",
      parts: [
        makePart("head", "head-media", {
          id: "head",
          slotId: "role:head",
          x: 110,
          y: 70,
          width: 120,
          height: 120,
          zIndex: 4,
        }),
        makePart("eye", "eye-open-media", {
          id: "eye-open",
          slotId: "slot:left-eye",
          side: "left",
          eyeState: "open",
          x: 140,
          y: 112,
          width: 32,
          height: 20,
          zIndex: 6,
        }),
        makePart("iris", "iris-media", {
          id: "left-iris",
          slotId: "slot:left-iris",
          side: "left",
          x: 152,
          y: 116,
          width: 8,
          height: 8,
          zIndex: 7,
        }),
      ],
    };
    const baseRig = buildDefaultRig(character);
    const frontRig = baseRig.angles?.front;
    if (!frontRig) throw new Error("Expected a front angle rig.");
    const movedFrontRig = {
      ...frontRig,
      slotBindings: frontRig.slotBindings.map((binding) =>
        binding.slotId === "slot:left-iris"
          ? { ...binding, x: binding.x + 18, y: binding.y + 6 }
          : binding,
      ),
    };
    const rig = {
      ...baseRig,
      activeAngle: "front" as const,
      angles: { ...baseRig.angles, front: movedFrontRig },
      bones: movedFrontRig.bones,
      slotBindings: movedFrontRig.slotBindings,
      drawOrder: movedFrontRig.drawOrder,
      slotRelations: movedFrontRig.slotRelations,
      hostConstraints: movedFrontRig.hostConstraints,
      reaches: movedFrontRig.reaches,
      sockets: movedFrontRig.sockets,
    };
    const rigCharacter = { ...character, rig };
    const runtime = buildCharacterRuntime(rigCharacter);
    const irisSlot = runtime.slotById.get("slot:left-iris");
    const eyeSlot = runtime.slotById.get("slot:left-eye");
    if (!irisSlot || !eyeSlot) throw new Error("Expected eye and iris slots.");
    const irisPart = resolveRuntimeSlotPart(irisSlot, runtime);
    const eyePart = resolveRuntimeSlotPart(eyeSlot, runtime, "open");
    if (!irisPart || !eyePart) throw new Error("Expected eye and iris parts.");
    const irisPlacement = runtimePartPlacement(irisSlot, irisPart, runtime, {
      basePart: irisPart,
    });
    const eyePlacement = runtimePartPlacement(eyeSlot, eyePart, runtime, { basePart: eyePart });
    const expectedLeft = cssNumber(irisPlacement.x - eyePlacement.x);
    const expectedTop = cssNumber(irisPlacement.y - eyePlacement.y);

    const html = buildCharacterCompositionHtml({
      compositionId: "char_iris_runtime_nested",
      clipId: "clip-iris-runtime-nested",
      width: character.canvasWidth,
      height: character.canvasHeight,
      duration: 4,
      character: rigCharacter,
      meta: {
        characterId: "eye-char",
        poses: {},
        autoBlink: false,
      },
      motionPresets: new Map(),
    });
    const payload = extractPixiPayload(html);
    const irisNode = payload.scene.nodes[payload.scene.partNodeIds["left-iris"]];
    const eyeNode = payload.scene.nodes[payload.scene.partNodeIds["eye-open"]];

    // Scene placement follows the moved socket binding, not the raw art offset.
    expect(irisNode?.placement?.x).toBeCloseTo(irisPlacement.x, 3);
    expect(irisNode?.placement?.y).toBeCloseTo(irisPlacement.y, 3);
    expect((irisNode?.placement?.x ?? 0) - (eyeNode?.placement?.x ?? 0)).toBeCloseTo(
      Number(expectedLeft),
      3,
    );
    expect((irisNode?.placement?.y ?? 0) - (eyeNode?.placement?.y ?? 0)).toBeCloseTo(
      Number(expectedTop),
      3,
    );
  });

  it("keeps nested iris slot motion on the iris target in compiled playback", () => {
    const characterBase = {
      ...createBlankCharacter("Eye actor"),
      id: "eye-char",
      parts: [
        makePart("body", "body-media", {
          id: "body",
          slotId: "role:body",
          x: 80,
          y: 130,
          width: 180,
          height: 280,
          zIndex: 1,
        }),
        makePart("head", "head-media", {
          id: "head",
          slotId: "role:head",
          x: 110,
          y: 70,
          width: 120,
          height: 120,
          zIndex: 4,
        }),
        makePart("eye", "eye-open-media", {
          id: "eye-open",
          slotId: "slot:left-eye",
          side: "left",
          eyeState: "open",
          x: 140,
          y: 112,
          width: 32,
          height: 20,
          zIndex: 6,
        }),
        makePart("eye", "eye-closed-media", {
          id: "eye-closed",
          slotId: "slot:left-eye",
          side: "left",
          eyeState: "closed",
          x: 140,
          y: 116,
          width: 32,
          height: 8,
          zIndex: 6,
        }),
        makePart("iris", "iris-media", {
          id: "left-iris",
          slotId: "slot:left-iris",
          side: "left",
          x: 152,
          y: 116,
          width: 8,
          height: 8,
          zIndex: 7,
        }),
      ],
    };
    const preset: MotionPreset = {
      id: "iris-look",
      name: "Iris look",
      category: "expression",
      duration: 1,
      loop: false,
      tracks: [],
      keyposes: [
        {
          t: 0,
          parts: [{ partRole: "iris", slotId: "slot:left-iris", dx: 10, dy: 4 }],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = buildCharacterCompositionHtml({
      compositionId: "char_iris_motion",
      clipId: "clip-iris-motion",
      width: characterBase.canvasWidth,
      height: characterBase.canvasHeight,
      duration: 1,
      character: { ...characterBase, rig: buildDefaultRig(characterBase) },
      meta: {
        characterId: "eye-char",
        poses: {},
        autoBlink: false,
        motions: [{ id: "applied-iris", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      motionPresets: new Map([[preset.id, preset]]),
    });
    const scene = extractScene(html);
    const irisTarget = scene.initialTargets.find((target) =>
      target.selector.includes("char-slot-slot-left-iris"),
    );

    expect(irisTarget?.vars.x).toBe(10);
    expect(irisTarget?.vars.y).toBe(4);
  });

  it("keeps eye size changes on the eye target in compiled playback", () => {
    const preset: MotionPreset = {
      id: "eye-size",
      name: "Eye size",
      category: "expression",
      duration: 1,
      loop: false,
      tracks: [],
      keyposes: [
        {
          t: 0,
          parts: [
            {
              partRole: "eye",
              slotId: "slot:left-eye",
              scale: 1.5,
              scaleX: 0.8,
              scaleY: 0.6,
            },
          ],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = build(
      {
        autoBlink: false,
        motions: [{ id: "applied-eye-size", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      new Map([[preset.id, preset]]),
    );
    const scene = extractScene(html);
    const eyeTarget = scene.initialTargets.find((target) =>
      target.selector.includes("char-slot-slot-left-eye"),
    );

    expect(eyeTarget?.vars.scaleX).toBe(1.2);
    expect(eyeTarget?.vars.scaleY).toBe(0.9);
  });

  it("renders any nested child slot through slotRelations and parent variant gates", () => {
    const characterBase = {
      ...createBlankCharacter("Mouth child actor"),
      id: "mouth-child-char",
      parts: [
        makePart("body", "body-media", {
          id: "body",
          slotId: "role:body",
          x: 80,
          y: 130,
          width: 180,
          height: 280,
          zIndex: 1,
        }),
        makePart("mouth", "mouth-rest-media", {
          id: "mouth-rest",
          slotId: "role:mouth",
          viseme: "rest",
          x: 120,
          y: 180,
          width: 70,
          height: 32,
          zIndex: 6,
        }),
        makePart("mouth", "mouth-a-media", {
          id: "mouth-a",
          slotId: "role:mouth",
          viseme: "A",
          x: 120,
          y: 180,
          width: 70,
          height: 50,
          zIndex: 6,
        }),
        makePart("custom", "tongue-media", {
          id: "tongue",
          slotId: "slot:tongue",
          slotName: "Tongue",
          x: 140,
          y: 202,
          width: 28,
          height: 16,
          zIndex: 7,
        }),
      ],
    };
    const defaultRig = buildDefaultRig(characterBase);
    const rig = {
      ...defaultRig,
      slotRelations: [
        ...defaultRig.slotRelations.filter((relation) => relation.childSlotId !== "slot:tongue"),
        {
          id: "relation:tongue-mouth-a",
          childSlotId: "slot:tongue",
          parentRef: { type: "slot" as const, id: "role:mouth" },
          relationType: "containedFeature" as const,
          activeWhenParentVariant: { keys: ["A"] },
          transformMode: "inheritParent" as const,
          visibilityMode: "withParentVariant" as const,
          renderMode: "nested" as const,
          clipMode: "none" as const,
        },
      ],
      angles: Object.fromEntries(
        Object.entries(defaultRig.angles ?? {}).map(([angle, angleRig]) => [
          angle,
          angleRig
            ? {
                ...angleRig,
                slotRelations: [
                  ...angleRig.slotRelations.filter(
                    (relation) => relation.childSlotId !== "slot:tongue",
                  ),
                  {
                    id: "relation:tongue-mouth-a",
                    childSlotId: "slot:tongue",
                    parentRef: { type: "slot" as const, id: "role:mouth" },
                    relationType: "containedFeature" as const,
                    activeWhenParentVariant: { keys: ["A"] },
                    transformMode: "inheritParent" as const,
                    visibilityMode: "withParentVariant" as const,
                    renderMode: "nested" as const,
                    clipMode: "none" as const,
                  },
                ],
              }
            : angleRig,
        ]),
      ),
    };
    const html = buildCharacterCompositionHtml({
      compositionId: "char_mouth_child",
      clipId: "clip-mouth-child",
      width: 300,
      height: 450,
      duration: 4,
      character: { ...characterBase, rig },
      meta: {
        characterId: "mouth-child-char",
        poses: {},
        autoBlink: false,
      },
      motionPresets: new Map(),
    });

    const payload = extractPixiPayload(html);
    const tongueBoneId = payload.scene.boneNodeIds["bone:slot:tongue"];
    expect(payload.scene.nodes[tongueBoneId]?.parentId).toBe(
      payload.scene.boneNodeIds["bone:role:mouth"],
    );
    expect(payload.scene.nodes[payload.scene.slotNodeIds["slot:tongue"]]?.parentId).toBe(
      tongueBoneId,
    );
    // Parent variant swaps re-anchor the nested child.
    const mouthEvents = payload.timelineScene.slotEvents.filter(
      (event) => event.slotId === "role:mouth",
    );
    expect(mouthEvents.length).toBeGreaterThan(0);
    expect(
      mouthEvents.every((event) =>
        event.boneAnchors?.some((anchor) => anchor.sceneNodeId === tongueBoneId),
      ),
    ).toBe(true);
  });

  it("emits nested rig, host, depth, angle, and draw-order metadata", () => {
    const characterBase = {
      ...createBlankCharacter("Rig actor"),
      id: "rig-char",
      angles: ["front", "3qL"] as CharacterPreset["angles"],
      parts: [
        makePart("body", "body-media", {
          id: "body",
          slotId: "role:body",
          x: 80,
          y: 130,
          width: 180,
          height: 280,
          zIndex: 1,
        }),
        makePart("head", "head-media", {
          id: "head",
          slotId: "role:head",
          x: 110,
          y: 70,
          width: 120,
          height: 120,
          zIndex: 4,
        }),
        makePart("eye", "eye-media", {
          id: "eye",
          slotId: "slot:left-eye",
          side: "left",
          eyeState: "open",
          x: 140,
          y: 112,
          width: 32,
          height: 20,
          zIndex: 6,
          depth: 5,
        }),
      ],
    };
    const rig = buildDefaultRig(characterBase);
    const threeQuarterRig = rig.angles?.["3qL"];
    const character = {
      ...characterBase,
      rig: {
        ...rig,
        activeAngle: "3qL" as const,
        angles: {
          ...rig.angles,
          "3qL": threeQuarterRig
            ? {
                ...threeQuarterRig,
                slotBindings: threeQuarterRig.slotBindings.map((binding) =>
                  binding.slotId === "slot:left-eye" ? { ...binding, depth: 7 } : binding,
                ),
              }
            : threeQuarterRig,
        },
      },
    };
    const html = buildCharacterCompositionHtml({
      compositionId: "char_rig_meta",
      clipId: "clip-rig-meta",
      width: 300,
      height: 450,
      duration: 4,
      character,
      meta: {
        characterId: "rig-char",
        poses: {},
        autoBlink: false,
      },
      motionPresets: new Map(),
    });

    expect(html).toContain('data-character-angle="3qL"');
    const payload = extractPixiPayload(html);
    expect(payload.scene.angle).toBe("3qL");
    const headBone = payload.scene.nodes[payload.scene.boneNodeIds["bone:role:head"]];
    expect(headBone?.parentId).toBe(payload.scene.boneNodeIds["bone:role:body"]);
    const eyeSlot = payload.scene.nodes[payload.scene.slotNodeIds["slot:left-eye"]];
    expect(eyeSlot?.boneId).toBe("bone:slot:left-eye");
    expect(eyeSlot?.parentId).toBe(payload.scene.boneNodeIds["bone:slot:left-eye"]);
    // The 3qL angle override drives the bound depth (host masks are a Pixi roadmap item).
    expect(eyeSlot?.depth).toBe(7);
    expect(typeof eyeSlot?.drawOrder).toBe("number");
  });

  it("uses an active angle part override for slot variants", () => {
    const characterBase = {
      ...createBlankCharacter("Angle actor"),
      id: "angle-char",
      angles: ["front", "3qL"] as CharacterPreset["angles"],
      parts: [
        makePart("body", "body-front-media", {
          id: "body-front",
          slotId: "role:body",
          pose: "front",
          x: 80,
          y: 120,
          width: 180,
          height: 280,
          zIndex: 1,
        }),
        makePart("body", "body-3ql-media", {
          id: "body-3ql",
          slotId: "role:body",
          pose: "3qL",
          x: 82,
          y: 120,
          width: 176,
          height: 280,
          zIndex: 1,
        }),
      ],
    };
    const rig = buildDefaultRig(characterBase);
    const html = buildCharacterCompositionHtml({
      compositionId: "char_angle_variant",
      clipId: "clip-angle-variant",
      width: 300,
      height: 450,
      duration: 4,
      character: {
        ...characterBase,
        rig: {
          ...rig,
          activeAngle: "3qL",
          slotBindings: rig.slotBindings.map((binding) =>
            binding.slotId === "role:body"
              ? { ...binding, angleOverrides: { "3qL": { partId: "body-3ql" } } }
              : binding,
          ),
        },
      },
      meta: {
        characterId: "angle-char",
        poses: {},
        autoBlink: false,
      },
      motionPresets: new Map(),
    });
    const scene = extractScene(html);

    expect(scene.slotEvents.some((event) => eventShowsVariant(event, "3qL"))).toBe(true);
    expect(html).toContain('"assetRef":"asset:body-3ql-media"');
  });

  it("renders active-angle images while preserving shared slot art", () => {
    const characterBase = {
      ...createBlankCharacter("Angle art actor"),
      id: "angle-art-char",
      angles: ["front", "sideL"] as CharacterPreset["angles"],
      parts: [
        makePart("body", "body-front-media", {
          id: "body-front",
          slotId: "role:body",
          angleIds: ["front"],
          x: 80,
          y: 120,
          width: 180,
          height: 280,
          zIndex: 1,
        }),
        makePart("body", "body-side-media", {
          id: "body-side",
          slotId: "role:body",
          angleIds: ["sideL"],
          x: 88,
          y: 120,
          width: 150,
          height: 280,
          zIndex: 1,
        }),
        makePart("hand", "shared-hand-media", {
          id: "shared-hand",
          slotId: "slot:left-hand",
          side: "left",
          x: 56,
          y: 270,
          width: 64,
          height: 80,
          zIndex: 4,
        }),
      ],
    };
    const rig = buildDefaultRig(characterBase, "sideL");
    const html = buildCharacterCompositionHtml({
      compositionId: "char_angle_art",
      clipId: "clip-angle-art",
      width: 300,
      height: 450,
      duration: 4,
      character: {
        ...characterBase,
        rig,
      },
      meta: {
        characterId: "angle-art-char",
        poses: {},
        autoBlink: false,
      },
      motionPresets: new Map(),
    });

    expect(html).toContain('"assetRef":"asset:body-side-media"');
    expect(html).not.toContain('"assetRef":"asset:body-front-media"');
    expect(html).toContain('"assetRef":"asset:shared-hand-media"');
  });

  it("targets bone groups for bone-aware motion while descendants inherit through scene nesting", () => {
    const character = {
      ...createBlankCharacter("Walker"),
      id: "walker-char",
      parts: [
        makePart("body", "body-media", {
          id: "body",
          slotId: "role:body",
          x: 100,
          y: 120,
          width: 180,
          height: 260,
          zIndex: 1,
        }),
        makePart("leg", "leg-media", {
          id: "left-leg",
          slotId: "slot:left-leg",
          side: "left",
          x: 120,
          y: 350,
          width: 44,
          height: 140,
          zIndex: 0,
        }),
        makePart("foot", "foot-media", {
          id: "left-foot",
          slotId: "slot:left-foot",
          side: "left",
          x: 120,
          y: 480,
          width: 72,
          height: 32,
          zIndex: 0,
        }),
      ],
    };
    const preset: MotionPreset = {
      id: "kick",
      name: "Kick",
      category: "gesture",
      region: "lowerBody",
      duration: 1,
      loop: false,
      tracks: [
        {
          target: "bone",
          boneId: "bone:slot:left-leg",
          partRole: "leg",
          keyframes: [
            { t: 0, rotation: 0, ease: "linear" },
            { t: 1, rotation: -30, ease: "linear" },
          ],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = buildCharacterCompositionHtml({
      compositionId: "char_bone_motion",
      clipId: "clip-bone-motion",
      width: 300,
      height: 450,
      duration: 2,
      character,
      meta: {
        characterId: "walker-char",
        poses: {},
        autoBlink: false,
        motions: [{ id: "applied-kick", presetId: "kick", offset: 0, intensity: 1 }],
      },
      motionPresets: new Map([["kick", preset]]),
    });
    const payload = extractPixiPayload(html);
    const legBoneId = payload.scene.boneNodeIds["bone:slot:left-leg"];
    const footBoneId = payload.scene.boneNodeIds["bone:slot:left-foot"];
    const animatedNodeIds = payload.timelineScene.motionSegments.flatMap((segment) =>
      segment.targets.map((target) => target.sceneNodeId),
    );

    // The foot inherits the kick through scene-graph nesting under the leg bone,
    // so motion targets only the leg bone node.
    expect(payload.scene.nodes[footBoneId]?.parentId).toBe(legBoneId);
    expect(animatedNodeIds).toContain(legBoneId);
    expect(animatedNodeIds).not.toContain(footBoneId);
    expect(animatedNodeIds).not.toContain(payload.scene.slotNodeIds["slot:left-foot"]);
  });

  it("locks child bone translation when compiled motion also animates an ancestor bone", () => {
    const preset: MotionPreset = {
      id: "bad-fk-drift",
      name: "Bad FK drift",
      category: "gesture",
      duration: 1,
      loop: false,
      tracks: [
        {
          target: "bone",
          boneId: "bone:role:body",
          partRole: "body",
          keyframes: [
            { t: 0, rotation: 0, ease: "linear" },
            { t: 1, rotation: 10, ease: "linear" },
          ],
        },
        {
          target: "bone",
          boneId: "bone:slot:right-arm",
          partRole: "arm",
          slotId: "slot:right-arm",
          keyframes: [
            { t: 0, dx: 0, dy: 0, rotation: 0, ease: "linear" },
            { t: 1, dx: 40, dy: -20, rotation: 30, ease: "linear" },
          ],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = build(
      {
        autoBlink: false,
        motions: [{ id: "applied-bad-fk", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      new Map([[preset.id, preset]]),
      makeVariantArmCharacter(),
    );
    const scene = extractScene(html);
    const armVars = [
      ...scene.initialTargets,
      ...scene.motionSegments.flatMap((segment) => segment.targets),
    ]
      .filter((target) => target.selector.startsWith("#char-bone-bone-slot-right-arm"))
      .map((target) => target.vars);

    expect(armVars.length).toBeGreaterThan(0);
    expect(armVars.every((vars) => vars.x === 0)).toBe(true);
    expect(armVars.every((vars) => vars.y === 0)).toBe(true);
    expect(Math.max(...armVars.map((vars) => Number(vars.rotation)))).toBe(30);
  });

  it("lets an explicit bone allowOutOfBounds entry bypass FK translation locking", () => {
    const preset: MotionPreset = {
      id: "free-fk-drift",
      name: "Free FK drift",
      category: "gesture",
      duration: 1,
      loop: false,
      allowOutOfBounds: ["bone:slot:right-arm"],
      tracks: [
        {
          target: "bone",
          boneId: "bone:role:body",
          partRole: "body",
          keyframes: [
            { t: 0, rotation: 0, ease: "linear" },
            { t: 1, rotation: 10, ease: "linear" },
          ],
        },
        {
          target: "bone",
          boneId: "bone:slot:right-arm",
          partRole: "arm",
          slotId: "slot:right-arm",
          keyframes: [
            { t: 0, dx: 0, dy: 0, ease: "linear" },
            { t: 1, dx: 40, dy: -20, ease: "linear" },
          ],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = build(
      {
        autoBlink: false,
        motions: [{ id: "applied-free-fk", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      new Map([[preset.id, preset]]),
      makeVariantArmCharacter(),
    );
    const scene = extractScene(html);
    const armVars = [
      ...scene.initialTargets,
      ...scene.motionSegments.flatMap((segment) => segment.targets),
    ]
      .filter((target) => target.selector.startsWith("#char-bone-bone-slot-right-arm"))
      .map((target) => target.vars);

    expect(Math.max(...armVars.map((vars) => Number(vars.x)))).toBe(20);
    expect(Math.min(...armVars.map((vars) => Number(vars.y)))).toBe(-10);
  });

  it("emits 3D transform vars (rotationY + transformPerspective) for a 3D bone motion", () => {
    const character = {
      ...createBlankCharacter("Flipper"),
      id: "flipper-char",
      parts: [
        makePart("body", "body-media", {
          id: "body",
          slotId: "role:body",
          x: 100,
          y: 120,
          width: 180,
          height: 260,
          zIndex: 1,
        }),
        makePart("leg", "leg-media", {
          id: "left-leg",
          slotId: "slot:left-leg",
          side: "left",
          x: 120,
          y: 350,
          width: 44,
          height: 140,
          zIndex: 0,
        }),
      ],
    };
    const preset: MotionPreset = {
      id: "cardflip",
      name: "Card Flip",
      category: "gesture",
      region: "lowerBody",
      duration: 1,
      loop: false,
      tracks: [
        {
          target: "bone",
          boneId: "bone:slot:left-leg",
          partRole: "leg",
          keyframes: [
            { t: 0, rotationY: 0, transformPerspective: 800, ease: "linear" },
            { t: 1, rotationY: 360, transformPerspective: 800, ease: "linear" },
          ],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = buildCharacterCompositionHtml({
      compositionId: "char_cardflip",
      clipId: "clip-cardflip",
      width: 300,
      height: 450,
      duration: 2,
      character,
      meta: {
        characterId: "flipper-char",
        poses: {},
        autoBlink: false,
        motions: [{ id: "applied-flip", presetId: "cardflip", offset: 0, intensity: 1 }],
      },
      motionPresets: new Map([["cardflip", preset]]),
    });
    const scene = extractScene(html);
    const allTargets = [
      ...scene.initialTargets,
      ...scene.motionSegments.flatMap((segment) => segment.targets),
    ];
    // 3D vars must reach the GSAP timeline, and the flip animates all the way to 360°.
    expect(allTargets.some((target) => typeof target.vars.rotationY === "number")).toBe(true);
    expect(allTargets.some((target) => target.vars.transformPerspective === 800)).toBe(true);
    expect(allTargets.some((target) => target.vars.rotationY === 360)).toBe(true);
  });

  it("keeps generated ids unique when slot ids sanitize to the same text", () => {
    const character = {
      ...createBlankCharacter("Actor"),
      id: "char-collision",
      parts: [
        makePart("body", "body-colon-media", {
          id: "body-colon",
          slotId: "slot:body",
          pose: "idle",
          x: 80,
          y: 100,
          zIndex: 1,
        }),
        makePart("body", "body-hyphen-media", {
          id: "body-hyphen",
          slotId: "slot-body",
          pose: "idle",
          x: 160,
          y: 120,
          zIndex: 2,
        }),
      ],
    };
    const html = buildCharacterCompositionHtml({
      compositionId: "char_collision",
      clipId: "clip-collision",
      width: 300,
      height: 450,
      duration: 4,
      character,
      meta: {
        characterId: "char-collision",
        poses: {},
        autoBlink: false,
      },
      motionPresets: new Map(),
    });
    const payload = extractPixiPayload(html);

    // The runtime canonicalizes "slot:body" to the body role slot; both slots
    // must exist as distinct scene nodes with disjoint generated id pools.
    expect(payload.scene.slotNodeIds["role:body"]).toBeTruthy();
    expect(payload.scene.slotNodeIds["slot-body"]).toBeTruthy();
    const partNodeIds = Object.values(payload.scene.partNodeIds);
    expect(new Set(partNodeIds).size).toBe(partNodeIds.length);
    const idsBySlot = new Map<string, Set<string>>();
    for (const event of payload.timelineScene.slotEvents) {
      const set = idsBySlot.get(event.slotId) ?? new Set<string>();
      for (const id of [...(event.variant?.hide ?? []), ...(event.variant?.show ?? [])])
        set.add(id);
      idsBySlot.set(event.slotId, set);
    }
    const colonIds = idsBySlot.get("role:body") ?? new Set<string>();
    const hyphenIds = idsBySlot.get("slot-body") ?? new Set<string>();
    expect(colonIds.size).toBeGreaterThan(0);
    expect(hyphenIds.size).toBeGreaterThan(0);
    for (const id of colonIds) expect(hyphenIds.has(id)).toBe(false);
  });

  it("uses mouth variants by default when a generated rig also exists", () => {
    const character = {
      ...makeCharacter(),
      mouthRig: createDefaultMouthRig("natural", {
        x: 190,
        y: 250,
        width: 150,
        height: 70,
        zIndex: 5,
      }),
    };
    const html = buildCharacterCompositionHtml({
      compositionId: "char_mouth_variants",
      clipId: "clip-mouth-variants",
      width: 300,
      height: 450,
      duration: 4,
      character,
      meta: {
        characterId: "char-1",
        poses: {},
        autoBlink: false,
      },
      motionPresets: new Map(),
    });
    const scene = extractScene(html);
    const payload = extractPixiPayload(html);

    expect(payload.scene.partNodeIds["mouth-rest"]).toBeTruthy();
    expect(html).not.toContain("generatedMouth");
    expect(scene.slotEvents.some((event) => event.slotId === "role:mouth" && event.variant)).toBe(
      true,
    );
  });

  it("serializes speech audio, viseme swaps, and finite applied motion data", () => {
    const preset: MotionPreset = {
      id: "motion-1",
      name: "Body dip",
      category: "gesture",
      duration: 1,
      loop: false,
      tracks: [
        {
          partRole: "body",
          keyframes: [
            { t: 0, dy: 0 },
            { t: 1, dy: 24 },
          ],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = build(
      {
        lipSyncAudioId: "voice-audio",
        visemes: [
          { t: 0, v: "rest" },
          { t: 0.3, v: "A" },
        ],
        motions: [{ id: "applied-1", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      new Map([[preset.id, preset]]),
    );

    expect(html).toContain('data-character-speech="true"');
    expect(html).toContain('src="asset:voice-audio"');
    expect(html).toContain("slotEvents");
    expect(html).toContain("motionSegments");
    expect(html).toContain('"y":12');
  });

  it("emits one audio per speech at its own start time", () => {
    const html = buildCharacterCompositionHtml({
      compositionId: "char_clip-1",
      clipId: "clip-1",
      width: 300,
      height: 450,
      duration: 10,
      character: makeCharacter(),
      meta: { characterId: "char-1", poses: {}, autoBlink: false },
      motionPresets: new Map(),
      speeches: [
        { audioId: "voice-a", start: 0, duration: 2, visemes: [{ t: 0.4, v: "A" }] },
        { audioId: "voice-b", start: 4, duration: 3, visemes: [{ t: 0.4, v: "O" }] },
      ],
    });

    expect((html.match(/data-character-speech="true"/g) ?? []).length).toBe(2);
    expect(html).toContain('src="asset:voice-a"');
    expect(html).toContain('src="asset:voice-b"');
    // Second speech sits at its start offset, not at 0.
    expect(html).toContain('data-start="4"');
  });

  it("allows time-overlapping speeches (distinct track lanes, no composition error)", () => {
    // buildCharacterCompositionHtml runs @hyperframes/core validation and throws if
    // the HTML is invalid — so a successful build proves overlapping audio is fine.
    const html = buildCharacterCompositionHtml({
      compositionId: "char_clip-1",
      clipId: "clip-1",
      width: 300,
      height: 450,
      duration: 10,
      character: makeCharacter(),
      meta: { characterId: "char-1", poses: {}, autoBlink: false },
      motionPresets: new Map(),
      speeches: [
        { audioId: "voice-a", start: 0, duration: 6, visemes: [{ t: 1, v: "A" }] },
        { audioId: "voice-b", start: 3, duration: 6, visemes: [{ t: 1, v: "O" }] }, // overlaps A
      ],
    });

    expect((html.match(/data-character-speech="true"/g) ?? []).length).toBe(2);
    // Each clip on its own track lane, so overlapping in time is not a same-track clash.
    expect(html).toContain('data-track-index="0"');
    expect(html).toContain('data-track-index="1"');
  });

  it("emits data-volume on a speech below full volume, none at 1", () => {
    const html = buildCharacterCompositionHtml({
      compositionId: "char_clip-1",
      clipId: "clip-1",
      width: 300,
      height: 450,
      duration: 10,
      character: makeCharacter(),
      meta: { characterId: "char-1", poses: {}, autoBlink: false },
      motionPresets: new Map(),
      speeches: [
        { audioId: "voice-quiet", start: 0, duration: 3, visemes: [{ t: 1, v: "A" }], volume: 0.4 },
        { audioId: "voice-full", start: 4, duration: 3, visemes: [{ t: 1, v: "O" }], volume: 1 },
      ],
    });

    expect(html).toContain('data-volume="0.4"');
    // Full-volume speech omits data-volume (matches the core generator's rule).
    expect(html).not.toContain('data-volume="1"');
  });

  it("emits data-media-start on a trimmed (in-pointed) speech, none at 0", () => {
    const html = buildCharacterCompositionHtml({
      compositionId: "char_clip-1",
      clipId: "clip-1",
      width: 300,
      height: 450,
      duration: 10,
      character: makeCharacter(),
      meta: { characterId: "char-1", poses: {}, autoBlink: false },
      motionPresets: new Map(),
      speeches: [
        // In-point 1.5s into the source, plays for 2s.
        {
          audioId: "voice-trim",
          start: 0,
          duration: 2,
          visemes: [{ t: 1, v: "A" }],
          mediaStartTime: 1.5,
        },
        { audioId: "voice-head", start: 4, duration: 2, visemes: [{ t: 0.4, v: "O" }] },
      ],
    });

    expect(html).toContain('data-media-start="1.5"');
    // The untrimmed speech omits data-media-start.
    expect((html.match(/data-media-start=/g) ?? []).length).toBe(1);
  });

  it("clamps a trimmed speech's audio duration to the trimmed length", () => {
    const html = buildCharacterCompositionHtml({
      compositionId: "char_clip-1",
      clipId: "clip-1",
      width: 300,
      height: 450,
      duration: 10,
      character: makeCharacter(),
      meta: { characterId: "char-1", poses: {}, autoBlink: false },
      motionPresets: new Map(),
      speeches: [
        // Full source is 8s, but trimmed to play only 3s from an in-point of 2s.
        {
          audioId: "voice-trim",
          start: 1,
          duration: 3,
          visemes: [{ t: 2.5, v: "A" }],
          mediaStartTime: 2,
        },
      ],
    });

    // The emitted <audio> plays the trimmed length, not the full source.
    expect(html).toMatch(/data-character-speech="true"[^>]*data-duration="3"/);
    expect(html).toMatch(/data-character-speech="true"[^>]*data-media-start="2"/);
  });

  it("matches expression recorder face turns in the generated timeline", () => {
    const preset: MotionPreset = {
      id: "expression-turn",
      name: "Look right",
      category: "expression",
      duration: 1,
      loop: false,
      tracks: [],
      keyposes: [
        { t: 0, faceTurnX: 1, parts: [] },
        { t: 1, faceTurnX: 1, parts: [] },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = build(
      {
        autoBlink: false,
        motions: [{ id: "applied-turn", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      new Map([[preset.id, preset]]),
    );
    const scene = extractScene(html);

    expect(
      scene.initialTargets.some(
        (target) => target.selector.includes("left-eye") && target.vars.skewY === -2,
      ),
    ).toBe(true);
  });

  it("lets expression mouth variant swaps drive the mouth when lip sync is inactive", () => {
    const preset: MotionPreset = {
      id: "expression-mouth",
      name: "Raspberry",
      category: "expression",
      duration: 1,
      loop: false,
      tracks: [],
      keyposes: [
        {
          t: 0,
          parts: [{ partRole: "mouth", slotId: "role:mouth", poseSwap: "raspberry" }],
        },
        {
          t: 1,
          parts: [{ partRole: "mouth", slotId: "role:mouth", poseSwap: "raspberry" }],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = build(
      {
        autoBlink: false,
        motions: [{ id: "applied-mouth", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      new Map([[preset.id, preset]]),
    );
    const scene = extractScene(html);
    const mouthTarget = scene.initialTargets.find((target) =>
      target.selector.includes("role-mouth"),
    );

    expect(extractPixiPayload(html).scene.partNodeIds["mouth-raspberry"]).toBeTruthy();
    expect(scene.slotEvents.some((event) => eventShowsVariant(event, "raspberry"))).toBe(true);
    expect(mouthTarget?.vars.transformOrigin).toBe("61.111% 59.524%");
  });

  it("lets generic slot variants drive hand swaps without pose fields", () => {
    const base = makeCharacter();
    const character: CharacterPreset = {
      ...base,
      parts: [
        ...base.parts,
        makePart("hand", "hand-open-media", {
          id: "hand-open",
          slotId: "slot:right-hand",
          slotName: "Right hand",
          side: "right",
          variant: { key: "open", name: "Open hand", kind: "handShape" },
          x: 236,
          y: 320,
          width: 52,
          height: 58,
          zIndex: 8,
        }),
        makePart("hand", "hand-fist-media", {
          id: "hand-fist",
          slotId: "slot:right-hand",
          slotName: "Right hand",
          side: "right",
          variant: { key: "fist", name: "Fist", kind: "handShape" },
          x: 236,
          y: 320,
          width: 52,
          height: 58,
          zIndex: 8,
        }),
      ],
    };
    const preset: MotionPreset = {
      id: "generic-hand",
      name: "Make fist",
      category: "gesture",
      duration: 1,
      loop: false,
      tracks: [],
      keyposes: [
        {
          t: 0,
          parts: [{ partRole: "hand", slotId: "slot:right-hand", poseSwap: "fist" }],
        },
        {
          t: 1,
          parts: [{ partRole: "hand", slotId: "slot:right-hand", poseSwap: "fist" }],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = build(
      {
        autoBlink: false,
        motions: [{ id: "applied-hand", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      new Map([[preset.id, preset]]),
      character,
    );
    const scene = extractScene(html);

    const fistNode = Object.values(extractPixiPayload(html).scene.nodes).find(
      (node) => node.variantKey === "fist",
    );
    expect(fistNode).toBeTruthy();
    expect(scene.slotEvents.some((event) => eventShowsVariant(event, "fist"))).toBe(true);
  });

  it("shows every artwork layer that belongs to the active generic variant", () => {
    const base = makeCharacter();
    const character: CharacterPreset = {
      ...base,
      parts: [
        ...base.parts,
        makePart("arm", "upper-arm-open-media", {
          id: "upper-arm-open",
          slotId: "slot:right-arm",
          slotName: "Right arm",
          side: "right",
          variant: { key: "explaining", name: "Explaining arm", kind: "pose" },
          x: 220,
          y: 270,
          width: 48,
          height: 96,
          zIndex: 7,
        }),
        makePart("arm", "forearm-open-media", {
          id: "forearm-open",
          slotId: "slot:right-arm",
          slotName: "Right arm",
          side: "right",
          variant: { key: "explaining", name: "Explaining arm", kind: "pose" },
          x: 256,
          y: 330,
          width: 72,
          height: 42,
          zIndex: 8,
        }),
      ],
    };
    const preset: MotionPreset = {
      id: "explaining-arm",
      name: "Explaining arm",
      category: "gesture",
      duration: 1,
      loop: false,
      tracks: [],
      keyposes: [
        {
          t: 0,
          parts: [{ partRole: "arm", slotId: "slot:right-arm", poseSwap: "explaining" }],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = build(
      {
        autoBlink: false,
        motions: [{ id: "applied-arm", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      new Map([[preset.id, preset]]),
      character,
    );
    const scene = extractScene(html);
    const event = scene.slotEvents.find((candidate) => candidate.key === "explaining");

    expect(event?.variant?.show?.filter((id) => id.includes("explaining"))).toHaveLength(2);
  });

  it("lets expression mouth swaps continue when speech audio has no viseme timing", () => {
    const preset: MotionPreset = {
      id: "expression-mouth",
      name: "Raspberry",
      category: "expression",
      duration: 1,
      loop: false,
      tracks: [],
      keyposes: [
        {
          t: 0,
          parts: [{ partRole: "mouth", slotId: "role:mouth", poseSwap: "raspberry" }],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = build(
      {
        autoBlink: false,
        lipSyncAudioId: "imported-voice-audio",
        motions: [{ id: "applied-mouth", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      new Map([[preset.id, preset]]),
    );
    const scene = extractScene(html);

    expect(html).toContain('data-character-speech="true"');
    expect(html).toContain('src="asset:imported-voice-audio"');
    expect(scene.slotEvents.some((event) => eventShowsVariant(event, "raspberry"))).toBe(true);
  });

  it("keeps lip sync in charge of mouth variant swaps when voice visemes exist", () => {
    const preset: MotionPreset = {
      id: "expression-mouth",
      name: "Raspberry",
      category: "expression",
      duration: 1,
      loop: false,
      tracks: [],
      keyposes: [
        {
          t: 0,
          parts: [{ partRole: "mouth", slotId: "role:mouth", poseSwap: "raspberry" }],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = build(
      {
        autoBlink: false,
        lipSyncAudioId: "voice-audio",
        visemes: [{ t: 0, v: "A" }],
        motions: [{ id: "applied-mouth", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      new Map([[preset.id, preset]]),
    );
    const scene = extractScene(html);

    expect(scene.slotEvents.some((event) => eventShowsVariant(event, "raspberry"))).toBe(false);
  });

  it("does not let auto blink override an active expression eye pose", () => {
    const preset: MotionPreset = {
      id: "expression-eye",
      name: "Closed eyes",
      category: "expression",
      duration: 10,
      loop: false,
      tracks: [],
      keyposes: [
        {
          t: 0,
          parts: [{ partRole: "eye", slotId: "slot:left-eye", poseSwap: "closed" }],
        },
        {
          t: 10,
          parts: [{ partRole: "eye", slotId: "slot:left-eye", poseSwap: "closed" }],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const clipId = "clip-blink-expression";
    expect(
      blinkWindowsForClip({ id: clipId, duration: 10, autoBlink: true }).length,
    ).toBeGreaterThan(0);
    const html = buildCharacterCompositionHtml({
      compositionId: "char_blink_expression",
      clipId,
      width: 300,
      height: 450,
      duration: 10,
      character: makeCharacter(),
      meta: {
        characterId: "char-1",
        poses: {},
        autoBlink: true,
        motions: [{ id: "applied-eye", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      motionPresets: new Map([[preset.id, preset]]),
    });
    const scene = extractScene(html);

    expect(scene.slotEvents.some((event) => eventShowsVariant(event, "closed"))).toBe(true);
    expect(scene.slotEvents.every((event) => event.key !== "open")).toBe(true);
  });
});

describe("parent variant bone anchors", () => {
  // Canvas 600x900 rendered at 300x450 → scale 0.5. Hand bone base anchor is
  // (10, 175) canvas px (straight hand pivot − arm pivot); the bent arm carries
  // it to (80, 60). Scaled: base (5, 87.5), bent (40, 30).
  const bentArmPreset: MotionPreset = {
    id: "bend-arm",
    name: "Bend arm",
    category: "gesture",
    duration: 1,
    loop: false,
    tracks: [],
    keyposes: [
      { t: 0, parts: [{ partRole: "arm", slotId: "slot:right-arm", poseSwap: "bent" }] },
      { t: 1, parts: [{ partRole: "arm", slotId: "slot:right-arm", poseSwap: "bent" }] },
    ],
    createdAt: 0,
    updatedAt: 0,
  };

  it("emits scaled variant anchors on the child bone track", () => {
    const html = build({ autoBlink: false }, new Map(), makeVariantArmCharacter());
    const payload = extractPixiPayload(html);
    const track = payload.scene.boneAnchorTracks["bone:slot:right-hand"];
    expect(track?.base).toEqual({ x: 5, y: 87.5, rotation: 0 });
    expect(track?.anchors.bent).toEqual({ x: 40, y: 30, rotation: 0 });
    // Aliases of the bent arm part resolve to the same anchor.
    expect(track?.anchors["arm-bent"]).toEqual({ x: 40, y: 30, rotation: 0 });
    // The straight (representative) variant needs no entry — the bone rests at base.
    const boneNode = payload.scene.nodes[payload.scene.boneNodeIds["bone:slot:right-hand"]];
    expect(boneNode?.frame.x).toBe(5);
    expect(boneNode?.frame.y).toBe(87.5);
  });

  it("bakes the initial bone anchor from the placed pose", () => {
    const html = build(
      { autoBlink: false, poses: { "slot:right-arm": "bent" } },
      new Map(),
      makeVariantArmCharacter(),
    );
    const payload = extractPixiPayload(html);
    const track = payload.scene.boneAnchorTracks["bone:slot:right-hand"];
    expect(track?.initial).toEqual({ x: 40, y: 30, rotation: 0 });
    const boneNode = payload.scene.nodes[payload.scene.boneNodeIds["bone:slot:right-hand"]];
    expect(boneNode?.frame.x).toBe(40);
    expect(boneNode?.frame.y).toBe(30);
  });

  it("re-anchors the hand bone through variant slot events when a motion bends the arm", () => {
    const html = build(
      {
        autoBlink: false,
        motions: [{ id: "applied-bend", presetId: bentArmPreset.id, offset: 0, intensity: 1 }],
      },
      new Map([[bentArmPreset.id, bentArmPreset]]),
      makeVariantArmCharacter(),
    );
    const scene = extractScene(html);
    const armEvents = scene.slotEvents.filter((event) => event.slotId === "slot:right-arm");
    const bentEvent = armEvents.find((event) => event.key === "bent");
    expect(bentEvent?.boneAnchors).toBeDefined();
    const anchor = bentEvent!.boneAnchors!.find((entry) =>
      entry.selector.startsWith("#char-bone-bone-slot-right-hand"),
    );
    expect(anchor).toMatchObject({ left: 40, top: 30 });
    // After the motion ends the arm returns to straight, restoring the base anchor.
    const straightEvent = armEvents.find(
      (event) => event.key !== "bent" && event.boneAnchors?.length,
    );
    expect(
      straightEvent?.boneAnchors?.find((entry) =>
        entry.selector.startsWith("#char-bone-bone-slot-right-hand"),
      ),
    ).toMatchObject({ left: 5, top: 87.5 });
    // The runtime applies anchors on swap and reset.
    expect(html).toContain("event.boneAnchors");
  });

  it("emits no anchor attributes for variant-less characters", () => {
    const html = build();
    expect(html).not.toContain("data-character-variant-anchors=");
  });
});

describe("pivot-aligned variant placement", () => {
  // Canvas 600x900 rendered at 300x450 → scale 0.5. The contract under test: in a bone-bound
  // variant slot, the DISPLAYED art's pivot rides the joint (and therefore any pinned socket),
  // regardless of which variant is showing or where it was drawn on the canvas.
  function partPos(html: string, partId: string): { left: number; top: number } {
    const payload = extractPixiPayload(html);
    const node = payload.scene.nodes[payload.scene.partNodeIds[partId]];
    expect(node, `no scene node for part ${partId}`).toBeTruthy();
    return { left: node!.frame.x, top: node!.frame.y };
  }

  /** World-space top-left of a part by summing frame offsets up the scene chain. */
  function chainLeftTop(html: string, partId: string): { left: number; top: number } {
    const payload = extractPixiPayload(html);
    let id: string | undefined = payload.scene.partNodeIds[partId];
    expect(id, `no scene node for part ${partId}`).toBeTruthy();
    let left = 0;
    let top = 0;
    while (id) {
      const node: PayloadSceneNode | undefined = payload.scene.nodes[id];
      if (!node) break;
      left += node.frame.x;
      top += node.frame.y;
      id = node.parentId;
    }
    return { left, top };
  }

  it("lands the displayed non-rep variant's pivot exactly on the pinned socket", () => {
    // The user's reported bug: a wrist socket pinned for the bent arm, with the hand showing a
    // non-representative variant — the hand art used to sit offset from the socket by the
    // difference between its pivot and the representative's pivot.
    const socket = { x: 400, y: 250 };
    const character = upsertVariantPinAtPoint(makeVariantArmCharacter(), {
      parentSlotId: "slot:right-arm",
      variantKey: "bent",
      childSlotId: "slot:right-hand",
      anchorPoint: socket,
    });
    const html = build(
      { autoBlink: false, poses: { "slot:right-arm": "bent", "slot:right-hand": "bent" } },
      new Map(),
      character,
    );
    const art = chainLeftTop(html, "hand-bent");
    // hand-bent pivot (370,230) − authored xy (360,220) = (10,10), scaled by 0.5.
    const pivotInArt = { x: 5, y: 5 };
    expect(art.left + pivotInArt.x).toBe(socket.x * 0.5);
    expect(art.top + pivotInArt.y).toBe(socket.y * 0.5);
  });

  it("rides a non-rep variant chosen at rest on the representative's joint instead of floating at its drawn spot", () => {
    // Bent-hand art picked while the arm stays straight: it must attach at the straight wrist
    // (the hand bone's base anchor), not display at its authored canvas position.
    const html = build(
      { autoBlink: false, poses: { "slot:right-hand": "bent" } },
      new Map(),
      makeVariantArmCharacter(),
    );
    const art = partPos(html, "hand-bent");
    // pivotAligned offset = pivotLocal(straight)(10,5) − pivotLocal(bent)(10,10) = (0,−5) × 0.5.
    expect(art).toEqual({ left: 0, top: 0 });
    // Full chain lands the displayed pivot on the straight wrist pivot (300,345) × 0.5.
    const world = chainLeftTop(html, "hand-bent");
    expect(world.left + 5).toBe(150);
    expect(world.top + 5).toBe(172.5);
  });

  it("keeps the representative group at its authored position (byte-stable placement)", () => {
    const html = build({ autoBlink: false }, new Map(), makeVariantArmCharacter());
    expect(partPos(html, "hand-straight")).toEqual({ left: 0, top: 0 });
    expect(partPos(html, "arm-straight")).toEqual({ left: 0, top: 0 });
  });

  it("aligns multi-layer variants as one group, preserving the layers' relative layout", () => {
    const base = makeVariantArmCharacter();
    const character: CharacterPreset = {
      ...base,
      parts: [
        ...base.parts,
        makePart("arm", "expl-upper-media", {
          id: "expl-upper",
          slotId: "slot:right-arm",
          side: "right",
          variant: { key: "explaining", name: "Explaining arm", kind: "pose" },
          x: 320,
          y: 200,
          width: 48,
          height: 96,
          zIndex: 7,
          pivot: { x: 340, y: 220 },
        }),
        makePart("arm", "expl-fore-media", {
          id: "expl-fore",
          slotId: "slot:right-arm",
          side: "right",
          variant: { key: "explaining", name: "Explaining arm", kind: "pose" },
          x: 356,
          y: 260,
          width: 72,
          height: 42,
          zIndex: 8,
          pivot: { x: 392, y: 281 },
        }),
      ],
    };
    const html = build({ autoBlink: false }, new Map(), character);
    const upper = partPos(html, "expl-upper");
    const fore = partPos(html, "expl-fore");
    // Group anchor = first matching layer (expl-upper): pivotLocal(rep arm)(10,10) −
    // pivotLocal(expl-upper)(20,20) = (−10,−10) × 0.5.
    expect(upper).toEqual({ left: -5, top: -5 });
    // The second layer moves by the SAME group delta: relative layout (36,60) × 0.5 preserved.
    expect(fore.left - upper.left).toBe(18);
    expect(fore.top - upper.top).toBe(30);
  });

  it("keeps face builders on authored placement (eyes and mouths are not joint attachments)", () => {
    const html = build({ autoBlink: false });
    // eye-closed authored offset from eye-open: (0,4) × 0.5 — NOT alpha/pivot aligned.
    expect(partPos(html, "eye-closed")).toEqual({ left: 0, top: 2 });
    // mouth-raspberry authored offset from mouth-rest: (−20,−10) × 0.5.
    expect(partPos(html, "mouth-raspberry")).toEqual({ left: -10, top: -5 });
  });

  it("rotates a swapped variant about the joint, not its authored canvas offset", () => {
    const preset: MotionPreset = {
      id: "bent-hand-twist",
      name: "Bent hand twist",
      category: "gesture",
      duration: 1,
      loop: false,
      tracks: [],
      keyposes: [
        {
          t: 0,
          parts: [
            {
              target: "slot",
              partRole: "hand",
              slotId: "slot:right-hand",
              poseSwap: "bent",
              rotation: 10,
            },
          ],
        },
        {
          t: 1,
          parts: [
            {
              target: "slot",
              partRole: "hand",
              slotId: "slot:right-hand",
              poseSwap: "bent",
              rotation: 10,
            },
          ],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = build(
      {
        autoBlink: false,
        motions: [{ id: "applied-twist", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      new Map([[preset.id, preset]]),
      makeVariantArmCharacter(),
    );
    const scene = extractScene(html);
    const origins = [
      ...scene.initialTargets,
      ...scene.motionSegments.flatMap((segment) => segment.targets),
    ]
      .filter((target) => target.selector.startsWith("#char-slot-slot-right-hand"))
      .map((target) => target.vars.transformOrigin)
      .filter((origin): origin is string => origin !== undefined);
    expect(origins.length).toBeGreaterThan(0);
    // The joint sits at container-local (10,5) of the 40×40 base box — for every frame,
    // including the ones displaying the swapped bent hand (which used to read "200% -275%").
    for (const origin of origins) expect(origin).toBe("25% 12.5%");
  });
});

describe("variant rotation limits in compiled playback", () => {
  // withFistVariant: the fist variant package limits hand rotation to [-15, 15], tighter than
  // anything the motion asks for. The motion holds the fist while rotating the hand to 60°.
  const rotatePastLimit: MotionPreset = {
    id: "fist-twist",
    name: "Fist twist",
    category: "gesture",
    duration: 1,
    loop: false,
    tracks: [],
    keyposes: [
      {
        t: 0,
        parts: [
          {
            target: "slot",
            partRole: "hand",
            slotId: "slot:right-hand",
            poseSwap: "fist",
            rotation: 60,
          },
        ],
      },
      {
        t: 1,
        parts: [
          {
            target: "slot",
            partRole: "hand",
            slotId: "slot:right-hand",
            poseSwap: "fist",
            rotation: 60,
          },
        ],
      },
    ],
    createdAt: 0,
    updatedAt: 0,
  };

  function handRotations(html: string): number[] {
    const scene = extractScene(html);
    const all = [
      ...scene.initialTargets,
      ...scene.motionSegments.flatMap((segment) => segment.targets),
    ];
    return all
      .filter((target) => target.selector.includes("right-hand"))
      .map((target) => target.vars.rotation)
      .filter((rotation): rotation is number => typeof rotation === "number");
  }

  it("clamps motion rotation to the active variant's rotation limits", () => {
    const html = build(
      {
        autoBlink: false,
        motions: [{ id: "applied-twist", presetId: rotatePastLimit.id, offset: 0, intensity: 1 }],
      },
      new Map([[rotatePastLimit.id, rotatePastLimit]]),
      withFistVariant(makeVariantArmCharacter()),
    );
    const rotations = handRotations(html);
    expect(rotations.length).toBeGreaterThan(0);
    expect(Math.max(...rotations)).toBe(15);
    expect(rotations.every((rotation) => rotation <= 15)).toBe(true);
  });

  it("lets allowOutOfBounds push past the variant limit", () => {
    const unclamped: MotionPreset = {
      ...rotatePastLimit,
      id: "fist-twist-free",
      allowOutOfBounds: ["slot:right-hand"],
    };
    const html = build(
      {
        autoBlink: false,
        motions: [{ id: "applied-free", presetId: unclamped.id, offset: 0, intensity: 1 }],
      },
      new Map([[unclamped.id, unclamped]]),
      withFistVariant(makeVariantArmCharacter()),
    );
    const rotations = handRotations(html);
    expect(Math.max(...rotations)).toBe(60);
  });

  it("treats a hand drawn inside the arm art as plain variants — no anchors, no warnings", () => {
    const base = makeVariantArmCharacter();
    const character = {
      ...base,
      // No hand slot at all: the hand pixels live inside each arm variant's artwork.
      parts: base.parts.filter((part) => part.slotId !== "slot:right-hand"),
    };
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...parts: unknown[]) => {
      warnings.push(parts.join(" "));
    };
    try {
      const html = build(
        { autoBlink: false, poses: { "slot:right-arm": "bent" } },
        new Map(),
        character,
      );
      expect(Object.keys(extractPixiPayload(html).scene.boneAnchorTracks)).toEqual([]);
      expect(warnings.filter((entry) => entry.includes("fallback anchor"))).toEqual([]);
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe("anchor rotation in compiled playback", () => {
  // The wrist joint is authored on the rig (bone-owned, per angle) — the post-refactor path.
  const rotatedSocketCharacter = (): CharacterPreset =>
    setVariantPinRotation(
      upsertVariantPinAtPoint(makeVariantArmCharacter(), {
        parentSlotId: "slot:right-arm",
        variantKey: "bent",
        childSlotId: "slot:right-hand",
        anchorPoint: { x: 352, y: 248 },
      }),
      {
        parentSlotId: "slot:right-arm",
        variantKey: "bent",
        childSlotId: "slot:right-hand",
        rotation: -35,
      },
    );

  it("bakes the variant rotation into the initial bone transform for a placed pose", () => {
    const html = build(
      { autoBlink: false, poses: { "slot:right-arm": "bent" } },
      new Map(),
      rotatedSocketCharacter(),
    );
    const payload = extractPixiPayload(html);
    const boneNode = payload.scene.nodes[payload.scene.boneNodeIds["bone:slot:right-hand"]];
    expect(boneNode?.frame.rotation).toBe(-35);
  });

  it("carries rotation through variant slot events", () => {
    const preset: MotionPreset = {
      id: "bend-arm-rot",
      name: "Bend arm",
      category: "gesture",
      duration: 1,
      loop: false,
      tracks: [],
      keyposes: [
        { t: 0, parts: [{ partRole: "arm", slotId: "slot:right-arm", poseSwap: "bent" }] },
        { t: 1, parts: [{ partRole: "arm", slotId: "slot:right-arm", poseSwap: "bent" }] },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = build(
      {
        autoBlink: false,
        motions: [{ id: "applied-bend", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      new Map([[preset.id, preset]]),
      rotatedSocketCharacter(),
    );
    const scene = extractScene(html);
    const bentEvent = scene.slotEvents.find(
      (event) => event.slotId === "slot:right-arm" && event.key === "bent",
    );
    const anchor = bentEvent?.boneAnchors?.find((entry) =>
      entry.selector.startsWith("#char-bone-bone-slot-right-hand"),
    ) as { rotation?: number } | undefined;
    expect(anchor?.rotation).toBe(-35);
    expect(html).toContain("toRadians(anchor.rotation)");
  });
});

describe("per-angle artwork in compiled output", () => {
  it("a side-view build contains no front-only parts (no stacked angle art)", () => {
    const base = makeVariantArmCharacter();
    const character: CharacterPreset = {
      ...base,
      angles: ["front", "sideL"],
      parts: [
        // Front-only drawings…
        ...base.parts.map((part) => ({ ...part, angleIds: ["front" as const] })),
        // …plus one side-view body in the same slot vocabulary.
        makePart("body", "side-body-media", {
          id: "side-body",
          slotId: "role:body",
          angleIds: ["sideL"],
          x: 120,
          y: 130,
          width: 160,
          height: 320,
          zIndex: 1,
        }),
      ],
      rig: undefined,
    };
    const sideRig = buildDefaultRig(character, "sideL");
    const html = buildCharacterCompositionHtml({
      compositionId: "char_side",
      clipId: "clip-side",
      width: 300,
      height: 450,
      duration: 4,
      character: { ...character, rig: { ...sideRig, activeAngle: "sideL" } },
      meta: { characterId: character.id, poses: {}, autoBlink: false },
      motionPresets: new Map(),
    });
    expect(html).toContain('"assetRef":"asset:side-body-media"');
    // Front drawings must not stack into the side view's render/export.
    expect(html).not.toContain('"assetRef":"asset:body-media"');
    expect(html).not.toContain('"assetRef":"asset:arm-straight-media"');
    expect(html).not.toContain('"assetRef":"asset:hand-straight-media"');
  });
});
