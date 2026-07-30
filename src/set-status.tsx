import { List, ActionPanel, Action, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { getClient } from "./lib/preferences";
import { ErrorView } from "./components/error-view";
import { StatusForm } from "./components/status-form";
import { listPresets, createPreset, updatePreset, deletePreset, StatusPreset } from "./lib/presets";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function Command() {
  const { pop } = useNavigation();
  const { isLoading, data, error, revalidate } = usePromise(async () => {
    const client = getClient();
    // Presets are local, so they always resolve even when the relay is unreachable.
    // getStatus() failing on its own (relay down) is reported inline on the
    // Current Status row rather than replacing the whole list, so the presets
    // stay usable. A getClient() throw (misconfiguration) still falls through
    // to the full ErrorView below, since it rejects this promise outright.
    const presets = await listPresets();
    let status: Awaited<ReturnType<typeof client.getStatus>> = null;
    let statusError: string | null = null;
    try {
      status = await client.getStatus();
    } catch (e) {
      statusError = errorMessage(e);
    }
    return { presets, status, statusError };
  });

  if (error) {
    return <ErrorView error={error} />;
  }

  async function apply(emoji: string, text: string): Promise<boolean> {
    try {
      await getClient().setStatus(text, emoji || undefined);
      await showToast({ style: Toast.Style.Success, title: "Status updated" });
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Could not set status", message: errorMessage(e) });
      return false;
    }
    revalidate();
    return true;
  }

  async function clear(): Promise<void> {
    try {
      await getClient().clearStatus();
      await showToast({ style: Toast.Style.Success, title: "Status cleared" });
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Could not clear status", message: errorMessage(e) });
      return;
    }
    revalidate();
  }

  async function removePreset(id: string): Promise<void> {
    try {
      await deletePreset(id);
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Could not delete preset", message: errorMessage(e) });
      return;
    }
    revalidate();
  }

  const customStatusAction = (
    <Action.Push
      title="Set Custom Status"
      icon={Icon.Pencil}
      shortcut={{ modifiers: ["cmd"], key: "n" }}
      target={
        <StatusForm
          submitTitle="Set Status"
          onSubmit={async ({ emoji, text }) => {
            if (await apply(emoji, text)) pop();
          }}
        />
      }
    />
  );

  const createPresetAction = (
    <Action.Push
      title="Create Preset"
      icon={Icon.PlusSquare}
      shortcut={{ modifiers: ["shift", "cmd"], key: "n" }}
      target={
        <StatusForm
          submitTitle="Create Preset"
          onSubmit={async ({ emoji, text }) => {
            try {
              await createPreset({ emoji, text });
            } catch (e) {
              await showToast({
                style: Toast.Style.Failure,
                title: "Could not create preset",
                message: errorMessage(e),
              });
              return;
            }
            revalidate();
            pop();
          }}
        />
      }
    />
  );

  const status = data?.status ?? null;
  const statusError = data?.statusError ?? null;

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search statuses">
      <List.Section title="Current Status">
        <List.Item
          key="current-status"
          title={statusError ? "Could not load status" : status ? status.text || status.emoji : "No status"}
          subtitle={statusError ?? undefined}
          icon={statusError ? Icon.Warning : status?.emoji || undefined}
          actions={
            <ActionPanel>
              {customStatusAction}
              {status && (
                <Action
                  title="Clear Status"
                  icon={Icon.XMarkCircle}
                  shortcut={{ modifiers: ["ctrl"], key: "x" }}
                  onAction={clear}
                />
              )}
              {createPresetAction}
            </ActionPanel>
          }
        />
      </List.Section>
      <List.Section title="Presets">
        {(data?.presets ?? []).map((preset: StatusPreset) => (
          <List.Item
            key={preset.id}
            title={preset.text}
            icon={preset.emoji || undefined}
            actions={
              <ActionPanel>
                <Action title="Set This Status" icon={Icon.Check} onAction={() => apply(preset.emoji, preset.text)} />
                <Action.Push
                  title="Edit Preset"
                  icon={Icon.Pencil}
                  shortcut={{ modifiers: ["cmd"], key: "e" }}
                  target={
                    <StatusForm
                      submitTitle="Save Preset"
                      initialEmoji={preset.emoji}
                      initialText={preset.text}
                      onSubmit={async ({ emoji, text }) => {
                        try {
                          await updatePreset(preset.id, { emoji, text });
                        } catch (e) {
                          await showToast({
                            style: Toast.Style.Failure,
                            title: "Could not save preset",
                            message: errorMessage(e),
                          });
                          return;
                        }
                        revalidate();
                        pop();
                      }}
                    />
                  }
                />
                <Action
                  title="Delete Preset"
                  icon={Icon.Trash}
                  shortcut={{ modifiers: ["ctrl"], key: "x" }}
                  onAction={() => removePreset(preset.id)}
                />
                {createPresetAction}
                {customStatusAction}
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}
