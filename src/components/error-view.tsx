import { List, ActionPanel, Action, openExtensionPreferences } from "@raycast/api";

/**
 * A List view for surfacing configuration or relay errors, with a shortcut to
 * open the extension preferences. Error messages from this codebase never carry
 * the private key.
 */
export function ErrorView({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <List>
      <List.EmptyView
        title="Something went wrong"
        description={message}
        actions={
          <ActionPanel>
            <Action title="Open Extension Preferences" onAction={openExtensionPreferences} />
          </ActionPanel>
        }
      />
    </List>
  );
}
