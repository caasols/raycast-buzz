import { useState } from "react";
import { List, ActionPanel, Action, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { getClient } from "./lib/preferences";
import { searchPeople } from "./lib/directory";
import { ErrorView } from "./components/error-view";
import { ComposeMessage } from "./components/compose-message";
import type { DirectMessage, Person } from "./lib/types";

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function Command() {
  const [query, setQuery] = useState("");
  const { push } = useNavigation();

  const { isLoading, data, error } = usePromise(async () => {
    const client = getClient();
    // Channels decide whether this command works at all, so a failure there is
    // fatal and reaches ErrorView. Conversations are additive: posting to a
    // channel shipped long before DMs existed and must not stop working because
    // a DM query failed, so that one degrades to an empty section plus a toast.
    // Set Status draws the same line around its own status fetch.
    const [channels, conversations] = await Promise.all([
      client.listChannels(),
      client.listDirectMessages().catch(async (e: unknown) => {
        await showToast({
          style: Toast.Style.Failure,
          title: "Could not load conversations",
          message: reason(e),
        });
        return [] as DirectMessage[];
      }),
    ]);
    return { client, channels, conversations };
  });

  const hasQuery = query.trim() !== "";

  // A directory search failing must not take the whole command down with it:
  // the channels and conversations already on screen are still usable, so the
  // failure is caught here and reported as a toast rather than thrown. `execute`
  // gates the fetch on non-blank input, rather than short-circuiting inside the
  // function body, so `people.data` genuinely starts undefined the first time a
  // search fires: that keeps the `?? []` below a real branch instead of one no
  // test (or real usage) could ever take the other side of.
  const people = usePromise(
    async (q: string) => {
      try {
        return await searchPeople(getClient(), q.trim());
      } catch (e) {
        await showToast({ style: Toast.Style.Failure, title: "People search failed", message: reason(e) });
        return [] as Person[];
      }
    },
    [query],
    { execute: hasQuery },
  );

  if (error) {
    return <ErrorView error={error} />;
  }

  return (
    <List
      isLoading={isLoading || people.isLoading}
      throttle
      onSearchTextChange={setQuery}
      searchBarPlaceholder="Search channels, conversations and people"
      // Supplying onSearchTextChange implicitly turns Raycast's own filtering off
      // (see the same rule in src/components/status-form.tsx), which would leave
      // every channel and conversation on screen while typing. Restoring it here,
      // with keepSectionOrder so Channels/Direct Messages/People stay in that
      // order rather than being re-ranked by match quality.
      filtering={{ keepSectionOrder: true }}
    >
      <List.EmptyView title="Nothing to write to" description="No channels or conversations on this relay" />

      {data && (
        <List.Section title="Channels">
          {data.channels.map((channel) => (
            <List.Item
              key={channel.id}
              title={channel.name || channel.id}
              subtitle={channel.about}
              icon={Icon.Hashtag}
              actions={
                <ActionPanel>
                  <Action.Push
                    title="Write Message"
                    icon={Icon.Pencil}
                    target={
                      <ComposeMessage
                        client={data.client}
                        channelId={channel.id}
                        destination={channel.name || channel.id}
                      />
                    }
                  />
                  <Action.CopyToClipboard title="Copy Channel ID" content={channel.id} />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}

      {data && (
        <List.Section title="Direct Messages">
          {data.conversations.map((conversation) => (
            <List.Item
              key={conversation.channelId}
              title={conversation.name}
              icon={Icon.Person}
              actions={
                <ActionPanel>
                  <Action.Push
                    title="Write Message"
                    icon={Icon.Pencil}
                    target={
                      <ComposeMessage
                        client={data.client}
                        channelId={conversation.channelId}
                        destination={conversation.name}
                      />
                    }
                  />
                  <Action.CopyToClipboard title="Copy Channel ID" content={conversation.channelId} />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}

      {data && hasQuery && (
        <List.Section title="People">
          {(people.data ?? []).map((person) => (
            <List.Item
              key={person.pubkey}
              title={person.name}
              subtitle={person.pubkey.slice(0, 8)}
              icon={Icon.PersonCircle}
              // The relay already matched this person against the current query
              // (possibly on a profile field other than their displayed name), so
              // native filtering re-matching only the title could hide a row Raycast
              // itself is responsible for surfacing. Forcing a match via keywords is
              // correct here, not a workaround: it restates a result the search
              // already returned.
              keywords={[query]}
              actions={
                <ActionPanel>
                  <Action
                    title="Write Message"
                    icon={Icon.Pencil}
                    onAction={async () => {
                      try {
                        // Idempotent: an existing conversation comes back rather than a new one.
                        const channelId = await data.client.openDirectMessage(person.pubkey);
                        push(<ComposeMessage client={data.client} channelId={channelId} destination={person.name} />);
                      } catch (e) {
                        await showToast({
                          style: Toast.Style.Failure,
                          title: "Could not open the conversation",
                          message: reason(e),
                        });
                      }
                    }}
                  />
                  <Action.CopyToClipboard title="Copy Public Key" content={person.pubkey} />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
