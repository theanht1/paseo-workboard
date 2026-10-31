import { expect, it, vi } from "vitest";
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
import {
  loadHostPreferencesFrom,
  saveHostPreferencesTo,
} from "../client/host-preferences";

it("defaults to all hosts and remembers the choice per viewing host", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  expect(loadHostPreferencesFrom(storage, "a")).toEqual({
    allHosts: true,
    crossHostOrder: {},
  });
  expect(
    saveHostPreferencesTo(storage, "a", {
      allHosts: false,
      crossHostOrder: { todo: ["x", "y"] },
    }),
  ).toBe(true);
  expect(loadHostPreferencesFrom(storage, "a")).toEqual({
    allHosts: false,
    crossHostOrder: { todo: ["x", "y"] },
  });
  expect(loadHostPreferencesFrom(storage, "b").allHosts).toBe(true);
});

it.each(["{bad", "[]", '{"allHosts":0,"crossHostOrder":[]}'])(
  "falls back safely for invalid saved host preferences %s",
  (value) => {
    expect(loadHostPreferencesFrom({ getItem: () => value }, "a")).toEqual({
      allHosts: true,
      crossHostOrder: {},
    });
  },
);

it("keeps only unique task IDs in a remembered arrangement", () => {
  expect(
    loadHostPreferencesFrom(
      {
        getItem: () =>
          '{"crossHostOrder":{"todo":["a","a","",3,"b"],"done":"bad"}}',
      },
      "a",
    ).crossHostOrder,
  ).toEqual({ todo: ["a", "b"] });
});

it("reports storage denial instead of throwing", () => {
  expect(
    saveHostPreferencesTo(
      {
        setItem: () => {
          throw new Error("denied");
        },
      },
      "a",
      { allHosts: true, crossHostOrder: {} },
    ),
  ).toBe(false);
});
