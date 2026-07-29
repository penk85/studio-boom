// Browser stub for node:fs — used by @hyperframes/core build utilities that never
// run in the browser.
export const constants = { X_OK: 1 };

export function existsSync(): boolean {
  return false;
}
export function accessSync(): never {
  throw new Error("fs.accessSync is not available in the browser");
}
export function readFileSync(): never {
  throw new Error("fs.readFileSync is not available in the browser");
}
export function readdirSync(): never {
  throw new Error("fs.readdirSync is not available in the browser");
}
export function realpathSync(path: string): string {
  return path;
}
