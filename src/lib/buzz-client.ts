import { buildNip98Header, getPublicKeyHex, signEvent } from "./nostr";
import { normalizeRelayUrl } from "./relay-url";
import { getThreadReference, isThreadReply } from "./threading";
import type { Channel, Filter, Message, NostrEvent, UserStatus } from "./types";

/** Fetch multiple of the requested limit, since replies are filtered out after the query. */
const OVER_FETCH = 4;
/** The relay's documented maximum results per filter. */
const RELAY_MAX_RESULTS = 500;

export class RelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayError";
  }
}

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((t) => t[0] === name)?.[1];
}

function toChannel(event: NostrEvent): Channel {
  return {
    id: tagValue(event, "d") ?? "",
    name: tagValue(event, "name") ?? "",
    about: tagValue(event, "about"),
  };
}

function toMessage(event: NostrEvent): Message {
  return {
    id: event.id,
    author: event.pubkey,
    content: event.content,
    createdAt: event.created_at,
    channelId: tagValue(event, "h") ?? "",
    replyCount: 0,
  };
}

function newestFirst(a: Message, b: Message): number {
  return b.createdAt - a.createdAt;
}

/**
 * Nostr treats kinds 10000-19999 as replaceable and 30000-39999 as
 * parameterized-replaceable: the relay keeps only the newest event per
 * coordinate. Kind 0 (metadata) and kind 3 (contacts) are also replaceable,
 * but this client never publishes either, so only the two numeric ranges it
 * actually writes into are handled here rather than pretending to be
 * exhaustive over the whole spec.
 */
function isReplaceableKind(kind: number): boolean {
  return (kind >= 10000 && kind <= 19999) || (kind >= 30000 && kind <= 39999);
}

function replaceableCoordinate(kind: number, tags: string[][]): string {
  const dTag = tags.find((t) => t[0] === "d")?.[1] ?? "";
  return `${kind}:${dTag}`;
}

/**
 * Last `created_at` (in seconds) this process has published for a given
 * replaceable coordinate. Module-level rather than a `BuzzClient` field: the
 * Set Status command's "apply" and "clear" affordances each call
 * `getClient()` in src/lib/preferences.ts, which mints a fresh `BuzzClient`
 * per action, so an instance field would not see both calls.
 *
 * Why this exists: the relay (crates/buzz-db/src/event.rs in block/buzz)
 * breaks a created_at tie on a replaceable coordinate by keeping the event
 * with the LOWEST id ("canonical NIP-16 ordering"), so two replaceable
 * publishes that land in the same wall-clock second are a coin flip on
 * whose sha256 sorts lower. `signEvent` stamps `Math.floor(Date.now() /
 * 1000)`, so a set-then-clear within the same second could silently lose.
 * Stamping every replaceable publish with a created_at strictly greater than
 * the last one used for that coordinate removes the tie entirely.
 */
const lastReplaceableCreatedAt = new Map<string, number>();

function nextCreatedAt(kind: number, tags: string[][]): number {
  const now = Math.floor(Date.now() / 1000);
  if (!isReplaceableKind(kind)) return now;
  const key = replaceableCoordinate(kind, tags);
  const last = lastReplaceableCreatedAt.get(key);
  const createdAt = last === undefined ? now : Math.max(now, last + 1);
  lastReplaceableCreatedAt.set(key, createdAt);
  return createdAt;
}

/** Test-only: forget all tracked replaceable-coordinate clock state. */
export function __resetReplaceableClock(): void {
  lastReplaceableCreatedAt.clear();
}

/**
 * Test-only: expose the monotonic created_at calculation directly, so tests
 * can exercise coordinate isolation (e.g. two different `d` tags on the same
 * kind) without adding a public `BuzzClient` method just to pick one.
 */
export function __nextReplaceableCreatedAt(kind: number, tags: string[][]): number {
  return nextCreatedAt(kind, tags);
}

async function readRelayError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return "";
    try {
      const data = JSON.parse(text) as { error?: unknown };
      if (typeof data.error === "string") return data.error.slice(0, 200);
    } catch {
      // body was not JSON; fall through to the raw text
    }
    return text.slice(0, 200);
  } catch {
    return "";
  }
}

export class BuzzClient {
  private readonly relayUrl: string;
  private readonly secretKey: Uint8Array;

  constructor(relayUrl: string, secretKey: Uint8Array) {
    this.relayUrl = normalizeRelayUrl(relayUrl);
    this.secretKey = secretKey;
  }

  async query(filters: Filter[]): Promise<NostrEvent[]> {
    const data = await this.post("/query", filters);
    if (!Array.isArray(data)) {
      throw new RelayError("Relay returned an unexpected response to a query");
    }
    return data as NostrEvent[];
  }

  async publish(event: NostrEvent): Promise<{ accepted: boolean; message: string }> {
    const data = (await this.post("/events", event)) as {
      accepted?: boolean;
      message?: string;
    };
    return { accepted: data.accepted ?? false, message: data.message ?? "" };
  }

  async listChannels(): Promise<Channel[]> {
    const events = await this.query([{ kinds: [39000] }]);
    // A channel with no `d` tag has no usable identifier: it would collide with
    // other such channels as a list key and query messages with an empty h tag.
    return events.map(toChannel).filter((channel) => channel.id !== "");
  }

  /**
   * Recent messages in a channel, collapsed the way Buzz collapses them: thread
   * replies are hidden and counted against their root instead.
   *
   * The filtering is client-side because a Nostr filter cannot express the
   * absence of a tag, so the relay sends replies regardless. That means asking
   * for `limit` events can yield far fewer after filtering, hence the
   * over-fetch. It is a heuristic: a channel that is mostly replies can still
   * come back short, even to zero: a channel whose fetched window is entirely
   * replies to roots outside that window collapses to an empty `messages` array
   * even though the channel is not empty. `fetchedCount` (the relay's raw event
   * count before filtering) is what lets a caller tell that case apart from a
   * truly empty channel, where `fetchedCount` is 0 too. The alternative to the
   * heuristic is pagination, which the relay's 500 result ceiling limits anyway.
   */
  async getMessages(channelId: string, limit = 50): Promise<{ messages: Message[]; fetchedCount: number }> {
    const events = await this.query([
      { kinds: [9], "#h": [channelId], limit: Math.min(limit * OVER_FETCH, RELAY_MAX_RESULTS) },
    ]);

    const replyCounts = new Map<string, number>();
    for (const event of events) {
      const rootId = getThreadReference(event.tags).rootId;
      if (rootId !== null) {
        replyCounts.set(rootId, (replyCounts.get(rootId) ?? 0) + 1);
      }
    }

    const messages = events
      .filter((event) => !isThreadReply(event.tags))
      .map((event) => ({ ...toMessage(event), replyCount: replyCounts.get(event.id) ?? 0 }))
      .sort(newestFirst)
      .slice(0, limit);

    return { messages, fetchedCount: events.length };
  }

  async searchMessages(q: string, opts?: { limit?: number }): Promise<Message[]> {
    const events = await this.query([{ search: q, kinds: [9], limit: opts?.limit ?? 50 }]);
    return events.map(toMessage).sort(newestFirst);
  }

  async sendMessage(channelId: string, content: string): Promise<void> {
    await this.publishSigned({ kind: 9, tags: [["h", channelId]], content });
  }

  async react(msgId: string, channelId: string, reaction: string): Promise<void> {
    await this.publishSigned({
      kind: 7,
      tags: [
        ["e", msgId],
        ["h", channelId],
      ],
      content: reaction,
    });
  }

  /**
   * Publish a NIP-38 status. Buzz carries the emoji in a dedicated `emoji`
   * tag, not inside the content: its desktop and mobile clients read
   * `tags.find((t) => t[0] === "emoji")`, so an emoji folded into the text
   * would render as literal characters with no emoji field.
   */
  async setStatus(text: string, emoji?: string): Promise<void> {
    const trimmedEmoji = emoji?.trim() ?? "";
    const tags: string[][] = [["d", "general"]];
    if (trimmedEmoji) {
      tags.push(["emoji", trimmedEmoji]);
    }
    await this.publishSigned({ kind: 30315, tags, content: text.trim() });
  }

  /**
   * Clear the status. Kind 30315 is parameterized-replaceable, so an event
   * with neither text nor emoji is what Buzz clients read as "no status".
   */
  async clearStatus(): Promise<void> {
    await this.setStatus("");
  }

  /**
   * Read our own NIP-38 status. Returns null when the newest event carries
   * neither text nor emoji, which is how Buzz clients represent "no status".
   */
  async getStatus(): Promise<UserStatus | null> {
    const pubkey = getPublicKeyHex(this.secretKey);
    const events = await this.query([{ kinds: [30315], authors: [pubkey], "#d": ["general"], limit: 1 }]);
    if (events.length === 0) return null;
    const newest = events.reduce((a, b) => (b.created_at > a.created_at ? b : a));
    const status = { text: newest.content, emoji: tagValue(newest, "emoji") ?? "" };
    return status.text || status.emoji ? status : null;
  }

  // Presence (kind 20001) is WebSocket-only on the relay; the set-presence
  // command is deferred to Tier B. This helper builds the correct event for
  // that future path.
  async setPresence(state: "online" | "away" | "offline"): Promise<void> {
    await this.publishSigned({ kind: 20001, tags: [], content: state });
  }

  private async publishSigned(fields: { kind: number; tags: string[][]; content: string }): Promise<void> {
    const created_at = nextCreatedAt(fields.kind, fields.tags);
    const event = signEvent({ ...fields, created_at }, this.secretKey);
    const result = await this.publish(event);
    if (!result.accepted) {
      // Carry the relay's own reason when it gives one: a bare "auth or
      // permission" is what hid the kind:20001 WebSocket-only rejection.
      throw new RelayError(
        result.message
          ? `Relay rejected the request: ${result.message.slice(0, 200)}`
          : "Relay rejected the request (auth or permission)",
      );
    }
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const url = `${this.relayUrl}${path}`;
    const bodyStr = JSON.stringify(body);
    const authorization = buildNip98Header(url, "POST", bodyStr, this.secretKey);

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authorization },
        body: bodyStr,
      });
    } catch {
      // Do not include the caught error: it must never risk echoing request data.
      throw new RelayError(`Cannot reach relay at ${this.relayUrl}`);
    }

    if (!res.ok) {
      const detail = await readRelayError(res);
      throw new RelayError(
        detail
          ? `Relay rejected the request (status ${res.status}): ${detail}`
          : `Relay rejected the request (status ${res.status})`,
      );
    }
    return res.json();
  }
}
