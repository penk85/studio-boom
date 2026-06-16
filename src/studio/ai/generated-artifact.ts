import { useCallback, useState } from "react";
import {
  buildJsonRepairPrompt,
  copyExternalAiPrompt,
  type AiGeneratedArtifactSummary,
  type AiGeneratedEditorStatus,
} from "./external-ai";

export type AiGeneratedArtifactPhase =
  | "idle"
  | "promptCopied"
  | "manualPrompt"
  | "loaded"
  | "error";

export type AiGeneratedArtifactResult<TArtifact> =
  | {
      ok: true;
      artifact: TArtifact;
      warnings?: string[];
    }
  | {
      ok: false;
      errors: string[];
      warnings?: string[];
      repairPrompt?: string;
    };

export type AiGeneratedArtifactLoadResult<TSummary = AiGeneratedArtifactSummary> =
  | {
      ok: true;
      message?: string;
      summary?: TSummary;
      warnings?: string[];
    }
  | {
      ok: false;
      errors: string[];
      warnings?: string[];
      repairPrompt?: string;
    };

export interface AiGeneratedFeatureAdapter<TArtifact, TSummary = AiGeneratedArtifactSummary> {
  featureName: string;
  artifactLabel: string;
  buildPrompt: (request: string) => string;
  parseArtifact: (source: string) => AiGeneratedArtifactResult<TArtifact>;
  loadArtifact: (artifact: TArtifact) => AiGeneratedArtifactLoadResult<TSummary>;
  buildRepairPrompt?: (args: { errors: string[]; source: string }) => string;
}

export interface UseAiGeneratedArtifactAddonOptions {
  initialRequest: string;
  initialOpen?: boolean;
}

export function useAiGeneratedArtifactAddon<
  TArtifact,
  TSummary extends AiGeneratedArtifactSummary = AiGeneratedArtifactSummary,
>(
  adapter: AiGeneratedFeatureAdapter<TArtifact, TSummary>,
  options: UseAiGeneratedArtifactAddonOptions,
) {
  const [open, setOpen] = useState(options.initialOpen ?? false);
  const [request, setRequestState] = useState(options.initialRequest);
  const [paste, setPasteState] = useState("");
  const [status, setStatus] = useState<AiGeneratedEditorStatus>({ kind: "idle", message: "" });
  const [phase, setPhase] = useState<AiGeneratedArtifactPhase>("idle");
  const [promptText, setPromptText] = useState("");
  const [promptOpen, setPromptOpen] = useState(false);
  const [repairPrompt, setRepairPrompt] = useState("");
  const [summary, setSummary] = useState<TSummary | null>(null);

  const clearLoadedFeedback = useCallback(() => {
    setRepairPrompt("");
    setSummary(null);
    if (phase === "loaded" || phase === "error") {
      setPhase("idle");
      setStatus({ kind: "idle", message: "" });
    }
  }, [phase]);

  const setPaste = useCallback(
    (value: string) => {
      setPasteState(value);
      clearLoadedFeedback();
    },
    [clearLoadedFeedback],
  );

  const setRequest = useCallback(
    (value: string) => {
      setRequestState(value);
      setPromptText("");
      setPromptOpen(false);
      clearLoadedFeedback();
    },
    [clearLoadedFeedback],
  );

  const buildAndStorePrompt = useCallback(() => {
    const text = adapter.buildPrompt(request);
    setPromptText(text);
    return text;
  }, [adapter, request]);

  const showPrompt = useCallback(() => {
    buildAndStorePrompt();
    setPromptOpen(true);
    setPhase("manualPrompt");
    setStatus({
      kind: "info",
      message: "Prompt is shown below for manual copy.",
    });
  }, [buildAndStorePrompt]);

  const copyPrompt = useCallback(async () => {
    const text = buildAndStorePrompt();
    const result = await copyExternalAiPrompt(text);
    if (result.ok) {
      setPromptOpen(false);
      setPhase("promptCopied");
      setStatus({
        kind: "success",
        message: "Copied prompt package. Paste it into your AI chat.",
      });
      return;
    }

    setPromptOpen(true);
    setPhase("manualPrompt");
    setStatus({
      kind: "info",
      message: "Clipboard access is unavailable. The prompt is shown below for manual copy.",
    });
  }, [buildAndStorePrompt]);

  const copyRepairPrompt = useCallback(async () => {
    if (!repairPrompt) return;
    const result = await copyExternalAiPrompt(repairPrompt);
    setStatus(
      result.ok
        ? { kind: "success", message: "Copied repair prompt." }
        : {
            kind: "info",
            message: "Clipboard access is unavailable. The repair prompt is shown below.",
          },
    );
  }, [repairPrompt]);

  const loadSuggestion = useCallback(() => {
    const source = paste.trim();
    if (!source) {
      setPhase("error");
      setStatus({ kind: "error", message: `Paste ${adapter.artifactLabel} first.` });
      return;
    }

    const parsed = adapter.parseArtifact(source);
    if (!parsed.ok) {
      const repair =
        parsed.repairPrompt ??
        buildRepairPrompt(adapter, {
          errors: parsed.errors,
          source,
        });
      setRepairPrompt(repair);
      setSummary(null);
      setPhase("error");
      setStatus({ kind: "error", message: formatIssues(parsed.errors, parsed.warnings) });
      return;
    }

    const loaded = adapter.loadArtifact(parsed.artifact);
    if (!loaded.ok) {
      const repair =
        loaded.repairPrompt ??
        buildRepairPrompt(adapter, {
          errors: loaded.errors,
          source,
        });
      setRepairPrompt(repair);
      setSummary(null);
      setPhase("error");
      setStatus({ kind: "error", message: formatIssues(loaded.errors, loaded.warnings) });
      return;
    }

    const warnings = [...(parsed.warnings ?? []), ...(loaded.warnings ?? [])];
    setRepairPrompt("");
    setSummary(loaded.summary ?? null);
    setPhase("loaded");
    setStatus({
      kind: "success",
      message: `${loaded.message ?? `Loaded ${adapter.artifactLabel} into the editor.`}${formatWarnings(
        warnings,
      )}`,
    });
  }, [adapter, paste]);

  return {
    open,
    request,
    paste,
    status,
    phase,
    promptText,
    promptOpen,
    repairPrompt,
    summary,
    setOpen,
    setRequest,
    setPaste,
    setPromptOpen,
    showPrompt,
    copyPrompt,
    copyRepairPrompt,
    loadSuggestion,
  };
}

function buildRepairPrompt<TArtifact, TSummary>(
  adapter: AiGeneratedFeatureAdapter<TArtifact, TSummary>,
  args: { errors: string[]; source: string },
): string {
  return (
    adapter.buildRepairPrompt?.(args) ??
    buildJsonRepairPrompt({
      featureName: adapter.featureName,
      artifactLabel: adapter.artifactLabel,
      errors: args.errors,
      source: args.source,
    })
  );
}

function formatIssues(errors: string[], warnings: string[] = []): string {
  const errorText = errors.join("\n");
  return `${errorText}${formatWarnings(warnings)}`;
}

function formatWarnings(warnings: string[]): string {
  return warnings.length ? `\nWarnings:\n${warnings.join("\n")}` : "";
}
