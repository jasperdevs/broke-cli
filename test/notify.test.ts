import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock, existsSyncMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(() => ({ unref: vi.fn() })),
  existsSyncMock: vi.fn(() => false),
}));

vi.mock("child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("fs", () => ({
  existsSync: existsSyncMock,
}));

import { sendResponseNotification } from "../src/cli/notify.js";

describe("response notifications", () => {
  beforeEach(() => {
    spawnMock.mockClear();
    existsSyncMock.mockClear();
    existsSyncMock.mockReturnValue(false);
  });

  it("rings the terminal bell before trying desktop notification", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true as any);
    try {
      sendResponseNotification("Done");
      expect(writeSpy).toHaveBeenCalledWith("\x07");
      expect(spawnMock).toHaveBeenCalledTimes(1);
    } finally {
      writeSpy.mockRestore();
    }
  });
});
