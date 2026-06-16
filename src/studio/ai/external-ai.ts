export type AiGeneratedEditorStatusKind = "idle" | "info" | "success" | "error";

export interface AiGeneratedEditorStatus {
  kind: AiGeneratedEditorStatusKind;
  message: string;
}

export interface AiGeneratedArtifactSummary {
  title: string;
  detail?: string;
  items?: string[];
}

export interface CopyExternalAiPromptResult {
  ok: boolean;
  error?: string;
}

export async function copyExternalAiPrompt(text: string): Promise<CopyExternalAiPromptResult> {
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard?.writeText) {
    return { ok: false, error: "Clipboard API is not available." };
  }

  try {
    await clipboard.writeText(text);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildJsonRepairPrompt({
  featureName,
  artifactLabel,
  errors,
  source,
}: {
  featureName: string;
  artifactLabel: string;
  errors: string[];
  source: string;
}): string {
  return `Fix this ${artifactLabel} for ${featureName}.

Validation errors:
${errors.map((error) => `- ${error}`).join("\n")}

Original JSON:
${source}`;
}
