/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { showToast, popToRoot, Toast } from "@raycast/api";
import type { Channel } from "./lib/types";

const mocks = vi.hoisted(() => ({ getClient: vi.fn() }));
vi.mock("./lib/preferences", () => ({ getClient: mocks.getClient }));

import Command from "./send-message";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClient.mockReset();
});

const CHANNELS: Channel[] = [
  { id: "uuid-1", name: "general" },
  { id: "uuid-2", name: "random" },
];

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    listChannels: vi.fn(async () => CHANNELS),
    sendMessage: vi.fn(async () => undefined),
    ...overrides,
  };
}

/** Wait for the channel dropdown to finish populating before interacting. */
async function ready(expectedOptions: number) {
  await waitFor(() =>
    expect(screen.getByTestId("field-channelId").querySelectorAll("option")).toHaveLength(expectedOptions),
  );
}

function typeMessage(text: string) {
  fireEvent.change(screen.getByTestId("field-content"), { target: { value: text } });
}

function submit() {
  fireEvent.click(screen.getByTestId("submit"));
}

describe("Send Message", () => {
  it("offers every channel the relay returned", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    render(<Command />);
    await ready(2);
    const options = Array.from(screen.getByTestId("field-channelId").querySelectorAll("option"));
    expect(options.map((o) => o.value)).toEqual(["uuid-1", "uuid-2"]);
    expect(options.map((o) => o.textContent)).toEqual(["general", "random"]);
  });

  it("labels a nameless channel with its id in the dropdown", async () => {
    mocks.getClient.mockReturnValue(fakeClient({ listChannels: vi.fn(async () => [{ id: "uuid-3", name: "" }]) }));
    render(<Command />);
    await ready(1);
    expect(screen.getByTestId("field-channelId").querySelector("option")).toHaveTextContent("uuid-3");
  });

  it("sends the typed message to the selected channel", async () => {
    const client = fakeClient();
    mocks.getClient.mockReturnValue(client);
    render(<Command />);
    await ready(2);

    fireEvent.change(screen.getByTestId("field-channelId"), { target: { value: "uuid-2" } });
    typeMessage("hello from raycast");
    submit();

    await waitFor(() => expect(client.sendMessage).toHaveBeenCalledWith("uuid-2", "hello from raycast"));
  });

  it("defaults to the first channel when none is picked explicitly", async () => {
    const client = fakeClient();
    mocks.getClient.mockReturnValue(client);
    render(<Command />);
    await ready(2);

    typeMessage("hi");
    submit();

    await waitFor(() => expect(client.sendMessage).toHaveBeenCalledWith("uuid-1", "hi"));
  });

  it("confirms a sent message and returns to the root", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    render(<Command />);
    await ready(2);

    typeMessage("hi");
    submit();

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({ style: Toast.Style.Success, title: "Message sent" }),
      ),
    );
    expect(popToRoot).toHaveBeenCalled();
  });

  it("refuses an empty message without calling the relay", async () => {
    const client = fakeClient();
    mocks.getClient.mockReturnValue(client);
    render(<Command />);
    await ready(2);

    submit();

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({ style: Toast.Style.Failure, title: "Message is empty" }),
      ),
    );
    expect(client.sendMessage).not.toHaveBeenCalled();
    expect(popToRoot).not.toHaveBeenCalled();
  });

  it("refuses a whitespace-only message", async () => {
    const client = fakeClient();
    mocks.getClient.mockReturnValue(client);
    render(<Command />);
    await ready(2);

    typeMessage("    ");
    submit();

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Message is empty" })));
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it("refuses to send when the relay exposed no channels", async () => {
    // With an empty dropdown there is no channel id to publish against, so the
    // message would go out with an empty h tag.
    const client = fakeClient({ listChannels: vi.fn(async () => []) });
    mocks.getClient.mockReturnValue(client);
    render(<Command />);
    await waitFor(() => expect(screen.getByTestId("form")).toHaveAttribute("data-loading", "false"));

    typeMessage("hi");
    submit();

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({ style: Toast.Style.Failure, title: "Pick a channel" }),
      ),
    );
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it("refuses to send while the channel list is still loading", async () => {
    const client = fakeClient({ listChannels: vi.fn(() => new Promise(() => {})) });
    mocks.getClient.mockReturnValue(client);
    render(<Command />);
    await waitFor(() => expect(screen.getByTestId("form")).toHaveAttribute("data-loading", "true"));

    typeMessage("hi");
    submit();

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({ style: Toast.Style.Failure, title: "Still loading channels" }),
      ),
    );
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it("reports a rejected send with the relay's reason and stays open", async () => {
    const client = fakeClient({
      sendMessage: vi.fn(async () => {
        throw new Error("Relay rejected the request: restricted");
      }),
    });
    mocks.getClient.mockReturnValue(client);
    render(<Command />);
    await ready(2);

    typeMessage("hi");
    submit();

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({
          style: Toast.Style.Failure,
          title: "Send failed",
          message: "Relay rejected the request: restricted",
        }),
      ),
    );
    expect(popToRoot).not.toHaveBeenCalled();
  });

  it("stringifies a non-Error send failure", async () => {
    const client = fakeClient({
      sendMessage: vi.fn(async () => {
        throw "socket closed";
      }),
    });
    mocks.getClient.mockReturnValue(client);
    render(<Command />);
    await ready(2);

    typeMessage("hi");
    submit();

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ message: "socket closed" })));
  });

  it("shows the error view when the channel list cannot be loaded", async () => {
    mocks.getClient.mockImplementation(() => {
      throw new Error("Set your Buzz relay URL (https:// or wss://) in extension preferences");
    });
    render(<Command />);
    await waitFor(() =>
      expect(screen.getByTestId("empty-view")).toHaveAttribute(
        "data-description",
        "Set your Buzz relay URL (https:// or wss://) in extension preferences",
      ),
    );
  });
});
