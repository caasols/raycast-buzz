import { Form, ActionPanel, Action, showToast, Toast, popToRoot } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { getClient } from "./lib/preferences";
import { ErrorView } from "./components/error-view";

export default function Command() {
  const { isLoading, data, error } = usePromise(async () => {
    const client = getClient();
    const channels = await client.listChannels();
    return { client, channels };
  });

  if (error) {
    return <ErrorView error={error} />;
  }

  async function onSubmit(values: { channelId: string; content: string }) {
    if (!values.content.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "Message is empty" });
      return;
    }
    if (!data?.client) {
      await showToast({ style: Toast.Style.Failure, title: "Still loading channels" });
      return;
    }
    if (!values.channelId) {
      await showToast({ style: Toast.Style.Failure, title: "Pick a channel" });
      return;
    }
    try {
      await data.client.sendMessage(values.channelId, values.content);
      await showToast({ style: Toast.Style.Success, title: "Message sent" });
      await popToRoot();
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Send failed",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Send" onSubmit={onSubmit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="channelId" title="Channel">
        {(data?.channels ?? []).map((channel) => (
          <Form.Dropdown.Item key={channel.id} value={channel.id} title={channel.name || channel.id} />
        ))}
      </Form.Dropdown>
      <Form.TextArea id="content" title="Message" placeholder="Type your message" />
    </Form>
  );
}
