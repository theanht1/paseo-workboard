import { useState, type ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import {
  groupKind,
  isTerminalGroup,
  priorityLabels,
  type Board,
  type Card,
  type Priority,
} from "../shared/model";
import {
  attentionReasons,
  boardNow,
  childrenSkippedForIdle,
  hasNoAgents,
  shortDate,
} from "./board-utils";
import { strings, stageTitle } from "./strings";
import { groupColor, supplementalColor } from "./colors";
import { HintButton } from "./Hint";
import { PriorityPicker } from "./PriorityPicker";
import { design, typography } from "./design";

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
  onPriorityChange,
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
  onPriorityChange?(priority: Priority): Promise<boolean>;
  compact?: boolean;
  showDragHandle?: boolean;
  presentation?: "card" | "row";
}) {
  const [agentsOpen, setAgentsOpen] = useState(false);
  const priorityPicker = (
    <PriorityPicker
      title={card.title}
      value={card.priority}
      priorityStyles={board.settings.priorityStyles}
      onChange={onPriorityChange}
      disabled={
        disabled || pending || card.archived !== null || card.binding !== null
      }
      theme={theme}
      t={t}
    />
  );
  const [actionsOpen, setActionsOpen] = useState(false);
  const [titleHovered, setTitleHovered] = useState(false);
  const toast = useToast();
  const request = card.changeRequest;
  const checkStatus =
    request?.checksStatus && request.checksStatus !== "none"
      ? request.checksStatus
      : null;
  const checkCounts = request?.checkCounts;
  const countedStatuses = checkCounts
    ? (
        ["success", "failure", "pending", "skipped", "cancelled"] as const
      ).filter((status) => checkCounts[status] > 0)
    : [];
  const checkCountParts = countedStatuses.map((status) =>
    t.checkCounts[status].replace("{count}", String(checkCounts![status])),
  );
  const checksText = checkCountParts.length
    ? `CI ${checkCountParts.join(" ")}`
    : checkStatus
      ? t.checks[checkStatus]
      : null;
  const requestLabel = request
    ? `${request.forge === "gitlab" ? "MR" : "PR"}${request.number === null ? "" : ` ${request.forge === "gitlab" ? "!" : "#"}${request.number}`}`
    : "";
  const isDraft = card.workspaceId === null;
  const displayedDate = card.lastConversationAt
    ? shortDate(card.lastConversationAt, t.locale)
    : null;
  const noAgents =
    hasNoAgents(card) && card.conversationDisplayEvidence === "unknown";
  const time = noAgents
    ? t.noAgents
    : card.conversationDisplayEvidence === "none"
      ? t.noConversation
      : card.conversationDisplayEvidence === "unknown" || displayedDate === null
        ? t.unknownConversation
        : card.conversationDisplayEvidence === "lower-bound"
          ? t.conversationAtLeast.replace("{date}", displayedDate)
          : card.conversationDisplayEvidence === "upper-bound"
            ? t.conversationAtMost.replace("{date}", displayedDate)
            : displayedDate;
  const reason = card.conversationReason
    ? childrenSkippedForIdle(card)
      ? t.childrenNotListedIdle
      : t.conversationReasons[card.conversationReason]
    : null;
  const terminal = isTerminalGroup(card.stage, board.settings.groups);
  const issue = [
    card.autoArchivePaused ? t.archivePaused : null,
    card.issue === "no-conversation" || card.issue === "conversation-unknown"
      ? null
      : issueText(card.issue, t),
    priorityLabels(card.labels, card.managedLabels).length > 1
      ? t.issues["priority-labels-conflict"]
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const normalLabels = card.labels.filter(
    (label) =>
      !card.managedLabels.includes(label) &&
      priorityLabels([label]).length === 0,
  );
  const group = board.settings.groups.find((item) => item.id === card.stage);
  const reasons = attentionReasons(card)
    .filter(
      (reason) =>
        (reason !== "checks-failure" || !checksText) &&
        (reason !== "changes-requested" || !request?.reviewDecision),
    )
    .map((reason) => {
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
          <View style={styles.requestStatuses}>
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
            {request.reviewDecision && (
              <HintButton
                hint={t.reviews[request.reviewDecision]}
                accessibilityRole="button"
                accessibilityLabel={t.reviews[request.reviewDecision]}
                style={styles.requestStatusAction}
              >
                <View style={styles.requestStatusIcon}>
                  <Icon
                    name={reviewIcon(request.reviewDecision)}
                    size={14}
                    color={reviewColor(request.reviewDecision, theme)}
                  />
                </View>
                <Text
                  style={[
                    styles.requestStatusText,
                    { color: reviewColor(request.reviewDecision, theme) },
                  ]}
                >
                  {t.reviews[request.reviewDecision]}
                </Text>
              </HintButton>
            )}
          </View>
          <View style={styles.requestStatuses}>
            {checksText && (
              <HintButton
                hint={checksText}
                accessibilityRole="button"
                accessibilityLabel={checksText}
                style={[styles.requestStatusAction, styles.checkCounts]}
              >
                {countedStatuses.length
                  ? countedStatuses.map((status) => (
                      <View key={status} style={styles.checkCount}>
                        <Icon
                          name={checksIcon(status)}
                          size={14}
                          color={checksColor(status, theme)}
                        />
                        <Text
                          style={[
                            styles.requestStatusText,
                            { color: checksColor(status, theme) },
                          ]}
                        >
                          {checkCounts![status]}
                        </Text>
                      </View>
                    ))
                  : checkStatus && (
                      <Icon
                        name={checksIcon(checkStatus)}
                        size={14}
                        color={checksColor(checkStatus, theme)}
                      />
                    )}
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
    <View style={styles.rowMenu}>
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
          style={[styles.startAction, styles.rowMenuAction]}
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
            styles.rowMenuAction,
            { opacity: disabled ? 0.5 : 1 },
            pressed && { backgroundColor: theme.colors.surface2 },
          ]}
        >
          <Icon name="X" size={15} color={theme.colors.foregroundMuted} />
          <Text style={[styles.cardMeta, { color: theme.colors.foreground }]}>
            {t.cancelBinding}
          </Text>
        </CardAction>
      )}
      <CardAction
        theme={theme}
        hint={isDraft ? t.edit : t.notes}
        accessibilityRole="button"
        accessibilityLabel={isDraft ? t.edit : t.notes}
        disabled={disabled}
        onPress={() => {
          setActionsOpen(false);
          onEdit();
        }}
        style={({ pressed }) => [
          styles.iconAction,
          styles.rowMenuAction,
          { opacity: disabled ? 0.5 : 1 },
          pressed && { backgroundColor: theme.colors.surface2 },
        ]}
      >
        <Icon name="FileText" size={15} color={theme.colors.foregroundMuted} />
        <Text style={[styles.cardMeta, { color: theme.colors.foreground }]}>
          {isDraft ? t.edit : t.notes}
        </Text>
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
              styles.rowMenuAction,
              { opacity: disabled ? 0.5 : 1 },
              pressed && { backgroundColor: theme.colors.surface2 },
            ]}
          >
            <Icon
              name="Archive"
              size={15}
              color={theme.colors.foregroundMuted}
            />
            <Text style={[styles.cardMeta, { color: theme.colors.foreground }]}>
              {t.archiveDraft}
            </Text>
          </CardAction>
        )}
    </View>
  );
  const primaryActions = (
    <View style={styles.primaryActions}>
      <CardAction
        theme={theme}
        hint={t.status}
        testID={`workboard-status-${card.id}`}
        accessibilityRole="button"
        accessibilityLabel={`${t.status}: ${stageTitle(card.stage, board.settings.groups, t)} · ${card.title}`}
        disabled={
          disabled || pending || card.binding !== null || card.archived !== null
        }
        onPress={onStatus}
        style={[
          styles.statusAction,
          {
            borderColor: group
              ? `${groupColor(group, theme)}40`
              : theme.colors.border,
            backgroundColor: group
              ? `${groupColor(group, theme)}0c`
              : theme.colors.surface1,
            opacity:
              disabled || pending || card.binding || card.archived
                ? design.disabledOpacity
                : 1,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            typography.meta,
            {
              flexShrink: 1,
              color: group ? groupColor(group, theme) : theme.colors.foreground,
            },
          ]}
        >
          {stageTitle(card.stage, board.settings.groups, t)}
        </Text>
        <Icon
          name="ChevronDown"
          size={13}
          color={
            group ? groupColor(group, theme) : theme.colors.foregroundMuted
          }
        />
      </CardAction>
      <View style={styles.primaryActionEnd}>
        <CardAction
          theme={theme}
          hint={
            isDraft || card.binding
              ? card.binding
                ? t.resumeBinding
                : t.startHint
              : t.openWorkspace
          }
          accessibilityRole="button"
          accessibilityLabel={
            isDraft || card.binding
              ? card.binding
                ? t.retry
                : t.start
              : `${t.openWorkspace}: ${card.title}`
          }
          disabled={(isDraft || card.binding) && disabled}
          onPress={isDraft || card.binding ? onStart : onOpen}
          style={[
            styles.startAction,
            {
              borderColor: theme.colors.border,
              opacity:
                (isDraft || card.binding) && disabled
                  ? design.disabledOpacity
                  : 1,
            },
          ]}
        >
          <Icon
            name={isDraft || card.binding ? "Play" : "FolderOpen"}
            size={15}
            color={theme.colors.foreground}
          />
          <Text style={[typography.meta, { color: theme.colors.foreground }]}>
            {isDraft || card.binding
              ? card.binding
                ? t.retry
                : t.start
              : t.openTask}
          </Text>
        </CardAction>
        <CardAction
          theme={theme}
          hint={t.moreActions}
          accessibilityRole="button"
          accessibilityLabel={t.moreActions}
          accessibilityState={{ expanded: actionsOpen }}
          aria-expanded={actionsOpen}
          onPress={() => setActionsOpen(true)}
          style={[
            styles.iconAction,
            {
              borderColor: theme.colors.border,
              borderWidth: design.borderWidth,
            },
          ]}
        >
          <Icon
            name="Ellipsis"
            size={16}
            color={theme.colors.foregroundMuted}
          />
        </CardAction>
      </View>
    </View>
  );
  const details = (
    <>
      {agentsOpen && (
        <Text style={[typography.title, { color: theme.colors.foreground }]}>
          {card.title}
        </Text>
      )}
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
      terminal &&
      card.dueAt &&
      new Date(card.dueAt).getTime() < boardNow(board);
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
          {isDraft
            ? t.noWorkspace
            : noAgents
              ? t.noAgents
              : t.activity[card.activity]}
        </Text>
        {!isDraft && !noAgents && (
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
          <View style={styles.rowPriority}>{priorityPicker}</View>
          <View style={styles.rowTitleBlock}>
            <HintButton
              hint={isDraft ? t.edit : t.openWorkspace}
              accessibilityRole="button"
              accessibilityLabel={`${isDraft ? t.edit : t.openWorkspace}: ${card.title}`}
              onPress={isDraft ? onEdit : onOpen}
              style={styles.cardTitlePressable}
            >
              <Text
                numberOfLines={2}
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
              {(request || card.changeRequestUnavailable) && (
                <View style={styles.rowRequest}>
                  {requestSummary}
                  {requestUnavailable}
                </View>
              )}
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
            {!compact && primaryActions}
          </View>
        </View>
        {compact && (
          <View style={styles.rowCompactMeta}>
            {projectSummary}
            {activitySummary}
          </View>
        )}
        {compact && primaryActions}
        {compact && requestUnavailable}
        {compact && requestSummary}
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
          <Modal.Content>
            <Text
              numberOfLines={3}
              style={[
                typography.title,
                { color: theme.colors.foreground, marginBottom: 8 },
              ]}
            >
              {card.title}
            </Text>
            {actionButtons}
          </Modal.Content>
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
        style={[styles.cardTitleRow, { paddingRight: showDragHandle ? 36 : 0 }]}
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
            numberOfLines={4}
            style={[
              styles.cardTitle,
              { color: theme.colors.foreground },
              titleHovered && { textDecorationLine: "underline" },
            ]}
          >
            {card.title}
          </Text>
        </HintButton>
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
      <View style={styles.cardPriorityRow}>
        {priorityPicker}
        <Text
          numberOfLines={1}
          style={[
            styles.cardMeta,
            { color: theme.colors.foregroundMuted, flex: 1 },
          ]}
        >
          {host ? `${host} · ` : ""}
          {card.projectName || t.unassigned}
        </Text>
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
      </View>
      {normalLabels.length > 0 && (
        <Text
          numberOfLines={1}
          style={[styles.cardMeta, { color: theme.colors.foregroundMuted }]}
        >
          {normalLabels.join(" · ")}
        </Text>
      )}
      {isDraft && card.description && (
        <Text
          numberOfLines={3}
          style={[styles.cardMeta, { color: theme.colors.foregroundMuted }]}
        >
          {card.description}
        </Text>
      )}
      {requestSummary}
      {requestUnavailable}
      {isDraft ? (
        <Text
          style={[styles.cardMeta, { color: theme.colors.foregroundMuted }]}
        >
          {t.noWorkspace}
        </Text>
      ) : (
        <CardAction
          theme={theme}
          hint={agentsOpen ? t.hideDetails : t.details}
          accessibilityRole="button"
          accessibilityLabel={agentsOpen ? t.hideDetails : t.details}
          accessibilityState={{ expanded: agentsOpen }}
          aria-expanded={agentsOpen}
          onPress={() => setAgentsOpen((value) => !value)}
          style={styles.activityBlock}
        >
          <View style={styles.activityLine}>
            <Icon
              name={card.activity === "running" ? "CircleDot" : "MessageCircle"}
              size={15}
              color={activityColor(card.activity, theme)}
            />
            <Text
              style={[
                styles.cardMeta,
                { color: activityColor(card.activity, theme), flex: 1 },
              ]}
            >
              {noAgents ? t.noAgents : `Agent: ${t.activity[card.activity]}`}
            </Text>
            <Icon
              name={agentsOpen ? "ChevronUp" : "ChevronDown"}
              size={14}
              color={theme.colors.foregroundMuted}
            />
          </View>
          {!noAgents && (
            <View style={styles.activityLine}>
              <Icon
                name="Clock"
                size={15}
                color={theme.colors.foregroundMuted}
              />
              <Text
                style={[
                  styles.cardMeta,
                  { color: theme.colors.foregroundMuted, flex: 1 },
                ]}
              >
                {time}
              </Text>
            </View>
          )}
        </CardAction>
      )}
      {primaryActions}
      <Modal
        open={actionsOpen}
        title={t.moreActions}
        onOpenChange={setActionsOpen}
      >
        <Modal.Content>
          <Text
            numberOfLines={3}
            style={[
              typography.title,
              { color: theme.colors.foreground, marginBottom: 8 },
            ]}
          >
            {card.title}
          </Text>
          {actionButtons}
        </Modal.Content>
      </Modal>
      {terminal && card.dueAt && (
        <Text
          style={[
            styles.cardMeta,
            {
              color:
                new Date(card.dueAt).getTime() < boardNow(board)
                  ? theme.colors.statusWarning
                  : theme.colors.foregroundMuted,
            },
          ]}
        >
          {new Date(card.dueAt).getTime() < boardNow(board)
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
        ? theme.colors.statusSuccess
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
  status:
    | Exclude<NonNullable<Card["changeRequest"]>["checksStatus"], "none">
    | "skipped"
    | "cancelled",
) {
  return status === "success"
    ? "CircleCheck"
    : status === "failure"
      ? "CircleX"
      : status === "skipped"
        ? "CircleMinus"
        : status === "cancelled"
          ? "Ban"
          : "CircleDot";
}
function checksColor(
  status:
    | Exclude<NonNullable<Card["changeRequest"]>["checksStatus"], "none">
    | "skipped"
    | "cancelled",
  theme: PluginSurfaceProps["theme"],
) {
  return status === "success"
    ? theme.colors.statusSuccess
    : status === "failure"
      ? theme.colors.statusDanger
      : status === "pending"
        ? theme.colors.statusWarning
        : theme.colors.foregroundMuted;
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
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  rowCompact: { minHeight: 68 },
  rowMain: { flexDirection: "row", alignItems: "center", gap: 12, minWidth: 0 },
  rowCompactMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    gap: 8,
  },
  rowProject: { flex: 1, minWidth: 70 },
  rowTitleBlock: { flex: 2, minWidth: 0 },
  rowActivity: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minWidth: 170,
    flexWrap: "wrap",
  },
  rowRequest: { flex: 1, minWidth: 240 },
  rowPriority: { alignSelf: "center" },
  rowActivityCompact: { flexWrap: "wrap", flexGrow: 2, minWidth: 180 },
  rowTimeCompact: { flexShrink: 0 },
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
    borderRadius: design.radius.card,
    padding: design.space.md,
    gap: design.space.sm,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  cardTitlePressable: { flex: 1, minWidth: 0 },
  cardPriorityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  cardTitle: typography.title,
  cardMeta: typography.meta,
  changeRequest: {
    alignItems: "flex-start",
    gap: 0,
  },
  requestLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 36,
  },
  requestTitle: {
    ...typography.meta,
    fontWeight: "600",
  },
  requestStatuses: {
    flexDirection: "row",
    flexWrap: "wrap",
    flexShrink: 1,
    maxWidth: "100%",
    columnGap: 6,
  },
  requestStatusAction: {
    minWidth: 36,
    minHeight: 36,
    maxWidth: "100%",
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  checkCounts: {
    flexWrap: "wrap",
    columnGap: 8,
    alignContent: "center",
    alignItems: "center",
  },
  checkCount: { flexDirection: "row", alignItems: "center", gap: 4 },
  requestStatusText: { ...typography.meta, flexShrink: 1 },
  requestStatusIcon: { width: 14, height: 14, flexShrink: 0 },
  pinAction: {
    minWidth: 36,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  reasonAction: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
  },
  primaryActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 4,
  },
  primaryActionEnd: { flexDirection: "row", alignItems: "center", gap: 4 },
  statusAction: {
    ...design.control,
    flexGrow: 1,
    flexShrink: 1,
    maxWidth: "100%",
    paddingHorizontal: 8,
    borderWidth: 1,
    borderRadius: design.radius.control,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
  },
  activityBlock: {
    minHeight: 36,
    paddingVertical: 2,
    gap: 6,
    borderRadius: design.radius.control,
  },
  activityLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  startAction: {
    borderWidth: design.borderWidth,
    maxWidth: "100%",
    minHeight: 36,
    borderRadius: 6,
    paddingHorizontal: 8,
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
