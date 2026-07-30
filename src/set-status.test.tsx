/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { showToast, Toast, __resetLocalStorage, pop, LocalStorage } from "@raycast/api";

const mocks = vi.hoisted(() => ({ getClient: vi.fn() }));
vi.mock("./lib/preferences", () => ({ getClient: mocks.getClient }));

import Command from "./set-status";
import { listPresets } from "./lib/presets";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClient.mockReset();
  __resetLocalStorage();
});

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    getStatus: vi.fn(async () => null),
    setStatus: vi.fn(async () => undefined),
    clearStatus: vi.fn(async () => undefined),
    ...overrides,
  };
}

async function items() {
  return waitFor(() => {
    const found = screen.getAllByTestId("list-item");
    expect(found.length).toBeGreaterThan(1);
    return found;
  });
}

function action(title: string) {
  return screen.getAllByTestId("action").find((b) => b.dataset.title === title);
}

describe("Set Status list", () => {
  it("shows No status when nothing is set", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    render(<Command />);
    const rendered = await items();
    expect(rendered[0]).toHaveAttribute("data-title", "No status");
  });

  it("shows the current status text when one is set", async () => {
    mocks.getClient.mockReturnValue(
      fakeClient({ getStatus: vi.fn(async () => ({ text: "in a meeting", emoji: "\u{1F4C5}" })) }),
    );
    render(<Command />);
    const rendered = await items();
    expect(rendered[0]).toHaveAttribute("data-title", "in a meeting");
  });

  it("falls back to a text label (not the emoji) when the status text is empty", async () => {
    mocks.getClient.mockReturnValue(fakeClient({ getStatus: vi.fn(async () => ({ text: "", emoji: "\u{1F4C5}" })) }));
    render(<Command />);
    const rendered = await items();
    // The emoji is carried by `icon` (see the icon/subtitle test below); the
    // title must be a plain label so the emoji isn't shown twice.
    expect(rendered[0]).toHaveAttribute("data-title", "Status set");
    expect(rendered[0]).toHaveAttribute("data-icon", "\u{1F4C5}");
  });

  it("shows the status emoji as the row icon, not the subtitle", async () => {
    mocks.getClient.mockReturnValue(
      fakeClient({ getStatus: vi.fn(async () => ({ text: "in a meeting", emoji: "\u{1F4C5}" })) }),
    );
    render(<Command />);
    const rendered = await items();
    expect(rendered[0]).toHaveAttribute("data-icon", "\u{1F4C5}");
    expect(rendered[0]).not.toHaveAttribute("data-subtitle");
  });

  it("lists the seeded presets", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    render(<Command />);
    const rendered = await items();
    const seeded = await listPresets();
    expect(rendered).toHaveLength(seeded.length + 1);
    expect(rendered[1]).toHaveAttribute("data-title", seeded[0].text);
  });

  it("tags each row with its list section", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    render(<Command />);
    const rendered = await items();
    expect(rendered[0]).toHaveAttribute("data-section", "Current Status");
    expect(rendered[1]).toHaveAttribute("data-section", "Presets");
  });

  it("shows each preset's emoji as its icon, not its subtitle", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    render(<Command />);
    const rendered = await items();
    const seeded = await listPresets();
    expect(rendered[1]).toHaveAttribute("data-icon", seeded[0].emoji);
    expect(rendered[1]).not.toHaveAttribute("data-subtitle");
  });

  it("applies a preset with its emoji and text", async () => {
    const client = fakeClient();
    mocks.getClient.mockReturnValue(client);
    render(<Command />);
    await items();
    const seeded = await listPresets();
    fireEvent.click(action("Set This Status")!);
    await waitFor(() => expect(client.setStatus).toHaveBeenCalledWith(seeded[0].text, seeded[0].emoji));
  });

  it("confirms applying a preset with a success toast", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    render(<Command />);
    await items();
    fireEvent.click(action("Set This Status")!);
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({ style: Toast.Style.Success, title: "Status updated" }),
      ),
    );
  });

  it("reports a rejected publish with the relay's reason", async () => {
    const client = fakeClient({
      setStatus: vi.fn(async () => {
        throw new Error("Relay rejected the request: restricted");
      }),
    });
    mocks.getClient.mockReturnValue(client);
    render(<Command />);
    await items();
    fireEvent.click(action("Set This Status")!);
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({
          style: Toast.Style.Failure,
          title: "Could not set status",
          message: "Relay rejected the request: restricted",
        }),
      ),
    );
  });

  it("stringifies a non-Error publish failure", async () => {
    mocks.getClient.mockReturnValue(
      fakeClient({
        setStatus: vi.fn(async () => {
          throw "socket closed";
        }),
      }),
    );
    render(<Command />);
    await items();
    fireEvent.click(action("Set This Status")!);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ message: "socket closed" })));
  });

  it("offers Clear Status only when a status is set", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    render(<Command />);
    await items();
    expect(action("Clear Status")).toBeUndefined();
  });

  it("clears the status", async () => {
    const client = fakeClient({ getStatus: vi.fn(async () => ({ text: "in a meeting", emoji: "" })) });
    mocks.getClient.mockReturnValue(client);
    render(<Command />);
    await items();
    fireEvent.click(action("Clear Status")!);
    await waitFor(() => expect(client.clearStatus).toHaveBeenCalled());
  });

  it("reports a failed clear", async () => {
    mocks.getClient.mockReturnValue(
      fakeClient({
        getStatus: vi.fn(async () => ({ text: "in a meeting", emoji: "" })),
        clearStatus: vi.fn(async () => {
          throw new Error("nope");
        }),
      }),
    );
    render(<Command />);
    await items();
    fireEvent.click(action("Clear Status")!);
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({ style: Toast.Style.Failure, title: "Could not clear status" }),
      ),
    );
  });

  it("stringifies a non-Error clear failure", async () => {
    mocks.getClient.mockReturnValue(
      fakeClient({
        getStatus: vi.fn(async () => ({ text: "in a meeting", emoji: "" })),
        clearStatus: vi.fn(async () => {
          throw "socket closed";
        }),
      }),
    );
    render(<Command />);
    await items();
    fireEvent.click(action("Clear Status")!);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ message: "socket closed" })));
  });

  it("deletes a preset", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    render(<Command />);
    const before = await items();
    fireEvent.click(action("Delete Preset")!);
    await waitFor(() => expect(screen.getAllByTestId("list-item")).toHaveLength(before.length - 1));
  });

  it("reports a failed preset deletion instead of silently doing nothing", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    render(<Command />);
    const before = await items();
    const setItemSpy = vi.spyOn(LocalStorage, "setItem").mockRejectedValueOnce(new Error("disk full"));
    fireEvent.click(action("Delete Preset")!);
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({ style: Toast.Style.Failure, title: "Could not delete preset", message: "disk full" }),
      ),
    );
    expect(screen.getAllByTestId("list-item")).toHaveLength(before.length);
    setItemSpy.mockRestore();
  });

  it("shows the error view when the relay cannot be reached", async () => {
    mocks.getClient.mockImplementation(() => {
      throw new Error("Cannot reach relay at https://relay.test");
    });
    render(<Command />);
    await waitFor(() =>
      expect(screen.getByTestId("empty-view")).toHaveAttribute(
        "data-description",
        "Cannot reach relay at https://relay.test",
      ),
    );
  });

  it("keeps the presets visible and usable when the status query fails", async () => {
    const client = fakeClient({
      getStatus: vi.fn(async () => {
        throw new Error("Cannot reach relay at https://relay.test");
      }),
    });
    mocks.getClient.mockReturnValue(client);
    render(<Command />);
    const rendered = await items();
    const seeded = await listPresets();
    // A relay outage must not wipe the (local) presets or fall back to the
    // full-page ErrorView; only the Current Status row reports the failure.
    expect(screen.queryByTestId("empty-view")).not.toBeInTheDocument();
    expect(rendered).toHaveLength(seeded.length + 1);
    expect(rendered[0]).toHaveAttribute("data-title", "Could not load status");
    expect(rendered[0]).toHaveAttribute("data-subtitle", "Cannot reach relay at https://relay.test");
    expect(rendered[0]).toHaveAttribute("data-icon", "Warning");
    fireEvent.click(action("Set This Status")!);
    await waitFor(() => expect(client.setStatus).toHaveBeenCalledWith(seeded[0].text, seeded[0].emoji));
  });

  it("attaches the design's keyboard shortcuts to their actions", async () => {
    mocks.getClient.mockReturnValue(
      fakeClient({ getStatus: vi.fn(async () => ({ text: "in a meeting", emoji: "" })) }),
    );
    render(<Command />);
    await items();
    // Rendered as "<macOS>/<Windows>" by the stub's shortcutAttr(); both
    // Set Custom Status and Edit Preset go through Keyboard.Shortcut.Common
    // (New / Edit), the rest are the platform-form shortcut objects.
    expect(action("Set Custom Status")).toHaveAttribute("data-shortcut", "cmd+n/ctrl+n");
    expect(action("Create Preset")).toHaveAttribute("data-shortcut", "shift+cmd+n/shift+ctrl+n");
    expect(action("Clear Status")).toHaveAttribute("data-shortcut", "ctrl+x/ctrl+x");
    expect(action("Edit Preset")).toHaveAttribute("data-shortcut", "cmd+e/ctrl+e");
    expect(action("Delete Preset")).toHaveAttribute("data-shortcut", "ctrl+x/ctrl+x");
  });

  it("marks Clear Status and Delete Preset as destructive", async () => {
    mocks.getClient.mockReturnValue(
      fakeClient({ getStatus: vi.fn(async () => ({ text: "in a meeting", emoji: "" })) }),
    );
    render(<Command />);
    await items();
    expect(action("Clear Status")).toHaveAttribute("data-style", "destructive");
    expect(action("Delete Preset")).toHaveAttribute("data-style", "destructive");
    // Non-destructive actions are left at the stub's default (no data-style).
    expect(action("Set Custom Status")).not.toHaveAttribute("data-style");
  });

  it("opens the custom status form", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    render(<Command />);
    await items();
    fireEvent.click(action("Set Custom Status")!);
    await waitFor(() => expect(screen.getByTestId("form")).toBeInTheDocument());
  });

  it("sets a custom status from the custom status form", async () => {
    const client = fakeClient();
    mocks.getClient.mockReturnValue(client);
    render(<Command />);
    await items();
    fireEvent.click(action("Set Custom Status")!);
    await waitFor(() => expect(screen.getByTestId("form")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("field-text"), { target: { value: "heads down" } });
    fireEvent.click(screen.getByTestId("submit"));
    await waitFor(() => expect(client.setStatus).toHaveBeenCalledWith("heads down", undefined));
  });

  it("does not pop when the custom status submit fails, and keeps the form open", async () => {
    mocks.getClient.mockReturnValue(
      fakeClient({
        setStatus: vi.fn(async () => {
          throw new Error("boom");
        }),
      }),
    );
    render(<Command />);
    await items();
    fireEvent.click(action("Set Custom Status")!);
    await waitFor(() => expect(screen.getByTestId("form")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("field-text"), { target: { value: "will fail" } });
    fireEvent.click(screen.getByTestId("submit"));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not set status" })),
    );
    expect(pop).not.toHaveBeenCalled();
    expect(screen.getByTestId("form")).toBeInTheDocument();
  });

  it("submits a custom status before the initial load resolves", async () => {
    let resolveStatus!: (value: null) => void;
    const client = fakeClient({
      getStatus: vi.fn(
        () =>
          new Promise<null>((resolve) => {
            resolveStatus = resolve;
          }),
      ),
    });
    mocks.getClient.mockReturnValue(client);
    render(<Command />);
    // Deliberately skip `items()`: the Current Status row and its actions
    // render before the initial getStatus()/listPresets() call resolves, and
    // must work (via getClient(), not the not-yet-loaded `data`) regardless.
    fireEvent.click(action("Set Custom Status")!);
    await waitFor(() => expect(screen.getByTestId("form")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("field-text"), { target: { value: "quick status" } });
    fireEvent.click(screen.getByTestId("submit"));
    await waitFor(() => expect(client.setStatus).toHaveBeenCalledWith("quick status", undefined));
    resolveStatus(null);
  });

  it("opens the create preset form", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    render(<Command />);
    await items();
    fireEvent.click(action("Create Preset")!);
    await waitFor(() => expect(screen.getByTestId("form")).toBeInTheDocument());
  });

  it("opens the edit preset form prefilled", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    render(<Command />);
    await items();
    const seeded = await listPresets();
    fireEvent.click(action("Edit Preset")!);
    await waitFor(() => expect(screen.getByTestId("field-text")).toHaveValue(seeded[0].text));
  });

  it("creates a preset from the create preset form", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    render(<Command />);
    const before = await items();
    fireEvent.click(action("Create Preset")!);
    await waitFor(() => expect(screen.getByTestId("form")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("field-text"), { target: { value: "brand new preset" } });
    fireEvent.click(screen.getByTestId("submit"));
    await waitFor(() => expect(screen.getAllByTestId("list-item")).toHaveLength(before.length + 1));
    const rendered = screen.getAllByTestId("list-item");
    expect(rendered[rendered.length - 1]).toHaveAttribute("data-title", "brand new preset");
  });

  it("reports a failed preset creation and does not pop or lose the form", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    render(<Command />);
    const before = await items();
    fireEvent.click(action("Create Preset")!);
    await waitFor(() => expect(screen.getByTestId("form")).toBeInTheDocument());
    const setItemSpy = vi.spyOn(LocalStorage, "setItem").mockRejectedValueOnce(new Error("disk full"));
    fireEvent.change(screen.getByTestId("field-text"), { target: { value: "will not save" } });
    fireEvent.click(screen.getByTestId("submit"));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({ style: Toast.Style.Failure, title: "Could not create preset", message: "disk full" }),
      ),
    );
    expect(pop).not.toHaveBeenCalled();
    expect(screen.getByTestId("form")).toBeInTheDocument();
    expect(screen.getAllByTestId("list-item")).toHaveLength(before.length);
    setItemSpy.mockRestore();
  });

  it("reports a failed preset edit and does not pop or lose the form", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    render(<Command />);
    await items();
    fireEvent.click(action("Edit Preset")!);
    await waitFor(() => expect(screen.getByTestId("form")).toBeInTheDocument());
    const setItemSpy = vi.spyOn(LocalStorage, "setItem").mockRejectedValueOnce(new Error("disk full"));
    fireEvent.change(screen.getByTestId("field-text"), { target: { value: "will not save" } });
    fireEvent.click(screen.getByTestId("submit"));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({ style: Toast.Style.Failure, title: "Could not save preset", message: "disk full" }),
      ),
    );
    expect(pop).not.toHaveBeenCalled();
    expect(screen.getByTestId("form")).toBeInTheDocument();
    setItemSpy.mockRestore();
  });

  it("saves an edited preset from the edit preset form", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    render(<Command />);
    await items();
    fireEvent.click(action("Edit Preset")!);
    await waitFor(() => expect(screen.getByTestId("form")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("field-text"), { target: { value: "renamed preset" } });
    fireEvent.click(screen.getByTestId("submit"));
    await waitFor(() => expect(screen.getAllByTestId("list-item")[1]).toHaveAttribute("data-title", "renamed preset"));
  });
});
