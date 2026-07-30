import { describe, it, expect } from "vitest";
import { EMOJI, emojiSearchTerms } from "./emoji";

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

describe("emojiSearchTerms", () => {
  const find = (shortcode: string) => EMOJI.find((e) => e.shortcode === shortcode)!;

  it("includes the shortcode's own name, which the colons hid from the filter", () => {
    expect(emojiSearchTerms(find(":brain:"))).toContain("brain");
  });

  it("splits an underscored name into its parts as well as the whole", () => {
    const terms = emojiSearchTerms(find(":sneezing_face:"));
    expect(terms).toContain("sneezing_face");
    expect(terms).toContain("sneezing");
    expect(terms).toContain("face");
  });

  it("keeps the curated keywords alongside the derived name", () => {
    const terms = emojiSearchTerms(find(":palm_tree:"));
    expect(terms).toEqual(expect.arrayContaining(["holiday", "vacation", "away", "ooo"]));
  });

  it("never repeats a term when the name already appears in the keywords", () => {
    for (const entry of EMOJI) {
      const terms = emojiSearchTerms(entry);
      expect(new Set(terms).size).toBe(terms.length);
    }
  });

  it("gives every entry at least one term", () => {
    for (const entry of EMOJI) {
      expect(emojiSearchTerms(entry).length).toBeGreaterThan(0);
    }
  });

  it("emits no empty strings, which would match everything", () => {
    for (const entry of EMOJI) {
      expect(emojiSearchTerms(entry).every((t) => t.length > 0)).toBe(true);
    }
  });
});
