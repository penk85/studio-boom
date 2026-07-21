import { describe, expect, it, vi } from "vitest";
import { createPreviewAssetLeaseManager } from "../pixi-preview-assets";

describe("Pixi preview asset leases", () => {
  it("unloads a shared texture only after its final preview releases it", async () => {
    const unload = vi.fn(async () => undefined);
    const load = vi.fn(async () => ({ id: "texture-a" }));
    const manager = createPreviewAssetLeaseManager(unload);

    const first = await manager.acquire("blob:a", load);
    const second = await manager.acquire("blob:a", load);

    expect(first.value).toBe(second.value);
    expect(load).toHaveBeenCalledTimes(1);
    await first.release();
    expect(unload).not.toHaveBeenCalled();
    await second.release();
    await second.release();
    expect(unload).toHaveBeenCalledOnce();
    expect(unload).toHaveBeenCalledWith("blob:a");
  });

  it("waits for an in-flight unload before loading the same texture again", async () => {
    let finishUnload: () => void = () => undefined;
    const unload = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishUnload = resolve;
        }),
    );
    const load = vi
      .fn<() => Promise<{ generation: number }>>()
      .mockResolvedValueOnce({ generation: 1 })
      .mockResolvedValueOnce({ generation: 2 });
    const manager = createPreviewAssetLeaseManager<{ generation: number }>(unload);

    const first = await manager.acquire("blob:a", load);
    const releasing = first.release();
    const reacquiring = manager.acquire("blob:a", load);
    await Promise.resolve();

    expect(load).toHaveBeenCalledTimes(1);
    finishUnload();
    await releasing;
    const second = await reacquiring;
    expect(second.value.generation).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
    const secondRelease = second.release();
    await Promise.resolve();
    finishUnload();
    await secondRelease;
  });

  it("does not leave a failed load retained", async () => {
    const unload = vi.fn(async () => undefined);
    const manager = createPreviewAssetLeaseManager<{ id: string }>(unload);

    await expect(
      manager.acquire("blob:a", async () => {
        throw new Error("decode failed");
      }),
    ).rejects.toThrow("decode failed");
    expect(unload).not.toHaveBeenCalled();

    const recovered = await manager.acquire("blob:a", async () => ({ id: "recovered" }));
    expect(recovered.value.id).toBe("recovered");
    await recovered.release();
    expect(unload).toHaveBeenCalledOnce();
  });
});
