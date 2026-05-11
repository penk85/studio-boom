import * as React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { usePlayerStore, useTimelinePlayer } from "@hyperframes/studio";
import { Timeline } from "../Timeline";
import { createBlankProject, useStudio } from "../../store";

vi.mock("@hyperframes/studio", async () => {
  const controls =
    await import("../../../../node_modules/@hyperframes/studio/src/player/components/PlayerControls");
  const playerStore =
    await import("../../../../node_modules/@hyperframes/studio/src/player/store/playerStore");
  const timelinePlayer =
    await import("../../../../node_modules/@hyperframes/studio/src/player/hooks/useTimelinePlayer");
  return {
    PlayerControls: controls.PlayerControls,
    usePlayerStore: playerStore.usePlayerStore,
    useTimelinePlayer: timelinePlayer.useTimelinePlayer,
  };
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers();
  resetStudio();
  usePlayerStore.getState().reset();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  vi.clearAllTimers();
  vi.useRealTimers();
  resetStudio();
  usePlayerStore.getState().reset();
});

function resetStudio() {
  useStudio.setState({
    project: null,
    tracks: [],
    characters: new Map(),
    motionPresets: new Map(),
    mediaAssets: new Map(),
    selectedClipId: null,
    zoom: 60,
  });
}

function renderHarness() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<TimelinePlaybackHarness />);
  });
  return container;
}

function TimelinePlaybackHarness() {
  const { iframeRef, onIframeLoad, togglePlay, seek } = useTimelinePlayer();

  React.useEffect(() => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const win = iframe.contentWindow as Window & {
      __timelines?: Record<string, unknown>;
    };
    const doc = iframe.contentDocument;
    doc?.open();
    doc?.write(
      '<!DOCTYPE html><html><body><div data-composition-id="project-1"></div></body></html>',
    );
    doc?.close();
    win.__timelines = {
      "project-1": {
        play: vi.fn(),
        pause: vi.fn(),
        seek: vi.fn(),
        time: () => 0,
        duration: () => 30,
        isActive: () => false,
      },
    };

    (iframeRef as React.MutableRefObject<HTMLIFrameElement | null>).current = iframe;
    onIframeLoad();

    return () => {
      iframe.remove();
      if ((iframeRef as React.MutableRefObject<HTMLIFrameElement | null>).current === iframe) {
        (iframeRef as React.MutableRefObject<HTMLIFrameElement | null>).current = null;
      }
    };
  }, [iframeRef, onIframeLoad]);

  return <Timeline togglePlay={togglePlay} seek={seek} />;
}

describe("Timeline playback integration", () => {
  it("enables the Play button after the HyperFrames iframe timeline is detected", () => {
    const project = createBlankProject("Playback Ready");
    project.id = "project-1";
    project.hf.id = "project-1";
    project.hf.duration = 30;
    useStudio.setState({
      project,
      tracks: project.editorMeta.tracks,
    });

    const host = renderHarness();

    act(() => {
      vi.advanceTimersByTime(250);
    });

    const playButton = host.querySelector<HTMLButtonElement>('button[aria-label="Play"]');
    expect(playButton).not.toBeNull();
    expect(playButton?.disabled).toBe(false);
  });
});
