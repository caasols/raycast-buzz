import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BuzzClient, RelayError, __resetReplaceableClock, __nextReplaceableCreatedAt } from "./buzz-client";
import { parseSecretKey, signEvent } from "./nostr";
import type { NostrEvent } from "./types";

const SK = parseSecretKey("0000000000000000000000000000000000000000000000000000000000000001");
const fetchMock = () => globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

afterEach(() => vi.unstubAllGlobals());

describe("BuzzClient.query", () => {
  it("posts filters as a JSON array to /query with a NIP-98 header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([{ id: "e1" }]), { status: 200 })),
    );
    const client = new BuzzClient("https://relay.test", SK);
    const events = await client.query([{ kinds: [39000] }]);
    expect(events).toEqual([{ id: "e1" }]);

    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toBe("https://relay.test/query");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization.startsWith("Nostr ")).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual([{ kinds: [39000] }]);
  });

  it("strips a trailing slash from the relay URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 })),
    );
    const client = new BuzzClient("https://relay.test/", SK);
    await client.query([{ kinds: [9] }]);
    expect(fetchMock().mock.calls[0][0]).toBe("https://relay.test/query");
  });

  it("throws RelayError on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("denied", { status: 401 })),
    );
    const client = new BuzzClient("https://relay.test", SK);
    await expect(client.query([{ kinds: [9] }])).rejects.toBeInstanceOf(RelayError);
  });

  it("surfaces the relay's JSON error body in the RelayError message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "invalid: kind 20001 is only accepted via WebSocket" }), {
            status: 400,
          }),
      ),
    );
    const client = new BuzzClient("https://relay.test", SK);
    await expect(client.query([{ kinds: [9] }])).rejects.toThrow(/invalid: kind 20001/);
  });

  it("reports an unreachable relay without echoing the underlying fetch error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED 10.0.0.1:443 body=<secret>");
      }),
    );
    const client = new BuzzClient("https://relay.test", SK);
    await expect(client.query([{ kinds: [9] }])).rejects.toThrow("Cannot reach relay at https://relay.test");
    await expect(client.query([{ kinds: [9] }])).rejects.not.toThrow(/secret|ECONNREFUSED/);
  });

  it("omits the detail suffix when an error response has an empty body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    const client = new BuzzClient("https://relay.test", SK);
    await expect(client.query([{ kinds: [9] }])).rejects.toThrow("Relay rejected the request (status 500)");
  });

  it("still reports the status when the error body cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 502,
        text: async () => {
          throw new Error("stream closed");
        },
      })),
    );
    const client = new BuzzClient("https://relay.test", SK);
    await expect(client.query([{ kinds: [9] }])).rejects.toThrow("Relay rejected the request (status 502)");
  });

  it("uses a non-JSON error body verbatim", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream timeout", { status: 504 })),
    );
    const client = new BuzzClient("https://relay.test", SK);
    await expect(client.query([{ kinds: [9] }])).rejects.toThrow(/upstream timeout/);
  });

  it("bounds a long relay error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "x".repeat(500) }), { status: 400 })),
    );
    const client = new BuzzClient("https://relay.test", SK);
    await expect(client.query([{ kinds: [9] }])).rejects.toThrow(/x{200}(?!x)/);
  });

  it("ignores a JSON error body whose error field is not a string", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { code: 7 } }), { status: 400 })),
    );
    const client = new BuzzClient("https://relay.test", SK);
    // Falls back to the raw body rather than rendering "[object Object]".
    await expect(client.query([{ kinds: [9] }])).rejects.toThrow(/\{"error":\{"code":7\}\}/);
  });

  it("throws RelayError instead of a TypeError when the body is not an array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: null }), { status: 200 })),
    );
    const client = new BuzzClient("https://relay.test", SK);
    await expect(client.query([{ kinds: [9] }])).rejects.toBeInstanceOf(RelayError);
    await expect(client.query([{ kinds: [9] }])).rejects.toThrow(/unexpected response/);
  });
});

describe("BuzzClient.publish", () => {
  it("defaults accepted to false and message to empty when the relay omits them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ event_id: "abc" }), { status: 200 })),
    );
    const client = new BuzzClient("https://relay.test", SK);
    const ev = signEvent({ kind: 9, created_at: 1700000000, tags: [], content: "hi" }, SK);
    expect(await client.publish(ev)).toEqual({ accepted: false, message: "" });
  });

  it("posts a single signed event to /events and returns accepted/message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ event_id: "abc", accepted: true, message: "" }), { status: 200 }),
      ),
    );
    const client = new BuzzClient("https://relay.test", SK);
    const ev = signEvent({ kind: 9, created_at: 1700000000, tags: [["h", "c"]], content: "hi" }, SK);
    const res = await client.publish(ev);
    expect(res).toEqual({ accepted: true, message: "" });

    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toBe("https://relay.test/events");
    expect(JSON.parse(init.body as string).kind).toBe(9);
  });
});

function ev(partial: Partial<NostrEvent>): NostrEvent {
  return { id: "", pubkey: "", created_at: 0, kind: 0, tags: [], content: "", sig: "", ...partial };
}

describe("BuzzClient.listChannels", () => {
  it("queries kind 39000 and maps d/name/about tags", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    const qSpy = vi.spyOn(client, "query").mockResolvedValue([
      ev({
        kind: 39000,
        tags: [
          ["d", "uuid-1"],
          ["name", "general"],
          ["about", "the main room"],
        ],
      }),
    ]);
    const channels = await client.listChannels();
    expect(qSpy).toHaveBeenCalledWith([{ kinds: [39000] }]);
    expect(channels).toEqual([{ id: "uuid-1", name: "general", about: "the main room" }]);
  });

  it("keeps an identified channel that carries no name or about tag", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    vi.spyOn(client, "query").mockResolvedValue([ev({ kind: 39000, tags: [["d", "uuid-9"]] })]);
    expect(await client.listChannels()).toEqual([{ id: "uuid-9", name: "", about: undefined }]);
  });

  it("drops channels with no d tag, which have no usable identifier", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    vi.spyOn(client, "query").mockResolvedValue([
      ev({ kind: 39000, tags: [["name", "no-identifier"]] }),
      ev({
        kind: 39000,
        tags: [
          ["d", "uuid-1"],
          ["name", "general"],
        ],
      }),
      ev({ kind: 39000, tags: [["name", "also-no-identifier"]] }),
    ]);
    const channels = await client.listChannels();
    expect(channels).toEqual([{ id: "uuid-1", name: "general", about: undefined }]);
  });
});

describe("BuzzClient.getMessages", () => {
  it("builds a kind:9 #h filter with an over-fetched limit and returns newest-first", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    const qSpy = vi
      .spyOn(client, "query")
      .mockResolvedValue([
        ev({ id: "old", pubkey: "a", created_at: 100, kind: 9, tags: [["h", "chan"]], content: "old" }),
        ev({ id: "new", pubkey: "b", created_at: 200, kind: 9, tags: [["h", "chan"]], content: "new" }),
      ]);
    const { messages: msgs } = await client.getMessages("chan", 10);
    expect(qSpy).toHaveBeenCalledWith([{ kinds: [9], "#h": ["chan"], limit: 40 }]);
    expect(msgs.map((m) => m.content)).toEqual(["new", "old"]);
    expect(msgs[0]).toMatchObject({ id: "new", author: "b", channelId: "chan", createdAt: 200, replyCount: 0 });
  });

  it("defaults the limit to 50, over-fetched", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    const qSpy = vi.spyOn(client, "query").mockResolvedValue([]);
    await client.getMessages("chan");
    expect(qSpy).toHaveBeenCalledWith([{ kinds: [9], "#h": ["chan"], limit: 200 }]);
  });
});

describe("BuzzClient.getMessages thread collapsing", () => {
  const ROOT = "a".repeat(64);

  function reply(id: string, rootId: string, extraTags: string[][] = []) {
    return ev({
      id,
      kind: 9,
      created_at: 50,
      content: "a reply",
      tags: [["h", "chan"], ["e", rootId, "", "root"], ["e", rootId, "", "reply"], ...extraTags],
    });
  }

  it("hides thread replies and keeps the root", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    vi.spyOn(client, "query").mockResolvedValue([
      ev({ id: ROOT, kind: 9, created_at: 10, content: "the question", tags: [["h", "chan"]] }),
      reply("r1", ROOT),
      reply("r2", ROOT),
    ]);
    const { messages: msgs } = await client.getMessages("chan");
    expect(msgs.map((m) => m.id)).toEqual([ROOT]);
  });

  it("counts the hidden replies against their root", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    vi.spyOn(client, "query").mockResolvedValue([
      ev({ id: ROOT, kind: 9, created_at: 10, content: "the question", tags: [["h", "chan"]] }),
      reply("r1", ROOT),
      reply("r2", ROOT),
    ]);
    expect((await client.getMessages("chan")).messages[0].replyCount).toBe(2);
  });

  it("reports zero replies for a message that has none", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    vi.spyOn(client, "query").mockResolvedValue([
      ev({ id: ROOT, kind: 9, created_at: 10, content: "alone", tags: [["h", "chan"]] }),
    ]);
    expect((await client.getMessages("chan")).messages[0].replyCount).toBe(0);
  });

  it("keeps a broadcast reply visible, as Buzz does", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    vi.spyOn(client, "query").mockResolvedValue([
      ev({ id: ROOT, kind: 9, created_at: 10, content: "the question", tags: [["h", "chan"]] }),
      reply("b1", ROOT, [["broadcast", "1"]]),
    ]);
    const { messages: msgs } = await client.getMessages("chan");
    expect(msgs.map((m) => m.id).sort()).toEqual([ROOT, "b1"].sort());
  });

  it("counts a broadcast reply against its root as well as showing it", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    vi.spyOn(client, "query").mockResolvedValue([
      ev({ id: ROOT, kind: 9, created_at: 10, content: "the question", tags: [["h", "chan"]] }),
      reply("b1", ROOT, [["broadcast", "1"]]),
    ]);
    const { messages: msgs } = await client.getMessages("chan");
    const root = msgs.find((m) => m.id === ROOT);
    expect(root?.replyCount).toBe(1);
  });

  it("loses the count when the root fell outside the fetched window", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    vi.spyOn(client, "query").mockResolvedValue([reply("r1", "some-root-we-did-not-fetch")]);
    // The reply is hidden and there is no visible root to attribute it to. This
    // is accepted rather than papered over: fetchedCount stays 1 so the caller
    // can tell "all replies, root out of window" apart from a truly empty channel.
    expect(await client.getMessages("chan")).toEqual({ messages: [], fetchedCount: 1 });
  });

  it("reports fetchedCount 0 for a genuinely empty channel", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    vi.spyOn(client, "query").mockResolvedValue([]);
    expect(await client.getMessages("chan")).toEqual({ messages: [], fetchedCount: 0 });
  });

  it("over-fetches so filtering does not empty a channel that is mostly replies", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    // 3 roots plus 12 replies to the first root: a plain (non-over-fetched)
    // limit of 5 would return only replies to root0, none of which are roots.
    const events = [
      ev({ id: "root0", kind: 9, created_at: 100, content: "root0", tags: [["h", "chan"]] }),
      ev({ id: "root1", kind: 9, created_at: 90, content: "root1", tags: [["h", "chan"]] }),
      ev({ id: "root2", kind: 9, created_at: 80, content: "root2", tags: [["h", "chan"]] }),
      ...Array.from({ length: 12 }, (_, i) => reply(`r${i}`, "root0")),
    ];
    vi.spyOn(client, "query").mockResolvedValue(events);
    const { messages: msgs } = await client.getMessages("chan", 5);
    expect(msgs.map((m) => m.id)).toEqual(["root0", "root1", "root2"]);
  });

  it("never asks for more than the relay's 500 result ceiling", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    const qSpy = vi.spyOn(client, "query").mockResolvedValue([]);
    await client.getMessages("chan", 400);
    expect(qSpy.mock.calls[0][0][0].limit).toBe(500);
  });

  it("trims the collapsed result back to the requested limit", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    vi.spyOn(client, "query").mockResolvedValue(
      Array.from({ length: 10 }, (_, i) =>
        ev({ id: `m${i}`, kind: 9, created_at: i, content: "x", tags: [["h", "chan"]] }),
      ),
    );
    const { messages: msgs } = await client.getMessages("chan", 3);
    // Fixture is 10 root messages with ascending created_at (m0..m9), so the
    // newest three, newest-first, are m9/m8/m7. Asserting only the length would
    // still pass if the implementation sliced before sorting instead of after.
    expect(msgs.map((m) => m.id)).toEqual(["m9", "m8", "m7"]);
  });

  it("still returns newest first after collapsing", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    vi.spyOn(client, "query").mockResolvedValue([
      ev({ id: "old", kind: 9, created_at: 10, content: "old", tags: [["h", "chan"]] }),
      ev({ id: "new", kind: 9, created_at: 99, content: "new", tags: [["h", "chan"]] }),
    ]);
    expect((await client.getMessages("chan")).messages.map((m) => m.id)).toEqual(["new", "old"]);
  });
});

describe("BuzzClient message mapping", () => {
  it("maps a message with no h tag to an empty channel id", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    vi.spyOn(client, "query").mockResolvedValue([ev({ id: "m", pubkey: "a", created_at: 1, kind: 9, content: "x" })]);
    const { messages: msgs } = await client.getMessages("chan");
    expect(msgs[0].channelId).toBe("");
  });
});

describe("BuzzClient.searchMessages", () => {
  it("defaults the limit to 50 when no options are given", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    const qSpy = vi.spyOn(client, "query").mockResolvedValue([]);
    await client.searchMessages("hello");
    expect(qSpy).toHaveBeenCalledWith([{ search: "hello", kinds: [9], limit: 50 }]);
  });

  it("builds a NIP-50 search filter and maps results", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    const qSpy = vi
      .spyOn(client, "query")
      .mockResolvedValue([
        ev({ id: "m", pubkey: "a", created_at: 5, kind: 9, tags: [["h", "chan"]], content: "hello world" }),
      ]);
    const msgs = await client.searchMessages("hello", { limit: 25 });
    expect(qSpy).toHaveBeenCalledWith([{ search: "hello", kinds: [9], limit: 25 }]);
    expect(msgs[0]).toMatchObject({ content: "hello world", channelId: "chan" });
  });
});

describe("BuzzClient write helpers", () => {
  it("sendMessage publishes a signed kind:9 with an h tag", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    const pSpy = vi.spyOn(client, "publish").mockResolvedValue({ accepted: true, message: "" });
    await client.sendMessage("chan", "hello");
    const published = pSpy.mock.calls[0][0];
    expect(published.kind).toBe(9);
    expect(published.content).toBe("hello");
    expect(published.tags).toContainEqual(["h", "chan"]);
    expect(published.sig).toMatch(/^[0-9a-f]{128}$/);
  });

  it("react publishes a signed kind:7 with e and h tags", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    const pSpy = vi.spyOn(client, "publish").mockResolvedValue({ accepted: true, message: "" });
    await client.react("m1", "chan", "+");
    const published = pSpy.mock.calls[0][0];
    expect(published.kind).toBe(7);
    expect(published.content).toBe("+");
    expect(published.tags).toContainEqual(["e", "m1"]);
    expect(published.tags).toContainEqual(["h", "chan"]);
  });

  it("puts the emoji in an emoji tag rather than concatenating it into the content", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    const pSpy = vi.spyOn(client, "publish").mockResolvedValue({ accepted: true, message: "" });
    await client.setStatus("in a meeting", "\u{1F4C5}");
    const published = pSpy.mock.calls[0][0];
    expect(published.kind).toBe(30315);
    expect(published.content).toBe("in a meeting");
    expect(published.tags).toContainEqual(["d", "general"]);
    expect(published.tags).toContainEqual(["emoji", "\u{1F4C5}"]);
  });

  it("omits the emoji tag entirely when no emoji is given", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    const pSpy = vi.spyOn(client, "publish").mockResolvedValue({ accepted: true, message: "" });
    await client.setStatus("heads down");
    const published = pSpy.mock.calls[0][0];
    expect(published.content).toBe("heads down");
    expect(published.tags.some((t) => t[0] === "emoji")).toBe(false);
  });

  it("treats a blank emoji as no emoji", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    const pSpy = vi.spyOn(client, "publish").mockResolvedValue({ accepted: true, message: "" });
    await client.setStatus("heads down", "   ");
    expect(pSpy.mock.calls[0][0].tags.some((t) => t[0] === "emoji")).toBe(false);
  });

  it("trims the status text and the emoji", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    const pSpy = vi.spyOn(client, "publish").mockResolvedValue({ accepted: true, message: "" });
    await client.setStatus("  heads down  ", "  \u{1F9E0}  ");
    const published = pSpy.mock.calls[0][0];
    expect(published.content).toBe("heads down");
    expect(published.tags).toContainEqual(["emoji", "\u{1F9E0}"]);
  });

  it("clearStatus publishes empty content with no emoji tag", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    const pSpy = vi.spyOn(client, "publish").mockResolvedValue({ accepted: true, message: "" });
    await client.clearStatus();
    const published = pSpy.mock.calls[0][0];
    expect(published.kind).toBe(30315);
    expect(published.content).toBe("");
    expect(published.tags).toEqual([["d", "general"]]);
  });

  it("setPresence publishes ephemeral kind:20001 with the state as content", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    const pSpy = vi.spyOn(client, "publish").mockResolvedValue({ accepted: true, message: "" });
    await client.setPresence("away");
    const published = pSpy.mock.calls[0][0];
    expect(published.kind).toBe(20001);
    expect(published.content).toBe("away");
  });

  it("throws RelayError when a publish is not accepted", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    vi.spyOn(client, "publish").mockResolvedValue({ accepted: false, message: "restricted" });
    await expect(client.sendMessage("chan", "x")).rejects.toBeInstanceOf(RelayError);
  });

  it("surfaces the relay's reason when it rejects a publish", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    vi.spyOn(client, "publish").mockResolvedValue({
      accepted: false,
      message: "invalid: kind 20001 is only accepted via WebSocket",
    });
    await expect(client.setPresence("online")).rejects.toThrow(/only accepted via WebSocket/);
  });

  it("falls back to a generic reason when the relay gives no message", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    vi.spyOn(client, "publish").mockResolvedValue({ accepted: false, message: "" });
    await expect(client.sendMessage("chan", "x")).rejects.toThrow(/auth or permission/);
  });
});

describe("BuzzClient.getStatus", () => {
  it("queries kind 30315 for our own pubkey on the general coordinate", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    const qSpy = vi.spyOn(client, "query").mockResolvedValue([]);
    await client.getStatus();
    const filter = qSpy.mock.calls[0][0][0] as Record<string, unknown>;
    expect(filter.kinds).toEqual([30315]);
    expect(filter["#d"]).toEqual(["general"]);
    expect((filter.authors as string[])[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the text and the emoji tag", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    vi.spyOn(client, "query").mockResolvedValue([
      ev({
        kind: 30315,
        created_at: 10,
        content: "in a meeting",
        tags: [
          ["d", "general"],
          ["emoji", "\u{1F4C5}"],
        ],
      }),
    ]);
    expect(await client.getStatus()).toEqual({ text: "in a meeting", emoji: "\u{1F4C5}" });
  });

  it("returns an empty emoji when the event carries no emoji tag", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    vi.spyOn(client, "query").mockResolvedValue([
      ev({ kind: 30315, created_at: 10, content: "heads down", tags: [["d", "general"]] }),
    ]);
    expect(await client.getStatus()).toEqual({ text: "heads down", emoji: "" });
  });

  it("returns null when there is no status event at all", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    vi.spyOn(client, "query").mockResolvedValue([]);
    expect(await client.getStatus()).toBeNull();
  });

  it("reads a cleared status as null", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    vi.spyOn(client, "query").mockResolvedValue([
      ev({ kind: 30315, created_at: 10, content: "", tags: [["d", "general"]] }),
    ]);
    expect(await client.getStatus()).toBeNull();
  });

  it("keeps a status that has an emoji but no text", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    vi.spyOn(client, "query").mockResolvedValue([
      ev({
        kind: 30315,
        created_at: 10,
        content: "",
        tags: [
          ["d", "general"],
          ["emoji", "\u{1F334}"],
        ],
      }),
    ]);
    expect(await client.getStatus()).toEqual({ text: "", emoji: "\u{1F334}" });
  });

  it("uses the newest event when the relay returns several", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    vi.spyOn(client, "query").mockResolvedValue([
      ev({ kind: 30315, created_at: 10, content: "old", tags: [["d", "general"]] }),
      ev({ kind: 30315, created_at: 99, content: "new", tags: [["d", "general"]] }),
    ]);
    expect(await client.getStatus()).toEqual({ text: "new", emoji: "" });
  });

  it("still uses the newest event when it is the first in the list", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    vi.spyOn(client, "query").mockResolvedValue([
      ev({ kind: 30315, created_at: 99, content: "new", tags: [["d", "general"]] }),
      ev({ kind: 30315, created_at: 10, content: "old", tags: [["d", "general"]] }),
    ]);
    expect(await client.getStatus()).toEqual({ text: "new", emoji: "" });
  });
});

// Regression coverage for a bug the live smoke test caught: the relay
// (crates/buzz-db/src/event.rs in block/buzz) breaks a created_at tie on a
// replaceable coordinate by keeping the event with the LOWEST id, so a
// set-then-clear within the same wall-clock second was effectively a coin
// flip on whose sha256 sorted lower. Publishing a replaceable kind must stamp
// a created_at that is strictly greater than the last one this process used
// for that coordinate.
describe("BuzzClient replaceable created_at monotonicity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    __resetReplaceableClock();
  });

  afterEach(() => {
    __resetReplaceableClock();
    vi.useRealTimers();
  });

  it("gives two setStatus calls in the same second strictly increasing created_at", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    const pSpy = vi.spyOn(client, "publish").mockResolvedValue({ accepted: true, message: "" });
    await client.setStatus("first");
    await client.setStatus("second");
    const [firstAt, secondAt] = pSpy.mock.calls.map((c) => c[0].created_at);
    expect(secondAt).toBeGreaterThan(firstAt);
  });

  it("gives a clearStatus that follows setStatus in the same second a strictly increasing created_at", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    const pSpy = vi.spyOn(client, "publish").mockResolvedValue({ accepted: true, message: "" });
    await client.setStatus("in a meeting");
    await client.clearStatus();
    const [setAt, clearAt] = pSpy.mock.calls.map((c) => c[0].created_at);
    expect(clearAt).toBeGreaterThan(setAt);
  });

  it("uses the real current time once it has caught up, instead of drifting ahead forever", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    const pSpy = vi.spyOn(client, "publish").mockResolvedValue({ accepted: true, message: "" });
    await client.setStatus("first");
    vi.setSystemTime(1_700_000_010_000); // 10 real seconds later
    await client.setStatus("second");
    const [firstAt, secondAt] = pSpy.mock.calls.map((c) => c[0].created_at);
    expect(secondAt).toBe(firstAt + 10);
  });

  it("tracks separate d tags on the same kind independently", () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const first = __nextReplaceableCreatedAt(30315, [["d", "general"]]);
    const second = __nextReplaceableCreatedAt(30315, [["d", "general"]]);
    const other = __nextReplaceableCreatedAt(30315, [["d", "other"]]);
    expect(second).toBeGreaterThan(first);
    // A different coordinate is untouched by the bump on "general".
    expect(other).toBe(nowSeconds);
  });

  it("falls back to an empty d tag for a replaceable kind that carries none", () => {
    // Kind 15000 sits in the 10000-19999 (non-parameterized) replaceable
    // range, which never carries a d tag; the coordinate key still has to
    // resolve without one.
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(__nextReplaceableCreatedAt(15000, [])).toBe(nowSeconds);
  });

  it("does not bump a non-replaceable kind: two kind:9 messages in the same second share created_at", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    const pSpy = vi.spyOn(client, "publish").mockResolvedValue({ accepted: true, message: "" });
    await client.sendMessage("chan", "one");
    await client.sendMessage("chan", "two");
    const [firstAt, secondAt] = pSpy.mock.calls.map((c) => c[0].created_at);
    expect(secondAt).toBe(firstAt);
  });

  it("resets cleanly between tests via __resetReplaceableClock", async () => {
    const client = new BuzzClient("https://relay.test", SK);
    const pSpy = vi.spyOn(client, "publish").mockResolvedValue({ accepted: true, message: "" });
    await client.setStatus("first");
    __resetReplaceableClock();
    await client.setStatus("second");
    const [firstAt, secondAt] = pSpy.mock.calls.map((c) => c[0].created_at);
    // Without the reset, the second call would be bumped ahead of the first;
    // a clean reset makes it start over at the current simulated time.
    expect(secondAt).toBe(firstAt);
  });
});
