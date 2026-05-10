// Browser stub for node:fs — used by @hyperframes/core build utilities that never
// run in the browser.
export function existsSync(): boolean {
  return false;
}
export function readFileSync(): never {
  throw new Error("fs.readFileSync is not available in the browser");
}
