/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { showToast, Toast, __resetLocalStorage } from "@raycast/api";

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

  it("falls back to the emoji when the status text is empty", async () => {
    mocks.getClient.mockReturnValue(fakeClient({ getStatus: vi.fn(async () => ({ text: "", emoji: "\u{1F4C5}" })) }));
    render(<Command />);
    const rendered = await items();
    expect(rendered[0]).toHaveAttribute("data-title", "\u{1F4C5}");
  });

  it("lists the seeded presets", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    render(<Command />);
    const rendered = await items();
    const seeded = await listPresets();
    expect(rendered).toHaveLength(seeded.length + 1);
    expect(rendered[1]).toHaveAttribute("data-title", seeded[0].text);
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
