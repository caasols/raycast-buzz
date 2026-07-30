/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { Message } from "./lib/types";

const mocks = vi.hoisted(() => ({ getClient: vi.fn() }));
vi.mock("./lib/preferences", () => ({ getClient: mocks.getClient }));

import Command from "./search-messages";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClient.mockReset();
});

function message(partial: Partial<Message>): Message {
  return {
    id: "m1",
    author: "abcdef0123456789",
    content: "hello world",
    createdAt: 1700000000,
    channelId: "chan-1",
    ...partial,
  };
}

function fakeClient(overrides: Record<string, unknown> = {}) {
  return { searchMessages: vi.fn(async () => [message({})]), ...overrides };
}

function type(text: string) {
  fireEvent.change(screen.getByTestId("search-bar"), { target: { value: text } });
}

describe("Search Messages", () => {
  it("shows a configuration error on mount, before anything is typed", async () => {
    // Regression guard: the client used to be built only for a non-empty query,
    // which left a bad relay URL or key invisible behind the neutral empty view.
    mocks.getClient.mockImplementation(() => {
      throw new Error("Private key must be a 64-character hex string or an nsec1... key");
    });
    render(<Command />);
    await waitFor(() =>
      expect(screen.getByTestId("empty-view")).toHaveAttribute(
        "data-description",
        "Private key must be a 64-character hex string or an nsec1... key",
      ),
    );
  });

  it("prompts for a query before searching anything", async () => {
    const client = fakeClient();
    mocks.getClient.mockReturnValue(client);
    render(<Command />);
    await waitFor(() => expect(screen.getByTestId("empty-view")).toHaveAttribute("data-title", "Search Buzz messages"));
    expect(client.searchMessages).not.toHaveBeenCalled();
  });

  it("searches the relay for what was typed", async () => {
    const client = fakeClient();
    mocks.getClient.mockReturnValue(client);
    render(<Command />);
    type("hello");
    await waitFor(() => expect(client.searchMessages).toHaveBeenCalledWith("hello"));
  });

  it("does not search for a whitespace-only query", async () => {
    const client = fakeClient();
    mocks.getClient.mockReturnValue(client);
    render(<Command />);
    type("   ");
    await waitFor(() => expect(screen.getByTestId("list")).toBeInTheDocument());
    expect(client.searchMessages).not.toHaveBeenCalled();
  });

  it("renders the matching messages with a truncated author", async () => {
    mocks.getClient.mockReturnValue(
      fakeClient({
        searchMessages: vi.fn(async () => [
          message({ id: "m1", content: "hello world" }),
          message({ id: "m2", content: "hello again" }),
        ]),
      }),
    );
    render(<Command />);
    type("hello");

    const rendered = await waitFor(() => {
      const found = screen.getAllByTestId("list-item");
      expect(found).toHaveLength(2);
      return found;
    });
    expect(rendered.map((el) => el.dataset.title)).toEqual(["hello world", "hello again"]);
    expect(rendered[0]).toHaveAttribute("data-subtitle", "abcdef01");
  });

  it("surfaces a relay failure through the error view", async () => {
    mocks.getClient.mockReturnValue(
      fakeClient({
        searchMessages: vi.fn(async () => {
          throw new Error("Relay rejected the request (status 401)");
        }),
      }),
    );
    render(<Command />);
    type("hello");
    await waitFor(() =>
      expect(screen.getByTestId("empty-view")).toHaveAttribute(
        "data-description",
        "Relay rejected the request (status 401)",
      ),
    );
  });
});
