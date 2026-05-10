// Browser stub for esbuild — the @hyperframes/core compiler utilities import it
// but are never actually called at runtime in the browser.
export function buildSync(): never {
  throw new Error("esbuild.buildSync is not available in the browser");
}
export function transformSync(): never {
  throw new Error("esbuild.transformSync is not available in the browser");
}
export function build(): never {
  throw new Error("esbuild.build is not available in the browser");
}
export function transform(): never {
  throw new Error("esbuild.transform is not available in the browser");
}
