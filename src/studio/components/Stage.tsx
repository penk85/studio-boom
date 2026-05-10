// Stage — renders project.hf.rootHtml through the HyperFrames player iframe.
// React hosts the editor shell; HyperFrames owns the movie preview.
import "@hyperframes/player";
import gsapRaw from "gsap/dist/gsap.min.js?raw";
import { useEffect, useRef, useState } from "react";
import { resolveIframe, useElementPicker } from "@hyperframes/studio";
import { useStudio } from "../store";
import { getMediaUrl } from "../db";
import type { HyperframesPlayerElement } from "../../hyperframes-player";

const GSAP_SCRIPT_RE =
  /<script\s+src=["'](?:https:\/\/cdn\.jsdelivr\.net\/npm\/gsap@[^"']+\/dist\/gsap\.min\.js|\.\.\/gsap\.min\.js)["']\s*><\/script>/gi;

function inlinePreviewScripts(html: string): string {
  return html.replace(GSAP_SCRIPT_RE, `<script>${gsapRaw}</script>`);
}

interface ResolvedPreviewHtml {
  html: string;
  revoke: () => void;
}

async function resolvePreviewHtml(
  rootHtml: string,
  compositionHtml: Record<string, string>,
  assets: { id: string }[],
): Promise<ResolvedPreviewHtml> {
  const assetEntries = await Promise.all(
    assets.map(async (a) => [a.id, await getMediaUrl(a.id)] as const),
  );
  const assetUrls = new Map(assetEntries.filter((e): e is [string, string] => Boolean(e[1])));

  const blobUrls: string[] = [];
  const compBlobUrls = new Map<string, string>();
  for (const [compId, compHtml] of Object.entries(compositionHtml)) {
    let resolved = inlinePreviewScripts(compHtml);
    for (const [id, url] of assetUrls) resolved = resolved.replaceAll(`asset:${id}`, url);
    const blobUrl = URL.createObjectURL(new Blob([resolved], { type: "text/html" }));
    blobUrls.push(blobUrl);
    compBlobUrls.set(compId, blobUrl);
  }

  let html = inlinePreviewScripts(rootHtml);
  for (const [id, url] of assetUrls) html = html.replaceAll(`asset:${id}`, url);
  for (const [compId, blobUrl] of compBlobUrls)
    html = html.replaceAll(`compositions/${compId}.html`, blobUrl);

  return {
    html,
    revoke: () => {
      for (const url of blobUrls) URL.revokeObjectURL(url);
    },
  };
}

interface StageProps {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onIframeLoad: () => void;
}

export function Stage({ iframeRef, onIframeLoad }: StageProps) {
  const project = useStudio((s) => s.project);
  const selectClip = useStudio((s) => s.selectClip);
  const updateRootHtml = useStudio((s) => s.updateRootHtml);

  const playerRef = useRef<HyperframesPlayerElement>(null);
  const [resolvedHtml, setResolvedHtml] = useState<string | null>(null);

  // Resolve asset URLs and serve the complete preview HTML through srcdoc.
  // Blob URLs cannot be passed through `src`: the player appends shader query
  // params to `src`, which changes object URLs and breaks loading.
  useEffect(() => {
    if (!project) {
      setResolvedHtml(null);
      return;
    }
    let alive = true;
    let cleanupResolvedHtml: (() => void) | null = null;
    void resolvePreviewHtml(
      project.hf.rootHtml,
      project.hf.compositionHtml,
      project.hf.assets,
    ).then((resolved) => {
      if (!alive) {
        resolved.revoke();
        return;
      }
      cleanupResolvedHtml = resolved.revoke;
      setResolvedHtml(resolved.html);
    });
    return () => {
      alive = false;
      cleanupResolvedHtml?.();
    };
  }, [project]);

  useEffect(() => {
    if (!resolvedHtml) return;
    const iframe = resolveIframe(playerRef.current);
    (iframeRef as { current: HTMLIFrameElement | null }).current = iframe;
    if (!iframe) return;

    iframe.addEventListener("load", onIframeLoad);
    onIframeLoad();
    return () => {
      iframe.removeEventListener("load", onIframeLoad);
      if ((iframeRef as { current: HTMLIFrameElement | null }).current === iframe) {
        (iframeRef as { current: HTMLIFrameElement | null }).current = null;
      }
    };
  }, [iframeRef, onIframeLoad, resolvedHtml]);

  // Element picker — click in player iframe → select clip.
  const { pickedElement, enablePick } = useElementPicker(iframeRef, {
    workspaceFiles: project ? { "index.html": project.hf.rootHtml } : undefined,
    onSyncFiles: (files) => {
      if (files["index.html"]) updateRootHtml(files["index.html"]);
    },
  });

  useEffect(() => {
    if (pickedElement) selectClip(pickedElement.id);
  }, [pickedElement, selectClip]);

  useEffect(() => {
    if (!resolvedHtml) return;
    enablePick();
  }, [resolvedHtml, enablePick]);

  if (!project) return null;

  return (
    <div
      className="absolute inset-0 overflow-hidden bg-stage-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) selectClip(null);
      }}
    >
      {resolvedHtml && (
        <hyperframes-player
          //key={resolvedHtml}
          ref={playerRef}
          srcdoc={resolvedHtml}
          width={project.hf.width}
          height={project.hf.height}
          style={{ position: "absolute", inset: 0, display: "block" }}
        />
      )}
      <div className="pointer-events-none absolute bottom-2 right-3 rounded bg-panel/80 px-2 py-1 text-xs text-muted-foreground">
        {project.hf.width}×{project.hf.height}
      </div>
    </div>
  );
}
