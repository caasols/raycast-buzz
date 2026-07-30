/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { showToast, popToRoot, Toast } from "@raycast/api";

const mocks = vi.hoisted(() => ({ getClient: vi.fn() }));
vi.mock("./lib/preferences", () => ({ getClient: mocks.getClient }));

import Command from "./set-status";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClient.mockReset();
});

function fakeClient(overrides: Record<string, unknown> = {}) {
  return { setStatus: vi.fn(async () => undefined), ...overrides };
}

function fill(field: "text" | "emoji", value: string) {
  fireEvent.change(screen.getByTestId(`field-${field}`), { target: { value } });
}

function submit() {
  fireEvent.click(screen.getByTestId("submit"));
}

describe("Set Status", () => {
  it("publishes the status text with no emoji when none is given", async () => {
    const client = fakeClient();
    mocks.getClient.mockReturnValue(client);
    render(<Command />);

    fill("text", "heads down");
    submit();

    await waitFor(() => expect(client.setStatus).toHaveBeenCalledWith("heads down", undefined));
  });

  it("passes a supplied emoji through to the client", async () => {
    const client = fakeClient();
    mocks.getClient.mockReturnValue(client);
    render(<Command />);

    fill("text", "in a meeting");
    fill("emoji", ":calendar:");
    submit();

    await waitFor(() => expect(client.setStatus).toHaveBeenCalledWith("in a meeting", ":calendar:"));
  });

  it("treats a whitespace-only emoji as no emoji", async () => {
    const client = fakeClient();
    mocks.getClient.mockReturnValue(client);
    render(<Command />);

    fill("text", "away");
    fill("emoji", "   ");
    submit();

    await waitFor(() => expect(client.setStatus).toHaveBeenCalledWith("away", undefined));
  });

  it("confirms the update and returns to the root", async () => {
    mocks.getClient.mockReturnValue(fakeClient());
    render(<Command />);

    fill("text", "heads down");
    submit();

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({ style: Toast.Style.Success, title: "Status updated" }),
      ),
    );
    expect(popToRoot).toHaveBeenCalled();
  });

  it("refuses an empty status without calling the relay", async () => {
    const client = fakeClient();
    mocks.getClient.mockReturnValue(client);
    render(<Command />);

    submit();

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({ style: Toast.Style.Failure, title: "Status is empty" }),
      ),
    );
    expect(client.setStatus).not.toHaveBeenCalled();
    expect(popToRoot).not.toHaveBeenCalled();
  });

  it("refuses a whitespace-only status", async () => {
    const client = fakeClient();
    mocks.getClient.mockReturnValue(client);
    render(<Command />);

    fill("text", "   ");
    submit();

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Status is empty" })));
    expect(client.setStatus).not.toHaveBeenCalled();
  });

  it("reports a misconfiguration as a toast, since this command has no list view", async () => {
    mocks.getClient.mockImplementation(() => {
      throw new Error("Private key must be a 64-character hex string or an nsec1... key");
    });
    render(<Command />);

    fill("text", "heads down");
    submit();

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({
          style: Toast.Style.Failure,
          title: "Could not set status",
          message: "Private key must be a 64-character hex string or an nsec1... key",
        }),
      ),
    );
    expect(popToRoot).not.toHaveBeenCalled();
  });

  it("reports a rejected status with the relay's reason", async () => {
    mocks.getClient.mockReturnValue(
      fakeClient({
        setStatus: vi.fn(async () => {
          throw new Error("Relay rejected the request: restricted");
        }),
      }),
    );
    render(<Command />);

    fill("text", "heads down");
    submit();

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Could not set status", message: "Relay rejected the request: restricted" }),
      ),
    );
  });

  it("stringifies a non-Error failure", async () => {
    mocks.getClient.mockReturnValue(
      fakeClient({
        setStatus: vi.fn(async () => {
          throw "socket closed";
        }),
      }),
    );
    render(<Command />);

    fill("text", "heads down");
    submit();

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ message: "socket closed" })));
  });
});
