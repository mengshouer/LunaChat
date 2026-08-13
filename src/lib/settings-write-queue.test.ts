import { describe, expect, it } from "vitest";
import { SettingsWriteQueue } from "./settings-write-queue";

describe("SettingsWriteQueue", () => {
  it("runs reset after pending writes and rejects later writes", async () => {
    const queue = new SettingsWriteQueue();
    const order: string[] = [];
    let releaseWrite = () => {};
    const writeBarrier = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });

    const pendingWrite = queue.enqueue(async () => {
      await writeBarrier;
      order.push("write");
    });
    const reset = queue.enqueueFinal(async () => {
      order.push("reset");
    });

    await expect(queue.enqueue(async () => order.push("late write"))).rejects.toThrow(
      "Reset in progress",
    );
    releaseWrite();
    await Promise.all([pendingWrite, reset]);

    expect(order).toEqual(["write", "reset"]);
  });

  it("allows writes again when the final write fails", async () => {
    const queue = new SettingsWriteQueue();

    await expect(
      queue.enqueueFinal(async () => {
        throw new Error("reset failed");
      }),
    ).rejects.toThrow("reset failed");

    await expect(queue.enqueue(async () => "saved")).resolves.toBe("saved");
  });
});
