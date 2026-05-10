import { describe, expect, it } from "vitest";
import type { HyperFramesProject } from "../../types";
import { validateHfProject } from "../validate";

function makeProject(overrides: Partial<HyperFramesProject> = {}): HyperFramesProject {
  return {
    id: "project-1",
    name: "Project",
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 5,
    assets: [{ id: "image-1", filename: "image.png", mimeType: "image/png", kind: "image" }],
    rootHtml: `<html><body><img id="el-1" src="asset:image-1" data-start="0" data-duration="2" data-track-index="0" /></body></html>`,
    compositionHtml: {},
    ...overrides,
  };
}

describe("validateHfProject", () => {
  it("accepts a simple complete media project", () => {
    expect(() => validateHfProject(makeProject())).not.toThrow();
  });

  it("throws when an element references a missing asset", () => {
    expect(() => validateHfProject(makeProject({ assets: [] }))).toThrow(/missing asset/);
  });

  it("throws when rootHtml is missing", () => {
    expect(() => validateHfProject(makeProject({ rootHtml: "" }))).toThrow(/missing rootHtml/);
  });

  it("accepts a project with composition html entries", () => {
    expect(() =>
      validateHfProject(
        makeProject({
          compositionHtml: { "comp-1": "<html><body></body></html>" },
        }),
      ),
    ).not.toThrow();
  });
});
