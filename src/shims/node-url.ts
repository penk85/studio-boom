// Browser stub for node:url — used by @hyperframes/core build utilities that never
// run in the browser.
export function fileURLToPath(url: string | URL): string {
  const href = typeof url === "string" ? url : url.href;
  return href.replace(/^file:\/\//, "");
}
export function pathToFileURL(path: string): URL {
  return new URL("file://" + path);
}
