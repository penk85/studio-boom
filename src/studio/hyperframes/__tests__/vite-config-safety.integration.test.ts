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
});
