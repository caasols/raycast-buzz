import { buildNip98Header, signEvent } from "./nostr";
import { normalizeRelayUrl } from "./relay-url";
import type { Channel, Filter, Message, NostrEvent } from "./types";

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
  };
}

function newestFirst(a: Message, b: Message): number {
  return b.createdAt - a.createdAt;
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

  async getMessages(channelId: string, limit = 50): Promise<Message[]> {
    const events = await this.query([{ kinds: [9], "#h": [channelId], limit }]);
    return events.map(toMessage).sort(newestFirst);
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

  // Presence (kind 20001) is WebSocket-only on the relay; the set-presence
  // command is deferred to Tier B. This helper builds the correct event for
  // that future path.
  async setPresence(state: "online" | "away" | "offline"): Promise<void> {
    await this.publishSigned({ kind: 20001, tags: [], content: state });
  }

  private async publishSigned(fields: { kind: number; tags: string[][]; content: string }): Promise<void> {
    const event = signEvent({ ...fields, created_at: Math.floor(Date.now() / 1000) }, this.secretKey);
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
