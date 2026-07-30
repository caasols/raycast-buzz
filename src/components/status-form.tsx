import { Form, ActionPanel, Action, showToast, Toast } from "@raycast/api";
import { EMOJI } from "../lib/emoji";

/**
 * The one form behind setting a custom status and creating or editing a
 * preset. It validates and hands the values back; it never publishes and never
 * writes to storage, so the caller decides what submitting means.
 */
export function StatusForm({
  submitTitle,
  initialEmoji,
  initialText,
  onSubmit,
}: {
  submitTitle: string;
  initialEmoji?: string;
  initialText?: string;
  onSubmit: (values: { emoji: string; text: string }) => Promise<void>;
}) {
  async function handleSubmit(values: { emoji: string; text: string }) {
    const emoji = values.emoji.trim();
    const text = values.text.trim();
    if (!emoji && !text) {
      await showToast({ style: Toast.Style.Failure, title: "Add an emoji or some text" });
      return;
    }
    await onSubmit({ emoji, text });
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title={submitTitle} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="emoji" title="Emoji" defaultValue={initialEmoji ?? ""}>
        <Form.Dropdown.Item value="" title="None" />
        {EMOJI.map((entry) => (
          <Form.Dropdown.Item
            key={entry.shortcode}
            value={entry.char}
            title={`${entry.char}  ${entry.shortcode}`}
            keywords={entry.keywords.split(" ")}
          />
        ))}
      </Form.Dropdown>
      <Form.TextField id="text" title="Status" placeholder="What's your status?" defaultValue={initialText ?? ""} />
    </Form>
  );
}
