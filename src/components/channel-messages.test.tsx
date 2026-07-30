/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { showToast, Toast } from "@raycast/api";
import { ChannelMessages } from "./channel-messages";
import type { BuzzClient } from "../lib/buzz-client";
import type { Channel, Message } from "../lib/types";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const CHANNEL: Channel = { id: "chan-1", name: "general", about: "the main room" };

function message(partial: Partial<Message>): Message {
  return {
    id: "m1",
    author: "abcdef0123456789",
    content: "hello",
    createdAt: 1700000000,
    channelId: "chan-1",
    ...partial,
  };
}

function fakeClient(overrides: Partial<Record<keyof BuzzClient, unknown>> = {}) {
  return {
    getMessages: vi.fn(async () => [message({})]),
    react: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as BuzzClient;
}

async function items() {
  return waitFor(() => {
    const found = screen.getAllByTestId("list-item");
    expect(found.length).toBeGreaterThan(0);
    return found;
  });
}

describe("ChannelMessages", () => {
  it("loads the messages for the channel it was given", async () => {
    const client = fakeClient();
    render(<ChannelMessages client={client} channel={CHANNEL} />);
    await waitFor(() => expect(client.getMessages).toHaveBeenCalledWith("chan-1"));
  });

  it("renders each message with a truncated author as the subtitle", async () => {
    const client = fakeClient({
      getMessages: vi.fn(async () => [
        message({ id: "m1", content: "first" }),
        message({ id: "m2", content: "second" }),
      ]),
    });
    render(<ChannelMessages client={client} channel={CHANNEL} />);
    const rendered = await items();
    expect(rendered).toHaveLength(2);
    expect(rendered[0]).toHaveAttribute("data-title", "first");
    // The author is shortened to 8 characters for display.
    expect(rendered[0]).toHaveAttribute("data-subtitle", "abcdef01");
  });

  it("falls back to a placeholder title for an empty message body", async () => {
    const client = fakeClient({ getMessages: vi.fn(async () => [message({ content: "" })]) });
    render(<ChannelMessages client={client} channel={CHANNEL} />);
    const rendered = await items();
    expect(rendered[0]).toHaveAttribute("data-title", "(no content)");
  });

  it("shows the empty view when the channel has no messages", async () => {
    const client = fakeClient({ getMessages: vi.fn(async () => []) });
    render(<ChannelMessages client={client} channel={CHANNEL} />);
    await waitFor(() => expect(screen.getByTestId("empty-view")).toHaveAttribute("data-title", "No messages"));
    expect(screen.queryAllByTestId("list-item")).toHaveLength(0);
  });

  it("titles the view with the channel name", async () => {
    render(<ChannelMessages client={fakeClient()} channel={CHANNEL} />);
    await waitFor(() => expect(screen.getByTestId("list")).toHaveAttribute("data-navigation-title", "general"));
  });

  it("falls back to the channel id when the channel has no name", async () => {
    render(<ChannelMessages client={fakeClient()} channel={{ id: "chan-2", name: "" }} />);
    await waitFor(() => expect(screen.getByTestId("list")).toHaveAttribute("data-navigation-title", "chan-2"));
  });

  it("surfaces a load failure through the error view", async () => {
    const client = fakeClient({
      getMessages: vi.fn(async () => {
        throw new Error("Cannot reach relay at https://relay.test");
      }),
    });
    render(<ChannelMessages client={client} channel={CHANNEL} />);
    await waitFor(() =>
      expect(screen.getByTestId("empty-view")).toHaveAttribute(
        "data-description",
        "Cannot reach relay at https://relay.test",
      ),
    );
  });

  it("offers Open in Buzz as the first action, targeting the message's deep link", async () => {
    render(<ChannelMessages client={fakeClient()} channel={CHANNEL} />);
    await items();
    const actions = screen.getAllByTestId("action");
    expect(actions[0]).toHaveAttribute("data-title", "Open in Buzz");
    expect(actions[0]).toHaveAttribute("data-target", "buzz://message?channel=chan-1&id=m1");
  });

  it("offers Copy Link carrying the same deep link", async () => {
    render(<ChannelMessages client={fakeClient()} channel={CHANNEL} />);
    await items();
    const copy = screen.getAllByTestId("action").find((b) => b.dataset.title === "Copy Link");
    expect(copy).toHaveAttribute("data-content", "buzz://message?channel=chan-1&id=m1");
  });

  it("falls back to the channel being viewed when the message carries no channel id", async () => {
    const client = fakeClient({ getMessages: vi.fn(async () => [message({ channelId: "" })]) });
    render(<ChannelMessages client={client} channel={CHANNEL} />);
    await items();
    const open = screen.getAllByTestId("action").find((b) => b.dataset.title === "Open in Buzz");
    // The h tag is authoritative where it exists; inside a channel we already
    // know which one we are looking at, so a tagless message is still linkable.
    expect(open).toHaveAttribute("data-target", "buzz://message?channel=chan-1&id=m1");
  });

  it("keeps React (Like) available, just not on Enter", async () => {
    const client = fakeClient();
    render(<ChannelMessages client={client} channel={CHANNEL} />);
    await items();
    const react = screen.getAllByTestId("action").find((b) => b.dataset.title === "React (Like)");
    expect(react).toBeDefined();
    fireEvent.click(react!);
    await waitFor(() => expect(client.react).toHaveBeenCalledWith("m1", "chan-1", "+"));
  });
});

describe("ChannelMessages react action", () => {
  it("publishes a NIP-25 '+' like for the message and channel", async () => {
    const client = fakeClient();
    render(<ChannelMessages client={client} channel={CHANNEL} />);
    await items();

    fireEvent.click(screen.getAllByTestId("action").find((b) => b.dataset.title === "React (Like)")!);

    await waitFor(() => expect(client.react).toHaveBeenCalledWith("m1", "chan-1", "+"));
  });

  it("confirms a successful reaction with a success toast", async () => {
    render(<ChannelMessages client={fakeClient()} channel={CHANNEL} />);
    await items();

    fireEvent.click(screen.getAllByTestId("action").find((b) => b.dataset.title === "React (Like)")!);

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({ style: Toast.Style.Success, title: "Reaction sent" }),
      ),
    );
  });

  it("reloads the message list after a successful reaction", async () => {
    const client = fakeClient();
    render(<ChannelMessages client={client} channel={CHANNEL} />);
    await items();
    expect(client.getMessages).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByTestId("action").find((b) => b.dataset.title === "React (Like)")!);

    await waitFor(() => expect(client.getMessages).toHaveBeenCalledTimes(2));
  });

  it("reports a rejected reaction with the relay's reason and does not reload", async () => {
    const client = fakeClient({
      react: vi.fn(async () => {
        throw new Error("Relay rejected the request: restricted");
      }),
    });
    render(<ChannelMessages client={client} channel={CHANNEL} />);
    await items();

    fireEvent.click(screen.getAllByTestId("action").find((b) => b.dataset.title === "React (Like)")!);

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({
          style: Toast.Style.Failure,
          title: "Reaction failed",
          message: "Relay rejected the request: restricted",
        }),
      ),
    );
    // The list is only revalidated on success.
    expect(client.getMessages).toHaveBeenCalledTimes(1);
  });

  it("stringifies a non-Error rejection into the failure toast", async () => {
    const client = fakeClient({
      react: vi.fn(async () => {
        throw "socket closed";
      }),
    });
    render(<ChannelMessages client={client} channel={CHANNEL} />);
    await items();

    fireEvent.click(screen.getAllByTestId("action").find((b) => b.dataset.title === "React (Like)")!);

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ message: "socket closed" })));
  });

  it("offers copy actions for the message body and its id", async () => {
    render(<ChannelMessages client={fakeClient()} channel={CHANNEL} />);
    await items();

    const copies = screen.getAllByTestId("action").filter((b) => b.dataset.kind === "copy");
    expect(copies.map((b) => b.dataset.content)).toEqual(["buzz://message?channel=chan-1&id=m1", "hello", "m1"]);
  });
});
