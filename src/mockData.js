const DAY = 86_400_000;

function mulberry32(seed) {
  return function random() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function gaussian(random) {
  const u = Math.max(random(), 1e-7);
  const v = Math.max(random(), 1e-7);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function toIso(date) {
  return date.toISOString().slice(0, 10);
}

export function fromIso(value) {
  return new Date(`${value}T12:00:00Z`);
}

export function addDays(value, amount) {
  const date = typeof value === "string" ? fromIso(value) : value;
  return new Date(date.getTime() + amount * DAY);
}

export function formatDate(value, options = {}) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...options,
    timeZone: "UTC",
  }).format(typeof value === "string" ? fromIso(value) : value);
}

export function formatLongDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(typeof value === "string" ? fromIso(value) : value);
}

export function formatClock(hour) {
  let normalized = ((hour % 24) + 24) % 24;
  let whole = Math.floor(normalized);
  let minutes = Math.round((normalized - whole) * 60);
  if (minutes === 60) {
    minutes = 0;
    whole = (whole + 1) % 24;
  }
  const suffix = whole >= 12 ? "PM" : "AM";
  const display = whole % 12 || 12;
  return `${display}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

export function formatDuration(hours) {
  const totalMinutes = Math.round(hours * 60);
  return `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, "0")}m`;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function finiteMetric(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function earlyProbability(participantIndex, dayIndex) {
  if (participantIndex === 0) {
    if (dayIndex < 42) return 0.2;
    if (dayIndex < 92) return 0.82;
    return 0.64 + Math.sin(dayIndex / 11) * 0.08;
  }
  const base = 0.42 + ((participantIndex * 17) % 31) / 100;
  const wave = Math.sin(dayIndex / (13 + (participantIndex % 5)) + participantIndex) * 0.2;
  const shift = dayIndex > 82 ? ((participantIndex % 3) - 1) * 0.1 : 0;
  return clamp(base + wave + shift, 0.12, 0.9);
}

function makeDepthProfile(random, later) {
  return Array.from({ length: 29 }, (_, index) => {
    const progress = index / 28;
    const earlyDeep = 1.2 * Math.exp(-Math.pow((progress - 0.2) / 0.18, 2));
    const secondDeep = 0.72 * Math.exp(-Math.pow((progress - 0.52) / 0.13, 2));
    const remWave = 0.32 * Math.sin(progress * Math.PI * 7 + (later ? 0.45 : 0));
    const wakeRise = progress > 0.78 ? (progress - 0.78) * 3.2 : 0;
    return clamp(1.42 + earlyDeep + secondDeep + remWave - wakeRise + gaussian(random) * 0.1, 0.12, 3);
  });
}

function makeParticipant(index) {
  const random = mulberry32(4_100 + index * 7919);
  const start = new Date("2025-11-01T12:00:00Z");
  const days = [];
  for (let dayIndex = 0; dayIndex < 181; dayIndex += 1) {
    const date = addDays(start, dayIndex);
    const early = random() < earlyProbability(index, dayIndex);
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
    const laterBias = weekend ? 0.2 : 0;
    const bed = (early ? 23.82 : 24.78) + laterBias + gaussian(random) * (early ? 0.24 : 0.32);
    const duration = (early ? 7.35 : 8.02) + gaussian(random) * 0.28;
    const wake = bed + duration + 0.35 + gaussian(random) * 0.12;
    const nap = !early && random() < 0.34;
    const valid = random() > 0.085;
    const light = clamp((early ? 0.6 : 0.59) + gaussian(random) * 0.018, 0.5, 0.68);
    const deep = clamp((early ? 0.155 : 0.145) + gaussian(random) * 0.014, 0.1, 0.2);
    const rem = clamp(1 - light - deep, 0.18, 0.3);
    days.push({
      id: `p${String(index + 1).padStart(2, "0")}-${toIso(date)}`,
      date: toIso(date),
      valid,
      early,
      bed,
      wake,
      duration,
      timeInBed: wake - bed,
      nap,
      napStart: nap ? 13.45 + gaussian(random) * 0.32 : null,
      napDuration: nap ? clamp(0.42 + gaussian(random) * 0.11, 0.2, 0.8) : 0,
      stages: { deep, light, rem },
      profile: makeDepthProfile(random, !early),
      quality: clamp(0.84 + gaussian(random) * 0.09, 0.45, 1),
    });
  }
  const missing = days.filter((day) => !day.valid).length;
  return {
    id: `p${String(index + 1).padStart(2, "0")}`,
    label: `Participant ${String(index + 1).padStart(2, "0")}`,
    cohort: index < 6 ? "High activity" : index < 11 ? "Mixed activity" : "Recovery focus",
    coverage: Math.round(((days.length - missing) / days.length) * 100),
    days,
  };
}

export const participants = Array.from({ length: 16 }, (_, index) => makeParticipant(index));

function additionalSleepSignal(days) {
  const daysWithAdditionalSleep = days.filter((day) => day.nap);
  const weekCount = new Set(daysWithAdditionalSleep.map((day) => {
    const value = fromIso(day.date);
    value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
    return toIso(value);
  })).size;
  const count = daysWithAdditionalSleep.length;
  const share = count / Math.max(1, days.length);
  const definingCountFloor = Math.max(3, Math.ceil(days.length * 0.2));
  return {
    count,
    share,
    weekCount,
    candidateEligible: count >= 3 && share >= 0.1 && weekCount >= 2,
    defining: count >= definingCountFloor && share >= 0.2 && weekCount >= 2,
  };
}

function physiologyScale(days, key, floor) {
  const values = days.map((day) => finiteMetric(day.physiology?.[key])).filter((value) => value != null);
  const minimumCoverage = Math.max(6, Math.ceil(days.length * 0.5));
  if (values.length < minimumCoverage) return null;
  return {
    center: median(values),
    scale: Math.max(floor, (quantile(values, 0.8) - quantile(values, 0.2)) / 1.28),
    coverage: values.length / Math.max(1, days.length),
  };
}

function makeFeatureContext(days) {
  return {
    includeAdditionalSleep: additionalSleepSignal(days).candidateEligible,
    physiology: {
      sleepMedianBpm: physiologyScale(days, "sleepMedianBpm", 3),
      sleepLowBpm: physiologyScale(days, "sleepLowBpm", 3),
      heartRateSettlingMinutes: physiologyScale(days, "heartRateSettlingMinutes", 8),
      restingBpm: physiologyScale(days, "restingBpm", 2.5),
    },
    sleepStructure: {
      first90DisruptionEvents: metricScale(days, (day) => day.sleepStructure?.first90DisruptionEvents, 2),
    },
  };
}

function metricScale(days, accessor, floor) {
  const values = days.map(accessor).map(finiteMetric).filter((value) => value != null);
  const minimumCoverage = Math.max(6, Math.ceil(days.length * 0.5));
  if (values.length < minimumCoverage) return null;
  return {
    center: median(values),
    scale: Math.max(floor, (quantile(values, 0.8) - quantile(values, 0.2)) / 1.28),
    coverage: values.length / Math.max(1, days.length),
  };
}

function physiologyFeature(day, context, key, weight) {
  const scale = context.physiology[key];
  const value = finiteMetric(day.physiology?.[key]);
  if (!scale || value == null) return 0;
  return clamp((value - scale.center) / scale.scale, -2.5, 2.5) * weight;
}

function structureFeature(day, context, key, weight) {
  const scale = context.sleepStructure[key];
  const value = finiteMetric(day.sleepStructure?.[key]);
  if (!scale || value == null) return 0;
  return clamp((value - scale.center) / scale.scale, -2.5, 2.5) * weight;
}

function feature(day, context) {
  return [
    (day.bed - 24.3) / 1.35,
    (day.wake - 32) / 1.7,
    (day.duration - 7.6) / 1.2,
    context.includeAdditionalSleep && day.nap ? 0.8 : 0,
    physiologyFeature(day, context, "sleepMedianBpm", 0.45),
    physiologyFeature(day, context, "sleepLowBpm", 0.3),
    physiologyFeature(day, context, "heartRateSettlingMinutes", 0.35),
    physiologyFeature(day, context, "restingBpm", 0.35),
    structureFeature(day, context, "first90DisruptionEvents", 0.28),
  ];
}

function distance(a, b) {
  return Math.sqrt(a.reduce((sum, value, index) => sum + Math.pow(value - b[index], 2), 0));
}

function centroid(days, context) {
  const features = days.map((day) => feature(day, context));
  return features[0].map((_, index) => features.reduce((sum, row) => sum + row[index], 0) / features.length);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  return sorted[base + 1] === undefined
    ? sorted[base]
    : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function seedFromDays(days, salt = 0) {
  return days.reduce((seed, day) => {
    for (const character of day.date) seed = Math.imul(seed ^ character.charCodeAt(0), 16_777_619);
    return seed >>> 0;
  }, (2_166_136_261 ^ salt) >>> 0);
}

function shuffledIndices(length, random) {
  const values = Array.from({ length }, (_, index) => index);
  for (let index = values.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [values[index], values[target]] = [values[target], values[index]];
  }
  return values;
}

function fitKMeans(days, k, context, seed) {
  const rows = days.map((day) => feature(day, context));
  if (k === 1) return { groups: [days], labels: rows.map(() => 0), centers: [centroid(days, context)], sse: rows.reduce((sum, row) => sum + distance(row, centroid(days, context)) ** 2, 0) };
  const random = mulberry32(seed);
  const centers = [[...rows[Math.floor(random() * rows.length)]]];
  while (centers.length < k) {
    const weights = rows.map((row) => Math.min(...centers.map((center) => distance(row, center))) ** 2);
    const total = weights.reduce((sum, value) => sum + value, 0);
    let target = random() * total;
    let selected = rows.length - 1;
    for (let index = 0; index < weights.length; index += 1) {
      target -= weights[index];
      if (target <= 0) { selected = index; break; }
    }
    centers.push([...rows[selected]]);
  }

  let labels = rows.map(() => -1);
  for (let iteration = 0; iteration < 35; iteration += 1) {
    const nextLabels = rows.map((row) => {
      let selected = 0;
      let nearest = Number.POSITIVE_INFINITY;
      centers.forEach((center, index) => {
        const value = distance(row, center);
        if (value < nearest) { nearest = value; selected = index; }
      });
      return selected;
    });
    const groups = Array.from({ length: k }, () => []);
    nextLabels.forEach((label, index) => groups[label].push(index));
    groups.forEach((group, index) => {
      if (group.length) {
        centers[index] = rows[0].map((_, column) => group.reduce((sum, row) => sum + rows[row][column], 0) / group.length);
      } else {
        const replacement = rows
          .map((row, rowIndex) => ({ rowIndex, gap: Math.min(...centers.map((center) => distance(row, center))) }))
          .sort((left, right) => right.gap - left.gap)[0].rowIndex;
        centers[index] = [...rows[replacement]];
        nextLabels[replacement] = index;
      }
    });
    const unchanged = nextLabels.every((label, index) => label === labels[index]);
    labels = nextLabels;
    if (unchanged) break;
  }
  const groups = Array.from({ length: k }, () => []);
  labels.forEach((label, index) => groups[label].push(days[index]));
  const sse = rows.reduce((sum, row, index) => sum + distance(row, centers[labels[index]]) ** 2, 0);
  return { groups, labels, centers, sse };
}

function bestKMeans(days, k, context, salt = 0, restarts = 10) {
  let best = null;
  const seed = seedFromDays(days, k * 7_919 + salt);
  for (let restart = 0; restart < restarts; restart += 1) {
    const result = fitKMeans(days, k, context, seed + restart * 104_729);
    if (result.groups.every((group) => group.length) && (!best || result.sse < best.sse)) best = result;
  }
  return best;
}

function silhouetteScore(days, model, context) {
  const rows = days.map((day) => feature(day, context));
  return rows.reduce((total, row, index) => {
    const own = rows.filter((_, other) => other !== index && model.labels[other] === model.labels[index]);
    if (!own.length) return total;
    const within = own.reduce((sum, other) => sum + distance(row, other), 0) / own.length;
    let nearest = Number.POSITIVE_INFINITY;
    for (let group = 0; group < model.groups.length; group += 1) {
      if (group === model.labels[index]) continue;
      const other = rows.filter((_, otherIndex) => model.labels[otherIndex] === group);
      if (other.length) nearest = Math.min(nearest, other.reduce((sum, item) => sum + distance(row, item), 0) / other.length);
    }
    return total + (nearest - within) / Math.max(nearest, within);
  }, 0) / rows.length;
}

function combination2(value) {
  return value * (value - 1) / 2;
}

function adjustedRandIndex(left, right) {
  const leftGroups = [...new Set(left)];
  const rightGroups = [...new Set(right)];
  const cells = leftGroups.flatMap((leftLabel) => rightGroups.map((rightLabel) => left.reduce(
    (total, value, index) => total + Number(value === leftLabel && right[index] === rightLabel),
    0,
  )));
  const joined = cells.reduce((sum, value) => sum + combination2(value), 0);
  const leftSum = leftGroups.reduce((sum, label) => sum + combination2(left.filter((value) => value === label).length), 0);
  const rightSum = rightGroups.reduce((sum, label) => sum + combination2(right.filter((value) => value === label).length), 0);
  const all = combination2(left.length);
  const expected = all ? leftSum * rightSum / all : 0;
  const maximum = (leftSum + rightSum) / 2;
  return maximum === expected ? 1 : (joined - expected) / (maximum - expected);
}

function bootstrapStability(days, model, k, context) {
  const random = mulberry32(seedFromDays(days, k * 65_537));
  const scores = [];
  for (let trial = 0; trial < 7; trial += 1) {
    const indices = shuffledIndices(days.length, random)
      .slice(0, Math.max(k * 4, Math.floor(days.length * 0.8)))
      .sort((left, right) => left - right);
    const sample = indices.map((index) => days[index]);
    const fitted = bestKMeans(sample, k, context, trial * 313, 5);
    if (!fitted) continue;
    const predicted = indices.map((index) => {
      const row = feature(days[index], context);
      let selected = 0;
      let nearest = Number.POSITIVE_INFINITY;
      fitted.centers.forEach((center, centerIndex) => {
        const value = distance(row, center);
        if (value < nearest) { nearest = value; selected = centerIndex; }
      });
      return selected;
    });
    scores.push(adjustedRandIndex(indices.map((index) => model.labels[index]), predicted));
  }
  return scores.length ? median(scores) : 0;
}

function proposeClusters(days, context) {
  if (!days.length) return { clusters: [], selectedK: 0, diagnostics: [] };
  const maximum = Math.min(4, Math.floor(days.length / 4));
  const models = { 1: bestKMeans(days, 1, context, 0, 1) };
  const diagnostics = [{ k: 1, accepted: true, silhouette: 0, improvement: 0, stability: 1, sizes: [days.length] }];
  let selectedK = 1;
  for (let k = 2; k <= maximum; k += 1) {
    const model = bestKMeans(days, k, context);
    models[k] = model;
    if (!model) continue;
    const sizes = model.groups.map((group) => group.length);
    const silhouette = silhouetteScore(days, model, context);
    const improvement = (models[k - 1].sse - model.sse) / Math.max(models[k - 1].sse, 1e-6);
    const stability = bootstrapStability(days, model, k, context);
    const silhouetteFloor = k === 2 ? 0.28 : k === 3 ? 0.3 : 0.32;
    const improvementFloor = k === 2 ? 0.18 : k === 3 ? 0.15 : 0.12;
    const stabilityFloor = k === 2 ? 0.72 : k === 3 ? 0.75 : 0.78;
    const accepted = Math.min(...sizes) >= 4
      && silhouette >= silhouetteFloor
      && improvement >= improvementFloor
      && stability >= stabilityFloor;
    diagnostics.push({ k, accepted, silhouette, improvement, stability, sizes });
    if (accepted) selectedK = k;
  }
  return { clusters: models[selectedK].groups, selectedK, diagnostics, stability: diagnostics.find((item) => item.k === selectedK)?.stability ?? 1 };
}

function robustCenter(days, context) {
  const rows = days.map((day) => feature(day, context));
  return rows[0].map((_, column) => median(rows.map((row) => row[column])));
}

function refinePatternMembership(days, proposedClusters, context) {
  if (!days.length || !proposedClusters.length) {
    return { clusters: [], unassignedDays: [], boundaryDays: [], diagnostics: [] };
  }
  const centers = proposedClusters.map((cluster) => robustCenter(cluster, context));
  const nearestRows = days.map((day) => {
    const row = feature(day, context);
    const ranked = centers
      .map((center, index) => ({ index, distance: distance(row, center) }))
      .sort((left, right) => left.distance - right.distance);
    const nearest = ranked[0];
    const second = ranked[1];
    const clarity = second ? (second.distance - nearest.distance) / Math.max(second.distance, 1e-6) : 1;
    return { day, clusterIndex: nearest.index, distance: nearest.distance, clarity };
  });
  const diagnostics = centers.map((_, clusterIndex) => {
    const assignedDistances = nearestRows
      .filter((item) => item.clusterIndex === clusterIndex)
      .map((item) => item.distance);
    const typical = median(assignedDistances);
    const mad = median(assignedDistances.map((value) => Math.abs(value - typical)));
    const coreLimit = Math.max(0.62, quantile(assignedDistances, 0.8), typical + Math.max(0.08, mad) * 2.2);
    const boundaryLimit = Math.max(0.92, quantile(assignedDistances, 0.92), typical + Math.max(0.08, mad) * 4, coreLimit * 1.35);
    return { clusterIndex, typical, mad, coreLimit, boundaryLimit };
  });
  const clusters = centers.map(() => []);
  const unassignedDays = [];
  const boundaryDays = [];
  nearestRows.forEach((item) => {
    const limits = diagnostics[item.clusterIndex];
    const core = item.distance <= limits.coreLimit && item.clarity >= 0.12;
    const boundary = !core && item.distance <= limits.boundaryLimit && item.clarity >= 0.03;
    if (!core && !boundary) {
      unassignedDays.push({
        ...item.day,
        patternMembership: "unassigned",
        patternMembershipWeight: 0,
        patternDistance: item.distance,
        patternClarity: item.clarity,
      });
      return;
    }
    const membershipWeight = core
      ? 1
      : clamp(0.65 - (item.distance / Math.max(limits.boundaryLimit, 1e-6)) * 0.22, 0.35, 0.65);
    const annotated = {
      ...item.day,
      patternMembership: core ? "core" : "boundary",
      patternMembershipWeight: membershipWeight,
      patternDistance: item.distance,
      patternClarity: item.clarity,
    };
    clusters[item.clusterIndex].push(annotated);
    if (boundary) boundaryDays.push(annotated);
  });
  return { clusters, unassignedDays, boundaryDays, diagnostics };
}

function robustSpread(days, center, context) {
  const distances = days.map((day) => distance(feature(day, context), center));
  return { median: median(distances), p80: quantile(distances, 0.8) };
}

function emergenceForCluster(cluster, allClusters, windowDays, windowStart, windowEnd, featureContext) {
  const coreDays = cluster.filter((day) => day.patternMembership === "core");
  const shapeDays = coreDays.length >= 2 ? coreDays : cluster;
  const center = centroid(shapeDays, featureContext);
  const memberships = cluster.map((day) => day.quality * (day.patternMembershipWeight ?? 1));
  const sum = memberships.reduce((total, value) => total + value, 0);
  const kish = (sum * sum) / Math.max(1e-6, memberships.reduce((total, value) => total + value * value, 0));
  const nEff = Math.min(kish, sum);
  const support = 1 - Math.exp(-nEff / 5);

  const availableSpan = Math.max(1, Math.round((fromIso(windowEnd) - fromIso(windowStart)) / DAY) + 1);
  const observedWeeks = Math.max(1, Math.ceil(availableSpan / 7));
  const occupiedWeeks = new Map();
  cluster.forEach((day) => {
    const week = Math.floor((fromIso(day.date) - fromIso(windowStart)) / DAY / 7);
    occupiedWeeks.set(week, Math.max(occupiedWeeks.get(week) || 0, day.patternMembershipWeight ?? 1));
  });
  const weekCoverage = [...occupiedWeeks.values()].reduce((total, value) => total + value, 0) / observedWeeks;
  const recurrenceEvidence = 0.52 + 0.48 * clamp((observedWeeks - 1) / 4);
  const recurrence = clamp(weekCoverage * recurrenceEvidence, 0.05, 1);

  const spread = robustSpread(shapeDays, center, featureContext);
  const compactness = clamp(Math.exp(-(spread.median * 0.72 + spread.p80 * 0.32)), 0.05, 1);

  const otherCenters = allClusters
    .filter((item) => item !== cluster && item.length >= 3)
    .map((item) => {
      const core = item.filter((day) => day.patternMembership === "core");
      return centroid(core.length >= 2 ? core : item, featureContext);
    });
  const nearest = otherCenters.length ? Math.min(...otherCenters.map((item) => distance(center, item))) : 1.05;
  const separation = clamp(nearest / (nearest + spread.p80 + 0.08), 0.05, 1);

  const ordered = [...shapeDays].sort((a, b) => a.date.localeCompare(b.date));
  const half = Math.max(2, Math.floor(ordered.length / 2));
  const first = ordered.slice(0, half);
  const last = ordered.slice(-half);
  const structural = first.length >= 2 && last.length >= 2
    ? Math.exp(-distance(centroid(first, featureContext), centroid(last, featureContext)) * 0.65)
    : 0.72;
  const stabilityEvidence = 0.52 + 0.48 * clamp(observedWeeks / 4);
  const temporalStability = clamp(structural * stabilityEvidence, 0.05, 1);

  const recentBoundary = toIso(addDays(windowEnd, -13));
  const recent = cluster
    .filter((day) => day.date >= recentBoundary)
    .reduce((total, day) => total + (day.patternMembershipWeight ?? 1), 0);
  const prior = cluster
    .filter((day) => day.date < recentBoundary)
    .reduce((total, day) => total + (day.patternMembershipWeight ?? 1), 0);
  const expectedRecent = Math.max(2, prior / Math.max(1, observedWeeks - 2) * 2);
  const recentContinuity = clamp((recent / expectedRecent) * (0.75 + compactness * 0.25), 0.05, 1);

  const dimensions = {
    support,
    recurrence,
    compactness,
    separation,
    temporalStability,
    recentContinuity,
  };
  const weights = {
    support: 0.2,
    recurrence: 0.2,
    compactness: 0.2,
    separation: 0.2,
    temporalStability: 0.1,
    recentContinuity: 0.1,
  };
  const emergence = 100 * Math.exp(
    Object.entries(weights).reduce(
      (total, [key, weight]) => total + weight * Math.log(Math.max(dimensions[key], 0.05)),
      0,
    ),
  );
  const validCoverage = windowDays.filter((day) => day.valid).length / windowDays.length;
  const historyConfidence = 0.46 + 0.38 * clamp(observedWeeks / 6) + 0.16 * validCoverage;
  const modelStability = featureContext.modelStability ?? 1;
  const confidence = clamp(historyConfidence * (0.7 + 0.3 * compactness) * (0.72 + 0.28 * modelStability), 0.05, 1);
  return {
    emergence,
    confidence,
    nEff,
    dimensions,
    center,
    spread,
    physiologyFeaturesUsed: Object.entries(featureContext.physiology).filter(([, value]) => value).map(([key]) => key),
    sleepStructureFeaturesUsed: Object.entries(featureContext.sleepStructure).filter(([, value]) => value).map(([key]) => key),
    modelStability,
    shapeDays,
  };
}

function rangeLabel(values, formatter, padding = 0) {
  return `${formatter(quantile(values, 0.2) - padding)}–${formatter(quantile(values, 0.8) + padding)}`;
}

function physiologyMetric(cluster, key) {
  const values = cluster.map((day) => finiteMetric(day.physiology?.[key])).filter((value) => value != null);
  if (!values.length) return { count: 0, low: null, typical: null, high: null };
  return {
    count: values.length,
    low: Math.round(quantile(values, 0.2) * 10) / 10,
    typical: Math.round(quantile(values, 0.5) * 10) / 10,
    high: Math.round(quantile(values, 0.8) * 10) / 10,
  };
}

function patternIdentity(cluster, clusters, index) {
  const count = clusters.length;
  const duration = median(cluster.map((day) => day.duration));
  const overallDuration = median(clusters.flat().map((day) => day.duration));
  const durationWord = duration >= overallDuration + 0.18 ? "longer" : duration <= overallDuration - 0.18 ? "shorter" : "steady-length";
  if (count === 1) {
    const earlier = median(cluster.map((day) => day.bed)) < 24.35;
    return {
      id: earlier ? "earlier-sleep" : "later-longer-sleep",
      name: earlier ? "Earlier sleep" : "Later sleep",
      color: earlier ? "mint" : "violet",
      timing: earlier ? "earlier" : "later",
      definitionTitle: earlier ? "An earlier place in the Sleep Day" : "A later place in the Sleep Day",
    };
  }
  if (index === 0) return { id: "earlier-sleep", name: "Earlier sleep", color: "mint", timing: "earlier", definitionTitle: "The earliest place in this Rhythm" };
  if (index === count - 1) return { id: "later-longer-sleep", name: durationWord === "longer" ? "Later, longer sleep" : "Later sleep", color: count === 4 ? "amber" : "violet", timing: "later", definitionTitle: "The latest place in this Rhythm" };
  const middleName = `${index === 1 ? "Middle-timed" : "Later-middle"}${durationWord === "steady-length" ? " sleep" : `, ${durationWord} sleep`}`;
  return {
    id: `middle-sleep-${index}`,
    name: middleName,
    color: index === 1 ? "aqua" : "violet",
    timing: "middle",
    definitionTitle: "A distinct middle-timed place in this Rhythm",
  };
}

function makePattern(cluster, stats, order, identity) {
  const coreDays = cluster.filter((day) => day.patternMembership === "core");
  const boundaryDays = cluster.filter((day) => day.patternMembership === "boundary");
  const shapeDays = stats.shapeDays?.length ? stats.shapeDays : coreDays.length ? coreDays : cluster;
  const bed = shapeDays.map((day) => day.bed);
  const wake = shapeDays.map((day) => day.wake);
  const duration = shapeDays.map((day) => day.duration);
  const additionalSleep = additionalSleepSignal(shapeDays);
  const napCount = additionalSleep.count;
  const earlier = identity.timing === "earlier";
  const timingPhrase = identity.timing === "earlier"
    ? "Primary sleep settles earlier"
    : identity.timing === "middle"
      ? "Primary sleep occupies a distinct middle-timed range"
      : "Primary sleep shifts later";
  const emergence = Math.round(stats.emergence);
  const status = emergence >= 70 ? "Clearly emerged" : emergence >= 55 ? "Taking shape" : "Candidate";
  return {
    id: identity.id,
    name: identity.name,
    color: identity.color,
    definitionTitle: identity.definitionTitle,
    description: additionalSleep.defining
      ? `${timingPhrase}; additional sleep also repeats across this shape.`
      : `${timingPhrase} with a repeatable sleep-duration and physiological shape.`,
    emergence,
    status,
    confidence: Math.round(stats.confidence * 100),
    nEff: stats.nEff,
    includedDays: [...coreDays].sort((a, b) => b.date.localeCompare(a.date)),
    boundaryDays: [...boundaryDays].sort((a, b) => b.date.localeCompare(a.date)),
    evidenceDays: [...cluster].sort((a, b) => b.date.localeCompare(a.date)),
    sleepStartRange: rangeLabel(bed, formatClock, 0.03),
    wakeRange: rangeLabel(wake, formatClock, 0.03),
    durationRange: rangeLabel(duration, formatDuration, 0),
    startLow: quantile(bed, 0.2),
    startHigh: quantile(bed, 0.8),
    wakeLow: quantile(wake, 0.2),
    wakeHigh: quantile(wake, 0.8),
    durationLow: quantile(duration, 0.2),
    durationHigh: quantile(duration, 0.8),
    napCount,
    napShare: additionalSleep.share,
    napWeekCount: additionalSleep.weekCount,
    additionalSleepDefinesPattern: additionalSleep.defining,
    physiology: {
      sleepMedianBpm: physiologyMetric(shapeDays, "sleepMedianBpm"),
      sleepLowBpm: physiologyMetric(shapeDays, "sleepLowBpm"),
      heartRateSettlingMinutes: physiologyMetric(shapeDays, "heartRateSettlingMinutes"),
      restingBpm: physiologyMetric(shapeDays, "restingBpm"),
      featuresUsed: stats.physiologyFeaturesUsed,
    },
    sleepStructure: {
      first90DisruptionEvents: physiologyMetric(shapeDays.map((day) => ({ physiology: day.sleepStructure })), "first90DisruptionEvents"),
      featuresUsed: stats.sleepStructureFeaturesUsed,
    },
    modelStability: stats.modelStability,
    dimensions: stats.dimensions,
    rank: order,
  };
}

export function deriveWindow(participant, endIndex) {
  const lastIndex = clamp(endIndex, 0, participant.days.length - 1);
  const firstIndex = Math.max(0, lastIndex - 41);
  const windowDays = participant.days.slice(firstIndex, lastIndex + 1);
  const validDays = windowDays.filter((day) => day.valid);
  const featureContext = makeFeatureContext(validDays);
  const proposal = proposeClusters(validDays, featureContext);
  featureContext.modelStability = proposal.stability;
  const membership = refinePatternMembership(validDays, proposal.clusters, featureContext);
  let clusters = membership.clusters.filter((cluster) => cluster.length);
  clusters = clusters.sort((left, right) => median(left.map((day) => day.bed)) - median(right.map((day) => day.bed)));
  const patterns = clusters
    .map((cluster, index) => makePattern(
      cluster,
      emergenceForCluster(cluster, clusters, windowDays, windowDays[0].date, windowDays.at(-1).date, featureContext),
      index,
      patternIdentity(cluster, clusters, index),
    ))
    .sort((a, b) => b.emergence - a.emergence);
  const visiblePatterns = patterns.filter(
    (pattern) => pattern.includedDays.length >= 4 && pattern.nEff >= 4 && pattern.emergence >= 55 && pattern.confidence >= 55,
  );
  return {
    start: windowDays[0].date,
    end: windowDays.at(-1).date,
    availableDays: windowDays.length,
    validDays,
    invalidDays: windowDays.filter((day) => !day.valid),
    patterns,
    visiblePatterns,
    hiddenCandidates: patterns.length - visiblePatterns.length,
    boundaryDays: membership.boundaryDays,
    unassignedDays: membership.unassignedDays,
    variationDays: [...membership.boundaryDays, ...membership.unassignedDays].sort((a, b) => b.date.localeCompare(a.date)),
    clusterModel: {
      selectedK: proposal.selectedK,
      stability: proposal.stability,
      diagnostics: proposal.diagnostics,
      membershipDiagnostics: membership.diagnostics,
    },
    isFullWindow: windowDays.length === 42,
  };
}

export function makeHistory(participant, selectedWindowEnd, maximumPeriods = 3) {
  const selectedEndIndex = typeof selectedWindowEnd === "number"
    ? clamp(selectedWindowEnd, 0, participant.days.length - 1)
    : participant.days.findIndex((day) => day.date === selectedWindowEnd);
  if (selectedEndIndex < 0) return [];
  const history = [];
  for (let period = 1; period <= maximumPeriods; period += 1) {
    const anchor = selectedEndIndex - period * 42;
    if (anchor < 0) break;
    const snapshot = deriveWindow(participant, anchor);
    snapshot.visiblePatterns.forEach((pattern) => {
      history.push({
        ...pattern,
        historyId: `${participant.id}-${snapshot.end}-${pattern.id}`,
        periodStart: snapshot.start,
        periodEnd: snapshot.end,
        referenceWindowEnd: participant.days[selectedEndIndex].date,
        archived: true,
      });
    });
  }
  return history.sort((left, right) => right.periodEnd.localeCompare(left.periodEnd)
    || right.emergence - left.emergence);
}

export function isInferredRestDay(dayOrDate) {
  const value = typeof dayOrDate === "string" ? dayOrDate : dayOrDate?.date;
  if (!value) return false;
  const weekday = new Date(`${value}T12:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

export function isInferredWorkNight(dayOrDate) {
  return !isInferredRestDay(dayOrDate);
}

const ASSOCIATION_DEFINITIONS = [
  {
    id: "before_inferred_rest_day",
    label: "an inferred rest day",
    source: "calendar",
    inferred: true,
    observed: (day) => Boolean(day.date),
    exposed: isInferredRestDay,
    statement: (direction) => `Has appeared ${direction} often before an inferred rest day.`,
  },
  {
    id: "evening_exercise",
    label: "later exercise",
    source: "exercise",
    observed: (day) => day.context?.exercise != null,
    exposed: (day) => Boolean(day.context?.exercise?.eveningExercise),
  },
  {
    id: "high_exercise_load",
    label: "higher exercise load",
    source: "exercise",
    observed: (day) => day.context?.exercise != null,
    exposed: (day) => Boolean(day.context?.exercise?.highLoad),
  },
  {
    id: "dinner_logged",
    label: "a logged dinner or evening meal",
    source: "food",
    observed: (day) => Boolean(day.context?.food?.reported),
    exposed: (day) => (day.context?.food?.meals || []).some((meal) => /dinner|evening/i.test(meal)),
  },
  {
    id: "alcohol_logged",
    label: "logged alcohol",
    source: "food",
    observed: (day) => Boolean(day.context?.food?.reported),
    exposed: (day) => day.context?.food?.alcohol === true,
  },
  {
    id: "lower_hydration",
    label: "lower logged hydration",
    source: "food",
    observed: (day) => Boolean(day.context?.food?.reported && day.context?.food?.fluidGlasses != null),
    exposed: (day) => Number(day.context?.food?.fluidGlasses) < 5,
  },
  {
    id: "higher_stress",
    label: "higher reported stress",
    source: "wellness",
    observed: (day) => Boolean(day.context?.wellness?.reported && day.context?.wellness?.stress != null),
    exposed: (day) => Number(day.context?.wellness?.stress) >= 4,
  },
];

function associationCounts(patternDays, comparisonDays, definition) {
  const a = patternDays.filter(definition.exposed).length;
  const b = patternDays.length - a;
  const c = comparisonDays.filter(definition.exposed).length;
  const d = comparisonDays.length - c;
  return { a, b, c, d };
}

function logOddsFromCounts({ a, b, c, d }) {
  return Math.log(((a + 0.5) * (d + 0.5)) / ((b + 0.5) * (c + 0.5)));
}

function restDayAdjustedEvidence(patternDays, comparisonDays, definition) {
  const comparableStrata = [false, true].map((restDay) => ({
    patternDays: patternDays.filter((day) => isInferredRestDay(day) === restDay),
    comparisonDays: comparisonDays.filter((day) => isInferredRestDay(day) === restDay),
  })).filter((stratum) => stratum.patternDays.length && stratum.comparisonDays.length);

  if (!comparableStrata.length) return null;

  let numerator = 0;
  let denominator = 0;
  const adjustedPatternDays = comparableStrata.flatMap((stratum) => stratum.patternDays);
  const adjustedComparisonDays = comparableStrata.flatMap((stratum) => stratum.comparisonDays);
  for (const stratum of comparableStrata) {
    const { a, b, c, d } = associationCounts(stratum.patternDays, stratum.comparisonDays, definition);
    const total = a + b + c + d + 2;
    numerator += ((a + 0.5) * (d + 0.5)) / total;
    denominator += ((b + 0.5) * (c + 0.5)) / total;
  }

  return {
    patternDays: adjustedPatternDays,
    comparisonDays: adjustedComparisonDays,
    counts: associationCounts(adjustedPatternDays, adjustedComparisonDays, definition),
    logOdds: Math.log(numerator / Math.max(1e-6, denominator)),
  };
}

export function deriveAssociations(pattern, window) {
  if (!pattern) return [];
  const included = new Set(pattern.includedDays.map((day) => day.id));
  return ASSOCIATION_DEFINITIONS.map((definition) => {
    const rawPatternDays = window.validDays.filter((day) => included.has(day.id) && definition.observed(day));
    const rawComparisonDays = window.validDays.filter((day) => !included.has(day.id) && definition.observed(day));
    const rawCounts = associationCounts(rawPatternDays, rawComparisonDays, definition);
    const rawLogOdds = logOddsFromCounts(rawCounts);
    const adjusted = definition.source === "calendar" ? null : restDayAdjustedEvidence(rawPatternDays, rawComparisonDays, definition);
    const patternDays = adjusted?.patternDays || rawPatternDays;
    const comparisonDays = adjusted?.comparisonDays || rawComparisonDays;
    const counts = adjusted?.counts || rawCounts;
    const { a } = counts;
    const logOdds = adjusted?.logOdds ?? rawLogOdds;
    const invertedCalendar = definition.source === "calendar" && logOdds < 0;
    const displayLogOdds = invertedCalendar ? -logOdds : logOdds;
    const displayCounts = invertedCalendar
      ? { a: counts.b, b: counts.a, c: counts.d, d: counts.c }
      : counts;
    const strength = Math.tanh(Math.abs(displayLogOdds) / 2);
    const coverage = patternDays.length / Math.max(1, pattern.includedDays.length);
    const directionalSupport = displayLogOdds >= 0 ? displayCounts.a : displayCounts.b;
    const evidence = (1 - Math.exp(-directionalSupport / 4)) * (1 - Math.exp(-comparisonDays.length / 6));
    const confidence = clamp(coverage * evidence * (0.45 + strength * 0.55));
    return {
      ...definition,
      id: invertedCalendar ? "before_inferred_work_day" : definition.id,
      label: invertedCalendar ? "an inferred work day" : definition.label,
      supportCount: directionalSupport,
      exposedPatternDays: displayCounts.a,
      exposedComparisonDays: displayCounts.c,
      observedPatternDays: patternDays.length,
      comparisonDays: comparisonDays.length,
      logOdds: displayLogOdds,
      rawLogOdds,
      rawSupportCount: rawCounts.a,
      strength,
      confidence,
      direction: displayLogOdds >= 0 ? "more" : "less",
      adjustedFor: definition.source === "calendar" ? null : "inferred_rest_day",
      evidenceSummary: definition.source === "calendar"
        ? `${displayCounts.a} of ${patternDays.length} included nights · ${displayCounts.c} of ${comparisonDays.length} other nights`
        : `${displayCounts.a} included Sleep Days · ${displayCounts.c} comparison Sleep Days`,
      statement: invertedCalendar
        ? "Has appeared more often before an inferred work day."
        : definition.statement
          ? definition.statement(displayLogOdds >= 0 ? "more" : "less")
          : `Has appeared ${displayLogOdds >= 0 ? "more" : "less"} often after ${definition.label}.`,
    };
  })
    .filter((item) => item.supportCount >= 2
      && item.comparisonDays >= 3
      && item.logOdds > 0
      && item.strength >= 0.15
      && item.confidence >= 0.25)
    .sort((a, b) => b.confidence * b.strength - a.confidence * a.strength);
}

function optionalSignalClause(days, windowDays, accessor, label) {
  const values = windowDays.map(accessor).map(finiteMetric).filter((value) => value != null);
  const selected = days.map(accessor).map(finiteMetric).filter((value) => value != null);
  if (values.length < 8 || selected.length < Math.max(3, Math.ceil(days.length * 0.6))) return null;
  return median(selected) >= quantile(values, 0.6) ? label : null;
}

export function deriveSignalInsights(pattern, window) {
  if (!pattern) return [];
  const included = new Set(pattern.includedDays.map((day) => day.id));
  const observed = window.validDays.filter((day) => finiteMetric(day.physiology?.heartRateSettlingMinutes) != null
    && finiteMetric(day.sleepStructure?.first90DisruptionEvents) != null);
  if (observed.length < 10) return [];
  const calendar = deriveAssociations(pattern, window).find((item) => item.source === "calendar");
  const calendarClause = calendar?.id === "before_inferred_work_day"
    ? " This Pattern appeared more often before inferred work days."
    : calendar?.id === "before_inferred_rest_day"
      ? " This Pattern appeared more often before inferred rest days."
      : "";

  const buildInsight = (patternNights, comparisonNights, scope) => {
    if (patternNights.length < 5 || comparisonNights.length < 3) return null;
    const comparisonSettling = comparisonNights.map((day) => day.physiology.heartRateSettlingMinutes);
    const comparisonDisruptions = comparisonNights.map((day) => day.sleepStructure.first90DisruptionEvents);
    const settlingThreshold = Math.min(90, median(comparisonSettling) + 5);
    const disruptionThreshold = median(comparisonDisruptions) + 1;
    const jointSignal = (day) => day.physiology.heartRateSettlingMinutes >= settlingThreshold
      && day.sleepStructure.first90DisruptionEvents >= disruptionThreshold;
    const supportNights = patternNights.filter(jointSignal);
    const comparisonSupport = comparisonNights.filter(jointSignal).length;
    if (supportNights.length < 3) return null;
    const patternShare = supportNights.length / patternNights.length;
    const comparisonShare = comparisonSupport / comparisonNights.length;
    const contrast = patternShare - comparisonShare;
    const confidence = clamp(
      (1 - Math.exp(-supportNights.length / 4))
      * (1 - Math.exp(-comparisonNights.length / 5))
      * (0.58 + clamp(contrast) * 0.42),
    );
    if (patternShare < (scope === "work" ? 0.5 : 0.45) || contrast < 0.15 || confidence < 0.28) return null;

    const positionClause = optionalSignalClause(
      supportNights,
      observed,
      (day) => day.movement?.positionChangeCountFirst90,
      " You also changed position more often during this period.",
    );
    const noiseClause = optionalSignalClause(
      supportNights,
      observed,
      (day) => day.environment?.intermittentNoiseEventsFirst90,
      " These nights also had more intermittent environmental noise.",
    );
    const settlingDifference = Math.round(median(patternNights.map((day) => day.physiology.heartRateSettlingMinutes))
      - median(comparisonSettling));
    const disruptionDifference = Math.round(median(patternNights.map((day) => day.sleepStructure.first90DisruptionEvents))
      - median(comparisonDisruptions));
    if (settlingDifference < 5 || disruptionDifference < 1) return null;
    const scopeLabel = scope === "work" ? "inferred work nights" : "Sleep Days";
    const comparisonLabel = scope === "work" ? "other inferred work nights" : "other recent Sleep Days";
    const patternSettlingMedian = median(patternNights.map((day) => day.physiology.heartRateSettlingMinutes));
    const settlingEvidence = patternSettlingMedian >= 90
      ? `at least ${settlingDifference} min longer above the stable HR band`
      : `${settlingDifference} min later HR settling`;
    const disruptionEvidence = `${disruptionDifference} more early-night disruption ${disruptionDifference === 1 ? "event" : "events"}`;
    return {
      id: `${scope}_night_settling_and_disruption`,
      source: "signals",
      calendarAssociationId: calendar?.id || null,
      statement: `On ${supportNights.length} of ${patternNights.length} ${scopeLabel} in this Pattern, your heart rate settled later and the first 90 minutes contained more brief wake or sleep-stage transition events.${positionClause || ""}${noiseClause || ""}${calendarClause}`,
      evidenceSummary: `${settlingEvidence} · ${disruptionEvidence} · ${comparisonSupport} of ${comparisonNights.length} ${comparisonLabel}`,
      supportCount: supportNights.length,
      observedPatternDays: patternNights.length,
      comparisonDays: comparisonNights.length,
      strength: clamp(contrast / 0.6),
      confidence,
      inferred: scope === "work" || Boolean(calendarClause),
      adjustedFor: scope === "work" ? "inferred_rest_day" : null,
      dataBoundary: !positionClause || !noiseClause
        ? "PMData has no body-position or environmental-noise stream; this observation uses heart rate and Fitbit sleep-stage interruptions only."
        : null,
    };
  };

  const patternWorkNights = observed.filter((day) => included.has(day.id) && isInferredWorkNight(day));
  const comparisonWorkNights = observed.filter((day) => !included.has(day.id) && isInferredWorkNight(day));
  const workInsight = buildInsight(patternWorkNights, comparisonWorkNights, "work");
  if (workInsight) return [workInsight];
  const patternNights = observed.filter((day) => included.has(day.id));
  const comparisonNights = observed.filter((day) => !included.has(day.id));
  const sleepDayInsight = buildInsight(patternNights, comparisonNights, "sleep_day");
  return sleepDayInsight ? [sleepDayInsight] : [];
}
