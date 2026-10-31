import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import {
  boardSchema,
  groupOrderSchema,
  groupsSchema,
  groupSchema,
  settingsSchema,
  stageSchema,
  startSchema,
  prioritySchema,
} from "./model";

export const snapshotRpc = defineRpc({
  name: "workboard.snapshot",
  input: z.object({}),
  output: boardSchema,
});
export const CANCEL_BINDING_BUSY_ERROR_CODE = "cancel-binding-busy";
export const mutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("priority"),
    taskId: z.string(),
    updatedAt: z.string(),
    priority: prioritySchema,
    expectedLabels: z.array(z.string()),
  }),
  z.object({
    action: z.literal("create"),
    title: z.string().trim().min(1).max(1000),
    description: z.string().max(50000).default(""),
    projectId: z.string().nullable().default(null),
    stage: stageSchema.optional(),
  }),
  z.object({
    action: z.literal("edit"),
    taskId: z.string(),
    updatedAt: z.string(),
    title: z.string().trim().min(1).max(1000),
    description: z.string().max(50000),
    projectId: z.string().nullable(),
  }),
  z.object({
    action: z.literal("start"),
    ...startSchema.shape,
    expectedGroup: groupSchema
      .pick({ id: true, kind: true, label: true })
      .optional(),
  }),
  z.object({
    action: z.literal("stage"),
    taskId: z.string(),
    stage: stageSchema,
    expectedLabels: z.array(z.string()),
    expectedUpdatedAt: z.string().optional(),
    expectedGroup: groupSchema
      .pick({ id: true, kind: true, label: true })
      .optional(),
  }),
  z.object({
    action: z.literal("reorder-cards"),
    taskId: z.string(),
    stage: stageSchema,
    expectedOrder: z.array(z.string()),
    cardOrder: z.array(z.string()),
  }),
  z.object({
    action: z.literal("reset-card-order"),
    stage: stageSchema,
    expectedOrder: z.array(z.string()),
  }),
  z.object({ action: z.literal("archive-draft"), taskId: z.string() }),
  z.object({
    action: z.literal("detach-draft"),
    taskId: z.string(),
    draftId: z.string(),
    updatedAt: z.string(),
  }),
  z.object({
    action: z.literal("cancel-binding"),
    taskId: z.string(),
    operationId: z.string(),
  }),
  z.object({
    action: z.literal("undo-archive"),
    taskId: z.string(),
    operationId: z.string(),
    updatedAt: z.string(),
  }),
  z.object({
    action: z.literal("resolve-archive"),
    taskId: z.string(),
    operationId: z.string(),
    updatedAt: z.string(),
    outcome: z.enum(["confirm", "restore"]),
  }),
  z.object({
    action: z.literal("reorder-groups"),
    expectedGroupOrder: groupOrderSchema,
    groupOrder: groupOrderSchema,
  }),
  z.object({
    action: z.literal("group-sync"),
    master: z.string().min(1).nullable(),
  }),
  z.object({
    action: z.literal("sync-groups"),
    master: z.string().min(1),
    groups: groupsSchema,
    groupOrder: groupOrderSchema,
  }),
  z.object({
    action: z.literal("settings"),
    revision: z.number(),
    expectedSettings: settingsSchema
      .extend({ groups: groupsSchema })
      .strict()
      .optional(),
    settings: settingsSchema.extend({ groups: groupsSchema }).strict(),
  }),
]);
export type Mutation = z.infer<typeof mutationSchema>;
export const mutateRpc = defineRpc({
  name: "workboard.mutate",
  input: mutationSchema,
  output: boardSchema,
});
