import { Form, ActionPanel, Action, showToast, Toast, popToRoot } from "@raycast/api";
import { getClient } from "./lib/preferences";

export default function Command() {
  async function onSubmit(values: { text: string; emoji: string }) {
    if (!values.text.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "Status is empty" });
      return;
    }
    try {
      const client = getClient();
      await client.setStatus(values.text, values.emoji.trim() || undefined);
      await showToast({ style: Toast.Style.Success, title: "Status updated" });
      await popToRoot();
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not set status",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Set Status" onSubmit={onSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="text" title="Status" placeholder="What are you up to?" />
      <Form.TextField id="emoji" title="Emoji" placeholder="Optional" />
    </Form>
  );
}
