// Browser stub for Node's child_process module — binary discovery is server-only.
export function execFileSync(): never {
  throw new Error("child_process.execFileSync is not available in the browser");
}

export function execFile(...args: unknown[]): void {
  const callback = args.at(-1);
  if (typeof callback === "function") {
    callback(new Error("child_process.execFile is not available in the browser"), "", "");
  }
}
