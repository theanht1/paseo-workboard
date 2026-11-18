import { CANCEL_BINDING_BUSY_ERROR_CODE } from "../shared/rpc";
import type { strings } from "./strings";

export function mutationErrorText(
  error: unknown,
  t: ReturnType<typeof strings>,
): string {
  if (!(error instanceof Error)) return t.confirmationFailed;
  const messages: Record<string, string> = {
    ...t.issues,
    ...t.mutationErrors,
    ...t.bootErrors,
    [CANCEL_BINDING_BUSY_ERROR_CODE]: t.cancelBindingBusy,
  };
  const message = error.message.replace(
    /^Request failed: (.*) requestType=plugin\.rpc\.invoke\.request code=handler_error$/,
    "$1",
  );
  return Object.hasOwn(messages, message)
    ? messages[message]
    : t.confirmationFailed;
}
