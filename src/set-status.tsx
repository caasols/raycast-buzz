import { List, ActionPanel, Action, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { getClient } from "./lib/preferences";
import { ErrorView } from "./components/error-view";
import { StatusForm } from "./components/status-form";
import { listPresets, createPreset, updatePreset, deletePreset, StatusPreset } from "./lib/presets";

export default function Command() {
  const { pop } = useNavigation();
  const { isLoading, data, error, revalidate } = usePromise(async () => {
    const client = getClient();
    // Presets are local, so they resolve even when the relay is unreachable;
    // only the status query can fail into the error view.
    const [status, presets] = await Promise.all([client.getStatus(), listPresets()]);
    return { client, status, presets };
  });

  if (error) {
    return <ErrorView error={error} />;
  }

  async function apply(emoji: string, text: string) {
    try {
      await data!.client.setStatus(text, emoji || undefined);
      await showToast({ style: Toast.Style.Success, title: "Status updated" });
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not set status",
        message: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    revalidate();
  }

  async function clear() {
    try {
      await data!.client.clearStatus();
      await showToast({ style: Toast.Style.Success, title: "Status cleared" });
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not clear status",
        message: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    revalidate();
  }

  async function removePreset(id: string) {
    await deletePreset(id);
    revalidate();
  }

  const customStatusAction = (
    <Action.Push
      title="Set Custom Status"
      icon={Icon.Pencil}
      target={
        <StatusForm
          submitTitle="Set Status"
          onSubmit={async ({ emoji, text }) => {
            await apply(emoji, text);
            pop();
          }}
        />
      }
    />
  );

  const createPresetAction = (
    <Action.Push
      title="Create Preset"
      icon={Icon.PlusSquare}
      target={
        <StatusForm
          submitTitle="Create Preset"
          onSubmit={async ({ emoji, text }) => {
            await createPreset({ emoji, text });
            revalidate();
            pop();
          }}
        />
      }
    />
  );

  const status = data?.status ?? null;

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search statuses">
      <List.Section title="Current Status">
        <List.Item
          title={status ? status.text || status.emoji : "No status"}
          subtitle={status?.emoji || undefined}
          actions={
            <ActionPanel>
              {customStatusAction}
              {status && <Action title="Clear Status" icon={Icon.XMarkCircle} onAction={clear} />}
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
            subtitle={preset.emoji || undefined}
            actions={
              <ActionPanel>
                <Action title="Set This Status" icon={Icon.Check} onAction={() => apply(preset.emoji, preset.text)} />
                <Action.Push
                  title="Edit Preset"
                  icon={Icon.Pencil}
                  target={
                    <StatusForm
                      submitTitle="Save Preset"
                      initialEmoji={preset.emoji}
                      initialText={preset.text}
                      onSubmit={async ({ emoji, text }) => {
                        await updatePreset(preset.id, { emoji, text });
                        revalidate();
                        pop();
                      }}
                    />
                  }
                />
                <Action title="Delete Preset" icon={Icon.Trash} onAction={() => removePreset(preset.id)} />
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
