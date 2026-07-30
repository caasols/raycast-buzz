import { describe, it, expect } from "vitest";
import { EMOJI } from "./emoji";

describe("EMOJI dataset", () => {
  it("is a non-trivial curated list", () => {
    expect(EMOJI.length).toBeGreaterThanOrEqual(80);
  });

  it("has a unique shortcode for every entry", () => {
    expect(new Set(EMOJI.map((e) => e.shortcode)).size).toBe(EMOJI.length);
  });

  it("has a unique character for every entry", () => {
    expect(new Set(EMOJI.map((e) => e.char)).size).toBe(EMOJI.length);
  });

  it("wraps every shortcode in colons", () => {
    for (const entry of EMOJI) {
      expect(entry.shortcode).toMatch(/^:[a-z0-9_+-]+:$/);
    }
  });

  it("gives every entry non-empty keywords, which the dropdown item passes to Raycast's filter", () => {
    for (const entry of EMOJI) {
      expect(entry.keywords.trim().length).toBeGreaterThan(0);
    }
  });

  it("covers the situations a work status actually needs", () => {
    const shortcodes = EMOJI.map((e) => e.shortcode);
    for (const required of [":calendar:", ":brain:", ":fork_and_knife:", ":palm_tree:", ":house_with_garden:"]) {
      expect(shortcodes).toContain(required);
    }
  });
});
