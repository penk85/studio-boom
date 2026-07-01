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
  generatedMouth?: {
    duration: number;
    components: Record<string, CharacterTimelineVars>;
  };
}

export interface CharacterTimelineScene {
  duration: number;
  initialTargets: CharacterTimelineTarget[];
  motionSegments: CharacterTimelineMotionSegment[];
  slotEvents: CharacterTimelineSlotEvent[];
}
