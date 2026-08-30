import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { deriveAssociations, deriveSignalInsights, deriveWindow, makeHistory } from "../src/mockData.js";
import { deriveResonance, fitNightToPattern, RESONANCE_WEIGHTS } from "../src/resonance.js";

const dataset = JSON.parse(fs.readFileSync(new URL("../public/data/pmdata.json", import.meta.url), "utf8"));

test("Participant 02 states the calendar association through the more-common work-day condition", () => {
  const participant = dataset.participants.find((item) => item.id === "p02");
  const endIndex = participant.days.findIndex((day) => day.date === "2020-02-25");
  const rhythmWindow = deriveWindow(participant, endIndex);
  const pattern = rhythmWindow.visiblePatterns.find((item) => item.id === "earlier-sleep");
  const associations = deriveAssociations(pattern, rhythmWindow);
  const calendar = associations.find((item) => item.id === "before_inferred_work_day");

  assert.ok(calendar.supportCount / pattern.includedDays.length >= 0.9);
  assert.ok(calendar.confidence > 0.8);
  assert.equal(calendar.statement, "Has appeared more often before an inferred work day.");
});

test("Pattern state continues to come from Emergence", () => {
  for (const participant of dataset.participants) {
    const lastIndex = participant.days.findLastIndex((day) => day.valid);
    if (lastIndex < 0) continue;
    const rhythmWindow = deriveWindow(participant, lastIndex);
    for (const pattern of rhythmWindow.patterns) {
      const expected = pattern.emergence >= 70 ? "Clearly emerged" : pattern.emergence >= 55 ? "Taking shape" : "Candidate";
      assert.equal(pattern.status, expected);
    }
  }
});

test("One-off additional sleep remains unassigned variation", () => {
  const participant = dataset.participants.find((item) => item.id === "p02");
  const endIndex = participant.days.findIndex((day) => day.date === "2020-02-25");
  const rhythmWindow = deriveWindow(participant, endIndex);
  const pattern = rhythmWindow.visiblePatterns.find((item) => item.id === "earlier-sleep");

  assert.equal(pattern.napCount, 0);
  assert.equal(pattern.napWeekCount, 0);
  assert.equal(pattern.additionalSleepDefinesPattern, false);
  assert.equal(pattern.description.includes("additional sleep"), false);
  assert.deepEqual(rhythmWindow.unassignedDays.filter((day) => day.nap).map((day) => day.date), ["2020-01-17"]);
});

test("Valid Sleep Days can remain at the boundary or outside every Pattern", () => {
  const participant = dataset.participants.find((item) => item.id === "p02");
  const endIndex = participant.days.findIndex((day) => day.date === "2020-02-25");
  const rhythmWindow = deriveWindow(participant, endIndex);
  const coreDays = rhythmWindow.patterns.flatMap((pattern) => pattern.includedDays);
  const boundaryDays = rhythmWindow.patterns.flatMap((pattern) => pattern.boundaryDays);
  const accounted = [...coreDays, ...boundaryDays, ...rhythmWindow.unassignedDays];

  assert.ok(boundaryDays.length > 0);
  assert.ok(rhythmWindow.unassignedDays.length > 0);
  assert.equal(new Set(accounted.map((day) => day.id)).size, rhythmWindow.validDays.length);
  assert.equal(accounted.length, rhythmWindow.validDays.length);
  assert.ok(coreDays.every((day) => day.patternMembership === "core" && day.patternMembershipWeight === 1));
  assert.ok(boundaryDays.every((day) => day.patternMembership === "boundary" && day.patternMembershipWeight < 1));
  assert.ok(rhythmWindow.unassignedDays.every((day) => day.patternMembership === "unassigned" && day.patternMembershipWeight === 0));
});

test("Night and resting heart-rate features are available to Pattern recognition", () => {
  const participant = dataset.participants.find((item) => item.id === "p02");
  const endIndex = participant.days.findIndex((day) => day.date === "2020-02-25");
  const rhythmWindow = deriveWindow(participant, endIndex);
  const pattern = rhythmWindow.visiblePatterns.find((item) => item.id === "earlier-sleep");

  assert.ok(pattern.physiology.sleepMedianBpm.count >= 6);
  assert.ok(pattern.physiology.sleepLowBpm.count >= 6);
  assert.ok(pattern.physiology.restingBpm.count >= 6);
  assert.ok(pattern.physiology.heartRateSettlingMinutes.count >= 6);
  assert.ok(pattern.sleepStructure.first90DisruptionEvents.count >= 6);
  assert.deepEqual(pattern.physiology.featuresUsed.sort(), ["heartRateSettlingMinutes", "restingBpm", "sleepLowBpm", "sleepMedianBpm"]);
  assert.deepEqual(pattern.sleepStructure.featuresUsed, ["first90DisruptionEvents"]);
});

test("The sampled PMData windows do not predominantly collapse to one visible Pattern", () => {
  const counts = { zero: 0, one: 0, two: 0, three: 0, four: 0 };
  for (const participant of dataset.participants) {
    const lastIndex = participant.days.findLastIndex((day) => day.valid);
    if (lastIndex < 0) continue;
    for (let endIndex = 41; endIndex <= lastIndex; endIndex += 14) {
      const visible = deriveWindow(participant, endIndex).visiblePatterns.length;
      if (visible === 0) counts.zero += 1;
      if (visible === 1) counts.one += 1;
      if (visible === 2) counts.two += 1;
      if (visible === 3) counts.three += 1;
      if (visible === 4) counts.four += 1;
    }
  }
  assert.ok(counts.two + counts.three + counts.four > counts.one, JSON.stringify(counts));
  assert.ok(counts.three > 0, JSON.stringify(counts));
});

test("A publishable work-night insight joins HR settling with early sleep disruption", () => {
  const participant = dataset.participants.find((item) => item.id === "p04");
  const endIndex = participant.days.findIndex((day) => day.date === "2020-01-29");
  const rhythmWindow = deriveWindow(participant, endIndex);
  const pattern = rhythmWindow.visiblePatterns.find((item) => item.id === "middle-sleep-1");
  const insight = deriveSignalInsights(pattern, rhythmWindow)[0];

  assert.ok(insight.statement.includes("inferred work nights"));
  assert.ok(insight.statement.includes("heart rate settled later"));
  assert.ok(insight.statement.includes("sleep-stage transition events"));
  assert.ok(insight.evidenceSummary.includes("other inferred work nights"));
  assert.ok(insight.dataBoundary.includes("no body-position or environmental-noise stream"));
});

test("Calendar associations always lead with the condition where the Pattern appears more often", () => {
  for (const participant of dataset.participants) {
    const lastIndex = participant.days.findLastIndex((day) => day.valid);
    if (lastIndex < 0) continue;
    const rhythmWindow = deriveWindow(participant, lastIndex);
    for (const pattern of rhythmWindow.visiblePatterns) {
      const calendar = deriveAssociations(pattern, rhythmWindow).find((item) => item.source === "calendar");
      if (calendar) assert.ok(calendar.statement.includes("more often"), calendar.statement);
    }
  }
});

test("Rhythm history follows the selected window end date", () => {
  const participant = dataset.participants.find((item) => item.id === "p02");
  const earlierEnd = "2020-01-28";
  const laterEnd = "2020-02-25";
  const earlierHistory = makeHistory(participant, earlierEnd);
  const laterHistory = makeHistory(participant, laterEnd);
  const laterIndex = participant.days.findIndex((day) => day.date === laterEnd);
  const selectedWindow = deriveWindow(participant, laterIndex);

  assert.ok(earlierHistory.length > 0);
  assert.ok(laterHistory.length > 0);
  assert.notDeepEqual(
    earlierHistory.map((pattern) => pattern.historyId),
    laterHistory.map((pattern) => pattern.historyId),
  );
  assert.ok(laterHistory.every((pattern) => pattern.periodEnd < selectedWindow.start));
  for (const pattern of laterHistory) {
    const anchor = participant.days.findIndex((day) => day.date === pattern.periodEnd);
    const source = deriveWindow(participant, anchor).visiblePatterns.find((item) => item.id === pattern.id);
    assert.ok(source);
    assert.equal(pattern.emergence, source.emergence);
    assert.equal(pattern.status, source.status);
  }
});

test("Resonance holds the current Sleep Day out of its Pattern reference", () => {
  const participant = dataset.participants.find((item) => item.id === "p01");
  const selectedIndex = participant.days.findIndex((day) => day.date === "2020-02-01");
  const resonance = deriveResonance(participant, selectedIndex);

  assert.equal(resonance.state, "matched");
  assert.equal(resonance.referenceWindow.end, participant.days[selectedIndex - 1].date);
  assert.ok(resonance.pattern.includedDays.every((day) => day.date < resonance.day.date));
  assert.ok(resonance.score >= 58 && resonance.score <= 100);
});

test("Resonance exposes all available fit dimensions and reweights missing physiology", () => {
  const participant = dataset.participants.find((item) => item.id === "p01");
  const selectedIndex = participant.days.findIndex((day) => day.date === "2020-02-01");
  const resonance = deriveResonance(participant, selectedIndex);
  const complete = fitNightToPattern(resonance.day, resonance.pattern);
  const withoutPhysiology = fitNightToPattern({ ...resonance.day, physiology: {} }, resonance.pattern);

  assert.deepEqual(Object.keys(complete.breakdown), Object.keys(RESONANCE_WEIGHTS));
  assert.ok(Number.isFinite(complete.breakdown.physiology));
  assert.equal(withoutPhysiology.breakdown.physiology, null);
  assert.ok(withoutPhysiology.signalCoverage < complete.signalCoverage);
  assert.ok(Number.isFinite(withoutPhysiology.score));
});

test("Resonance distinguishes mixed, different and still-learning nights", () => {
  const participant = dataset.participants.find((item) => item.id === "p01");
  const mixedIndex = participant.days.findIndex((day) => day.date === "2019-12-23");
  const differentIndex = participant.days.findIndex((day) => day.date === "2020-02-15");
  const firstValidIndex = participant.days.findIndex((day) => day.valid);
  const mixed = deriveResonance(participant, mixedIndex);
  const different = deriveResonance(participant, differentIndex);
  const learning = deriveResonance(participant, firstValidIndex);

  assert.equal(mixed.state, "mixed");
  assert.ok(mixed.secondaryPattern);
  assert.ok(mixed.margin < 6);
  assert.equal(different.state, "different");
  assert.equal(different.stateLabel, "This night was different");
  assert.ok(different.score < 58);
  assert.equal(learning.state, "learning");
  assert.ok(learning.summary.includes("more nights"));
});
