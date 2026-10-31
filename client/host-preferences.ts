import { Platform } from "react-native";
import type { CardOrderByStage } from "../shared/model";

/** How this client combines hosts; never synchronized between clients or hosts. */
export type HostPreferences = {
  allHosts: boolean;
  /** The last cross-host arrangement per group, used only to interleave host columns. */
  crossHostOrder: CardOrderByStage;
};
type StorageReader = { getItem(key: string): string | null };
type StorageWriter = { setItem(key: string, value: string): void };
declare const localStorage: (StorageReader & StorageWriter) | undefined;
const storageKey = (host: string) => `paseo-workboard:hosts:${host}`;
const defaults = (): HostPreferences => ({
  allHosts: true,
  crossHostOrder: {},
});

export function loadHostPreferencesFrom(
  storage: StorageReader,
  host: string,
): HostPreferences {
  try {
    const value = JSON.parse(storage.getItem(storageKey(host)) ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value))
      return defaults();
    const orders =
      value.crossHostOrder &&
      typeof value.crossHostOrder === "object" &&
      !Array.isArray(value.crossHostOrder)
        ? value.crossHostOrder
        : {};
    return {
      allHosts: value.allHosts !== false,
      crossHostOrder: Object.fromEntries(
        Object.entries(orders)
          .filter(([, ids]) => Array.isArray(ids))
          .map(([stage, ids]) => [
            stage,
            [
              ...new Set(
                (ids as unknown[]).filter(
                  (id): id is string => typeof id === "string" && !!id,
                ),
              ),
            ],
          ]),
      ),
    };
  } catch {
    return defaults();
  }
}

export function saveHostPreferencesTo(
  storage: StorageWriter,
  host: string,
  value: HostPreferences,
): boolean {
  try {
    storage.setItem(storageKey(host), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadHostPreferences(host: string): HostPreferences {
  try {
    return Platform.OS === "web" && typeof localStorage !== "undefined"
      ? loadHostPreferencesFrom(localStorage, host)
      : defaults();
  } catch {
    return defaults();
  }
}

export function saveHostPreferences(
  host: string,
  value: HostPreferences,
): boolean {
  try {
    return (
      Platform.OS !== "web" ||
      typeof localStorage === "undefined" ||
      saveHostPreferencesTo(localStorage, host, value)
    );
  } catch {
    return false;
  }
}
