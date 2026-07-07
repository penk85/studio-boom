export interface CharacterTimelineVars {
  x?: number;
  y?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  skewX?: number;
  skewY?: number;
  rotation?: number;
  rotationX?: number;
  rotationY?: number;
  /** Smooth-curve degrees applied to flexible (mesh) parts under the target. */
  bend?: number;
  /** Flexible limb path offsets in part-local source pixels. */
  pathEndX?: number;
  pathEndY?: number;
  pathCurveX?: number;
  pathCurveY?: number;
  transformPerspective?: number;
  opacity?: number;
  transformOrigin?: string;
}

export interface CharacterTimelineTarget {
  selector: string;
  sceneNodeId?: string;
  vars: CharacterTimelineVars;
}

export interface CharacterTimelineMotionSegment {
  start: number;
  duration: number;
  targets: CharacterTimelineTarget[];
}

export interface CharacterTimelineBoneAnchor {
  selector: string;
  sceneNodeId?: string;
  left: number;
  top: number;
  rotation: number;
}

export interface CharacterTimelineSlotEvent {
  time: number;
  slotId: string;
  key: string;
  variant?: {
    hide: string[];
    show?: string[];
    hideSceneNodeIds?: string[];
    showSceneNodeIds?: string[];
  };
  boneAnchors?: CharacterTimelineBoneAnchor[];
}

export interface CharacterTimelineScene {
  duration: number;
  initialTargets: CharacterTimelineTarget[];
  motionSegments: CharacterTimelineMotionSegment[];
  slotEvents: CharacterTimelineSlotEvent[];
}
