import { deriveWindow, quantile } from "./mockData.js";

export const RESONANCE_WEIGHTS = {
  timing: 0.28,
  duration: 0.12,
  landscape: 0.25,
  composition: 0.12,
  physiology: 0.16,
  earlyNight: 0.07,
};

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const finite = (value) => Number.isFinite(value) ? value : null;

function average(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? usable.reduce((total, value) => total + value, 0) / usable.length : null;
}

function robustSimilarity(value, referenceValues, fallbackScale) {
  if (!Number.isFinite(value)) return null;
  const usable = referenceValues.filter(Number.isFinite);
  if (!usable.length) return null;
  const center = quantile(usable, 0.5);
  const observedSpread = (quantile(usable, 0.85) - quantile(usable, 0.15)) / 2;
  const scale = Math.max(fallbackScale, observedSpread);
  const standardizedDistance = Math.abs(value - center) / scale;
  return Math.exp(-0.5 * standardizedDistance * standardizedDistance);
}

export function resampleProfile(profile, count = 36) {
  if (!Array.isArray(profile) || !profile.length) return [];
  return Array.from({ length: count }, (_, index) => {
    const position = (index / Math.max(1, count - 1)) * (profile.length - 1);
    const left = Math.floor(position);
    const right = Math.min(profile.length - 1, left + 1);
    const mix = position - left;
    return profile[left] * (1 - mix) + profile[right] * mix;
  });
}

function landscapeSimilarity(day, pattern) {
  const actual = resampleProfile(day.profile);
  const references = pattern.includedDays
    .map((item) => resampleProfile(item.profile))
    .filter((profile) => profile.length === actual.length);
  if (!actual.length || !references.length) return null;
  const representative = actual.map((_, index) => quantile(references.map((profile) => profile[index]), 0.5));
  const levelDifference = average(actual.map((value, index) => Math.abs(value - representative[index]) / 3));
  const transitionDifference = average(actual.slice(1).map((value, index) => {
    const actualChange = value - actual[index];
    const referenceChange = representative[index + 1] - representative[index];
    return Math.abs(actualChange - referenceChange) / 3;
  }));
  return clamp(1 - (levelDifference * 0.78 + transitionDifference * 0.22));
}

function compositionSimilarity(day, pattern) {
  const stageKeys = ["deep", "light", "rem"];
  const scores = stageKeys.map((key) => {
    const value = finite(day.stages?.[key]);
    const reference = pattern.includedDays.map((item) => finite(item.stages?.[key])).filter(Number.isFinite);
    if (value == null || !reference.length) return null;
    return clamp(1 - Math.abs(value - quantile(reference, 0.5)) / 0.18);
  });
  return average(scores);
}

function physiologySimilarity(day, pattern) {
  const metrics = [
    ["sleepMedianBpm", 5],
    ["sleepLowBpm", 5],
    ["restingBpm", 5],
    ["heartRateSettlingMinutes", 18],
  ];
  return average(metrics.map(([key, fallbackScale]) => robustSimilarity(
    finite(day.physiology?.[key]),
    pattern.includedDays.map((item) => finite(item.physiology?.[key])),
    fallbackScale,
  )));
}

function explainFit(breakdown, patternName, state) {
  const timing = breakdown.timing ?? 0;
  const landscape = breakdown.landscape ?? 0;
  const physiology = breakdown.physiology ?? 0;
  if (state === "different") {
    const strongest = Object.entries(breakdown)
      .filter(([, value]) => Number.isFinite(value))
      .sort((a, b) => b[1] - a[1])[0]?.[0];
    const strongestCopy = {
      timing: "Timing came closest",
      duration: "Sleep duration came closest",
      landscape: "Part of the sleep-depth landscape came closest",
      composition: "Stage composition came closest",
      physiology: "Night heart-rate shape came closest",
      earlyNight: "The first 90 minutes came closest",
    }[strongest] || "A few features came close";
    return `${strongestCopy}, but the whole night did not align closely enough with ${patternName}.`;
  }
  if (timing >= 0.78 && landscape >= 0.72) {
    return `Timing and the overall sleep-depth landscape stayed close to your ${patternName}.`;
  }
  if (physiology >= 0.74 && landscape < 0.68) {
    return `Night heart-rate shape stayed familiar, while sleep depth varied more than your ${patternName}.`;
  }
  if (timing >= landscape) {
    return `Sleep timing stayed closest to your ${patternName}; the depth landscape carried more variation.`;
  }
  return `The sleep-depth landscape carried the strongest resemblance to your ${patternName}.`;
}

export function fitNightToPattern(day, pattern) {
  const startFit = robustSimilarity(day.bed, pattern.includedDays.map((item) => item.bed), 0.55);
  const wakeFit = robustSimilarity(day.wake, pattern.includedDays.map((item) => item.wake), 0.65);
  const breakdown = {
    timing: average([startFit, wakeFit]),
    duration: robustSimilarity(day.duration, pattern.includedDays.map((item) => item.duration), 0.7),
    landscape: landscapeSimilarity(day, pattern),
    composition: compositionSimilarity(day, pattern),
    physiology: physiologySimilarity(day, pattern),
    earlyNight: robustSimilarity(
      finite(day.sleepStructure?.first90DisruptionEvents),
      pattern.includedDays.map((item) => finite(item.sleepStructure?.first90DisruptionEvents)),
      4,
    ),
  };
  let usedWeight = 0;
  let weightedSimilarity = 0;
  Object.entries(RESONANCE_WEIGHTS).forEach(([key, weight]) => {
    if (!Number.isFinite(breakdown[key])) return;
    usedWeight += weight;
    weightedSimilarity += breakdown[key] * weight;
  });
  const rawScore = usedWeight ? (weightedSimilarity / usedWeight) * 100 : 0;
  const signalCoverage = usedWeight / Object.values(RESONANCE_WEIGHTS).reduce((sum, value) => sum + value, 0);
  const patternReliability = clamp((pattern.confidence || 0) / 100) * 0.65
    + clamp(pattern.includedDays.length / 12) * 0.35;
  const reliability = signalCoverage * 0.45 + patternReliability * 0.55;
  const score = Math.round(clamp(50 + (rawScore - 50) * (0.78 + 0.22 * reliability), 0, 100));
  return {
    pattern,
    score,
    rawScore: Math.round(rawScore),
    reliability: Math.round(reliability * 100),
    signalCoverage: Math.round(signalCoverage * 100),
    breakdown,
  };
}

function validPastNightCount(participant, selectedIndex) {
  return participant.days.slice(0, Math.max(0, selectedIndex)).filter((day) => day.valid).length;
}

export function deriveResonance(participant, selectedIndex) {
  const day = participant?.days?.[selectedIndex];
  if (!day?.valid || !day.profile?.length) {
    return {
      state: "unavailable",
      day,
      title: "No Resonance for this Sleep Day",
      summary: "A complete primary-sleep record is required before this night can be compared with your Rhythm.",
    };
  }
  const pastNightCount = validPastNightCount(participant, selectedIndex);
  if (selectedIndex < 1) {
    return {
      state: "learning",
      day,
      pastNightCount,
      title: "DUVA is learning your Rhythm",
      summary: "We need more nights of sleep data to form your first Pattern.",
    };
  }
  const referenceWindow = deriveWindow(participant, selectedIndex - 1);
  const patterns = referenceWindow.visiblePatterns || [];
  if (!patterns.length) {
    return {
      state: "learning",
      day,
      pastNightCount,
      referenceWindow,
      title: "DUVA is learning your Rhythm",
      summary: "We need more nights of sleep data to form your first Pattern.",
    };
  }

  const ranked = patterns.map((pattern) => fitNightToPattern(day, pattern)).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];
  const margin = second ? best.score - second.score : 100;
  const shared = best.score >= 58;
  const mixed = shared && second?.score >= 58 && margin < 6;
  const state = mixed ? "mixed" : shared ? "matched" : "different";
  const stateLabel = mixed
    ? "Between two patterns"
    : best.score >= 82
      ? "Close match"
      : best.score >= 70
        ? "Familiar shape"
        : best.score >= 58
          ? "Some shared terrain"
          : "This night was different";
  const patternLabel = mixed ? `${best.pattern.name} + ${second.pattern.name}` : best.pattern.name;
  const confidence = Math.round(
    best.pattern.confidence * 0.6
    + best.reliability * 0.25
    + clamp(day.quality ?? 0.8) * 100 * 0.15,
  );
  return {
    state,
    day,
    score: best.score,
    stateLabel,
    pattern: best.pattern,
    secondaryPattern: mixed ? second.pattern : null,
    patternLabel,
    nearestPattern: best.pattern,
    ranked,
    margin,
    confidence,
    pastNightCount,
    referenceWindow,
    title: state === "different" ? "This night was different" : stateLabel,
    summary: mixed
      ? `This Sleep Day shared features with both ${best.pattern.name} and ${second.pattern.name}; neither fit was clearly stronger.`
      : explainFit(best.breakdown, best.pattern.name, state),
    evidenceCount: best.pattern.includedDays.length,
    breakdown: best.breakdown,
    signalCoverage: best.signalCoverage,
  };
}

