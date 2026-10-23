import type { PluginSurfaceProps, SettingsState } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsInput, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text } from "react-native";
import { reviewSettings } from "../shared/settings";

type ReadySettings = SettingsState<typeof reviewSettings.schema> & { status: "ready" };

function EditorSettings({ settings, hostLabel }: { settings: ReadySettings; hostLabel: string }) {
  const [executable, setExecutable] = useState(settings.values.editorExecutable);
  const parsed = reviewSettings.schema.safeParse({ editorExecutable: executable });
  return (
    <SettingsSection title="External editor">
      <SettingsInput
        label="Editor executable"
        hint={`Executable name or full path, such as code or cursor. Opens the project folder and selected file on ${hostLabel}. Enter only the executable, without arguments.`}
        initialValue={executable}
        onChangeText={setExecutable}
        placeholder="code"
        disabled={settings.saving}
        error={parsed.success ? null : parsed.error.issues[0]?.message}
      />
      <SettingsAction
        label="Save editor"
        actionLabel={settings.saving ? "Saving…" : "Save"}
        disabled={
          settings.saving ||
          !parsed.success ||
          parsed.data.editorExecutable === settings.values.editorExecutable
        }
        error={settings.saveError}
        onPress={() => {
          if (parsed.success) void settings.save(parsed.data, settings.revision);
        }}
      />
    </SettingsSection>
  );
}

export function ReviewSettings({ theme, host }: PluginSurfaceProps) {
  const settings = useSettings(reviewSettings);
  if (settings.status !== "ready")
    return (
      <Text style={{ padding: 20, color: theme.colors.foreground }}>
        {settings.status === "loading" ? "Loading editor settings…" : settings.error}
      </Text>
    );
  return <EditorSettings key={settings.revision} settings={settings} hostLabel={host.label} />;
}
