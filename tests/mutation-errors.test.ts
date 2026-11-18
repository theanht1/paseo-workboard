import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { CANCEL_BINDING_BUSY_ERROR_CODE } from "../shared/rpc";
import { strings } from "../client/strings";
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: vi.fn() }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: () => null,
  Modal: () => null,
  ScrollView: () => null,
  TextInput: () => null,
  useToast: vi.fn(),
}));
vi.mock("@getpaseo/plugin/client/ui", () =>
  Object.fromEntries(
    [
      "ExternalLink",
      "SettingsCard",
      "SettingsInput",
      "SettingsAction",
      "SettingsSelect",
      "SettingsSection",
      "SettingsSwitch",
      "SettingsRow",
    ].map((key) => [key, () => null]),
  ),
);
import { mutationErrorText } from "../client/mutation-errors";

// Enumerate messages in the real throw expressions, including ternary fallbacks.
const codes = new Set<string>([CANCEL_BINDING_BUSY_ERROR_CODE]);
function messages(node: ts.Expression): string[] {
  if (ts.isStringLiteral(node)) return [node.text];
  if (ts.isConditionalExpression(node))
    return [...messages(node.whenTrue), ...messages(node.whenFalse)];
  if (ts.isBinaryExpression(node))
    return [...messages(node.left), ...messages(node.right)];
  if (ts.isCallExpression(node) && node.expression.getText() === "String")
    return node.arguments.flatMap(messages);
  return [];
}
// Conversation replay errors are caught by Workboard.observe and become evidence/issue codes.
// These four modules can reject a mutation, including Promise.reject and IPC reply failures.
for (const file of ["workboard", "host", "store", "paseo-compat"]) {
  const source = ts.createSourceFile(
    file + ".ts",
    readFileSync(new URL(`../server/${file}.ts`, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  function visit(node: ts.Node) {
    if (
      (ts.isNewExpression(node) &&
        node.expression.getText(source) === "Error") ||
      (ts.isCallExpression(node) &&
        node.expression.getText(source) === "this.rejectAll")
    )
      for (const argument of node.arguments ?? [])
        for (const message of messages(argument)) codes.add(message);
    ts.forEachChild(node, visit);
  }
  visit(source);
}
it.each(["zh", "en"] as const)(
  "F-10 maps every current server error and issue in %s, using a generic fallback for unknown details",
  (language) => {
    const t = strings(language);
    for (const code of [
      ...codes,
      ...Object.keys(t.issues),
      ...Object.keys(t.bootErrors),
    ]) {
      const value = mutationErrorText(new Error(code), t);
      expect(value, code).not.toBe(t.confirmationFailed);
      expect(value, code).not.toBe("");
      if (language === "zh") expect(value, code).not.toBe(code);
    }
    expect(mutationErrorText(new Error("private host error"), t)).toBe(
      t.confirmationFailed,
    );
    expect(
      mutationErrorText(
        new Error(
          "Request failed: Settings changed; refresh before saving requestType=plugin.rpc.invoke.request code=handler_error",
        ),
        t,
      ),
    ).toBe(t.mutationErrors["Settings changed; refresh before saving"]);
    expect(
      mutationErrorText(
        new Error(
          "Request failed: private host error requestType=plugin.rpc.invoke.request code=handler_error",
        ),
        t,
      ),
    ).toBe(t.confirmationFailed);
    expect(mutationErrorText(null, t)).toBe(t.confirmationFailed);
    expect(mutationErrorText(new Error("constructor"), t)).toBe(
      t.confirmationFailed,
    );
  },
);
