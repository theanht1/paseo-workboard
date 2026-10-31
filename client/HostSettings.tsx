import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from "@getpaseo/plugin/client/ui";
import { groupSyncRole, type Settings } from "../shared/model";
import type { GroupSyncState } from "./host-runtimes";
import { strings } from "./strings";
import { ConfirmationModal } from "./ConfirmationModal";

export type HostStatus = {
  serverId: string;
  label: string;
  local: boolean;
  online: boolean;
  /** Absent when the host has no reachable Workboard of this release. */
  settings?: Pick<Settings, "groupSyncMaster">;
  sync?: GroupSyncState;
};

export function hostStatusText(
  host: HostStatus,
  hosts: readonly HostStatus[],
  t: ReturnType<typeof strings>,
  errorText: (code: string) => string,
): string {
  if (!host.online) return t.hostOffline;
  if (!host.settings) return t.hostNoWorkboard;
  const role = groupSyncRole(host.settings, host.serverId);
  if (role !== "follower") return t.hostRoles[role];
  const master = host.settings.groupSyncMaster!;
  const state = host.sync?.state;
  const text =
    state === "synced" || state === "waiting" || state === "error"
      ? t.hostRoles[state]
      : t.hostRoles.pending;
  return text
    .replace(
      "{master}",
      hosts.find((item) => item.serverId === master)?.label ?? master,
    )
    .replace("{error}", host.sync?.error ? errorText(host.sync.error) : "");
}

export function HostSettings({
  hosts,
  master,
  disabled,
  t,
  theme,
  errorText,
  onSetMaster,
}: {
  hosts: readonly HostStatus[];
  /** The local host's designation; every host is written together. */
  master: string | null;
  disabled: boolean;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  errorText(code: string): string;
  onSetMaster(master: string | null): Promise<boolean>;
}) {
  const [choosing, setChoosing] = useState<string | null | undefined>();
  const candidates = hosts.filter((host) => host.online && host.settings);
  const name = (host: HostStatus) =>
    host.local ? t.thisHost.replace("{host}", host.label) : host.label;
  const chosen = hosts.find((host) => host.serverId === choosing);
  return (
    <SettingsSection title={t.hostsTitle} testID="workboard-hosts">
      <Text style={[styles.hint, { color: theme.colors.foregroundMuted }]}>
        {t.hostsHint}
      </Text>
      <SettingsCard>
        <SettingsSelect
          label={t.groupMaster}
          hint={t.groupMasterHint}
          value={master ?? ""}
          options={[
            { value: "", label: t.groupMasterNone },
            ...(master && !candidates.some((host) => host.serverId === master)
              ? [{ value: master, label: master }]
              : []),
            ...candidates.map((host) => ({
              value: host.serverId,
              label: name(host),
            })),
          ]}
          onValueChange={(value) => {
            if ((value || null) !== master) setChoosing(value || null);
          }}
          disabled={disabled}
          testID="workboard-group-master"
        />
        {hosts.map((host) => (
          <SettingsRow
            key={host.serverId}
            label={name(host)}
            hint={hostStatusText(host, hosts, t, errorText)}
            testID={`workboard-host-${host.serverId}`}
          />
        ))}
      </SettingsCard>
      {choosing !== undefined && (
        <ConfirmationModal
          title={t.changeGroupMaster}
          description={
            choosing === null
              ? t.clearGroupMasterConfirm
              : t.changeGroupMasterConfirm
                  .replace(
                    "{hosts}",
                    candidates
                      .filter((host) => host.serverId !== choosing)
                      .map(name)
                      .join(", "),
                  )
                  .replaceAll("{master}", chosen ? name(chosen) : choosing)
          }
          confirmLabel={t.changeGroupMaster}
          disabled={disabled}
          t={t}
          theme={theme}
          onClose={() => setChoosing(undefined)}
          onConfirm={() => onSetMaster(choosing)}
        />
      )}
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, lineHeight: 18, marginBottom: 8 },
});
