import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveAssociations, deriveSignalInsights, deriveWindow } from "../src/mockData.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataset = JSON.parse(fs.readFileSync(path.join(root, "public/data/pmdata.json"), "utf8"));
const observations = [];
const sampledWindows = [];

for (const participant of dataset.participants) {
  const latestValid = participant.days.findLastIndex((day) => day.valid);
  if (latestValid < 0) continue;
  const anchors = new Set();
  for (let index = 41; index <= latestValid; index += 14) anchors.add(index);
  anchors.add(latestValid);
  for (const endIndex of [...anchors].sort((a, b) => a - b)) {
    const rhythmWindow = deriveWindow(participant, endIndex);
    sampledWindows.push({
      participant: participant.id,
      windowStart: rhythmWindow.start,
      windowEnd: rhythmWindow.end,
      visiblePatternCount: rhythmWindow.visiblePatterns.length,
      candidateCount: rhythmWindow.patterns.length,
      hiddenCandidateCount: rhythmWindow.hiddenCandidates,
      validSleepDays: rhythmWindow.validDays.length,
      coreSleepDays: rhythmWindow.patterns.reduce((total, pattern) => total + pattern.includedDays.length, 0),
      boundarySleepDays: rhythmWindow.boundaryDays.length,
      unassignedSleepDays: rhythmWindow.unassignedDays.length,
    });
    for (const pattern of rhythmWindow.visiblePatterns) {
      const signalInsights = deriveSignalInsights(pattern, rhythmWindow);
      const integratedCalendar = new Set(signalInsights.map((item) => item.calendarAssociationId).filter(Boolean));
      const associations = [
        ...signalInsights,
        ...deriveAssociations(pattern, rhythmWindow).filter((item) => !integratedCalendar.has(item.id)),
      ];
      observations.push({
        participant: participant.id,
        windowStart: rhythmWindow.start,
        windowEnd: rhythmWindow.end,
        pattern: pattern.name,
        emergence: pattern.emergence,
        confidence: pattern.confidence,
        support: pattern.includedDays.length,
        associations: associations.map((item) => ({
          id: item.id,
          source: item.source,
          statement: item.statement,
          supportCount: item.supportCount,
          comparisonDays: item.comparisonDays,
          strength: Number(item.strength.toFixed(4)),
          confidence: Number(item.confidence.toFixed(4)),
          inferred: Boolean(item.inferred),
          adjustedFor: item.adjustedFor,
        })),
      });
    }
  }
}

const published = observations.flatMap((item) => item.associations.map((association) => ({ ...item, associations: undefined, ...association })));
const bySource = Object.groupBy(published, (item) => item.source);
const strongest = [...published]
  .sort((a, b) => b.strength * b.confidence - a.strength * a.confidence)
  .slice(0, 20);
const participantCoverage = Object.groupBy(published, (item) => item.participant);

const summary = {
  generatedAt: new Date().toISOString(),
  method: {
    windows: "rolling 42-calendar-day maximum; sampled every 14 days plus latest valid night",
    patternState: "Emergence determines Candidate, Taking shape, or Clearly emerged",
    publicationFloor: "N_eff >= 4, Emergence >= 55, Confidence >= 0.55",
    association: "within-person exposed prevalence in Pattern vs other valid Sleep Days in the same window, Haldane-corrected log odds; lifestyle associations are estimated inside comparable inferred-rest-day strata",
    associationPublication: "positive direction, support >= 2, comparison >= 3, strength >= 0.15, confidence >= 0.25",
    crossSignalInsight: "within-pattern work-night or Sleep-Day contrast; joint later HR settling and more first-90-minute Fitbit sleep-stage disruption; support >= 3 with comparison and effect-size floors",
    membership: "core nights define Pattern shape and Context evidence; boundary nights contribute reduced Emergence support; unassigned nights remain outside every Pattern",
    boundary: "context fields never enter Emergence",
  },
  counts: {
    participants: dataset.participants.length,
    sampledWindows: sampledWindows.length,
    windowsWithZeroVisiblePattern: sampledWindows.filter((item) => item.visiblePatternCount === 0).length,
    windowsWithOneVisiblePattern: sampledWindows.filter((item) => item.visiblePatternCount === 1).length,
    windowsWithTwoVisiblePatterns: sampledWindows.filter((item) => item.visiblePatternCount === 2).length,
    windowsWithThreeVisiblePatterns: sampledWindows.filter((item) => item.visiblePatternCount === 3).length,
    windowsWithFourVisiblePatterns: sampledWindows.filter((item) => item.visiblePatternCount === 4).length,
    sampledPatternSnapshots: observations.length,
    snapshotsWithPublishedAssociation: observations.filter((item) => item.associations.length).length,
    publishedAssociationObservations: published.length,
    participantsWithAssociation: Object.keys(participantCoverage).length,
    exerciseAssociationObservations: bySource.exercise?.length || 0,
    foodAssociationObservations: bySource.food?.length || 0,
    wellnessAssociationObservations: bySource.wellness?.length || 0,
    calendarAssociationObservations: bySource.calendar?.length || 0,
    crossSignalInsightObservations: bySource.signals?.length || 0,
    sampledValidSleepDayObservations: sampledWindows.reduce((total, item) => total + item.validSleepDays, 0),
    sampledCoreSleepDayObservations: sampledWindows.reduce((total, item) => total + item.coreSleepDays, 0),
    sampledBoundarySleepDayObservations: sampledWindows.reduce((total, item) => total + item.boundarySleepDays, 0),
    sampledUnassignedSleepDayObservations: sampledWindows.reduce((total, item) => total + item.unassignedSleepDays, 0),
    windowsWithBoundarySleepDays: sampledWindows.filter((item) => item.boundarySleepDays > 0).length,
    windowsWithUnassignedSleepDays: sampledWindows.filter((item) => item.unassignedSleepDays > 0).length,
  },
  strongest,
  specialHandling: dataset.validation.specialHandling,
  limitations: [
    "Exploratory association screening; no causal interpretation.",
    "PMData has no schedule. Saturday and Sunday are treated as inferred rest days and labelled as an inference.",
    "Lifestyle associations are adjusted within comparable inferred-rest-day strata; sparse strata can suppress a signal that cannot be separated from calendar timing.",
    "Food reports identify meal occurrence, hydration and alcohol, without meal time, nutrients or food identity.",
    "Repeated overlapping windows and multiple context checks require later false-discovery and stability controls.",
    "Exercise absence in Fitbit exercise logs is treated as no recorded exercise; wear and detection gaps can reduce Confidence.",
    "PMData has no body-position/IMU or environmental-noise stream. Cross-signal insights omit those clauses instead of inferring them from sleep stages.",
  ],
};

fs.writeFileSync(path.join(root, "public/data/initial_associations.json"), JSON.stringify(summary, null, 2));

const lines = [
  "# PMData 上下文关联初步验证",
  "",
  `生成时间：${summary.generatedAt}`,
  "",
  "## 口径",
  "",
  "- 以参与者为单位，使用最多 42 个日历日的滚动窗口，每 14 天抽取一次快照，并补充每人的最后一个有效睡眠日。",
  "- Pattern 状态只由 Emergence 决定。发布底线使用有效支持量、Emergence 和 Confidence。",
  "- Core Sleep Days 定义 Pattern 形态并进入 Context 对照；Boundary Sleep Days 只降权参与 Emergence；Unassigned variation 留在所有 Pattern 之外。",
  "- Context association 在 Pattern 形成后计算，比较同一窗口中 Pattern 内外的上下文暴露比例。",
  "- PMData 缺少真实日程。当前把周六、周日标记为推定休息日，并在同类日期内复核运动、饮食和主观状态关联。",
  "- 日历时序、运动、饮食和主观状态不进入 Emergence。",
  "",
  "## 初步结果",
  "",
  `- 共抽取 ${summary.counts.sampledWindows} 个滚动窗口，得到 ${summary.counts.sampledPatternSnapshots} 个可见 Pattern 快照。`,
  `- 其中 ${summary.counts.windowsWithZeroVisiblePattern} 个窗口没有可见 Pattern，${summary.counts.windowsWithOneVisiblePattern} 个有 1 个，${summary.counts.windowsWithTwoVisiblePatterns} 个有 2 个，${summary.counts.windowsWithThreeVisiblePatterns} 个有 3 个，${summary.counts.windowsWithFourVisiblePatterns} 个有 4 个。`,
  `- ${summary.counts.snapshotsWithPublishedAssociation} 个快照至少出现一条达到初步发布口径的关联。`,
  `- 关联覆盖 ${summary.counts.participantsWithAssociation} 名参与者。`,
  `- 联合生理信号洞察 ${summary.counts.crossSignalInsightObservations} 条；日历关联观察 ${summary.counts.calendarAssociationObservations} 条，运动关联观察 ${summary.counts.exerciseAssociationObservations} 条，饮食关联观察 ${summary.counts.foodAssociationObservations} 条，主观状态关联观察 ${summary.counts.wellnessAssociationObservations} 条。`,
  `- 重叠窗口累计 ${summary.counts.sampledValidSleepDayObservations} 个有效Sleep Day观察，其中 ${summary.counts.sampledCoreSleepDayObservations} 个为Core、${summary.counts.sampledBoundarySleepDayObservations} 个为Boundary、${summary.counts.sampledUnassignedSleepDayObservations} 个为Unassigned。${summary.counts.windowsWithBoundarySleepDays} 个窗口含有Boundary，${summary.counts.windowsWithUnassignedSleepDays} 个窗口含有Unassigned variation。`,
  "",
  "## 较强的探索性信号",
  "",
  "| 参与者 | 窗口结束 | Pattern | 关联 | 支持 | 强度 | Confidence |",
  "|---|---|---|---|---:|---:|---:|",
  ...strongest.slice(0, 12).map((item) => `| ${item.participant} | ${item.windowEnd} | ${item.pattern} | ${item.statement.replace(/\.$/, "")} | ${item.supportCount} | ${(item.strength * 100).toFixed(0)} | ${(item.confidence * 100).toFixed(0)} |`),
  "",
  "## 边界",
  "",
  ...summary.limitations.map((item) => `- ${item}`),
  "- p12 的有效分期睡眠不足，保持证据不足状态。p15 保留睡眠 Pattern 与运动关联，关闭饮食关联。",
  "",
];
fs.writeFileSync(path.join(root, "PMDATA_CONTEXT_VALIDATION.md"), lines.join("\n"));
console.log(JSON.stringify(summary.counts, null, 2));
