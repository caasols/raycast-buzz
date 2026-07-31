import { Form, ActionPanel, Action, showToast, Toast, popToRoot } from "@raycast/api";
import type { BuzzClient } from "../lib/buzz-client";

/**
 * The compose step, shared by every way of picking a destination. A Buzz DM is
 * an ordinary private channel, so sending to a person and sending to a channel
 * are the same publish and deliberately the same form.
 */
export function ComposeMessage(props: { client: BuzzClient; channelId: string; destination: string }) {
  async function onSubmit(values: { content: string }) {
    if (!values.content.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "Message is empty" });
      return;
    }
    try {
      await props.client.sendMessage(props.channelId, values.content);
      await showToast({ style: Toast.Style.Success, title: "Message sent" });
      await popToRoot();
    } catch (e) {
      // The form stays open on failure so the typed message is not lost.
      await showToast({
        style: Toast.Style.Failure,
        title: "Send failed",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return (
    <Form
      navigationTitle={`Message ${props.destination}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Send" onSubmit={onSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description text={`To: ${props.destination}`} />
      <Form.TextArea id="content" title="Message" placeholder="Type your message" />
    </Form>
  );
}
