/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { showToast, Toast } from "@raycast/api";
// `push` is a stub-only test helper that the real @raycast/api package does
// not declare, so it is imported by relative path rather than through the
// "@raycast/api" specifier (which vitest aliases to this same file for
// runtime resolution; see vitest.config.ts). This keeps `tsc` type-checking
// the rest of the import against the real package's types.
import { push } from "../test/raycast-api-stub";
import type { Channel, DirectMessage, Person } from "./lib/types";

const mocks = vi.hoisted(() => ({ getClient: vi.fn(), searchPeople: vi.fn() }));
vi.mock("./lib/preferences", () => ({ getClient: mocks.getClient }));
vi.mock("./lib/directory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/directory")>()),
  searchPeople: mocks.searchPeople,
}));

import Command from "./send-message";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClient.mockReset();
  mocks.searchPeople.mockReset();
  mocks.searchPeople.mockResolvedValue([]);
});

const CHANNELS: Channel[] = [
  { id: "chan-1", name: "general" },
  { id: "chan-2", name: "random" },
];

const DMS: DirectMessage[] = [{ channelId: "dm-1", participants: ["aa".repeat(32)], name: "Ada" }];

const PEOPLE: Person[] = [{ pubkey: "bb".repeat(32), name: "Bo" }];

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    listChannels: vi.fn(async () => CHANNELS),
    listDirectMessages: vi.fn(async () => DMS),
    openDirectMessage: vi.fn(async () => "opened-chan"),
    sendMessage: vi.fn(async () => undefined),
    ...overrides,
  };
}

function rows() {
  return Array.from(screen.getAllByTestId("list-item"));
}

function rowTitled(title: string) {
  const row = rows().find((r) => r.getAttribute("data-title") === title);
  if (!row) throw new Error(`no row titled ${title}; have ${rows().map((r) => r.getAttribute("data-title"))}`);
  return row;
}

function search(text: string) {
  fireEvent.change(screen.getByTestId("search-bar"), { target: { value: text } });
}

/** Click the named action inside a given row. */
function act(title: string, actionTitle: string) {
  const action = Array.from(rowTitled(title).querySelectorAll("[data-testid='action']")).find(
    (a) => a.getAttribute("data-title") === actionTitle,
  );
  if (!action) throw new Error(`no action ${actionTitle} in row ${title}`);
  fireEvent.click(action);
}

async function loaded() {
  await waitFor(() => expect(rowTitled("general")).toBeTruthy());
}

describe("Send Message", () => {
  it("lists channels and existing conversations in their own sections", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    render(<Command />);
    await loaded();

    expect(rowTitled("general").getAttribute("data-section")).toBe("Channels");
    expect(rowTitled("random").getAttribute("data-section")).toBe("Channels");
    expect(rowTitled("Ada").getAttribute("data-section")).toBe("Direct Messages");
  });

  it("labels a nameless channel with its id", async () => {
    mocks.getClient.mockReturnValue(fakeClient({ listChannels: vi.fn(async () => [{ id: "chan-9", name: "" }]) }));
    render(<Command />);
    await waitFor(() => expect(rowTitled("chan-9")).toBeTruthy());
  });

  it("shows no People section until something is typed", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    mocks.searchPeople.mockResolvedValue(PEOPLE);
    render(<Command />);
    await loaded();

    expect(rows().some((r) => r.getAttribute("data-section") === "People")).toBe(false);
    expect(mocks.searchPeople).not.toHaveBeenCalled();
  });

  it("searches people once something is typed and lists them", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    mocks.searchPeople.mockResolvedValue(PEOPLE);
    render(<Command />);
    await loaded();
    search("bo");

    await waitFor(() => expect(rowTitled("Bo").getAttribute("data-section")).toBe("People"));
    expect(mocks.searchPeople).toHaveBeenCalledWith(expect.anything(), "bo");
  });

  it("opens the composer for a channel with that channel's id", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    render(<Command />);
    await loaded();
    act("general", "Write Message");

    const pushed = await screen.findByTestId("pushed-view");
    expect(pushed.querySelector("[data-testid='form-description']")?.textContent).toContain("general");
    expect(pushed.querySelector("[data-testid='field-content']")).toBeTruthy();
  });

  it("opens the composer for an existing conversation without publishing anything", async () => {
    const client = fakeClient();
    mocks.getClient.mockReturnValue(client);
    render(<Command />);
    await loaded();
    act("Ada", "Write Message");

    await screen.findByTestId("pushed-view");
    expect(client.openDirectMessage).not.toHaveBeenCalled();
  });

  it("opens a conversation before composing when a person is picked", async () => {
    const client = fakeClient();
    mocks.getClient.mockReturnValue(client);
    mocks.searchPeople.mockResolvedValue(PEOPLE);
    render(<Command />);
    await loaded();
    search("bo");
    await waitFor(() => expect(rowTitled("Bo")).toBeTruthy());
    act("Bo", "Write Message");

    await waitFor(() => expect(client.openDirectMessage).toHaveBeenCalledWith("bb".repeat(32)));
    await waitFor(() => expect(push).toHaveBeenCalled());
    const view = push.mock.calls[0][0];
    expect(view.props.channelId).toBe("opened-chan");
    expect(view.props.destination).toBe("Bo");
  });

  it("does not compose when opening the conversation fails", async () => {
    const client = fakeClient({
      openDirectMessage: vi.fn(async () => {
        throw new Error("Relay rejected the request: not allowed");
      }),
    });
    mocks.getClient.mockReturnValue(client);
    mocks.searchPeople.mockResolvedValue(PEOPLE);
    render(<Command />);
    await loaded();
    search("bo");
    await waitFor(() => expect(rowTitled("Bo")).toBeTruthy());
    act("Bo", "Write Message");

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith({
        style: Toast.Style.Failure,
        title: "Could not open the conversation",
        message: "Relay rejected the request: not allowed",
      }),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("reports a non-Error open failure as text", async () => {
    const client = fakeClient({
      openDirectMessage: vi.fn(async () => {
        throw "socket closed";
      }),
    });
    mocks.getClient.mockReturnValue(client);
    mocks.searchPeople.mockResolvedValue(PEOPLE);
    render(<Command />);
    await loaded();
    search("bo");
    await waitFor(() => expect(rowTitled("Bo")).toBeTruthy());
    act("Bo", "Write Message");

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith({
        style: Toast.Style.Failure,
        title: "Could not open the conversation",
        message: "socket closed",
      }),
    );
  });

  it("keeps channels visible when the people search fails", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    mocks.searchPeople.mockRejectedValue(new Error("search unavailable"));
    render(<Command />);
    await loaded();
    search("bo");

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith({
        style: Toast.Style.Failure,
        title: "People search failed",
        message: "search unavailable",
      }),
    );
    expect(rowTitled("general")).toBeTruthy();
  });

  it("reports a non-Error search failure as text", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    mocks.searchPeople.mockRejectedValue("boom");
    render(<Command />);
    await loaded();
    search("bo");

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith({
        style: Toast.Style.Failure,
        title: "People search failed",
        message: "boom",
      }),
    );
  });

  it("offers a copy action for a channel id", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    render(<Command />);
    await loaded();
    const copy = Array.from(rowTitled("general").querySelectorAll("[data-testid='action']")).find(
      (a) => a.getAttribute("data-kind") === "copy",
    );
    expect(copy?.getAttribute("data-content")).toBe("chan-1");
  });

  it("renders the error view when the relay cannot be reached", async () => {
    mocks.getClient.mockImplementation(() => {
      throw new Error("Cannot reach relay at https://relay.example");
    });
    render(<Command />);
    await waitFor(() =>
      expect(screen.getByTestId("empty-view")).toHaveAttribute(
        "data-description",
        "Cannot reach relay at https://relay.example",
      ),
    );
  });

  it("shows an empty state when there is nothing to write to", async () => {
    mocks.getClient.mockReturnValue(
      fakeClient({ listChannels: vi.fn(async () => []), listDirectMessages: vi.fn(async () => []) }),
    );
    render(<Command />);
    await waitFor(() => expect(screen.getByTestId("empty-view")).toHaveAttribute("data-title", "Nothing to write to"));
  });
});
