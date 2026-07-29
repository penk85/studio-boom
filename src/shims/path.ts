// Browser shim for Node's `path` module — only the posix subset used by @hyperframes/core.
const SEP = "/";

function normalize(p: string): string {
  return p.replace(/\/+/g, SEP).replace(/\/$/, "") || SEP;
}

function splitPath(p: string): string[] {
  return normalize(p).split(SEP).filter(Boolean);
}

export const posix = {
  join: (...parts: string[]) => normalize(parts.filter(Boolean).join(SEP)),
  resolve: (...parts: string[]) => normalize(parts.filter(Boolean).join(SEP)),
  normalize,
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
export const isAbsolute = (p: string): boolean => p.startsWith(SEP);
export const relative = (from: string, to: string): string => {
  const fromParts = splitPath(from);
  const toParts = splitPath(to);
  let common = 0;
  while (common < fromParts.length && fromParts[common] === toParts[common]) common += 1;
  return [...fromParts.slice(common).map(() => ".."), ...toParts.slice(common)].join(SEP);
};
export const dirname = posix.dirname;
export const basename = posix.basename;
export const extname = posix.extname;
export const sep = SEP;
export const delimiter = ":";

export default {
  posix,
  join,
  resolve,
  isAbsolute,
  relative,
  dirname,
  basename,
  extname,
  sep,
  delimiter,
};
