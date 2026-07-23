import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Vite server safety source contract", () => {
  it("binds the local-only Studio server to loopback", () => {
    const source = readFileSync(join(process.cwd(), "vite.config.ts"), "utf8");

    expect(source).toContain('server: { host: "127.0.0.1", port: 8080 }');
    expect(source).not.toContain('host: "::"');
    expect(source).not.toContain('host: "0.0.0.0"');
  });

  it("lets Vite provide the mode-correct NODE_ENV while retaining browser shims", () => {
    const source = readFileSync(join(process.cwd(), "vite.config.ts"), "utf8");

    expect(source).not.toContain('"process.env.NODE_ENV"');
    expect(source).toContain('"process.env": "{}"');
    expect(source).toContain('"process.platform": JSON.stringify("browser")');
  });

  it("keeps build-only Vite tooling outside the runtime dependency surface", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

    expect(packageJson.sideEffects).toBeUndefined();
    expect(packageJson.dependencies["vite-tsconfig-paths"]).toBeUndefined();
    expect(packageJson.devDependencies["vite-tsconfig-paths"]).toBe("^6.0.2");
  });
});
