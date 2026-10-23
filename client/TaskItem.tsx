import { useState, type ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import {
  groupKind,
  isTerminalGroup,
  type Board,
  type Card,
} from "../shared/model";
import { attentionReasons, shortDate } from "./board-utils";
import { strings } from "./strings";
import { groupColor, supplementalColor } from "./colors";
import { HintButton } from "./Hint";

function CardAction({
  theme,
  style,
  ...props
}: ComponentProps<typeof HintButton> & { theme: PluginSurfaceProps["theme"] }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <HintButton
      {...props}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={(state) => [
        typeof style === "function" ? style(state) : style,
        !props.disabled &&
          (hovered || focused || state.pressed) && {
            backgroundColor: theme.colors.surface2,
          },
      ]}
    />
  );
}

export function TaskItem({
  card,
  board,
  host,
  t,
  theme,
  disabled,
  pending,
  onOpen,
  onEdit,
  onStart,
  onStatus,
  onArchive,
  onCancelBinding,
  onDetachDraft,
  onUndo,
  compact = false,
  showDragHandle = false,
  presentation = "card",
}: {
  card: Card;
  board: Board;
  /** The owning host's label when the board combines hosts. */
  host?: string;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  disabled: boolean;
  pending: boolean;
  onOpen(): void;
  onEdit(): void;
  onStart(): void;
  onStatus(): void;
  onArchive(): void;
  onCancelBinding(): void;
  onDetachDraft(draftId: string): void;
  onUndo?(): Promise<void>;
  compact?: boolean;
  showDragHandle?: boolean;
  presentation?: "card" | "row";
}) {
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [titleHovered, setTitleHovered] = useState(false);
  const toast = useToast();
  const request = card.changeRequest;
  const requestLabel = request
    ? `${request.forge === "gitlab" ? "MR" : "PR"}${request.number === null ? "" : ` ${request.forge === "gitlab" ? "!" : "#"}${request.number}`}`
    : "";
  const isDraft = card.workspaceId === null;
  const displayedDate = card.lastConversationAt
    ? shortDate(card.lastConversationAt, t.locale)
    : null;
  const time =
    card.conversationDisplayEvidence === "none"
      ? t.noConversation
      : card.conversationDisplayEvidence === "unknown" || displayedDate === null
        ? t.unknownConversation
        : card.conversationDisplayEvidence === "lower-bound"
          ? t.conversationAtLeast.replace("{date}", displayedDate)
          : card.conversationDisplayEvidence === "upper-bound"
            ? t.conversationAtMost.replace("{date}", displayedDate)
            : displayedDate;
  const reason = card.conversationReason
    ? t.conversationReasons[card.conversationReason]
    : null;
  const terminal = isTerminalGroup(card.stage, board.settings.groups);
  const issue =
    card.issue === "no-conversation" || card.issue === "conversation-unknown"
      ? null
      : issueText(card.issue, t);
  const normalLabels = card.labels.filter(
    (label) => !card.managedLabels.includes(label),
  );
  const group = board.settings.groups.find((item) => item.id === card.stage);
  const reasons = attentionReasons(card).map((reason) => {
    if (reason === "waiting" || reason === "error" || reason === "attention")
      return t.attentionActivity[reason];
    if (reason === "checks-failure") return t.checks.failure;
    if (reason === "changes-requested") return t.reviews.changes_requested;
    return issueText(reason, t) ?? reason;
  });
  const pinHint = card.pinState === "automatic" ? t.pinAutomatic : t.pinManual;
  const requestSummary = (
    <>
      {request && (
        <View style={styles.changeRequest}>
          <ExternalLink
            href={request.url}
            accessibilityLabel={`${requestLabel} · ${t.changeRequestStates[request.state]}: ${request.title}`}
            onError={() => toast.error(t.openChangeRequestError)}
          >
            <View style={styles.requestLink}>
              <Icon
                name={changeRequestIcon(request.state)}
                size={14}
                color={changeRequestColor(request.state, theme)}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.requestTitle,
                  { color: theme.colors.foreground },
                ]}
              >
                {requestLabel}
              </Text>
            </View>
          </ExternalLink>
          <View style={styles.requestStatuses}>
            {request.checksStatus && request.checksStatus !== "none" && (
              <HintButton
                hint={t.checks[request.checksStatus]}
                accessibilityRole="button"
                accessibilityLabel={t.checks[request.checksStatus]}
                style={styles.requestStatusAction}
              >
                <Icon
                  name={checksIcon(request.checksStatus)}
                  size={14}
                  color={checksColor(request.checksStatus, theme)}
                />
              </HintButton>
            )}
            {request.reviewDecision && (
              <HintButton
                hint={t.reviews[request.reviewDecision]}
                accessibilityRole="button"
                accessibilityLabel={t.reviews[request.reviewDecision]}
                style={styles.requestStatusAction}
              >
                <Icon
                  name={reviewIcon(request.reviewDecision)}
                  size={14}
                  color={reviewColor(request.reviewDecision, theme)}
                />
              </HintButton>
            )}
          </View>
        </View>
      )}
    </>
  );
  const requestUnavailable = card.changeRequestUnavailable && (
    <Text style={[styles.cardMeta, { color: theme.colors.statusWarning }]}>
      {t.changeRequestUnavailable}
    </Text>
  );
  const actionButtons = (
    <View style={presentation === "row" ? styles.rowMenu : styles.cardActions}>
      {(isDraft || card.binding) && (
        <CardAction
          theme={theme}
          hint={card.binding ? t.resumeBinding : t.startHint}
          accessibilityRole="button"
          accessibilityLabel={card.binding ? t.retry : t.start}
          disabled={disabled}
          onPress={() => {
            setActionsOpen(false);
            onStart();
          }}
          style={({ pressed }) => [
            styles.startAction,
            presentation === "row" && styles.rowMenuAction,
            { opacity: disabled ? 0.5 : 1 },
            pressed && { backgroundColor: theme.colors.surface2 },
          ]}
        >
          <Icon
            name="Play"
            size={15}
            color={
              disabled ? theme.colors.foregroundMuted : theme.colors.foreground
            }
          />
          <Text
            style={[
              styles.cardMeta,
              {
                color: disabled
                  ? theme.colors.foregroundMuted
                  : theme.colors.foreground,
              },
            ]}
          >
            {card.binding ? t.retry : t.start}
          </Text>
        </CardAction>
      )}
      {card.mergedDrafts.map((source) => (
        <CardAction
          theme={theme}
          hint={`${t.detachDraft}: ${source.title}`}
          key={source.draftId}
          accessibilityRole="button"
          accessibilityLabel={`${t.detachDraft}: ${source.title}`}
          disabled={disabled}
          onPress={() => {
            setActionsOpen(false);
            onDetachDraft(source.draftId);
          }}
          style={[
            styles.startAction,
            presentation === "row" && styles.rowMenuAction,
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.cardMeta,
              { color: theme.colors.foreground, flexShrink: 1 },
            ]}
          >
            {t.detachDraft}: {source.title}
          </Text>
        </CardAction>
      ))}
      {card.binding && (
        <CardAction
          theme={theme}
          hint={t.cancelBinding}
          accessibilityRole="button"
          accessibilityLabel={t.cancelBinding}
          disabled={disabled}
          onPress={() => {
            setActionsOpen(false);
            onCancelBinding();
          }}
          style={({ pressed }) => [
            styles.iconAction,
            presentation === "row" && styles.rowMenuAction,
            { opacity: disabled ? 0.5 : 1 },
            pressed && { backgroundColor: theme.colors.surface2 },
          ]}
        >
          <Icon name="X" size={15} color={theme.colors.foregroundMuted} />
          {presentation === "row" && (
            <Text style={[styles.cardMeta, { color: theme.colors.foreground }]}>
              {t.cancelBinding}
            </Text>
          )}
        </CardAction>
      )}
      {!isDraft && (
        <CardAction
          theme={theme}
          hint={t.notes}
          accessibilityRole="button"
          accessibilityLabel={t.notes}
          disabled={disabled}
          onPress={() => {
            setActionsOpen(false);
            onEdit();
          }}
          style={({ pressed }) => [
            styles.iconAction,
            presentation === "row" && styles.rowMenuAction,
            { opacity: disabled ? 0.5 : 1 },
            pressed && { backgroundColor: theme.colors.surface2 },
          ]}
        >
          <Icon
            name="FileText"
            size={15}
            color={theme.colors.foregroundMuted}
          />
          {presentation === "row" && (
            <Text style={[styles.cardMeta, { color: theme.colors.foreground }]}>
              {t.notes}
            </Text>
          )}
        </CardAction>
      )}
      <CardAction
        theme={theme}
        hint={t.status}
        accessibilityRole="button"
        accessibilityLabel={t.status}
        disabled={
          disabled || pending || card.binding !== null || card.archived !== null
        }
        onPress={() => {
          setActionsOpen(false);
          onStatus();
        }}
        style={({ pressed }) => [
          styles.iconAction,
          presentation === "row" && styles.rowMenuAction,
          {
            opacity:
              disabled || pending || card.binding || card.archived ? 0.5 : 1,
          },
          pressed && { backgroundColor: theme.colors.surface2 },
        ]}
      >
        <Icon
          name="ArrowRightLeft"
          size={15}
          color={theme.colors.foregroundMuted}
        />
        {presentation === "row" && (
          <Text style={[styles.cardMeta, { color: theme.colors.foreground }]}>
            {t.status}
          </Text>
        )}
      </CardAction>
      {isDraft &&
        groupKind(card.stage, board.settings.groups) === "canceled" && (
          <CardAction
            theme={theme}
            hint={t.archiveDraft}
            accessibilityRole="button"
            accessibilityLabel={t.archiveDraft}
            disabled={disabled}
            onPress={() => {
              setActionsOpen(false);
              onArchive();
            }}
            style={({ pressed }) => [
              styles.iconAction,
              presentation === "row" && styles.rowMenuAction,
              { opacity: disabled ? 0.5 : 1 },
              pressed && { backgroundColor: theme.colors.surface2 },
            ]}
          >
            <Icon
              name="Archive"
              size={15}
              color={theme.colors.foregroundMuted}
            />
            {presentation === "row" && (
              <Text
                style={[styles.cardMeta, { color: theme.colors.foreground }]}
              >
                {t.archiveDraft}
              </Text>
            )}
          </CardAction>
        )}
    </View>
  );
  const details = (
    <>
      {agentsOpen && card.description && (
        <Text style={[styles.cardMeta, { color: theme.colors.foreground }]}>
          {card.description}
        </Text>
      )}
      {agentsOpen && reasons.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text
            style={[styles.cardMeta, { color: theme.colors.statusWarning }]}
          >
            {t.attentionReason}: {reasons.join(" · ")}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={card.stage === "conflict" ? onStatus : onOpen}
            disabled={card.stage === "conflict" && disabled}
            style={styles.reasonAction}
          >
            <Text
              style={[
                styles.cardMeta,
                {
                  color: theme.colors.foreground,
                  textDecorationLine: "underline",
                },
              ]}
            >
              {card.stage === "conflict" ? t.resolveConflict : t.openWorkspace}
            </Text>
            <Icon
              name="ArrowUpRight"
              size={13}
              color={theme.colors.foregroundMuted}
            />
          </Pressable>
        </View>
      )}
      {agentsOpen && reason && (
        <Text
          style={[styles.cardMeta, { color: theme.colors.foregroundMuted }]}
        >
          {reason}
        </Text>
      )}
      {agentsOpen && card.pinState !== "none" && (
        <Text
          style={[styles.cardMeta, { color: theme.colors.foregroundMuted }]}
        >
          {pinHint}
        </Text>
      )}
      {agentsOpen && request && (
        <>
          <Text style={[styles.cardMeta, { color: theme.colors.foreground }]}>
            {request.title}
          </Text>
          <Text
            style={[styles.cardMeta, { color: theme.colors.foregroundMuted }]}
          >
            {t.changeRequestStates[request.state]}
            {request.checksStatus && request.checksStatus !== "none"
              ? ` · ${t.checks[request.checksStatus]}`
              : ""}
            {request.reviewDecision
              ? ` · ${t.reviews[request.reviewDecision]}`
              : ""}
          </Text>
        </>
      )}
      {agentsOpen && normalLabels.length > 0 && (
        <Text
          style={[styles.cardMeta, { color: theme.colors.foregroundMuted }]}
        >
          {normalLabels.join(" · ")}
        </Text>
      )}
      {agentsOpen &&
        card.agents.map((agent) => (
          <Text
            key={agent.id}
            style={{ color: activityColor(agent.activity, theme) }}
          >
            • {agent.title} · {t.activity[agent.activity]}
          </Text>
        ))}
    </>
  );
  if (presentation === "row") {
    const overdue =
      terminal && card.dueAt && new Date(card.dueAt).getTime() < Date.now();
    const projectSummary = (
      <Text
        numberOfLines={1}
        style={[
          styles.cardMeta,
          styles.rowProject,
          { color: theme.colors.foregroundMuted },
        ]}
      >
        {host ? `${host} · ` : ""}
        {card.projectName || t.unassigned}
      </Text>
    );
    const activitySummary = (
      <View style={[styles.rowActivity, compact && styles.rowActivityCompact]}>
        <Icon
          name="MessageCircle"
          size={13}
          color={activityColor(card.activity, theme)}
        />
        <Text
          numberOfLines={1}
          style={[
            styles.cardMeta,
            { color: activityColor(card.activity, theme) },
          ]}
        >
          {isDraft ? t.noWorkspace : t.activity[card.activity]}
        </Text>
        {!isDraft && (
          <Text
            numberOfLines={1}
            style={[
              styles.cardMeta,
              compact && styles.rowTimeCompact,
              { color: theme.colors.foregroundMuted },
            ]}
          >
            {time}
          </Text>
        )}
      </View>
    );
    return (
      <View
        style={[
          styles.row,
          {
            borderColor: theme.colors.border,
          },
          compact && styles.rowCompact,
        ]}
      >
        <View style={[styles.rowMain]}>
          <View style={styles.rowTitleBlock}>
            <HintButton
              hint={isDraft ? t.edit : t.openWorkspace}
              accessibilityRole="button"
              accessibilityLabel={`${isDraft ? t.edit : t.openWorkspace}: ${card.title}`}
              onPress={isDraft ? onEdit : onOpen}
              style={styles.cardTitlePressable}
            >
              <Text
                numberOfLines={compact ? 2 : 1}
                style={[styles.cardTitle, { color: theme.colors.foreground }]}
              >
                {card.title}
              </Text>
            </HintButton>
          </View>
          {!compact && (
            <>
              {projectSummary}
              {activitySummary}
              <View style={styles.rowRequest}>
                {requestSummary}
                {requestUnavailable}
              </View>
            </>
          )}
          <View style={styles.rowControls}>
            {pending && (
              <View
                accessible
                accessibilityLabel={t.syncing}
                testID={`workboard-task-${card.id}-syncing`}
              >
                <Icon
                  name="LoaderCircle"
                  size={13}
                  color={theme.colors.foregroundMuted}
                />
              </View>
            )}
            {!isDraft && (
              <CardAction
                theme={theme}
                hint={agentsOpen ? t.hideDetails : t.details}
                accessibilityRole="button"
                accessibilityLabel={agentsOpen ? t.hideDetails : t.details}
                accessibilityState={{ expanded: agentsOpen }}
                aria-expanded={agentsOpen}
                onPress={() => setAgentsOpen((value) => !value)}
                style={styles.iconAction}
              >
                <Icon
                  name={agentsOpen ? "ChevronUp" : "ChevronDown"}
                  size={14}
                  color={theme.colors.foregroundMuted}
                />
              </CardAction>
            )}
            <CardAction
              theme={theme}
              hint={t.moreActions}
              accessibilityRole="button"
              accessibilityLabel={t.moreActions}
              accessibilityState={{ expanded: actionsOpen }}
              aria-expanded={actionsOpen}
              onPress={() => setActionsOpen(true)}
              style={styles.iconAction}
            >
              <Icon
                name="Ellipsis"
                size={16}
                color={theme.colors.foregroundMuted}
              />
            </CardAction>
          </View>
        </View>
        {compact && (
          <View style={styles.rowCompactMeta}>
            {projectSummary}
            {activitySummary}
          </View>
        )}
        {compact && requestUnavailable}
        {agentsOpen && compact && requestSummary}
        {(issue || overdue || card.binding || reasons.length > 0) && (
          <Text
            numberOfLines={compact ? 2 : 1}
            style={[styles.cardMeta, { color: theme.colors.statusWarning }]}
          >
            {[
              issue,
              overdue ? t.overdue : null,
              card.binding ? t.resumeBinding : null,
              ...reasons,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        )}
        {onUndo && (
          <HintButton
            hint={t.undoMoveHint}
            accessibilityRole="button"
            accessibilityLabel={t.undoMove}
            testID={`workboard-undo-${card.id}`}
            disabled={disabled || pending}
            onPress={() => void onUndo()}
            style={styles.startAction}
          >
            <Icon name="Undo2" size={14} color={theme.colors.accent} />
            <Text style={{ color: theme.colors.accent }}>{t.undoMove}</Text>
          </HintButton>
        )}
        {terminal && card.dueAt && !overdue && (
          <Text
            style={[styles.cardMeta, { color: theme.colors.foregroundMuted }]}
          >
            {t.expires.replace("{date}", shortDate(card.dueAt, t.locale))}
          </Text>
        )}
        {details}
        <Modal
          open={actionsOpen}
          title={t.moreActions}
          onOpenChange={setActionsOpen}
        >
          <Modal.Content>{actionButtons}</Modal.Content>
        </Modal>
      </View>
    );
  }
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface0,
          borderColor: theme.colors.border,
          ...(onUndo && compact
            ? {
                outlineColor: theme.colors.accent,
                outlineWidth: 2,
                outlineStyle: "solid" as const,
              }
            : {}),
          borderLeftColor: group
            ? groupColor(group, theme)
            : theme.colors.statusWarning,
        },
      ]}
    >
      {onUndo && (
        <HintButton
          hint={t.undoMoveHint}
          accessibilityRole="button"
          accessibilityLabel={t.undoMove}
          testID={`workboard-undo-${card.id}`}
          disabled={disabled || pending}
          onPress={() => void onUndo()}
          style={styles.iconAction}
        >
          <Icon name="Undo2" size={14} color={theme.colors.accent} />
          <Text style={{ color: theme.colors.accent }}>{t.undoMove}</Text>
        </HintButton>
      )}
      <View
        style={[styles.cardTitleRow, { paddingRight: showDragHandle ? 30 : 0 }]}
      >
        <HintButton
          hint={isDraft ? t.edit : t.openWorkspace}
          onHoverIn={() => setTitleHovered(true)}
          onHoverOut={() => setTitleHovered(false)}
          accessibilityRole="button"
          accessibilityLabel={`${isDraft ? t.edit : t.openWorkspace}: ${card.title}`}
          onPress={isDraft ? onEdit : onOpen}
          style={styles.cardTitlePressable}
        >
          <Text
            numberOfLines={2}
            style={[
              styles.cardTitle,
              { color: theme.colors.foreground },
              titleHovered && { textDecorationLine: "underline" },
            ]}
          >
            {card.title}
          </Text>
        </HintButton>
        {card.pinState !== "none" && (
          <HintButton
            hint={pinHint}
            accessibilityRole="button"
            accessibilityLabel={pinHint}
            style={styles.pinAction}
          >
            <Icon name="Pin" size={13} color={theme.colors.foregroundMuted} />
          </HintButton>
        )}
        {pending && (
          <View
            accessible
            accessibilityLabel={t.syncing}
            testID={`workboard-task-${card.id}-syncing`}
          >
            <Icon
              name="LoaderCircle"
              size={13}
              color={theme.colors.foregroundMuted}
            />
          </View>
        )}
      </View>
      <Text
        numberOfLines={1}
        style={[styles.cardMeta, { color: theme.colors.foregroundMuted }]}
      >
        {host ? `${host} · ` : ""}
        {card.projectName || t.unassigned}
        {normalLabels.length ? ` · ${normalLabels.join(" · ")}` : ""}
      </Text>
      {requestSummary}
      {requestUnavailable}
      <View style={styles.cardBottom}>
        {isDraft ? (
          <Text
            style={[styles.cardMeta, { color: theme.colors.foregroundMuted }]}
          >
            {t.noWorkspace}
          </Text>
        ) : (
          <HintButton
            hint={
              reasons.length
                ? reasons.join(" · ")
                : `${t.activity[card.activity]} · ${time}`
            }
            accessibilityRole="button"
            accessibilityLabel={
              reasons.length
                ? `${t.attentionReason}: ${reasons.join(" · ")}`
                : `${t.activity[card.activity]} · ${time}`
            }
            style={styles.cardFooter}
          >
            <Icon
              name="MessageCircle"
              size={13}
              color={activityColor(card.activity, theme)}
            />
            <Text
              style={[
                styles.cardMeta,
                { color: activityColor(card.activity, theme) },
              ]}
            >
              {t.activity[card.activity]}
            </Text>
            <Text
              style={[styles.cardMeta, { color: theme.colors.foregroundMuted }]}
            >
              {time}
            </Text>
          </HintButton>
        )}
        <View style={styles.cardActions}>
          {!isDraft && (
            <CardAction
              theme={theme}
              hint={agentsOpen ? t.hideDetails : t.details}
              accessibilityRole="button"
              accessibilityLabel={agentsOpen ? t.hideDetails : t.details}
              accessibilityState={{ expanded: agentsOpen }}
              aria-expanded={agentsOpen}
              onPress={() => setAgentsOpen((value) => !value)}
              style={({ pressed }) => [
                styles.iconAction,
                pressed && { backgroundColor: theme.colors.surface2 },
              ]}
            >
              <Icon
                name={agentsOpen ? "ChevronUp" : "ChevronDown"}
                size={14}
                color={theme.colors.foregroundMuted}
              />
            </CardAction>
          )}
          {actionButtons}
        </View>
      </View>
      {terminal && card.dueAt && (
        <Text
          style={[
            styles.cardMeta,
            {
              color:
                new Date(card.dueAt).getTime() < Date.now()
                  ? theme.colors.statusWarning
                  : theme.colors.foregroundMuted,
            },
          ]}
        >
          {new Date(card.dueAt).getTime() < Date.now()
            ? t.overdue
            : t.expires.replace("{date}", shortDate(card.dueAt, t.locale))}
        </Text>
      )}
      {issue && (
        <Text style={[styles.cardMeta, { color: theme.colors.statusWarning }]}>
          {issue}
        </Text>
      )}
      {details}
    </View>
  );
}
export const TaskCard = TaskItem;

function issueText(
  issue: string | null,
  t: ReturnType<typeof strings>,
): string | null {
  return issue ? ((t.issues as Record<string, string>)[issue] ?? issue) : null;
}
function activityColor(
  activity: Card["activity"],
  theme: PluginSurfaceProps["theme"],
) {
  return activity === "error"
    ? theme.colors.statusDanger
    : activity === "attention" || activity === "waiting"
      ? theme.colors.statusWarning
      : activity === "running"
        ? theme.colors.foreground
        : theme.colors.foregroundMuted;
}
function changeRequestIcon(
  state: NonNullable<Card["changeRequest"]>["state"],
): string {
  return state === "merged"
    ? "GitMerge"
    : state === "closed"
      ? "GitPullRequestClosed"
      : state === "draft"
        ? "GitPullRequestDraft"
        : "GitPullRequest";
}
function changeRequestColor(
  state: NonNullable<Card["changeRequest"]>["state"],
  theme: PluginSurfaceProps["theme"],
) {
  return state === "merged"
    ? supplementalColor(theme, "#7347af", "#a890d5")
    : state === "closed"
      ? theme.colors.statusDanger
      : state === "open"
        ? theme.colors.statusSuccess
        : theme.colors.foregroundMuted;
}
function checksIcon(
  status: Exclude<NonNullable<Card["changeRequest"]>["checksStatus"], "none">,
) {
  return status === "success"
    ? "CircleCheck"
    : status === "failure"
      ? "CircleX"
      : "CircleDot";
}
function checksColor(
  status: Exclude<NonNullable<Card["changeRequest"]>["checksStatus"], "none">,
  theme: PluginSurfaceProps["theme"],
) {
  return status === "success"
    ? theme.colors.statusSuccess
    : status === "failure"
      ? theme.colors.statusDanger
      : theme.colors.statusWarning;
}
function reviewIcon(
  status: NonNullable<Card["changeRequest"]>["reviewDecision"],
) {
  return status === "approved"
    ? "CircleCheck"
    : status === "changes_requested"
      ? "CircleX"
      : "MessageSquare";
}
function reviewColor(
  status: NonNullable<Card["changeRequest"]>["reviewDecision"],
  theme: PluginSurfaceProps["theme"],
) {
  return status === "approved"
    ? theme.colors.statusSuccess
    : status === "changes_requested"
      ? theme.colors.statusDanger
      : theme.colors.foregroundMuted;
}
const styles = StyleSheet.create({
  row: {
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 3,
  },
  rowCompact: { minHeight: 68 },
  rowMain: { flexDirection: "row", alignItems: "center", gap: 12, minWidth: 0 },
  rowCompactMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowProject: { flex: 1, minWidth: 0 },
  rowTitleBlock: { flex: 2, minWidth: 0 },
  rowActivity: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minWidth: 0,
    flexWrap: "wrap",
  },
  rowRequest: { flex: 1, minWidth: 80 },
  rowActivityCompact: { flexWrap: "nowrap" },
  rowTimeCompact: { flexShrink: 1, minWidth: 0 },
  rowControls: { flexDirection: "row", alignItems: "center" },
  rowMenu: { gap: 4 },
  rowMenuAction: {
    width: "100%",
    minHeight: 40,
    flexDirection: "row",
    justifyContent: "flex-start",
    paddingHorizontal: 12,
    gap: 8,
  },
  card: {
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 8,
    gap: 4,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  cardTitlePressable: { flex: 1, minWidth: 0 },
  cardTitle: { fontWeight: "600", fontSize: 14, lineHeight: 18 },
  cardMeta: { fontSize: 12, lineHeight: 16 },
  changeRequest: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  requestLink: { flexDirection: "row", alignItems: "center", gap: 5 },
  requestTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
  },
  requestStatuses: {
    flexDirection: "row",
    columnGap: 6,
  },
  requestStatusAction: {
    width: 36,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  pinAction: {
    minWidth: 36,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -5,
  },
  reasonAction: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
  },
  cardBottom: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 2,
  },
  cardFooter: {
    flexDirection: "row",
    flexWrap: "wrap",
    flexShrink: 1,
    alignItems: "center",
    gap: 5,
  },
  cardActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    flexShrink: 1,
    maxWidth: "100%",
    alignItems: "center",
    gap: 2,
  },
  startAction: {
    maxWidth: "100%",
    minHeight: 36,
    borderRadius: 6,
    paddingHorizontal: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  iconAction: {
    minWidth: 36,
    minHeight: 36,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
});
