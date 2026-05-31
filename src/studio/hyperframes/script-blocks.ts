// Shared helpers for the three inline-script syntax validators (composition
// source, preview bundle, render bundle). The validators differ in their parse
// strategy (`new Function` vs esbuild) and error reporting (collect vs throw),
// but they all walk the same set of script tags and read the same attributes.

export interface InlineScript {
  /** 1-based index across the document for human-readable messages. */
  index: number;
  /** JavaScript source between the opening and closing script tags. */
  source: string;
  /** 1-based HTML line number of the opening tag. */
  htmlLine: number;
}

/** Walk a raw HTML string and yield every inline classic JavaScript block. */
export function findInlineScripts(html: string): InlineScript[] {
  const scripts: InlineScript[] = [];
  let scriptIndex = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1] ?? "";
    const source = match[2] ?? "";
    if (readHtmlAttr(attrs, "src") !== null) continue;
    if (!isClassicJavaScriptType(readHtmlAttr(attrs, "type"))) continue;

    scriptIndex += 1;
    const htmlLine = html.slice(0, match.index ?? 0).split(/\r\n|\r|\n/).length;
    scripts.push({ index: scriptIndex, source, htmlLine });
  }
  return scripts;
}

export function readHtmlAttr(attrs: string, attr: string): string | null {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attrs.match(new RegExp(`\\s${escaped}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, "i"));
  if (!match?.[1]) return null;
  return match[1].replace(/^["']|["']$/g, "");
}

export function isClassicJavaScriptType(type: string | null): boolean {
  if (type === null || type.trim() === "") return true;
  const normalized = type.trim().toLowerCase();
  return (
    normalized === "text/javascript" ||
    normalized === "application/javascript" ||
    normalized === "text/ecmascript" ||
    normalized === "application/ecmascript"
  );
}
