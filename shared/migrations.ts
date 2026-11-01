import { z } from "zod";
import {
  dataSchema,
  DATA_SCHEMA_VERSION,
  DEFAULT_PRIORITY_STYLES,
  priorityStyleSchema,
  DEFAULT_LABELS,
  DEFAULT_GROUPS,
  groupSchema,
  labelKey,
  orderedGroups,
  settingsSchema,
  taskSchema,
} from "./model";

const oldPriority = z.enum(["high", "normal", "low"]);
const v12Task = taskSchema.omit({ autoArchivePaused: true }).extend({
  archived: taskSchema.shape.archived.unwrap().omit({ undo: true }).nullable(),
});
const oldTask = v12Task
  .omit({ priorityLabelBaseline: true, priorityWrite: true })
  .extend({
    priority: oldPriority.optional(),
    mergedDrafts: z
      .array(
        taskSchema.shape.mergedDrafts
          .unwrap()
          .element.extend({ priority: oldPriority.optional() }),
      )
      .default([]),
  });
const oldSettings = settingsSchema.extend({
  priorityStyles: z
    .object({
      high: priorityStyleSchema,
      normal: priorityStyleSchema,
      low: priorityStyleSchema,
    })
    .optional(),
});
const oldDataShape = {
  ...dataSchema.shape,
  tasks: z.array(oldTask).default([]),
  settings: oldSettings.default(() => oldSettings.parse({})),
};
const { cardOrderByStage: _cardOrder, ...preV8DataShape } = oldDataShape;

const legacyStages = [
  "todo",
  "in-progress",
  "review",
  "done",
  "canceled",
] as const;
const legacyGroups = legacyStages.map((kind) => ({
  id: kind,
  kind,
  name: null,
  label: DEFAULT_LABELS[kind],
}));
// Legacy versions had a master gate and enabled both subordinate rules by default.
const v8Settings = oldSettings.extend({
  autoArchive: z.boolean().default(false),
  archiveDoneEnabled: z.boolean().default(true),
  archiveCanceledEnabled: z.boolean().default(true),
});
const preV8Settings = v8Settings.omit({ defaultStartWorkGroup: true });
const preV7Settings = preV8Settings
  .omit({
    archiveAfterDays: true,
    archiveMappingNeedsReview: true,
    defaultDraftGroup: true,
    defaultStartGroup: true,
  })
  .extend({ groups: z.array(groupSchema).min(1).default(DEFAULT_GROUPS) });
const priorSettings = preV7Settings
  .omit({ pinInProgressWorkspaces: true })
  .extend({
    pinRunningWorkspaces: z.boolean().default(true),
  });
const legacySettings = priorSettings.omit({ groups: true }).extend({
  labels: z
    .object({
      todo: z.string().trim().min(1),
      "in-progress": z.string().trim().min(1),
      review: z.string().trim().min(1),
      done: z.string().trim().min(1),
      canceled: z.string().trim().min(1),
    })
    .prefault(DEFAULT_LABELS)
    .refine(
      (labels) =>
        new Set(Object.values(labels).map(labelKey)).size ===
        legacyStages.length,
    ),
});
/**
 * Before v6 a task kept one conversation status plus a string list of agent ids. Stored
 * data from those versions is parsed with this shape and upgraded by `migrateV5`.
 */
const preV6Task = oldTask
  .omit({
    conversationDisplayEvidence: true,
    conversationGateAt: true,
    conversationGateEvidence: true,
    conversationReason: true,
    mergedDrafts: true,
  })
  .extend({ conversationAgents: z.array(z.string()).default([]) });
const preV6Tasks = z.array(preV6Task).default([]);
const legacyData = z.object({
  ...preV8DataShape,
  schemaVersion: z.literal(1).default(1),
  settings: legacySettings.default(() => legacySettings.parse({})),
  tasks: z
    .array(
      preV6Task.extend({
        draftStage: z.enum(["todo", "canceled"]),
        lastStage: z.enum([...legacyStages, "conflict"]),
        archived: taskSchema.shape.archived
          .unwrap()
          .omit({ group: true })
          .nullable(),
        binding: taskSchema.shape.binding
          .unwrap()
          .omit({ stage: true })
          .nullable(),
      }),
    )
    .default([]),
});
const v2Settings = priorSettings.extend({
  groups: z.array(groupSchema).min(1).default(legacyGroups),
});
const v2Data = z.object({
  ...preV8DataShape,
  schemaVersion: z.literal(2).default(2),
  tasks: preV6Tasks,
  settings: v2Settings.default(() => v2Settings.parse({})),
});
const v3Data = v2Data.extend({
  schemaVersion: z.literal(3).default(3),
  settings: priorSettings.default(() => priorSettings.parse({})),
});

/**
 * v6 splits the conversation record into display evidence and gate evidence. A once exact
 * observation stays a valid lower bound when the task later became unknown, and never a
 * gate: the real last message may be newer than what was last observed.
 */
function migrateV5(values: unknown) {
  const previous = z
    .object({
      ...preV8DataShape,
      schemaVersion: z.literal(5).default(5),
      tasks: preV6Tasks,
      settings: preV7Settings.default(() => preV7Settings.parse({})),
    })
    .parse(values);
  return migrateV6({
    ...previous,
    schemaVersion: 6,
    tasks: previous.tasks.map((task) => {
      const observedAt = task.lastConversationAt;
      const display =
        task.conversationStatus === "known"
          ? observedAt
            ? "exact"
            : "none"
          : task.conversationStatus === "none"
            ? "none"
            : observedAt
              ? "lower-bound"
              : "unknown";
      const gate =
        task.conversationStatus === "known" && observedAt ? observedAt : null;
      return {
        ...task,
        conversationDisplayEvidence: display,
        conversationGateAt: gate,
        conversationGateEvidence: gate ? "exact" : "unknown",
        conversationReason: null,
        // v5 ids have no observation time; real scans rediscover agents without synthetic blockers.
        conversationAgents: [],
      };
    }),
  });
}

function migrateV6(values: unknown) {
  const previous = z
    .object({
      ...preV8DataShape,
      schemaVersion: z.literal(6).default(6),
      tasks: z.array(oldTask.omit({ mergedDrafts: true })).default([]),
      settings: preV7Settings.default(() => preV7Settings.parse({})),
    })
    .parse(values);
  const groups = [...previous.settings.groups];
  const addedCanceled = !groups.some((group) => group.kind === "canceled");
  if (addedCanceled) {
    let id = "canceled";
    for (let suffix = 2; groups.some((group) => group.id === id); suffix++)
      id = `canceled-${suffix}`;
    let label = DEFAULT_LABELS.canceled;
    for (
      let suffix = 2;
      groups.some((group) => labelKey(group.label) === labelKey(label));
      suffix++
    )
      label = `${DEFAULT_LABELS.canceled}-${suffix}`;
    groups.push({ id, kind: "canceled", name: null, label });
  }
  return migrateV7({
    ...previous,
    schemaVersion: 7,
    settings: {
      ...previous.settings,
      groups,
      autoArchive: addedCanceled ? false : previous.settings.autoArchive,
      archiveMappingNeedsReview: addedCanceled,
    },
    tasks: previous.tasks.map((task) => ({
      ...task,
      mergedDrafts: [],
      // v6 could clear seenWhileLive while retaining cached provider children.
      conversationAgents: task.conversationAgents.filter(
        (entry) =>
          entry.lastObservedAt !== null ||
          entry.seenWhileLive ||
          entry.id.includes("/provider/"),
      ),
    })),
  });
}

function migrateV7(values: unknown) {
  const previous = z
    .object({
      ...preV8DataShape,
      schemaVersion: z.literal(7).default(7),
      settings: preV8Settings.default(() => preV8Settings.parse({})),
    })
    .parse(values);
  return migrateV8({
    ...previous,
    schemaVersion: 8,
    cardOrderByStage: {},
  });
}

function migrateV8(values: unknown) {
  const previous = z
    .object({
      ...oldDataShape,
      schemaVersion: z.literal(8).default(8),
      settings: v8Settings.default(() => v8Settings.parse({})),
    })
    .parse(values);
  const { autoArchive, ...settings } = previous.settings;
  return migrateV9({
    ...previous,
    schemaVersion: 9,
    settings: {
      ...settings,
      archiveDoneEnabled: autoArchive && settings.archiveDoneEnabled,
      archiveCanceledEnabled: autoArchive && settings.archiveCanceledEnabled,
    },
  });
}

/** Earlier paths retain their own priority schema until the final conversion. */
function migrateV9(values: unknown) {
  const previous = z
    .object({ ...oldDataShape, schemaVersion: z.literal(9).default(9) })
    .parse(values);
  return migrateV11({ ...previous, schemaVersion: 11 });
}

function migrateV11(values: unknown) {
  const previous = z
    .object({ ...oldDataShape, schemaVersion: z.literal(11) })
    .parse(values);
  const levels = { high: "p1", normal: "p2", low: "p3" } as const;
  // Paseo stores settings as JSON and rejects an undefined value, so absent keys stay absent.
  const withPriority = <T extends { priority?: keyof typeof levels }>({
    priority,
    ...item
  }: T) => (priority ? { ...item, priority: levels[priority] } : item);
  const { priorityStyles: styles, ...settings } = previous.settings;
  return dataSchema.parse({
    ...previous,
    schemaVersion: DATA_SCHEMA_VERSION,
    settings: styles
      ? {
          ...settings,
          priorityStyles: {
            p0: DEFAULT_PRIORITY_STYLES.p0,
            p1: styles.high,
            p2: styles.normal,
            p3: styles.low,
          },
        }
      : settings,
    tasks: previous.tasks.map((task) => ({
      ...withPriority(task),
      mergedDrafts: task.mergedDrafts.map(withPriority),
    })),
  });
}

function migrateV1(values: unknown) {
  const previous = legacyData.parse(values);
  const { labels, ...preferences } = previous.settings;
  const groups = legacyStages.map((kind) => ({
    id: kind,
    kind,
    name: null,
    label: labels[kind],
  }));
  return {
    ...previous,
    schemaVersion: 2,
    settings: { ...preferences, groups },
    tasks: previous.tasks.map((task) => ({
      ...task,
      binding: task.binding ? { ...task.binding, stage: "in-progress" } : null,
      archived: task.archived
        ? {
            ...task.archived,
            group:
              groups.find((group) => group.id === task.archived!.stage) ?? null,
          }
        : null,
    })),
  };
}

function addInbox(values: unknown, fromVersion: number) {
  const previous = v2Data.parse(fromVersion === 1 ? migrateV1(values) : values);
  const groups = previous.settings.groups;
  let id = "inbox";
  for (let suffix = 2; groups.some((group) => group.id === id); suffix++)
    id = `inbox-${suffix}`;
  let label = DEFAULT_LABELS.inbox;
  for (
    let suffix = 2;
    groups.some((group) => labelKey(group.label) === labelKey(label));
    suffix++
  )
    label = `${DEFAULT_LABELS.inbox}-${suffix}`;
  return {
    ...previous,
    schemaVersion: 3,
    settings: {
      ...previous.settings,
      groups: [{ id, kind: "inbox", name: null, label }, ...groups],
      groupOrder: previous.settings.groupOrder.length
        ? [id, ...orderedGroups(previous.settings).map((group) => group.id)]
        : [],
    },
  };
}

export const UNSUPPORTED_STORAGE_VERSION_ERROR_CODE =
  "unsupported-storage-version";
export const INVALID_STORAGE_DATA_ERROR_CODE = "invalid-storage-data";

/** Stable codes survive the host's serialized settings error response. */
export class UnsupportedStorageVersionError extends Error {
  constructor() {
    super(UNSUPPORTED_STORAGE_VERSION_ERROR_CODE);
    this.name = "UnsupportedStorageVersionError";
  }
}
export class InvalidStorageDataError extends Error {
  constructor() {
    super(INVALID_STORAGE_DATA_ERROR_CODE);
    this.name = "InvalidStorageDataError";
  }
}

function migrateDataUnsafe(values: unknown, fromVersion: number) {
  if (fromVersion === DATA_SCHEMA_VERSION) return dataSchema.parse(values);
  if (fromVersion === 12) {
    const previous = z
      .object({
        ...dataSchema.shape,
        schemaVersion: z.literal(12),
        tasks: z.array(v12Task).default([]),
      })
      .parse(values);
    return dataSchema.parse({
      ...previous,
      schemaVersion: DATA_SCHEMA_VERSION,
    });
  }
  if (fromVersion === 11) return migrateV11(values);
  if (fromVersion === 10) {
    const previous = z
      .object({ ...oldDataShape, schemaVersion: z.literal(10) })
      .parse(values);
    return migrateV11({ ...previous, schemaVersion: 11 });
  }
  if (fromVersion === 9) return migrateV9(values);
  if (fromVersion === 8) return migrateV8(values);
  if (fromVersion === 7) return migrateV7(values);
  if (fromVersion === 6) return migrateV6(values);
  if (fromVersion === 5) return migrateV5(values);
  if (fromVersion === 4) {
    const previous = z
      .object({
        ...preV8DataShape,
        schemaVersion: z.literal(4),
        tasks: preV6Tasks,
        settings: preV7Settings.default(() => preV7Settings.parse({})),
      })
      .parse(values);
    return migrateV5({ ...previous, schemaVersion: 5 });
  }
  if (![1, 2, 3].includes(fromVersion))
    throw new UnsupportedStorageVersionError();
  const previous = v3Data.parse(
    fromVersion === 3 ? values : addInbox(values, fromVersion),
  );
  const { pinRunningWorkspaces, ...settings } = previous.settings;
  return migrateV5({
    ...previous,
    schemaVersion: 5,
    settings: { ...settings, pinInProgressWorkspaces: pinRunningWorkspaces },
    autoPins: {},
  });
}

/** Paseo persists the validated migration once, retaining its revision check. */
export function migrateData(values: unknown, fromVersion: number) {
  try {
    const migrated = migrateDataUnsafe(values, fromVersion);
    if (fromVersion < 10) {
      // Inspect the raw value before schema defaults erase the missing preference.
      const previous = z
        .object({
          settings: z
            .object({ exclusiveStatusLabels: z.boolean().optional() })
            .optional(),
        })
        .parse(values);
      migrated.exclusiveStatusLabelsPending =
        previous.settings?.exclusiveStatusLabels === undefined;
      if (migrated.exclusiveStatusLabelsPending)
        migrated.settings.exclusiveStatusLabels = false;
    }
    return migrated;
  } catch (error) {
    if (error instanceof z.ZodError) throw new InvalidStorageDataError();
    throw error;
  }
}
