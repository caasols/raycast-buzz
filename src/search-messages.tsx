import { useState } from "react";
import { List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { getClient } from "./lib/preferences";
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
      {(data ?? []).map((message) => (
        <List.Item
          key={message.id}
          title={message.content}
          subtitle={message.author.slice(0, 8)}
          accessories={[{ date: new Date(message.createdAt * 1000) }]}
        />
      ))}
    </List>
  );
}
