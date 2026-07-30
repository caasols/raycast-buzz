import { List, ActionPanel, Action, showToast, Toast } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { BuzzClient } from "../lib/buzz-client";
import { Channel } from "../lib/types";
import { ErrorView } from "./error-view";

export function ChannelMessages({ client, channel }: { client: BuzzClient; channel: Channel }) {
  const { isLoading, data, error, revalidate } = usePromise(async (id: string) => client.getMessages(id), [channel.id]);

  if (error) {
    return <ErrorView error={error} />;
  }

  async function like(msgId: string) {
    try {
      await client.react(msgId, channel.id, "+");
      await showToast({ style: Toast.Style.Success, title: "Reaction sent" });
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Reaction failed",
        message: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    await revalidate();
  }

  return (
    <List isLoading={isLoading} navigationTitle={channel.name || channel.id}>
      <List.EmptyView title="No messages" description="This channel has no messages yet" />
      {(data ?? []).map((message) => (
        <List.Item
          key={message.id}
          title={message.content || "(no content)"}
          subtitle={message.author.slice(0, 8)}
          accessories={[{ date: new Date(message.createdAt * 1000) }]}
          actions={
            <ActionPanel>
              <Action title="React (Like)" onAction={() => like(message.id)} />
              <Action.CopyToClipboard title="Copy Message" content={message.content} />
              <Action.CopyToClipboard title="Copy Message ID" content={message.id} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
