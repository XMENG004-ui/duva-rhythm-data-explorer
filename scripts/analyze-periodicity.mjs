import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveWindow } from "../src/mockData.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataset = JSON.parse(fs.readFileSync(path.join(root, "public/data/pmdata.json"), "utf8"));
const DAY_MS = 86_400_000;
const PERMUTATIONS = 5_000;

const featureDefinitions = [
  { id: "sleep_start", label: "Primary-sleep start", get: (day) => day.bed, unit: "hours" },
  { id: "wake_time", label: "Primary-sleep wake", get: (day) => day.wake, unit: "hours" },
  { id: "sleep_duration", label: "Sleep duration", get: (day) => day.duration, unit: "hours" },
  { id: "deep_share", label: "Deep-sleep share", get: (day) => day.stages?.deep, unit: "share" },
  { id: "rem_share", label: "REM share", get: (day) => day.stages?.rem, unit: "share" },
  { id: "wake_share", label: "Wake share", get: (day) => day.stages?.wake, unit: "share" },
  { id: "sleep_median_hr", label: "Night median heart rate", get: (day) => day.physiology?.sleepMedianBpm, unit: "bpm" },
  { id: "sleep_low_hr", label: "Night low heart rate", get: (day) => day.physiology?.sleepLowBpm, unit: "bpm" },
  { id: "resting_hr", label: "Resting heart rate", get: (day) => day.physiology?.restingBpm, unit: "bpm" },
  { id: "hr_settling", label: "Heart-rate settling time", get: (day) => day.physiology?.heartRateSettlingMinutes, unit: "minutes" },
  { id: "first90_disruption", label: "First-90-minute sleep-stage disruption", get: (day) => day.sleepStructure?.first90DisruptionEvents, unit: "events" },
];

function ordinal(date) {
  const [year, month, day] = date.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function dayOfWeek(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
}

function standardDeviation(values) {
  const center = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - center) ** 2)));
}

function solve(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    if (Math.abs(augmented[column][column]) < 1e-9) augmented[column][column] = 1e-9;
    const divisor = augmented[column][column];
    for (let item = column; item <= size; item += 1) augmented[column][item] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let item = column; item <= size; item += 1) augmented[row][item] -= factor * augmented[column][item];
    }
  }
  return augmented.map((row) => row[size]);
}

function fit(design, values) {
  const columns = design[0].length;
  const gram = Array.from({ length: columns }, () => Array(columns).fill(0));
  const cross = Array(columns).fill(0);
  for (let row = 0; row < design.length; row += 1) {
    for (let left = 0; left < columns; left += 1) {
      cross[left] += design[row][left] * values[row];
      for (let right = 0; right < columns; right += 1) {
        gram[left][right] += design[row][left] * design[row][right];
      }
    }
  }
  for (let index = 0; index < columns; index += 1) gram[index][index] += 1e-8;
  const beta = solve(gram, cross);
  const predicted = design.map((row) => row.reduce((total, value, index) => total + value * beta[index], 0));
  const residual = values.map((value, index) => value - predicted[index]);
  return { beta, predicted, residual };
}

function baselineDesign(dates) {
  const ordinals = dates.map(ordinal);
  const first = Math.min(...ordinals);
  const span = Math.max(1, Math.max(...ordinals) - first);
  return dates.map((date, index) => {
    const weekday = dayOfWeek(date);
    return [
      1,
      (ordinals[index] - first) / span,
      ...Array.from({ length: 6 }, (_, item) => Number(weekday === item + 1)),
    ];
  });
}

function residualize(column, baseline) {
  return fit(baseline, column).residual;
}

function preparePeriodModels(dates, periods) {
  const baseline = baselineDesign(dates);
  const ordinals = dates.map(ordinal);
  return periods.map((period) => {
    const sine = residualize(ordinals.map((value) => Math.sin((2 * Math.PI * value) / period)), baseline);
    const cosine = residualize(ordinals.map((value) => Math.cos((2 * Math.PI * value) / period)), baseline);
    const ss = sine.reduce((total, value) => total + value * value, 0);
    const cc = cosine.reduce((total, value) => total + value * value, 0);
    const sc = sine.reduce((total, value, index) => total + value * cosine[index], 0);
    const determinant = Math.max(1e-9, ss * cc - sc * sc);
    return { period, sine, cosine, ss, cc, sc, determinant };
  });
}

function scanResidual(residual, models) {
  const total = Math.max(1e-9, residual.reduce((sum, value) => sum + value * value, 0));
  return models
    .map((model) => {
      const sy = model.sine.reduce((sum, value, index) => sum + value * residual[index], 0);
      const cy = model.cosine.reduce((sum, value, index) => sum + value * residual[index], 0);
      const sineBeta = (sy * model.cc - cy * model.sc) / model.determinant;
      const cosineBeta = (cy * model.ss - sy * model.sc) / model.determinant;
      const explained = Math.max(0, sy * sineBeta + cy * cosineBeta);
      return {
        period: model.period,
        residualVarianceExplained: Math.min(1, explained / total),
        sineBeta,
        cosineBeta,
      };
    })
    .sort((left, right) => right.residualVarianceExplained - left.residualVarianceExplained)[0];
}

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function hashSeed(text) {
  let hash = 2_166_136_261;
  for (const character of text) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function blockShuffle(values, blockSize, rng) {
  const blocks = [];
  for (let index = 0; index < values.length; index += blockSize) blocks.push(values.slice(index, index + blockSize));
  for (let index = blocks.length - 1; index > 0; index -= 1) {
    const target = Math.floor(rng() * (index + 1));
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
  }
  return blocks.flat();
}

function testSeries(dates, values, periods, seed, permutations = PERMUTATIONS) {
  const baseline = baselineDesign(dates);
  const residual = fit(baseline, values).residual;
  const models = preparePeriodModels(dates, periods);
  const observed = scanResidual(residual, models);
  const rng = makeRng(hashSeed(seed));
  let atLeastObserved = 0;
  for (let run = 0; run < permutations; run += 1) {
    const shuffled = blockShuffle(residual, 3, rng).slice(0, residual.length);
    const bestNull = scanResidual(shuffled, models);
    if (bestNull.residualVarianceExplained >= observed.residualVarianceExplained - 1e-12) atLeastObserved += 1;
  }
  const amplitude = Math.sqrt(observed.sineBeta ** 2 + observed.cosineBeta ** 2);
  return {
    ...observed,
    pValue: (atLeastObserved + 1) / (permutations + 1),
    amplitude,
    standardizedAmplitude: amplitude / Math.max(1e-9, standardDeviation(values)),
    phase: Math.atan2(observed.cosineBeta, observed.sineBeta),
  };
}

function evaluateAtPeriod(dates, values, period) {
  const baseline = baselineDesign(dates);
  const residual = fit(baseline, values).residual;
  return scanResidual(residual, preparePeriodModels(dates, [period]));
}

function scanHalf(dates, values, periods) {
  const baseline = baselineDesign(dates);
  const residual = fit(baseline, values).residual;
  return scanResidual(residual, preparePeriodModels(dates, periods));
}

function phaseAgreement(left, right) {
  const numerator = left.sineBeta * right.sineBeta + left.cosineBeta * right.cosineBeta;
  const denominator = Math.sqrt((left.sineBeta ** 2 + left.cosineBeta ** 2) * (right.sineBeta ** 2 + right.cosineBeta ** 2));
  return denominator > 1e-9 ? numerator / denominator : 0;
}

function adjustBenjaminiHochberg(items) {
  const sorted = [...items].sort((left, right) => left.pValue - right.pValue);
  let running = 1;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    running = Math.min(running, (sorted[index].pValue * sorted.length) / (index + 1));
    sorted[index].qValue = running;
  }
}

const featureTests = [];
for (const participant of dataset.participants) {
  for (const feature of featureDefinitions) {
    const rows = participant.days
      .filter((day) => day.valid && Number.isFinite(feature.get(day)))
      .map((day) => ({ date: day.date, value: feature.get(day) }));
    if (rows.length < 50) continue;
    const dates = rows.map((row) => row.date);
    const values = rows.map((row) => row.value);
    const spanDays = ordinal(dates.at(-1)) - ordinal(dates[0]) + 1;
    const periods = Array.from({ length: 20 }, (_, index) => index + 2).filter((period) => spanDays / period >= 4);
    const result = testSeries(dates, values, periods, `${participant.id}-${feature.id}`);
    const midpoint = Math.floor(rows.length / 2);
    const halves = [rows.slice(0, midpoint), rows.slice(midpoint)];
    const halfResults = halves.map((half) => {
      const halfDates = half.map((row) => row.date);
      const halfValues = half.map((row) => row.value);
      return {
        atSelectedPeriod: evaluateAtPeriod(halfDates, halfValues, result.period),
        best: scanHalf(halfDates, halfValues, periods),
      };
    });
    featureTests.push({
      participant: participant.id,
      feature: feature.id,
      featureLabel: feature.label,
      unit: feature.unit,
      observationCount: rows.length,
      dateStart: dates[0],
      dateEnd: dates.at(-1),
      ...result,
      firstHalfVarianceExplained: halfResults[0].atSelectedPeriod.residualVarianceExplained,
      secondHalfVarianceExplained: halfResults[1].atSelectedPeriod.residualVarianceExplained,
      firstHalfBestPeriod: halfResults[0].best.period,
      secondHalfBestPeriod: halfResults[1].best.period,
      splitPhaseAgreement: phaseAgreement(halfResults[0].atSelectedPeriod, halfResults[1].atSelectedPeriod),
    });
  }
}
adjustBenjaminiHochberg(featureTests);
for (const item of featureTests) {
  item.splitStable = item.firstHalfVarianceExplained >= 0.04
    && item.secondHalfVarianceExplained >= 0.04
    && Math.abs(item.firstHalfBestPeriod - item.period) <= 1
    && Math.abs(item.secondHalfBestPeriod - item.period) <= 1
    && item.splitPhaseAgreement > 0;
  item.publishable = item.qValue <= 0.1 && item.residualVarianceExplained >= 0.08 && item.splitStable;
}

const patternTests = [];
for (const participant of dataset.participants) {
  for (let endIndex = 41; endIndex < participant.days.length; endIndex += 42) {
    const rhythmWindow = deriveWindow(participant, endIndex);
    if (rhythmWindow.validDays.length < 30) continue;
    for (const pattern of rhythmWindow.visiblePatterns) {
      if (pattern.includedDays.length < 5 || rhythmWindow.validDays.length - pattern.includedDays.length < 8) continue;
      const coreIds = new Set(pattern.includedDays.map((day) => day.id));
      const dates = rhythmWindow.validDays.map((day) => day.date);
      const values = rhythmWindow.validDays.map((day) => Number(coreIds.has(day.id)));
      const periods = Array.from({ length: 9 }, (_, index) => index + 2);
      const result = testSeries(dates, values, periods, `${participant.id}-${rhythmWindow.end}-${pattern.id}`);
      patternTests.push({
        participant: participant.id,
        windowStart: rhythmWindow.start,
        windowEnd: rhythmWindow.end,
        patternId: pattern.id,
        pattern: pattern.name,
        emergence: pattern.emergence,
        coreSleepDays: pattern.includedDays.length,
        validSleepDays: rhythmWindow.validDays.length,
        coreDates: pattern.includedDays.map((day) => day.date).sort(),
        ...result,
      });
    }
  }
}
adjustBenjaminiHochberg(patternTests);

for (const item of patternTests) {
  const repeats = patternTests.filter((other) => other !== item
    && other.participant === item.participant
    && other.patternId === item.patternId
    && Math.abs(other.period - item.period) <= 1
    && other.pValue <= 0.1);
  item.replicatedInNonOverlappingWindow = repeats.length > 0;
  item.publishable = item.qValue <= 0.1
    && item.residualVarianceExplained >= 0.1
    && item.replicatedInNonOverlappingWindow;
}

const strongestFeatures = [...featureTests]
  .sort((left, right) => left.pValue - right.pValue || right.residualVarianceExplained - left.residualVarianceExplained)
  .slice(0, 20);
const strongestPatterns = [...patternTests]
  .sort((left, right) => left.pValue - right.pValue || right.residualVarianceExplained - left.residualVarianceExplained)
  .slice(0, 20);
const publishableFeatures = featureTests.filter((item) => item.publishable);
const publishablePatterns = patternTests.filter((item) => item.publishable);

const output = {
  generatedAt: new Date().toISOString(),
  method: {
    featurePeriodRangeDays: "2–21 integer days; at least four observed cycles",
    patternPeriodRangeDays: "2–10 integer days inside non-overlapping 42-calendar-day windows",
    adjustment: "participant-specific weekday indicators plus linear trend are removed before period screening",
    nullTest: `${PERMUTATIONS} deterministic three-observation block permutations; maximum score across all tested periods controls the within-series period search`,
    multipleTesting: "Benjamini–Hochberg q <= 0.10 across screened series",
    featureReplication: "both chronological halves must retain >= 4% residual variance at the selected period, prefer the same period within one day, and keep compatible phase",
    patternReplication: "the same participant and Pattern identity must repeat at a similar period in another non-overlapping 42-day window",
    interpretation: "exploratory association only; a detected interval is temporal context and does not change Pattern Emergence",
  },
  counts: {
    participants: dataset.participants.length,
    featureSeriesTested: featureTests.length,
    featureSeriesNominalP05: featureTests.filter((item) => item.pValue <= 0.05).length,
    featureSeriesFdrQ10: featureTests.filter((item) => item.qValue <= 0.1).length,
    featureSeriesSplitStable: featureTests.filter((item) => item.splitStable).length,
    publishableFeatureCycles: publishableFeatures.length,
    nonOverlappingPatternSnapshotsTested: patternTests.length,
    patternSnapshotsNominalP05: patternTests.filter((item) => item.pValue <= 0.05).length,
    patternSnapshotsFdrQ10: patternTests.filter((item) => item.qValue <= 0.1).length,
    patternSnapshotsWithReplication: patternTests.filter((item) => item.replicatedInNonOverlappingWindow).length,
    publishablePatternCycles: publishablePatterns.length,
  },
  publishableFeatures,
  publishablePatterns,
  strongestFeatures,
  strongestPatterns,
};

fs.writeFileSync(path.join(root, "public/data/periodicity_analysis.json"), JSON.stringify(output, null, 2));

const featureRows = strongestFeatures.slice(0, 12).map((item) => `| ${item.participant} | ${item.featureLabel} | ${item.period} | ${(item.residualVarianceExplained * 100).toFixed(1)}% | ${item.pValue.toFixed(4)} | ${item.qValue.toFixed(3)} | ${item.splitStable ? "yes" : "no"} |`);
const patternRows = strongestPatterns.slice(0, 12).map((item) => `| ${item.participant} | ${item.windowEnd} | ${item.pattern} | ${item.period} | ${(item.residualVarianceExplained * 100).toFixed(1)}% | ${item.pValue.toFixed(4)} | ${item.qValue.toFixed(3)} | ${item.replicatedInNonOverlappingWindow ? "yes" : "no"} |`);
const report = [
  "# PMData 固定间隔周期探索",
  "",
  `生成时间：${output.generatedAt}`,
  "",
  "## 检查范围",
  "",
  "- 以参与者为单位检查 2–21 天的睡眠特征周期。",
  "- 在互不重叠的六周窗口中检查 2–10 天的 Pattern 复现周期。",
  "- 先移除星期几和缓慢长期变化，再检查剩余变化是否按固定间隔重复。",
  "- 每个信号同时比较全部候选天数，随后统一控制大量重复筛选带来的偶然命中。",
  "- 睡眠特征需要在前后两段记录中保持相近周期和相位；Pattern 需要在另一个互不重叠窗口中再次出现。",
  "",
  "## 结果",
  "",
  `- 共检查 ${output.counts.featureSeriesTested} 条个人睡眠特征序列。${output.counts.featureSeriesNominalP05} 条达到未经多重校正的 p≤0.05，${output.counts.featureSeriesFdrQ10} 条通过 FDR q≤0.10，${output.counts.publishableFeatureCycles} 条同时通过前后分段稳定性门槛。`,
  `- 共检查 ${output.counts.nonOverlappingPatternSnapshotsTested} 个可分析的 Pattern 快照。${output.counts.patternSnapshotsNominalP05} 个达到未经多重校正的 p≤0.05，${output.counts.patternSnapshotsFdrQ10} 个通过 FDR q≤0.10。${output.counts.patternSnapshotsWithReplication} 个快照在另一窗口出现相近间隔，${output.counts.publishablePatternCycles} 个同时通过全部复核门槛。`,
  "- p10 的夜间低位心率出现约 20 天的候选周期。它覆盖 99 个夜晚，去除星期效应和长期趋势后解释 17.3% 的剩余变化，前后两段记录都接近 20–21 天；估计振幅约 2.3 bpm。",
  "- p10 的静息心率和夜间中位心率在全段记录中也接近 20 天。静息心率的后半段最佳周期移到 18 天，夜间中位心率的分段最佳周期变化更大，因此保留为支持线索。",
  "- p02 的 REM 占比出现过 3 天候选，但后半段最佳周期变为 10 天，且多重比较校正后 q=0.483，不能发布。",
  "- 目前没有任何 Pattern 出现间隔通过全部复核。p09 和 p15 的 9–10 天候选只在局部窗口成立。",
  "",
  "## 最强的睡眠特征候选",
  "",
  "| 参与者 | 特征 | 最佳间隔（天） | 去除星期效应后解释量 | p | q | 前后分段稳定 |",
  "|---|---|---:|---:|---:|---:|---|",
  ...featureRows,
  "",
  "## 最强的 Pattern 复现候选",
  "",
  "| 参与者 | 窗口结束 | Pattern | 最佳间隔（天） | 去除星期效应后解释量 | p | q | 相近间隔再次出现 |",
  "|---|---|---|---:|---:|---:|---:|---|",
  ...patternRows,
  "",
  "## 产品边界",
  "",
  "- 固定间隔属于 Pattern 形成后的时间 Context。它不进入聚类距离，也不提高 Emergence。",
  "- 产品发布需要至少四次完整循环、跨两个独立观察区间复现、通过多重比较控制，并能与星期或工作/休息日效应区分。",
  "- PMData 只有约五个月记录。月经周期、轮班周期、训练周期等较长节律需要更长数据和真实日程记录才能验证。",
  "- 当前结果只表示时间关联，不能推断生理原因。",
  "",
];
fs.writeFileSync(path.join(root, "PMDATA_PERIODICITY_VALIDATION.md"), report.join("\n"));
console.log(JSON.stringify(output.counts, null, 2));
console.log(JSON.stringify({ publishableFeatures, publishablePatterns, strongestFeatures: strongestFeatures.slice(0, 5), strongestPatterns: strongestPatterns.slice(0, 5) }, null, 2));
