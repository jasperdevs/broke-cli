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
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");

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

  it("uses PowerShell on Windows notifications", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    existsSyncMock.mockImplementation((path: string) => path.includes("powershell.exe"));

    try {
      sendResponseNotification("Done");
      expect(spawnMock).toHaveBeenCalledWith(
        expect.stringContaining("powershell.exe"),
        expect.arrayContaining(["-NoProfile", "-Sta", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", expect.any(String)]),
        expect.objectContaining({ detached: true, windowsHide: true }),
      );
    } finally {
      if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
    }
  });

  it("uses osascript on macOS notifications", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });

    try {
      sendResponseNotification("Done");
      expect(spawnMock).toHaveBeenCalledWith("osascript", expect.any(Array), expect.objectContaining({ detached: true }));
    } finally {
      if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
    }
  });

  it("uses notify-send on Linux notifications and includes the icon when present", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    existsSyncMock.mockReturnValue(true);

    try {
      sendResponseNotification("Done");
      expect(spawnMock).toHaveBeenCalledWith(
        "notify-send",
        expect.arrayContaining(["--icon", expect.any(String), "Terminal Agent", "Done"]),
        expect.objectContaining({ detached: true }),
      );
    } finally {
      if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
    }
  });
});
