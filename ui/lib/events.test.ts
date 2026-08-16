import { describe, expect, it, vi } from "vitest";
import { unsubscribe } from "./events";

describe("unsubscribe", () => {
  it("unlistens once when the subscription is up", async () => {
    const unlisten = vi.fn().mockResolvedValue(undefined);
    await unsubscribe(Promise.resolve(unlisten));
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("retries past the window where Tauri hasn't recorded the listener yet", async () => {
    const unlisten = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("undefined is not an object"))
      .mockResolvedValue(undefined);
    await unsubscribe(Promise.resolve(unlisten));
    expect(unlisten).toHaveBeenCalledTimes(2);
  });

  it("gives up loudly rather than rejecting — nothing catches effect cleanup", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const unlisten = vi.fn().mockRejectedValue(new Error("nope"));
    await expect(unsubscribe(Promise.resolve(unlisten))).resolves.toBeUndefined();
    expect(unlisten).toHaveBeenCalledTimes(5);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("does nothing when the subscription never came up", async () => {
    await expect(
      unsubscribe(Promise.reject(new Error("listen failed"))),
    ).resolves.toBeUndefined();
  });
});
