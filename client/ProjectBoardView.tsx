import { Pressable, Text, View } from "react-native";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { BoardView, type BoardViewProps } from "./BoardView";
import type { Board } from "../shared/model";
import { taskSections } from "./project-groups";
import { design, typography } from "./design";

/** Project lanes, including unassigned tasks, reuse the status columns and drag behavior. */
export function ProjectBoardView(
  props: BoardViewProps & {
    projects: Board["projects"];
    projectAliases?: ReadonlyMap<string, string>;
    onCreateInProject?(projectId: string | null): void;
    collapsed: ReadonlySet<string>;
    onCollapsedChange(ids: string[]): void;
  },
) {
  const { t, theme, collapsed } = props;
  const sections = taskSections({
    ...props,
    unassigned: t.unassigned,
  });
  return (
    <View style={{ flex: 1 }}>
      {sections.length > 0 ? (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "flex-end",
            gap: design.space.sm,
            paddingHorizontal: design.space.md,
          }}
        >
          {[false, true].map((fold) => {
            const disabled = sections.every(
              (section) => collapsed.has(section.id) === fold,
            );
            return (
              <Pressable
                key={String(fold)}
                accessibilityRole="button"
                disabled={disabled}
                onPress={() => {
                  const next = new Set(collapsed);
                  for (const section of sections) {
                    if (fold) next.add(section.id);
                    else next.delete(section.id);
                  }
                  props.onCollapsedChange([...next]);
                }}
                style={({ pressed }) => ({
                  ...design.control,
                  paddingHorizontal: design.space.sm,
                  justifyContent: "center",
                  borderRadius: design.radius.control,
                  backgroundColor: pressed
                    ? theme.colors.surface2
                    : "transparent",
                  opacity: disabled ? design.disabledOpacity : 1,
                })}
              >
                <Text
                  style={[
                    typography.meta,
                    { color: theme.colors.foregroundMuted },
                  ]}
                >
                  {fold ? t.collapseAll : t.expandAll}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 12, gap: 14 }}
      >
        {sections.length === 0 ? (
          <Text style={{ color: theme.colors.foregroundMuted }}>
            {props.hasActiveFilter ? t.emptyFiltered : t.empty}
          </Text>
        ) : null}
        {sections.map((section) => {
          const largestColumn = Math.max(
            1,
            ...props.groups.map(
              (g) => section.cards.filter((c) => c.stage === g.id).length,
            ),
          );
          return (
            <View
              key={section.id}
              testID={`workboard-project-lane-${section.id}`}
              style={{
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: 10,
                overflow: "hidden",
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${collapsed.has(section.id) ? t.expandGroup : t.collapseGroup}: ${section.title}`}
                accessibilityState={{ expanded: !collapsed.has(section.id) }}
                onPress={() => {
                  const next = new Set(collapsed);
                  if (next.has(section.id)) next.delete(section.id);
                  else next.add(section.id);
                  props.onCollapsedChange([...next]);
                }}
                style={{
                  minHeight: 40,
                  padding: 10,
                  flexDirection: "row",
                  gap: 8,
                  alignItems: "center",
                  backgroundColor: theme.colors.surface1,
                }}
              >
                <Icon
                  name={
                    collapsed.has(section.id) ? "ChevronRight" : "ChevronDown"
                  }
                  size={16}
                  color={theme.colors.foregroundMuted}
                />
                <Text
                  numberOfLines={2}
                  style={{
                    flex: 1,
                    color: theme.colors.foreground,
                    fontWeight: "600",
                  }}
                >
                  {section.title}
                </Text>
                <Text style={{ color: theme.colors.foregroundMuted }}>
                  {section.cards.length} / {section.total}
                </Text>
              </Pressable>
              {!collapsed.has(section.id) ? (
                <View
                  style={{ height: Math.min(700, 140 + largestColumn * 280) }}
                >
                  <BoardView
                    {...props}
                    layoutScope={section.id}
                    cards={section.cards}
                    renderQuickCreate={undefined}
                    onCreateTask={
                      props.onCreateInProject
                        ? () =>
                            props.onCreateInProject!(section.cards[0].projectId)
                        : undefined
                    }
                  />
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
