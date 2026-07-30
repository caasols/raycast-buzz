/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { showToast, Toast } from "@raycast/api";
import { StatusForm } from "./status-form";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

function submit() {
  fireEvent.click(screen.getByTestId("submit"));
}

describe("StatusForm", () => {
  it("uses the submit title it was given", () => {
    render(<StatusForm submitTitle="Create Preset" onSubmit={vi.fn()} />);
    expect(screen.getByTestId("submit")).toHaveAttribute("data-title", "Create Preset");
  });

  it("submits the typed text", async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<StatusForm submitTitle="Set Status" onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId("field-text"), { target: { value: "heads down" } });
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ emoji: "", text: "heads down" }));
  });

  it("submits the chosen emoji", async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<StatusForm submitTitle="Set Status" onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId("field-emoji"), { target: { value: "\u{1F9E0}" } });
    fireEvent.change(screen.getByTestId("field-text"), { target: { value: "focus" } });
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ emoji: "\u{1F9E0}", text: "focus" }));
  });

  it("prefills from the initial values it was given", () => {
    render(
      <StatusForm submitTitle="Save Preset" initialEmoji={"\u{1F9E0}"} initialText="Focus time" onSubmit={vi.fn()} />,
    );
    expect(screen.getByTestId("field-text")).toHaveValue("Focus time");
    expect(screen.getByTestId("field-emoji")).toHaveValue("\u{1F9E0}");
  });

  it("refuses a submit with neither emoji nor text", async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<StatusForm submitTitle="Set Status" onSubmit={onSubmit} />);
    submit();
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({ style: Toast.Style.Failure, title: "Add an emoji or some text" }),
      ),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("refuses a whitespace-only text with no emoji", async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<StatusForm submitTitle="Set Status" onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId("field-text"), { target: { value: "   " } });
    submit();
    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("allows an emoji with no text", async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<StatusForm submitTitle="Set Status" onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId("field-emoji"), { target: { value: "\u{1F334}" } });
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ emoji: "\u{1F334}", text: "" }));
  });

  it("offers a none option plus one item per emoji", () => {
    render(<StatusForm submitTitle="Set Status" onSubmit={vi.fn()} />);
    const options = screen.getByTestId("field-emoji").querySelectorAll("option");
    expect(options.length).toBeGreaterThan(80);
    expect(options[0]).toHaveValue("");
  });
});
