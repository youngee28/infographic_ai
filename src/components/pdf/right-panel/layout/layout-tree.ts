import type {
  LayoutBlock,
  LayoutBlockTree,
  LayoutChartBlock,
  LayoutChartSpec,
  LayoutGeometry,
  LayoutGroupBlock,
  LayoutHeadingBlock,
  LayoutKpiBlock,
  LayoutKpiItem,
  LayoutPlan,
  LayoutSection,
  LayoutSectionType,
  LayoutTextBlock,
} from "@/lib/session-types";

const SECTION_TYPE_LABELS: Record<Exclude<LayoutSectionType, "header">, string> = {
  "chart-group": "차트 그룹",
  "kpi-group": "KPI 그룹",
  takeaway: "결론",
  note: "노트",
};

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function cloneGeometry(layout?: LayoutGeometry): LayoutGeometry | undefined {
  return layout ? { ...layout } : undefined;
}

function getSectionLabel(sectionType: LayoutSectionType): string {
  if (sectionType === "header") {
    return "헤더";
  }

  return SECTION_TYPE_LABELS[sectionType];
}

function isFooterSection(section: LayoutSection): boolean {
  return section.type === "takeaway" || section.type === "note";
}

function getSectionFallbackWeight(section: LayoutSection, heroSectionId?: string): number {
  if (section.id === heroSectionId && section.type === "chart-group") {
    return 2.8;
  }

  if (section.type === "chart-group") {
    return 1.2;
  }

  if (section.type === "kpi-group") {
    return 0.75;
  }

  if (isFooterSection(section)) {
    return 0.45;
  }

  return 1;
}

function getSectionMinimumHeight(section: LayoutSection, heroSectionId?: string): number {
  if (section.id === heroSectionId && section.type === "chart-group") {
    return 28;
  }

  if (section.type === "chart-group") {
    return 18;
  }

  if (section.type === "kpi-group") {
    return 13;
  }

  if (isFooterSection(section)) {
    return 10;
  }

  return 12;
}

export function buildFallbackSectionLayouts(plan: LayoutPlan): Map<string, LayoutGeometry> {
  const editableSections = plan.sections.filter((section) => section.type !== "header");
  if (editableSections.length === 0) {
    return new Map();
  }

  const heroSectionId = editableSections.find((section) => section.type === "chart-group")?.id;
  const hasNonFooterSections = editableSections.some((section) => !isFooterSection(section));
  const orderedSections = hasNonFooterSections
    ? [
        ...editableSections.filter((section) => section.id === heroSectionId),
        ...editableSections.filter((section) => section.id !== heroSectionId && !isFooterSection(section)),
        ...editableSections.filter((section) => isFooterSection(section)),
      ]
    : editableSections;
  const marginX = 4;
  const topPadding = plan.aspectRatio === "portrait" ? 4 : 3.5;
  const bottomPadding = 4;
  const gap = 3;
  const totalGap = gap * Math.max(orderedSections.length - 1, 0);
  const minimumHeights = orderedSections.map((section) => getSectionMinimumHeight(section, heroSectionId));
  const minimumHeightBudget = minimumHeights.reduce((sum, height) => sum + height, 0);
  const weightedSections = orderedSections.map((section) => ({
    section,
    weight: getSectionFallbackWeight(section, heroSectionId),
  }));
  const totalWeight = weightedSections.reduce((sum, entry) => sum + entry.weight, 0);
  const distributableHeight = Math.max(0, 100 - topPadding - bottomPadding - totalGap - minimumHeightBudget);
  const layouts = new Map<string, LayoutGeometry>();
  let cursorY = topPadding;

  weightedSections.forEach(({ section, weight }, index) => {
    const remainingSections = weightedSections.length - index - 1;
    const remainingMinimumHeight = minimumHeights.slice(index + 1).reduce((sum, height) => sum + height, 0);
    const remainingGap = gap * remainingSections;
    const baseHeight = minimumHeights[index] ?? 12;
    const proposedHeight = baseHeight + distributableHeight * (weight / Math.max(totalWeight, 1));
    const maxHeight = 100 - bottomPadding - cursorY - remainingMinimumHeight - remainingGap;
    const height = clampNumber(proposedHeight, baseHeight, Math.max(baseHeight, maxHeight));

    layouts.set(section.id, {
      x: marginX,
      y: cursorY,
      width: 100 - marginX * 2,
      height,
    });
    cursorY += height + gap;
  });

  return layouts;
}

function preserveBlockMetadata(nextBlock: LayoutBlock, existingBlock?: LayoutBlock): LayoutBlock {
  if (!existingBlock || existingBlock.type !== nextBlock.type) {
    return nextBlock;
  }

  return {
    ...nextBlock,
    name: existingBlock.name ?? nextBlock.name,
    style: existingBlock.style ?? nextBlock.style,
    locked: existingBlock.locked ?? nextBlock.locked,
    hidden: existingBlock.hidden ?? nextBlock.hidden,
    zIndex: existingBlock.zIndex ?? nextBlock.zIndex,
  };
}

function findLegacyBlockForMigration(tree: LayoutBlockTree | undefined, sectionId: string, kind: "group" | "title" | "chart" | "kpi" | "note", entityId?: string): LayoutBlock | undefined {
  if (!tree) return undefined;

  const legacyId = kind === "group"
    ? `${sectionId}-frame`
    : kind === "title"
      ? `${sectionId}-title`
      : kind === "note"
        ? `${sectionId}-note`
        : kind === "chart"
          ? `${entityId}-card`
          : `${entityId}-card`;

  return tree.blocks[legacyId];
}

function buildBlockId(sectionId: string, kind: "group" | "title" | "chart" | "kpi" | "note", entityId?: string): string {
  if (kind === "group") return `${sectionId}-frame`;
  if (kind === "title") return `${sectionId}-title`;
  if (kind === "note") return `${sectionId}-note`;
  return `${sectionId}-${entityId}-${kind}`;
}

export function buildLayoutTreeFromPlan(plan: LayoutPlan, existingTree?: LayoutBlockTree): LayoutBlockTree {
  const blocks: Record<string, LayoutBlock> = {};
  const rootIds: string[] = [];
  const fallbackSectionLayouts = buildFallbackSectionLayouts(plan);
  const headerSection = plan.sections.find((section) => section.type === "header");
  const headerTitleId = `${plan.id}-header-title`;
  const headerSummaryId = `${plan.id}-header-summary`;

  const headerTitleBlock: LayoutHeadingBlock = {
    id: headerTitleId,
    type: "heading",
    region: "header",
    layout: cloneGeometry(plan.headerTitleLayout) ?? { x: 0, y: 0, width: 58, height: 44 },
    content: {
      text: headerSection?.title ?? plan.name ?? "데이터 레이아웃",
    },
  };

  const headerSummaryBlock: LayoutTextBlock = {
    id: headerSummaryId,
    type: "text",
    region: "header",
    layout: cloneGeometry(plan.headerSummaryLayout) ?? { x: 0, y: 50, width: 64, height: 24 },
    content: {
      text: plan.description ?? "표 데이터를 기반으로 재구성한 레이아웃 미리보기",
    },
  };

  blocks[headerTitleId] = preserveBlockMetadata(headerTitleBlock, existingTree?.blocks[headerTitleId]);
  blocks[headerSummaryId] = preserveBlockMetadata(headerSummaryBlock, existingTree?.blocks[headerSummaryId]);
  rootIds.push(headerTitleId, headerSummaryId);

  plan.sections
    .filter((section) => section.type !== "header")
    .forEach((section) => {
      const groupId = buildBlockId(section.id, "group");
      const titleId = buildBlockId(section.id, "title");
      const groupBlock: LayoutGroupBlock = {
        id: groupId,
        type: "group",
        region: "canvas",
        layout: cloneGeometry(section.layout) ?? fallbackSectionLayouts.get(section.id) ?? { x: 4, y: 4, width: 92, height: 24 },
        content: {
          role: section.type,
          sectionId: section.id,
        },
        childIds: [],
      };

      const titleBlock: LayoutHeadingBlock = {
        id: titleId,
        type: "heading",
        region: "canvas",
        parentId: groupId,
        layout: cloneGeometry(section.titleLayout) ?? { x: 0, y: 0, width: 44, height: 18 },
        content: {
          text: section.title ?? getSectionLabel(section.type),
          sectionId: section.id,
        },
      };

      blocks[groupId] = preserveBlockMetadata(groupBlock, existingTree?.blocks[groupId] ?? findLegacyBlockForMigration(existingTree, section.id, "group"));
      blocks[titleId] = preserveBlockMetadata(titleBlock, existingTree?.blocks[titleId] ?? findLegacyBlockForMigration(existingTree, section.id, "title"));
      groupBlock.childIds.push(titleId);
      rootIds.push(groupId);

      if (section.type === "chart-group") {
        (section.charts ?? []).forEach((chart) => {
          const blockId = buildBlockId(section.id, "chart", chart.id);
          const chartBlock: LayoutChartBlock = {
            id: blockId,
            type: "chart",
            region: "canvas",
            parentId: groupId,
            layout: cloneGeometry(chart.layout) ?? { x: 0, y: 14, width: 100, height: 36 },
            content: {
              sectionId: section.id,
              chartId: chart.id,
              tableId: chart.tableId,
              chartType: chart.chartType,
              title: chart.title,
              goal: chart.goal,
              dimension: chart.dimension,
              metric: chart.metric,
            },
          };
          blocks[blockId] = preserveBlockMetadata(chartBlock, existingTree?.blocks[blockId] ?? findLegacyBlockForMigration(existingTree, section.id, "chart", chart.id));
          groupBlock.childIds.push(blockId);
        });
      }

      if (section.type === "kpi-group") {
        (section.items ?? []).forEach((item) => {
          const blockId = buildBlockId(section.id, "kpi", item.id);
          const kpiBlock: LayoutKpiBlock = {
            id: blockId,
            type: "kpi",
            region: "canvas",
            parentId: groupId,
            layout: cloneGeometry(item.layout) ?? { x: 0, y: 14, width: 32, height: 68 },
            content: {
              sectionId: section.id,
              itemId: item.id,
              tableId: item.tableId,
              label: item.label,
              value: item.value,
            },
          };
          blocks[blockId] = preserveBlockMetadata(kpiBlock, existingTree?.blocks[blockId] ?? findLegacyBlockForMigration(existingTree, section.id, "kpi", item.id));
          groupBlock.childIds.push(blockId);
        });
      }

      if (section.type === "takeaway" || section.type === "note") {
        const noteId = buildBlockId(section.id, "note");
        const noteBlock: LayoutTextBlock = {
          id: noteId,
          type: "text",
          region: "canvas",
          parentId: groupId,
          layout: cloneGeometry(section.noteLayout) ?? { x: 0, y: 14, width: 100, height: 76 },
          content: {
            text: section.note ?? "핵심 시사점을 짧게 요약하는 영역",
            sectionId: section.id,
          },
        };
        blocks[noteId] = preserveBlockMetadata(noteBlock, existingTree?.blocks[noteId] ?? findLegacyBlockForMigration(existingTree, section.id, "note"));
        groupBlock.childIds.push(noteId);
      }
    });

  return { rootIds, blocks };
}

function cloneSectionBase(section: LayoutSection): LayoutSection {
  return {
    ...section,
    layout: cloneGeometry(section.layout),
    titleLayout: cloneGeometry(section.titleLayout),
    noteLayout: cloneGeometry(section.noteLayout),
    charts: section.charts?.map((chart) => ({ ...chart, layout: cloneGeometry(chart.layout) })),
    items: section.items?.map((item) => ({ ...item, layout: cloneGeometry(item.layout) })),
  };
}

export function projectLayoutPlanFromTree(plan: LayoutPlan): LayoutPlan {
  if (!plan.layoutTree) {
    return plan;
  }

  const tree = plan.layoutTree;
  const headerTitleBlock = tree.blocks[`${plan.id}-header-title`];
  const headerSummaryBlock = tree.blocks[`${plan.id}-header-summary`];
  const sourceSections = new Map(plan.sections.map((section) => [section.id, cloneSectionBase(section)]));
  const headerSection = plan.sections.find((section) => section.type === "header") ? cloneSectionBase(plan.sections.find((section) => section.type === "header")!) : { id: "header", type: "header" as const };

  if (headerTitleBlock?.type === "heading") {
    headerSection.title = headerTitleBlock.content.text;
  }

  const projectedSections: LayoutSection[] = [headerSection];

  tree.rootIds.forEach((rootId) => {
    const block = tree.blocks[rootId];
    if (!block || block.type !== "group" || block.region !== "canvas") return;
    const sectionId = block.content.sectionId;
    if (!sectionId) return;
    const sectionType = block.content.role;
    if (sectionType === "header" || sectionType === "generic") return;

    const baseSection = sourceSections.get(sectionId) ?? {
      id: sectionId,
      type: sectionType,
    };

    const nextSection: LayoutSection = {
      ...baseSection,
      id: sectionId,
      type: sectionType,
      layout: cloneGeometry(block.layout),
      charts: [],
      items: [],
      note: undefined,
      noteLayout: undefined,
    };

    block.childIds.forEach((childId) => {
      const child = tree.blocks[childId];
      if (!child) return;
      if (child.type === "heading") {
        nextSection.title = child.content.text;
        nextSection.titleLayout = cloneGeometry(child.layout);
      }
      if (child.type === "chart") {
        const chart: LayoutChartSpec = {
          id: child.content.chartId,
          tableId: child.content.tableId,
          chartType: child.content.chartType,
          title: child.content.title,
          goal: child.content.goal,
          dimension: child.content.dimension,
          metric: child.content.metric,
          layout: cloneGeometry(child.layout),
        };
        nextSection.charts = [...(nextSection.charts ?? []), chart];
      }
      if (child.type === "kpi") {
        const item: LayoutKpiItem = {
          id: child.content.itemId,
          tableId: child.content.tableId,
          label: child.content.label,
          value: child.content.value,
          layout: cloneGeometry(child.layout),
        };
        nextSection.items = [...(nextSection.items ?? []), item];
      }
      if (child.type === "text") {
        nextSection.note = child.content.text;
        nextSection.noteLayout = cloneGeometry(child.layout);
      }
    });

    if (nextSection.type !== "chart-group") {
      delete nextSection.charts;
    }
    if (nextSection.type !== "kpi-group") {
      delete nextSection.items;
    }
    if (nextSection.type !== "takeaway" && nextSection.type !== "note") {
      delete nextSection.note;
      delete nextSection.noteLayout;
    }

    projectedSections.push(nextSection);
  });

  return {
    ...plan,
    name: headerTitleBlock?.type === "heading" ? headerTitleBlock.content.text : plan.name,
    description: headerSummaryBlock?.type === "text" ? headerSummaryBlock.content.text : plan.description,
    headerTitleLayout: headerTitleBlock ? cloneGeometry(headerTitleBlock.layout) : plan.headerTitleLayout,
    headerSummaryLayout: headerSummaryBlock ? cloneGeometry(headerSummaryBlock.layout) : plan.headerSummaryLayout,
    sections: projectedSections,
  };
}

export function updateLayoutTreeBlock(plan: LayoutPlan, blockId: string, updater: (block: LayoutBlock) => LayoutBlock): LayoutPlan {
  const tree = plan.layoutTree ?? buildLayoutTreeFromPlan(plan);
  const block = tree.blocks[blockId];
  if (!block) {
    return plan;
  }

  const nextTree: LayoutBlockTree = {
    rootIds: [...tree.rootIds],
    blocks: {
      ...tree.blocks,
      [blockId]: updater(block),
    },
  };

  return projectLayoutPlanFromTree({
    ...plan,
    layoutTree: nextTree,
  });
}

export function reorderLayoutTreeRoots(plan: LayoutPlan, groupBlockId: string, targetIndex: number): LayoutPlan {
  const tree = plan.layoutTree ?? buildLayoutTreeFromPlan(plan);
  const canvasRootIds = tree.rootIds.filter((id) => tree.blocks[id]?.type === "group" && tree.blocks[id]?.region === "canvas");
  const currentIndex = canvasRootIds.indexOf(groupBlockId);
  if (currentIndex < 0) return plan;

  const nextCanvasRoots = canvasRootIds.slice();
  const [moved] = nextCanvasRoots.splice(currentIndex, 1);
  nextCanvasRoots.splice(Math.max(0, Math.min(targetIndex, nextCanvasRoots.length)), 0, moved);

  const preservedHeaderRoots = tree.rootIds.filter((id) => !canvasRootIds.includes(id));
  const nextPlan = projectLayoutPlanFromTree({
    ...plan,
    layoutTree: {
      rootIds: [...preservedHeaderRoots, ...nextCanvasRoots],
      blocks: { ...tree.blocks },
    },
  });

  return nextPlan;
}
