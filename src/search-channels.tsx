import { List, ActionPanel, Action, Icon } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { getClient } from "./lib/preferences";
import { ErrorView } from "./components/error-view";
import { ChannelMessages } from "./components/channel-messages";
import { buildChannelLink } from "./lib/buzz-link";

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
              {/* channel.id has no native buzz://channel link; buildChannelLink anchors it
                  to a message that cannot exist, and Buzz falls back to opening the channel. */}
              <Action.Open title="Open in Buzz" target={buildChannelLink(channel.id)} icon={Icon.AppWindow} />
              {data?.client && (
                <Action.Push
                  title="Show Messages"
                  target={<ChannelMessages client={data.client} channel={channel} />}
                />
              )}
              <Action.CopyToClipboard title="Copy Channel ID" content={channel.id} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
