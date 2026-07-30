import { useState } from "react";
import { List, ActionPanel, Action, Icon } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { getClient } from "./lib/preferences";
import { buildMessageLink } from "./lib/buzz-link";
import { ErrorView } from "./components/error-view";

export default function Command() {
  const [query, setQuery] = useState("");
  const { isLoading, data, error } = usePromise(
    async (q: string) => {
      // Built before the empty-query check so a missing or malformed relay URL or
      // private key surfaces on mount rather than staying hidden until first type.
      const client = getClient();
      return q.trim() ? client.searchMessages(q) : [];
    },
    [query],
  );

  if (error) {
    return <ErrorView error={error} />;
  }

  return (
    <List isLoading={isLoading} throttle onSearchTextChange={setQuery} searchBarPlaceholder="Search messages">
      <List.EmptyView title="Search Buzz messages" description="Type a query to search accessible channels" />
      {(data ?? []).map((message) => {
        // A search hit whose event carried no h tag has no channel to link to,
        // and the Buzz deep-link parser rejects a link missing `channel`, so
        // the link actions are not offered rather than offered broken.
        const link = message.channelId ? buildMessageLink(message.channelId, message.id) : null;
        return (
          <List.Item
            key={message.id}
            title={message.content}
            subtitle={message.author.slice(0, 8)}
            accessories={[{ date: new Date(message.createdAt * 1000) }]}
            actions={
              <ActionPanel>
                {link && <Action.Open title="Open in Buzz" target={link} icon={Icon.AppWindow} />}
                {link && <Action.CopyToClipboard title="Copy Link" content={link} />}
                <Action.CopyToClipboard title="Copy Message" content={message.content} />
                <Action.CopyToClipboard title="Copy Message ID" content={message.id} />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
