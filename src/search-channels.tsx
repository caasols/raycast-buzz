import { List, ActionPanel, Action } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { getClient } from "./lib/preferences";
import { ErrorView } from "./components/error-view";
import { ChannelMessages } from "./components/channel-messages";

export default function Command() {
  const { isLoading, data, error } = usePromise(async () => {
    const client = getClient();
    const channels = await client.listChannels();
    return { client, channels };
  });

  if (error) {
    return <ErrorView error={error} />;
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter channels">
      <List.EmptyView title="No channels" description="No channels found on this relay" />
      {(data?.channels ?? []).map((channel) => (
        <List.Item
          key={channel.id}
          title={channel.name || channel.id}
          subtitle={channel.about}
          actions={
            <ActionPanel>
              {data?.client && (
                <Action.Push title="Open Channel" target={<ChannelMessages client={data.client} channel={channel} />} />
              )}
              <Action.CopyToClipboard title="Copy Channel ID" content={channel.id} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
