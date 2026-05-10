// Browser shim for Node's `path` module — only the posix subset used by @hyperframes/core.
const SEP = "/";

function normalize(p: string): string {
  return p.replace(/\/+/g, SEP).replace(/\/$/, "") || SEP;
}

export const posix = {
  join: (...parts: string[]) => normalize(parts.filter(Boolean).join(SEP)),
  resolve: (...parts: string[]) => normalize(parts.filter(Boolean).join(SEP)),
  dirname: (p: string) => normalize(p).split(SEP).slice(0, -1).join(SEP) || SEP,
  basename: (p: string, ext?: string) => {
    const base = p.split(SEP).pop() ?? "";
    return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
  },
  extname: (p: string) => {
    const base = p.split(SEP).pop() ?? "";
    const dot = base.lastIndexOf(".");
    return dot > 0 ? base.slice(dot) : "";
  },
  sep: SEP,
};

export const join = posix.join;
export const resolve = posix.resolve;
export const dirname = posix.dirname;
export const basename = posix.basename;
export const extname = posix.extname;
export const sep = SEP;

export default { posix, join, resolve, dirname, basename, extname, sep };
