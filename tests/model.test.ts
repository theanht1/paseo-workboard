import { migrateData } from "../shared/migrations";
import { describe, expect, it } from "vitest";
import {
  DATA_SCHEMA_VERSION,
  dataSchema,
  DEFAULT_LABELS,
  DEFAULT_GROUPS,
  resolveStage,
  archiveDelayFor,
  archiveDueAt,
  archiveGate,
  conversationStatusFor,
  isArchiveDue,
  newTask,
  newestConflictStage,
  settingsSchema,
} from "../shared/model";

describe("task stages and conversation-based expiry", () => {
  it("does not infer business completion from an absent label", () => {
    expect(resolveStage([], DEFAULT_GROUPS)).toBe("inbox");
    expect(resolveStage(["task:todo"], DEFAULT_GROUPS)).toBe("todo");
    expect(resolveStage(["task:inbox"], DEFAULT_GROUPS)).toBe("inbox");
    expect(resolveStage(["task:inbox", "task:todo"], DEFAULT_GROUPS)).toBe(
      "conflict",
    );
    expect(resolveStage(["task:done", "priority:high"], DEFAULT_GROUPS)).toBe(
      "done",
    );
    expect(resolveStage(["task:done", "task:todo"], DEFAULT_GROUPS)).toBe(
      "conflict",
    );
    expect(resolveStage([" TASK:DONE "], DEFAULT_GROUPS)).toBe("done");
    expect(resolveStage(["TASK:DONE", "Task:Todo"], DEFAULT_GROUPS)).toBe(
      "conflict",
    );
  });
  it("uses the last conversation and a strict 30-day boundary", () => {
    const conversation = "2026-09-01T10:00:00.000Z";
    const boundary = Date.parse("2026-10-01T10:00:00.000Z");
    expect(archiveDueAt(conversation)).toBe("2026-10-01T10:00:00.000Z");
    expect(isArchiveDue("done", conversation, boundary)).toBe(false);
    expect(isArchiveDue("done", conversation, boundary + 1)).toBe(true);
    expect(isArchiveDue("canceled", conversation, boundary + 1)).toBe(true);
    expect(isArchiveDue("todo", conversation, boundary + 1)).toBe(false);
    expect(isArchiveDue("inbox", conversation, boundary + 1)).toBe(false);
    expect(isArchiveDue("conflict", conversation, boundary + 1)).toBe(false);
    expect(isArchiveDue("done", null, boundary + 1)).toBe(false);
    expect(isArchiveDue("done", conversation, boundary + 1, null)).toBe(false);
  });
  it("uses the shared legacy delay as each terminal rule's fallback", () => {
    const legacy = migrateData(
      {
        schemaVersion: 8,
        settings: { autoArchive: true, archiveAfterDays: 14 },
      },
      8,
    ).settings;
    expect(legacy).toMatchObject({
      archiveCanceledEnabled: true,
      archiveDoneEnabled: true,
      archiveCanceledAfterDays: null,
      archiveDoneAfterDays: null,
    });
    expect(archiveDelayFor(legacy, "canceled")).toBe(14);
    expect(archiveDelayFor(legacy, "done")).toBe(14);
    expect(archiveDelayFor(legacy, "todo")).toBeNull();

    const split = settingsSchema.parse({
      archiveCanceledEnabled: true,
      archiveAfterDays: 30,
      archiveCanceledAfterDays: 7,
      archiveDoneAfterDays: 90,
      archiveDoneEnabled: false,
    });
    expect(archiveDelayFor(split, "canceled")).toBe(7);
    expect(archiveDelayFor(split, "done")).toBeNull();
  });
  it("keeps one stored settings version for the schema and its registration", () => {
    expect(dataSchema.parse({}).schemaVersion).toBe(DATA_SCHEMA_VERSION);
  });
  it("gates archiving on an upper bound and never on a lower bound", () => {
    const task = (evidence: {
      conversationGateEvidence: "exact" | "upper-bound" | "unknown";
      conversationGateAt: string | null;
    }) => ({ ...newTask("t", "T", "2026-01-01T00:00:00Z"), ...evidence });
    const at = "2026-08-01T00:00:00.000Z";
    expect(
      archiveGate(
        task({ conversationGateEvidence: "exact", conversationGateAt: at }),
      ),
    ).toBe(at);
    expect(
      archiveGate(
        task({
          conversationGateEvidence: "upper-bound",
          conversationGateAt: at,
        }),
      ),
    ).toBe(at);
    expect(
      archiveGate(
        task({
          conversationGateEvidence: "unknown",
          conversationGateAt: at,
        }),
      ),
    ).toBe(null);
  });
  it("summarizes display evidence without losing a bound", () => {
    expect(conversationStatusFor("exact")).toBe("known");
    expect(conversationStatusFor("lower-bound")).toBe("known");
    expect(conversationStatusFor("upper-bound")).toBe("known");
    expect(conversationStatusFor("none")).toBe("none");
    expect(conversationStatusFor("unknown")).toBe("unknown");
  });
  it("rejects ambiguous mappings and keeps autoarchive opt-in", () => {
    expect(settingsSchema.parse({})).toMatchObject({
      archiveDoneEnabled: false,
      archiveCanceledEnabled: false,
    });
    expect(settingsSchema.parse({}).exclusiveStatusLabels).toBe(true);
    expect(
      settingsSchema.parse({ exclusiveStatusLabels: false })
        .exclusiveStatusLabels,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({
        groups: DEFAULT_GROUPS.map((group) =>
          group.id === "done" ? { ...group, label: " task:todo " } : group,
        ),
      }).success,
    ).toBe(false);
  });
  it("attributes a conflict to the one label that differs from the previous stage", () => {
    const groups = settingsSchema.parse({}).groups;
    expect(
      newestConflictStage("todo", ["task:todo", "task:done"], groups),
    ).toBe("done");
    expect(
      newestConflictStage("done", ["task:in-progress", "task:done"], groups),
    ).toBe("in-progress");
    expect(
      newestConflictStage("todo", ["task:review", "task:done"], groups),
    ).toBe(undefined);
    expect(
      newestConflictStage(
        "todo",
        ["task:todo", "task:review", "task:done"],
        groups,
      ),
    ).toBe(undefined);
    expect(
      newestConflictStage("conflict" as never, ["task:todo"], groups),
    ).toBe(undefined);
  });
  it("enables sidebar In progress pinning, leaves Review pinning off and defers missing exclusivity for older settings", () => {
    const data = migrateData(
      {
        schemaVersion: 1,
        settings: {
          autoArchive: false,
          language: "en",
          labels: DEFAULT_LABELS,
        },
      },
      1,
    );
    expect(data.settings).toEqual({
      ...settingsSchema.parse({}),
      exclusiveStatusLabels: false,
      pinInProgressWorkspaces: true,
      pinReviewWorkspaces: false,
      groups: DEFAULT_GROUPS,
      groupOrder: [],
    });
    expect(
      settingsSchema.parse({ pinInProgressWorkspaces: false })
        .pinInProgressWorkspaces,
    ).toBe(false);
  });
});
