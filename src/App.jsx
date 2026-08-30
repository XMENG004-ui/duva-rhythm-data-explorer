import { useEffect, useMemo, useRef, useState } from "react";
import {
  deriveAssociations,
  deriveSignalInsights,
  deriveWindow,
  formatClock,
  formatDate,
  formatDuration,
  formatLongDate,
  isInferredRestDay,
  makeHistory,
  participants as mockParticipants,
  quantile,
} from "./mockData.js";
import { deriveResonance, RESONANCE_WEIGHTS } from "./resonance.js";

const DIMENSION_LABELS = {
  support: "Effective support",
  recurrence: "Recurrence",
  compactness: "Compactness",
  separation: "Separation",
  temporalStability: "Temporal stability",
  recentContinuity: "Recent continuity",
};

function statusTone(value) {
  if (value >= 70) return "clear";
  if (value >= 55) return "taking";
  return "candidate";
}

function useDataset() {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let alive = true;
    fetch("/data/pmdata.json")
      .then((response) => {
        if (!response.ok) throw new Error(`PMData request returned ${response.status}`);
        return response.json();
      })
      .then((data) => alive && setState({ loading: false, data, error: null }))
      .catch((error) => alive && setState({ loading: false, data: null, error: error.message }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

function smoothStageBands(samples, radius = 4) {
  const sigma = Math.max(1, radius * 0.62);
  const smoothValue = (bandIndex, edgeIndex, index) => {
    let weightedTotal = 0;
    let weightTotal = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const sample = samples[index + offset];
      if (!sample) continue;
      const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
      weightedTotal += sample.densityBands[bandIndex][edgeIndex] * weight;
      weightTotal += weight;
    }
    return weightedTotal / Math.max(1e-6, weightTotal);
  };
  return samples.map((item, index) => ({
    ...item,
    densityBands: item.densityBands.map((_, bandIndex) => [
      smoothValue(bandIndex, 0, index),
      smoothValue(bandIndex, 1, index),
    ]),
  }));
}

function traceSplineSegments(ctx, points, tension = 0.82) {
  for (let index = 0; index < points.length - 1; index += 1) {
    const before = points[Math.max(0, index - 1)];
    const current = points[index];
    const next = points[index + 1];
    const after = points[Math.min(points.length - 1, index + 2)];
    ctx.bezierCurveTo(
      current.x + ((next.x - before.x) / 6) * tension,
      current.y + ((next.y - before.y) / 6) * tension,
      next.x - ((after.x - current.x) / 6) * tension,
      next.y - ((after.y - current.y) / 6) * tension,
      next.x,
      next.y,
    );
  }
}

function StageBandChart({ pattern, historical = false }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pattern?.includedDays?.length) return undefined;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      const ctx = canvas.getContext("2d");
      ctx.scale(ratio, ratio);
      const width = rect.width;
      const height = rect.height;
      const left = 72;
      const right = 16;
      const top = 44;
      const bottom = 14;
      const innerWidth = width - left - right;
      const innerHeight = height - top - bottom;
      const x = (hour) => left + ((hour - 18) / 24) * innerWidth;
      const y = (depth) => top + (depth / 3) * innerHeight;
      ctx.clearRect(0, 0, width, height);

      const stages = [[0, "AWAKE"], [1, "REM"], [2, "LIGHT"], [3, "DEEP"]];
      ctx.font = '10px "Manrope", "Segoe UI", sans-serif';
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      stages.forEach(([value, label], index) => {
        const outerAxis = index === 0 || index === stages.length - 1;
        ctx.strokeStyle = index === 0
          ? "rgba(159,224,212,.22)"
          : index === stages.length - 1
            ? "rgba(159,224,212,.17)"
            : "rgba(255,255,255,.075)";
        ctx.setLineDash(outerAxis ? [] : [3, 5]);
        ctx.beginPath();
        ctx.moveTo(left, y(value));
        ctx.lineTo(width - right, y(value));
        ctx.stroke();
        ctx.fillStyle = index === stages.length - 1 ? "rgba(159,224,212,.58)" : "rgba(255,255,255,.3)";
        ctx.fillText(label, left - 12, y(value));
      });
      ctx.setLineDash([]);

      ctx.font = '10px "Manrope", "Segoe UI", sans-serif';
      ctx.fillStyle = "rgba(255,255,255,.38)";
      ctx.textBaseline = "middle";
      [[18, "6 PM"], [24, "12 AM"], [30, "6 AM"], [36, "12 PM"], [42, "6 PM"]].forEach(([hour, label], index, list) => {
        ctx.textAlign = index === 0 ? "left" : index === list.length - 1 ? "right" : "center";
        ctx.fillText(label, x(hour), top - 22);
        ctx.strokeStyle = "rgba(159,224,212,.13)";
        ctx.beginPath();
        ctx.moveTo(x(hour), top - 5);
        ctx.lineTo(x(hour), top);
        ctx.stroke();
      });

      const sleepStarts = pattern.includedDays.map((day) => day.bed);
      const wakeTimes = pattern.includedDays.map((day) => day.wake);
      const startRangeLow = quantile(sleepStarts, 0.03);
      const startRangeHigh = quantile(sleepStarts, 0.97);
      const wakeRangeLow = quantile(wakeTimes, 0.03);
      const wakeRangeHigh = quantile(wakeTimes, 0.97);
      const sampledHours = [startRangeLow];
      for (let hour = Math.ceil(startRangeLow * 8) / 8; hour < wakeRangeHigh; hour += 0.125) {
        if (hour > startRangeLow + 1e-6) sampledHours.push(hour);
      }
      sampledHours.push(wakeRangeHigh);

      const samples = [];
      for (const hour of sampledHours) {
        const values = [];
        for (const day of pattern.includedDays) {
          if (hour < day.bed || hour > day.wake || !day.profile?.length) {
            values.push(0);
            continue;
          }
          const progress = (hour - day.bed) / Math.max(0.01, day.wake - day.bed);
          const position = progress * (day.profile.length - 1);
          const base = Math.floor(position);
          const rest = position - base;
          const next = day.profile[Math.min(day.profile.length - 1, base + 1)];
          values.push(day.profile[base] * (1 - rest) + next * rest);
        }
        samples.push({
          hour,
          values,
          densityBands: [[quantile(values, 0.15), quantile(values, 0.85)]],
        });
      }

      if (samples.length) {
        const smoothed = smoothStageBands(smoothStageBands(samples, 4), 3);
        const baseRgb = {
          mint: [159, 224, 212],
          aqua: [134, 184, 255],
          violet: [201, 179, 227],
          amber: [224, 196, 143],
        }[pattern.color] || [201, 179, 227];
        const baseColor = baseRgb.join(",");
        const lowPoints = smoothed.map((item) => ({
          x: x(item.hour),
          y: y(item.densityBands[0][0]),
        }));
        const highPoints = smoothed.map((item) => ({
          x: x(item.hour),
          y: y(item.densityBands[0][1]),
        }));
        const densityWidth = Math.max(1, Math.ceil(innerWidth));
        const densityHeight = Math.max(1, Math.ceil(innerHeight));
        const densityCanvas = document.createElement("canvas");
        densityCanvas.width = densityWidth;
        densityCanvas.height = densityHeight;
        const densityContext = densityCanvas.getContext("2d");
        const densityImage = densityContext.createImageData(densityWidth, densityHeight);
        const stageBandwidth = 0.23;
        let sampleRight = 1;
        for (let pixelX = 0; pixelX < densityWidth; pixelX += 1) {
          const hour = 18 + (pixelX / Math.max(1, densityWidth - 1)) * 24;
          while (sampleRight < samples.length - 1 && samples[sampleRight].hour < hour) sampleRight += 1;
          const leftSample = samples[Math.max(0, sampleRight - 1)];
          const rightSample = samples[Math.min(samples.length - 1, sampleRight)];
          const timeMix = Math.max(0, Math.min(1,
            (hour - leftSample.hour) / Math.max(1e-6, rightSample.hour - leftSample.hour),
          ));
          for (let pixelY = 0; pixelY < densityHeight; pixelY += 1) {
            const depth = (pixelY / Math.max(1, densityHeight - 1)) * 3;
            let density = 0;
            for (let nightIndex = 0; nightIndex < leftSample.values.length; nightIndex += 1) {
              const value = leftSample.values[nightIndex] * (1 - timeMix)
                + rightSample.values[nightIndex] * timeMix;
              const distance = (depth - value) / stageBandwidth;
              density += Math.exp(-0.5 * distance * distance);
            }
            density /= Math.max(1, leftSample.values.length);
            const imageIndex = (pixelY * densityWidth + pixelX) * 4;
            densityImage.data[imageIndex] = baseRgb[0];
            densityImage.data[imageIndex + 1] = baseRgb[1];
            densityImage.data[imageIndex + 2] = baseRgb[2];
            densityImage.data[imageIndex + 3] = Math.round(255 * Math.min(0.7, Math.pow(density, 0.78) * 0.7));
          }
        }
        densityContext.putImageData(densityImage, 0, 0);
        const blurredDensityCanvas = document.createElement("canvas");
        blurredDensityCanvas.width = densityWidth;
        blurredDensityCanvas.height = densityHeight;
        const blurredDensityContext = blurredDensityCanvas.getContext("2d");
        blurredDensityContext.filter = "blur(4px)";
        blurredDensityContext.drawImage(densityCanvas, 0, 0);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(lowPoints[0].x, lowPoints[0].y);
        traceSplineSegments(ctx, lowPoints);
        const reversedHigh = [...highPoints].reverse();
        ctx.lineTo(reversedHigh[0].x, reversedHigh[0].y);
        traceSplineSegments(ctx, reversedHigh);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(blurredDensityCanvas, left, top, innerWidth, innerHeight);
        ctx.restore();

        ctx.strokeStyle = `rgba(${baseColor},.58)`;
        ctx.lineWidth = 2.4;
        ctx.lineCap = "round";
        [[startRangeLow, startRangeHigh], [wakeRangeLow, wakeRangeHigh]].forEach(([rangeStart, rangeEnd]) => {
          ctx.beginPath();
          ctx.moveTo(x(rangeStart), y(0));
          ctx.lineTo(x(rangeEnd), y(0));
          ctx.stroke();
        });

      }
    };
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [pattern]);

  return (
    <section className="shape-panel">
      <div className="section-heading-row">
        <div>
          <span className="eyebrow">{historical ? "REPRESENTATIVE SLEEP DAY SHAPE" : "SLEEP DAY SHAPE"}</span>
          <h3>Primary sleep · time and depth</h3>
        </div>
        <span className="chart-note">Probability density · 15–85%</span>
      </div>
      <canvas ref={canvasRef} className="stage-chart" role="img" aria-label={`Sleep depth probability density from ${pattern.sleepStartRange} to ${pattern.wakeRange}`} />
      <div className="shape-stats">
        <div><strong>{pattern.sleepStartRange}</strong><span>Usual sleep start</span></div>
        <div><strong>{pattern.wakeRange}</strong><span>Usual wake</span></div>
        <div><strong>{pattern.durationRange}</strong><span>Sleep duration</span></div>
        <div><strong>{pattern.napCount} / {pattern.includedDays.length}</strong><span>Additional sleep observed</span></div>
      </div>
    </section>
  );
}

function depthAtHour(day, hour) {
  if (!day?.profile?.length || hour < day.bed || hour > day.wake) return 0;
  const progress = (hour - day.bed) / Math.max(0.01, day.wake - day.bed);
  const position = clampNumber(progress, 0, 1) * (day.profile.length - 1);
  const left = Math.floor(position);
  const right = Math.min(day.profile.length - 1, left + 1);
  const mix = position - left;
  return day.profile[left] * (1 - mix) + day.profile[right] * mix;
}

function clampNumber(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function smoothScalarSeries(series, radius = 3) {
  const sigma = Math.max(1, radius * 0.62);
  return series.map((item, index) => {
    let total = 0;
    let weightTotal = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const neighbor = series[index + offset];
      if (!neighbor) continue;
      const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
      total += neighbor.value * weight;
      weightTotal += weight;
    }
    return { ...item, value: total / Math.max(1e-6, weightTotal) };
  });
}

function interpolateSeries(series, hour, key = "value") {
  if (!series.length) return 0;
  if (hour <= series[0].hour) return series[0][key];
  if (hour >= series[series.length - 1].hour) return series[series.length - 1][key];
  let rightIndex = 1;
  while (rightIndex < series.length && series[rightIndex].hour < hour) rightIndex += 1;
  const left = series[rightIndex - 1];
  const right = series[rightIndex];
  const mix = (hour - left.hour) / Math.max(1e-6, right.hour - left.hour);
  return left[key] * (1 - mix) + right[key] * mix;
}

function DayStageChart({ day }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !day?.profile?.length) return undefined;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      const ctx = canvas.getContext("2d");
      ctx.scale(ratio, ratio);
      const width = rect.width;
      const height = rect.height;
      const left = 38;
      const right = 16;
      const top = 12;
      const bottom = 31;
      const plotHeight = height - top - bottom;
      const stageY = (stage) => top + (stage / 3) * plotHeight;
      const stageColors = ["#d6ab96", "#85c0c7", "#6e97c4", "#485f94"];
      ctx.clearRect(0, 0, width, height);
      [0, 1, 2, 3].forEach((stage) => {
        ctx.strokeStyle = "rgba(255,255,255,.065)";
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(left, stageY(stage));
        ctx.lineTo(width - right, stageY(stage));
        ctx.stroke();
      });
      ctx.setLineDash([]);
      const segmentWidth = (width - left - right) / day.profile.length;
      day.profile.forEach((stage, index) => {
        const x = left + index * segmentWidth;
        const nextStage = day.profile[Math.min(day.profile.length - 1, index + 1)];
        ctx.fillStyle = stageColors[Math.round(stage)] || stageColors[2];
        ctx.globalAlpha = 0.92;
        ctx.beginPath();
        ctx.roundRect(x, stageY(stage) - 8, Math.max(3, segmentWidth + 1), 16, 4);
        ctx.fill();
        if (index < day.profile.length - 1 && nextStage !== stage) {
          ctx.fillStyle = `rgba(159,224,212,.34)`;
          ctx.fillRect(x + segmentWidth - 1, Math.min(stageY(stage), stageY(nextStage)) - 2, 2, Math.abs(stageY(nextStage) - stageY(stage)) + 4);
        }
      });
      ctx.globalAlpha = 1;
      ctx.font = '10px "Manrope", "Segoe UI", sans-serif';
      ctx.fillStyle = "rgba(255,255,255,.42)";
      ctx.textBaseline = "bottom";
      ctx.textAlign = "left";
      ctx.fillText(formatClock(day.bed), left, height - 3);
      ctx.textAlign = "center";
      ctx.fillText(formatClock((day.bed + day.wake) / 2), (left + width - right) / 2, height - 3);
      ctx.textAlign = "right";
      ctx.fillText(formatClock(day.wake), width - right, height - 3);
    };
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [day]);
  return <canvas ref={canvasRef} className="day-stage-chart" role="img" aria-label={`Sleep stages from ${formatClock(day.bed)} to ${formatClock(day.wake)}`} />;
}

function SleepLandscape({ day, pattern }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !day?.profile?.length || !pattern?.includedDays?.length) return undefined;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      const ctx = canvas.getContext("2d");
      ctx.scale(ratio, ratio);
      const width = rect.width;
      const height = rect.height;
      const left = 18;
      const right = 18;
      const horizon = Math.round(height * 0.49);
      const depthHeight = Math.min(128, horizon - 28, height - horizon - 42);
      const x = (hour) => left + ((hour - 18) / 24) * (width - left - right);
      const yAbove = (depth) => horizon - (depth / 3) * depthHeight;
      const yBelow = (depth) => horizon + (depth / 3) * depthHeight;
      ctx.clearRect(0, 0, width, height);

      const hours = [];
      for (let hour = 18; hour <= 42.0001; hour += 0.125) hours.push(hour);
      const actualRaw = hours.map((hour) => ({ hour, value: depthAtHour(day, hour) }));
      const actual = smoothScalarSeries(smoothScalarSeries(actualRaw, 3), 2);
      const patternRaw = hours.map((hour) => {
        const values = pattern.includedDays.map((item) => depthAtHour(item, hour));
        return { hour, low: quantile(values, 0.15), high: quantile(values, 0.85) };
      });
      const patternLow = smoothScalarSeries(patternRaw.map((item) => ({ hour: item.hour, value: item.low })), 3);
      const patternHigh = smoothScalarSeries(patternRaw.map((item) => ({ hour: item.hour, value: item.high })), 3);
      const actualRange = actual.filter((item) => item.hour >= day.bed && item.hour <= day.wake);

      const waterGradient = ctx.createLinearGradient(0, horizon, 0, height);
      waterGradient.addColorStop(0, "rgba(38,99,109,.14)");
      waterGradient.addColorStop(0.42, "rgba(28,68,79,.08)");
      waterGradient.addColorStop(1, "rgba(13,28,36,0)");
      ctx.fillStyle = waterGradient;
      ctx.fillRect(0, horizon, width, height - horizon);

      const reflectedPoints = actualRange.map((item) => ({ x: x(item.hour), y: yBelow(item.value) }));
      if (reflectedPoints.length > 1) {
        const reflectionGradient = ctx.createLinearGradient(0, horizon, 0, horizon + depthHeight);
        reflectionGradient.addColorStop(0, "rgba(124,210,205,.18)");
        reflectionGradient.addColorStop(1, "rgba(56,102,112,.04)");
        ctx.beginPath();
        ctx.moveTo(reflectedPoints[0].x, horizon);
        ctx.lineTo(reflectedPoints[0].x, reflectedPoints[0].y);
        traceSplineSegments(ctx, reflectedPoints, 0.76);
        ctx.lineTo(reflectedPoints[reflectedPoints.length - 1].x, horizon);
        ctx.closePath();
        ctx.fillStyle = reflectionGradient;
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(reflectedPoints[0].x, reflectedPoints[0].y);
        traceSplineSegments(ctx, reflectedPoints, 0.76);
        ctx.strokeStyle = "rgba(134,211,207,.28)";
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }

      const lowPoints = patternLow.map((item) => ({ x: x(item.hour), y: yBelow(item.value) }));
      const highPoints = patternHigh.map((item) => ({ x: x(item.hour), y: yBelow(item.value) }));
      ctx.beginPath();
      ctx.moveTo(lowPoints[0].x, lowPoints[0].y);
      traceSplineSegments(ctx, lowPoints, 0.8);
      const reversedHigh = [...highPoints].reverse();
      ctx.lineTo(reversedHigh[0].x, reversedHigh[0].y);
      traceSplineSegments(ctx, reversedHigh, 0.8);
      ctx.closePath();

      const densityWidth = Math.max(1, Math.round(width - left - right));
      const densityHeight = Math.max(1, Math.round(depthHeight));
      const densityCanvas = document.createElement("canvas");
      densityCanvas.width = densityWidth;
      densityCanvas.height = densityHeight;
      const densityContext = densityCanvas.getContext("2d");
      const densityImage = densityContext.createImageData(densityWidth, densityHeight);
      const kernelBandwidth = 0.24;
      for (let densityX = 0; densityX < densityWidth; densityX += 1) {
        const hour = 18 + (densityX / Math.max(1, densityWidth - 1)) * 24;
        const values = pattern.includedDays.map((item) => depthAtHour(item, hour));
        for (let densityY = 0; densityY < densityHeight; densityY += 1) {
          const depth = (densityY / Math.max(1, densityHeight - 1)) * 3;
          const density = values.reduce((sum, value) => {
            const distance = (depth - value) / kernelBandwidth;
            return sum + Math.exp(-0.5 * distance * distance);
          }, 0) / Math.max(1, values.length);
          const offset = (densityY * densityWidth + densityX) * 4;
          densityImage.data[offset] = 203;
          densityImage.data[offset + 1] = 181;
          densityImage.data[offset + 2] = 229;
          densityImage.data[offset + 3] = Math.round(255 * clampNumber(Math.pow(density, 0.72) * 0.74, 0, 0.72));
        }
      }
      densityContext.putImageData(densityImage, 0, 0);
      ctx.save();
      ctx.clip();
      ctx.drawImage(densityCanvas, left, horizon, densityWidth, densityHeight);
      ctx.restore();

      const goldSegments = [];
      let currentGoldSegment = [];
      for (let pixelX = Math.max(left, Math.floor(x(day.bed))); pixelX <= Math.min(width - right, Math.ceil(x(day.wake))); pixelX += 2) {
        const hour = 18 + ((pixelX - left) / Math.max(1, width - left - right)) * 24;
        const actualDepth = interpolateSeries(actual, hour);
        const low = interpolateSeries(patternLow, hour);
        const high = interpolateSeries(patternHigh, hour);
        const insidePattern = actualDepth >= low - 0.025 && actualDepth <= high + 0.025;
        if (insidePattern) {
          currentGoldSegment.push({ x: pixelX, y: yBelow(actualDepth) });
        } else if (currentGoldSegment.length) {
          if (currentGoldSegment.length > 1) goldSegments.push(currentGoldSegment);
          currentGoldSegment = [];
        }
      }
      if (currentGoldSegment.length > 1) goldSegments.push(currentGoldSegment);

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      goldSegments.forEach((segment) => {
        ctx.beginPath();
        ctx.moveTo(segment[0].x, segment[0].y);
        traceSplineSegments(ctx, segment, 0.76);
        ctx.strokeStyle = "rgba(247,216,151,.24)";
        ctx.lineWidth = 5.5;
        ctx.shadowColor = "rgba(255,222,153,.48)";
        ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(segment[0].x, segment[0].y);
        traceSplineSegments(ctx, segment, 0.76);
        ctx.strokeStyle = "rgba(255,232,178,.96)";
        ctx.lineWidth = 1.75;
        ctx.shadowColor = "rgba(255,223,153,.82)";
        ctx.shadowBlur = 7;
        ctx.stroke();
      });
      ctx.restore();

      if (actualRange.length > 1) {
        const actualPoints = actualRange.map((item) => ({ x: x(item.hour), y: yAbove(item.value) }));
        const mountainGradient = ctx.createLinearGradient(0, horizon - depthHeight, 0, horizon);
        mountainGradient.addColorStop(0, "rgba(159,224,212,.36)");
        mountainGradient.addColorStop(1, "rgba(81,137,143,.05)");
        ctx.beginPath();
        ctx.moveTo(actualPoints[0].x, horizon);
        ctx.lineTo(actualPoints[0].x, actualPoints[0].y);
        traceSplineSegments(ctx, actualPoints, 0.76);
        ctx.lineTo(actualPoints[actualPoints.length - 1].x, horizon);
        ctx.closePath();
        ctx.fillStyle = mountainGradient;
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(actualPoints[0].x, actualPoints[0].y);
        traceSplineSegments(ctx, actualPoints, 0.76);
        ctx.strokeStyle = "rgba(170,235,225,.9)";
        ctx.lineWidth = 1.6;
        ctx.shadowColor = "rgba(159,224,212,.48)";
        ctx.shadowBlur = 7;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      const horizonGlow = ctx.createLinearGradient(left, 0, width - right, 0);
      horizonGlow.addColorStop(0, "rgba(159,224,212,.08)");
      horizonGlow.addColorStop(0.5, "rgba(201,225,222,.52)");
      horizonGlow.addColorStop(1, "rgba(159,224,212,.08)");
      ctx.strokeStyle = horizonGlow;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, horizon);
      ctx.lineTo(width - right, horizon);
      ctx.stroke();
      ctx.font = '9px "Manrope", "Segoe UI", sans-serif';
      ctx.fillStyle = "rgba(255,255,255,.38)";
      ctx.textBaseline = "bottom";
      [[18, "6 PM"], [24, "12 AM"], [30, "6 AM"], [36, "12 PM"], [42, "6 PM"]].forEach(([hour, label], index, list) => {
        ctx.textAlign = index === 0 ? "left" : index === list.length - 1 ? "right" : "center";
        ctx.fillText(label, x(hour), horizon - 7);
      });
    };
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [day, pattern]);
  return (
    <div className="landscape-wrap">
      <canvas ref={canvasRef} className="resonance-landscape-canvas" role="img" aria-label={`This Sleep Day reflected against ${pattern.name}`} />
      <div className="landscape-legend"><span className="actual">This Sleep Day</span><span className="reflection">Dim reflection</span><span className="pattern">Your Pattern</span><span className="shared">Resonant overlap</span></div>
    </div>
  );
}

function MiniTimeline({ pattern }) {
  const left = ((pattern.startLow - 18) / 24) * 100;
  const width = ((pattern.wakeHigh - pattern.startLow) / 24) * 100;
  return (
    <div className="mini-timeline" aria-label={`${pattern.sleepStartRange} to ${pattern.wakeRange}`}>
      <span className="mini-title">Primary sleep · {formatClock(pattern.startLow)}–{formatClock(pattern.wakeHigh)}</span>
      <div className="timeline-track"><span className={`timeline-band ${pattern.color}`} style={{ left: `${left}%`, width: `${width}%` }} /></div>
      <div className="timeline-labels"><span>6 PM</span><span>6 AM</span><span>6 PM</span></div>
    </div>
  );
}

function EmergenceBlock({ pattern, compact = false, archived = false }) {
  return (
    <div className={`emergence-block ${compact ? "compact" : ""}`}>
      <strong className={`emergence-value ${pattern.color}`}>{pattern.emergence}</strong>
      <div><span className="eyebrow">{archived ? "EMERGENCE AT ARCHIVE" : "EMERGENCE"}</span><p>{pattern.status} · {pattern.includedDays.length} core Sleep Days</p></div>
    </div>
  );
}

function PatternCard({ pattern, rhythmWindow, onOpen }) {
  const leadAssociation = deriveSignalInsights(pattern, rhythmWindow)[0] || deriveAssociations(pattern, rhythmWindow)[0];
  return (
    <article className={`pattern-card ${pattern.color}`}>
      <EmergenceBlock pattern={pattern} compact />
      <div className="pattern-card-copy"><h3>{pattern.name}</h3><p>{pattern.description}</p></div>
      <MiniTimeline pattern={pattern} />
      <p className="context-line">{leadAssociation?.statement || "Context evidence is still developing in this window."}</p>
      <button className="text-link" onClick={onOpen}>View pattern details <span>›</span></button>
    </article>
  );
}

function windowDate(start, index) {
  const date = new Date(`${start}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
}

function mondayOnOrBefore(date) {
  const value = new Date(`${date}T12:00:00Z`);
  const daysFromMonday = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - daysFromMonday);
  return value.toISOString().slice(0, 10);
}

function EvidenceDots({ pattern, window: rhythmWindow }) {
  const included = new Set(pattern.includedDays.map((day) => day.date));
  const boundary = new Set((pattern.boundaryDays || []).map((day) => day.date));
  const calendarStart = mondayOnOrBefore(rhythmWindow.start);
  const calendarSpan = Math.floor((new Date(`${rhythmWindow.end}T12:00:00Z`) - new Date(`${calendarStart}T12:00:00Z`)) / 86400000) + 1;
  const columns = Array.from({ length: Math.ceil(calendarSpan / 7) }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => {
      const date = windowDate(calendarStart, week * 7 + weekday);
      if (date < rhythmWindow.start || date > rhythmWindow.end) return { date, outside: true };
      return rhythmWindow.validDays.find((day) => day.date === date) || { date, missing: true };
    }),
  );
  return (
    <div>
      <div className="coverage-grid" aria-label="Pattern evidence coverage by calendar week">
        <div className="weekday-labels">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, index) => <span className={index > 4 ? "rest-day-label" : ""} key={label}>{label}</span>)}</div>
        {columns.map((column, week) => (
          <div className="week-column" key={week}>
            <span className="week-label">{formatDate(column[0].date)}</span>
            {column.map((day) => <span key={day.date} className={`evidence-dot ${included.has(day.date) ? pattern.color : boundary.has(day.date) ? `${pattern.color} boundary` : "empty"} ${day?.nap && included.has(day.date) ? "nap" : ""} ${day.outside ? "outside" : ""} ${isInferredRestDay(day) ? "inferred-rest-day" : ""}`} title={day.outside ? "Outside selected window" : day.missing ? `${formatLongDate(day.date)} · no valid Sleep Day` : boundary.has(day.date) ? `${formatLongDate(day.date)} · near the Pattern boundary` : formatLongDate(day.date)} />)}
          </div>
        ))}
      </div>
      <p className="calendar-legend"><span className={`core-key ${pattern.color}`} /> Filled dots define the Pattern.{boundary.size > 0 && <><span className={`boundary-key ${pattern.color}`} /> Outlined dots stay at the Pattern boundary.</>}<span className="calendar-key" /> Weekend rings mark inferred rest days.</p>
    </div>
  );
}

function WindowVariationCard({ window: rhythmWindow }) {
  const boundary = rhythmWindow.boundaryDays.length;
  const unassigned = rhythmWindow.unassignedDays.length;
  if (!boundary && !unassigned) return null;
  return (
    <section className="window-variation-card">
      <div><span className="eyebrow">OBSERVED VARIATION</span><h3>{boundary + unassigned} valid Sleep Days remain outside Pattern definitions</h3><p>These nights do not shape the Pattern chart or enter its Context evidence. Boundary nights contribute reduced support to Emergence; unassigned nights contribute none.</p></div>
      <div className="variation-counts"><span><strong>{boundary}</strong>Near a Pattern boundary</span><span><strong>{unassigned}</strong>Unassigned variation</span></div>
    </section>
  );
}

function ContextAssociations({ pattern, window: rhythmWindow, foodAvailable = true }) {
  const associations = useMemo(() => {
    const signals = deriveSignalInsights(pattern, rhythmWindow);
    const integratedCalendar = new Set(signals.map((item) => item.calendarAssociationId).filter(Boolean));
    return [
      ...signals,
      ...deriveAssociations(pattern, rhythmWindow).filter((item) => !integratedCalendar.has(item.id)),
    ];
  }, [pattern, rhythmWindow]);
  return (
    <section className="context-card">
      <div className="section-heading-row"><div><span className="eyebrow">SEPARATE EVIDENCE LAYER</span><h3>When this Pattern appears</h3></div><span className="independent-pill">Does not change Emergence</span></div>
      {associations.length ? associations.slice(0, 3).map((association) => (
        <div className="association-row" key={association.id}>
          <span className={`source-mark ${association.source}`} />
          <div><strong>{association.statement}</strong><p>{association.evidenceSummary || `Based on ${association.supportCount} core Sleep Days`} · association confidence {Math.round(association.confidence * 100)}%</p>{association.inferred && <span className="association-note">Work and rest nights are inferred from weekday timing; PMData has no schedule.</span>}{association.adjustedFor && association.source !== "signals" && <span className="association-note">Adjusted for inferred rest-day timing.</span>}{association.dataBoundary && <span className="association-note data-boundary">{association.dataBoundary}</span>}</div>
          <span className="association-strength">{Math.round(association.strength * 100)}</span>
        </div>
      )) : <div className="empty-association"><strong>No publishable cross-signal association in this window</strong><p>DUVA keeps comparing physiology, early-night sleep structure and available context without changing this Pattern’s Emergence.</p></div>}
      {!foodAvailable && <p className="data-caution">Food context is unavailable for this participant. Sleep Patterns and exercise associations remain available.</p>}
    </section>
  );
}

function Overview({ participant, window: rhythmWindow, onOpenPattern, onOpenUpdates, onHistory }) {
  const visible = rhythmWindow.visiblePatterns;
  return (
    <div className="screen-content overview-screen">
      <section className="intro-block">
        <span className="eyebrow">RHYTHM OVERVIEW</span><h1>Your current Rhythm</h1>
        <p>DUVA sees recurring ways this participant’s Sleep Day tends to take shape inside the selected evidence window.</p>
        <div className="evidence-meta"><span className="live-dot" /> {rhythmWindow.isFullWindow ? "Rolling 6-week evidence" : `Available history · ${rhythmWindow.availableDays} days`} · {formatDate(rhythmWindow.start)}–{formatDate(rhythmWindow.end)} · {rhythmWindow.validDays.length} valid Sleep Days</div>
      </section>
      {!participant.sourceStatus?.patternEligible ? (
        <section className="insufficient-card"><span className="eyebrow">INSUFFICIENT EVIDENCE</span><h2>No Pattern can be estimated for {participant.id.toUpperCase()}</h2><p>This participant has {participant.sourceStatus?.validStageNights ?? rhythmWindow.validDays.length} valid staged Sleep Day. The computational floor requires effective support of at least four.</p></section>
      ) : visible.length ? (
        <section><div className="section-heading-row section-title"><h2>Rhythm patterns</h2><span>{visible.length} visible</span></div><div className="pattern-grid">{visible.map((pattern) => <PatternCard key={pattern.id} pattern={pattern} rhythmWindow={rhythmWindow} onOpen={() => onOpenPattern(pattern.id)} />)}</div></section>
      ) : (
        <section className="insufficient-card"><span className="eyebrow">LEARNING IN THE BACKGROUND</span><h2>No Pattern reaches Taking shape yet</h2><p>Candidate shapes remain hidden until Emergence reaches 55 and the minimum effective-support and Confidence checks pass.</p></section>
      )}
      <WindowVariationCard window={rhythmWindow} />
      <div className="overview-bottom-grid">
        <button className="info-card" onClick={onOpenUpdates}><span className="eyebrow">MODEL BEHAVIOR</span><strong>How your Rhythm updates</strong><p>Each valid Sleep Day is compared with current Candidate shapes. Only sufficiently close nights enter Pattern evidence.</p><span className="text-link-static">See how Rhythm updates ›</span></button>
        <button className="info-card" onClick={onHistory}><span className="eyebrow">EARLIER PERIODS</span><strong>Rhythm history</strong><p>Inspect representative Pattern shapes recognized at earlier dates in this participant’s record.</p><span className="text-link-static">Open Rhythm history ›</span></button>
      </div>
    </div>
  );
}

const FIT_LABELS = {
  timing: "Sleep timing",
  duration: "Sleep duration",
  landscape: "Depth landscape",
  composition: "Stage composition",
  physiology: "Night heart-rate shape",
  earlyNight: "First 90 minutes",
};

function stageHours(day, key) {
  return Math.max(0, (day.timeInBed || day.duration || 0) * (day.stages?.[key] || 0));
}

function ResonanceSummaryCard({ resonance, onOpen }) {
  if (resonance.state === "learning") {
    return (
      <section className="daily-resonance-card learning">
        <div><span className="eyebrow">RESONANCE</span><h2>DUVA is learning your Rhythm</h2></div>
        <p>{resonance.summary}</p>
        <span className="learning-progress">{resonance.pastNightCount || 0} earlier valid Sleep Days available</span>
      </section>
    );
  }
  if (resonance.state === "unavailable") {
    return (
      <section className="daily-resonance-card learning">
        <div><span className="eyebrow">RESONANCE UNAVAILABLE</span><h2>{resonance.title}</h2></div>
        <p>{resonance.summary}</p>
      </section>
    );
  }
  return (
    <button className={`daily-resonance-card ${resonance.state}`} onClick={onOpen}>
      <div className="daily-resonance-head">
        <strong>{resonance.score}</strong>
        <div><span className="eyebrow">RESONANCE</span><h3>{resonance.patternLabel}</h3></div>
        <span className="resonance-state-label">{resonance.stateLabel}</span>
      </div>
      <p>{resonance.summary}</p>
      <div className="daily-resonance-evidence">
        <span>{resonance.state === "different" ? `Compared with ${resonance.evidenceCount} earlier Pattern days` : `Based on ${resonance.evidenceCount} matching Pattern days`}</span>
        <span>View details ›</span>
      </div>
    </button>
  );
}

function DailySummary({ day }) {
  const totalAsleep = day.duration + (day.napDuration || 0);
  const totalInBed = day.timeInBed + (day.napDuration || 0);
  const efficiency = Math.round((totalAsleep / Math.max(0.01, totalInBed)) * 100);
  const stageParts = [
    ["deep", "Deep", "#485f94"],
    ["light", "Light", "#6e97c4"],
    ["rem", "REM", "#85c0c7"],
  ];
  return (
    <section className="daily-summary-section">
      <div className="section-heading-row"><div><span className="eyebrow">DAILY SLEEP SUMMARY</span><h2>Across {day.nap ? 2 : 1} sleep {day.nap ? "periods" : "period"}</h2></div><span>{day.nap ? "Primary + additional sleep" : "Primary sleep"}</span></div>
      <div className="daily-metric-grid">
        <div><strong>{formatDuration(totalAsleep)}</strong><span>Total asleep</span></div>
        <div><strong>{formatDuration(totalInBed)}</strong><span>Time in bed</span></div>
        <div><strong>{efficiency}%</strong><span>Sleep efficiency</span></div>
        <div><strong>{day.physiology?.restingBpm ? `${Math.round(day.physiology.restingBpm)} bpm` : "Unavailable"}</strong><span>Resting heart rate</span></div>
      </div>
      <div className="daily-stage-summary">
        <div className="section-heading-row"><h3>Sleep stages</h3><span>{formatDuration(day.duration)} primary sleep</span></div>
        <div className="daily-stage-bar">{stageParts.map(([key, label, color]) => <i key={key} title={label} style={{ width: `${(day.stages?.[key] || 0) * 100}%`, background: color }} />)}</div>
        <div className="daily-stage-totals">{stageParts.map(([key, label, color]) => <div key={key}><span><i style={{ background: color }} />{label}</span><strong>{formatDuration(stageHours(day, key))}</strong><small>{Math.round((day.stages?.[key] || 0) * 100)}%</small></div>)}</div>
      </div>
    </section>
  );
}

function DailySleepPeriods({ day }) {
  const stageParts = [["deep", "Deep"], ["light", "Light"], ["rem", "REM"], ["wake", "Awake"]];
  return (
    <section className="daily-periods-section">
      <span className="eyebrow">SLEEP PERIOD</span>
      <article className="sleep-period-card">
        <div className="sleep-period-head"><div><h2>Primary sleep</h2><p>{formatClock(day.bed)}–{formatClock(day.wake)}</p></div><div><strong>{formatDuration(day.duration)}</strong><span>Asleep</span></div><div><strong>{formatDuration(day.timeInBed)}</strong><span>Time in bed</span></div></div>
        <DayStageChart day={day} />
        <div className="period-stage-totals">{stageParts.map(([key, label]) => <div key={key}><span>{label}</span><strong>{formatDuration(stageHours(day, key))}</strong></div>)}</div>
        <div className="smart-assist-note"><span className="live-dot" /><div><strong>{day.sleepStructure?.first90BriefWakeEvents || 0} brief wake events in the first 90 min</strong><p>Shown as observed sleep structure; PMData contains no DUVA intervention record.</p></div></div>
      </article>
      {day.nap && (
        <article className="sleep-period-card nap-card">
          <div className="sleep-period-head"><div><h2>Additional sleep</h2><p>{formatClock(day.napStart)}–{formatClock(day.napStart + day.napDuration)}</p></div><div><strong>{formatDuration(day.napDuration)}</strong><span>Observed duration</span></div></div>
          <p className="nap-boundary">PMData provides the additional sleep period and duration without a complete stage landscape for this record.</p>
        </article>
      )}
    </section>
  );
}

function DailyContext({ day }) {
  const exercise = day.context?.exercise;
  const food = day.context?.food;
  const wellness = day.context?.wellness;
  return (
    <section className="daily-context-section">
      <span className="eyebrow">DAILY CONTEXT · FROM AVAILABLE RECORDS</span>
      <div className="daily-context-grid">
        <div><strong>{exercise?.matched ? `${Math.round(exercise.totalMinutes || 0)} min` : "No record"}</strong><span>Exercise</span><small>{exercise?.types?.join(", ") || "—"}</small></div>
        <div><strong>{food?.reported ? `${food.meals?.length || 0} meals` : "No report"}</strong><span>Food</span><small>{food?.alcohol ? "Alcohol logged" : "No alcohol logged"}</small></div>
        <div><strong>{food?.fluidGlasses != null ? `${food.fluidGlasses} glasses` : "No report"}</strong><span>Fluids</span><small>Self-reported</small></div>
        <div><strong>{wellness?.reported ? "Reported" : "No report"}</strong><span>Wellness</span><small>{wellness?.stress != null ? `Stress ${wellness.stress}` : "—"}</small></div>
      </div>
      <p>Daily context can help explain when a Pattern appears. It does not change this night’s Resonance score.</p>
    </section>
  );
}

function DailySleepRecords({ day, resonance, onOpenResonance }) {
  if (!day?.valid) {
    return (
      <div className="screen-content sleep-records-screen">
        <header className="page-header"><span className="eyebrow">SLEEP RECORDS</span><h1>{day ? formatLongDate(day.date) : "Selected Sleep Day"}</h1><p>No valid staged primary sleep is available for this date.</p></header>
        <ResonanceSummaryCard resonance={resonance} />
      </div>
    );
  }
  return (
    <div className="screen-content sleep-records-screen">
      <header className="sleep-records-header"><div><span className="eyebrow">SLEEP RECORDS</span><h1>{formatLongDate(day.date)}</h1></div><p>This Sleep Day is compared only with Patterns formed before it began.</p></header>
      <section className="resonance-section"><h2>Resonance</h2><ResonanceSummaryCard resonance={resonance} onOpen={onOpenResonance} /></section>
      <DailySummary day={day} />
      <DailySleepPeriods day={day} />
      <DailyContext day={day} />
    </div>
  );
}

function ResonanceDetail({ resonance, onBack }) {
  if (!resonance?.pattern || !resonance.day) return null;
  const { day, pattern } = resonance;
  const stageParts = [["deep", "DEEP", "#4d6eb0"], ["light", "LIGHT", "#73a6d1"], ["rem", "REM", "#8fd1d6"]];
  return (
    <div className="screen-content resonance-detail-screen">
      <button className="back-button" onClick={onBack}>‹ <span>Sleep records</span></button>
      <header className="resonance-detail-header"><div><span className="eyebrow">RESONANCE · {formatLongDate(day.date)}</span><h1>{resonance.state === "different" ? "This night was different" : resonance.patternLabel}</h1><p>{resonance.summary}</p></div><div className="resonance-score-portrait"><strong>{resonance.score}</strong><div><span>RESONANCE</span><b>{resonance.stateLabel}</b><small>Confidence {resonance.confidence}%</small></div></div></header>
      <section className="landscape-section">
        <div className="section-heading-row"><div><span className="eyebrow">A REAL SLEEP DAY AGAINST YOUR RHYTHM</span><h2>Sleep landscape</h2><p>{formatClock(day.bed)}–{formatClock(day.wake)} · {formatDuration(day.duration)} asleep</p></div><span>{resonance.state === "different" ? `Nearest: ${pattern.name}` : pattern.name}</span></div>
        <SleepLandscape day={day} pattern={pattern} />
        <p className="landscape-note">The bright line above the water is this primary sleep. Its dim reflection and the Pattern sit below. Gold marks the parts of the reflected line that fall inside the Pattern.</p>
      </section>
      <section className="resonance-method-section">
        <div className="section-heading-row"><div><span className="eyebrow">HOW THE SCORE WAS FORMED</span><h2>Pattern fit</h2></div><span>Current night held out</span></div>
        <div className="resonance-candidate-list" aria-label="Pattern candidates compared for this Sleep Day">
          {resonance.ranked.slice(0, 3).map((candidate, index) => {
            const label = index === 0
              ? resonance.state === "different" ? "Nearest Pattern" : "Selected Pattern"
              : resonance.state === "mixed" && index === 1 ? "Also close" : "Comparison";
            return <div className={index === 0 || (resonance.state === "mixed" && index === 1) ? "active" : ""} key={candidate.pattern.id}><span>{label}</span><strong>{candidate.pattern.name}</strong><b>{candidate.score}</b></div>;
          })}
        </div>
        <div className="resonance-fit-grid">{Object.entries(RESONANCE_WEIGHTS).map(([key, weight]) => {
          const value = resonance.breakdown?.[key];
          return <div className="resonance-fit-row" key={key}><span>{FIT_LABELS[key]}<small>{Math.round(weight * 100)}% base weight</small></span><div><i style={{ width: `${Math.round((value || 0) * 100)}%` }} /></div><strong>{Number.isFinite(value) ? Math.round(value * 100) : "—"}</strong></div>;
        })}</div>
        <div className="resonance-method-note"><strong>How matching works</strong><p>DUVA scores every visible Pattern built from earlier nights, selects the strongest fit, and checks the gap to the next-best Pattern. Missing physiology stays out of the score and the remaining weights rescale. Pattern Confidence and signal coverage shrink uncertain scores toward the middle. Scores below 58 are shown as “This night was different.”</p></div>
      </section>
      <section className="resonance-composition-section">
        <div><span className="eyebrow">PRIMARY SLEEP</span><h2>Sleep composition</h2><p>{formatDuration(day.duration)} asleep</p></div>
        <div className="composition-bar resonance-composition-bar">{stageParts.map(([key,, color]) => <i key={key} style={{ width: `${(day.stages?.[key] || 0) * 100}%`, background: color }} />)}</div>
        <p>{resonance.state === "different" ? `Stage composition alone was not enough to match ${pattern.name}.` : `The overall stage composition contributed to the match with ${pattern.name}.`}</p>
        <div className="resonance-stage-comparison">{stageParts.map(([key, label, color]) => {
          const references = pattern.includedDays.map((item) => item.stages?.[key] ?? 0);
          const low = Math.round(quantile(references, 0.15) * 100);
          const high = Math.round(quantile(references, 0.85) * 100);
          return <div key={key}><span><i style={{ background: color }} />{label}</span><strong>{formatDuration(stageHours(day, key))} · {Math.round((day.stages?.[key] || 0) * 100)}%</strong><small>Pattern range {low}–{high}%</small></div>;
        })}</div>
      </section>
      <section className="resonance-evidence-strip"><div><span className="eyebrow">REFERENCE PATTERN</span><strong>{pattern.name}</strong></div><div><strong>{pattern.includedDays.length}</strong><span>Core Sleep Days</span></div><div><strong>{pattern.emergence}</strong><span>Emergence</span></div><div><strong>{resonance.signalCoverage}%</strong><span>Signals available</span></div><p>This Sleep Day was not used to build its own reference.</p></section>
    </div>
  );
}

function DimensionRows({ pattern }) {
  return <div className="dimension-list">{Object.entries(pattern.dimensions).map(([key, value]) => <div className="dimension-row" key={key}><span>{DIMENSION_LABELS[key]}</span><div className="dimension-track"><i style={{ width: `${Math.round(value * 100)}%` }} /></div><strong>{Math.round(value * 100)}</strong></div>)}</div>;
}

function bpmRange(metric) {
  if (!metric?.count) return "No reliable data";
  const low = Math.round(metric.low);
  const high = Math.round(metric.high);
  return `${low === high ? low : `${low}–${high}`} bpm`;
}

function PhysiologyCard({ pattern }) {
  const physiology = pattern.physiology;
  const coverage = Math.max(
    physiology?.sleepMedianBpm?.count || 0,
    physiology?.sleepLowBpm?.count || 0,
    physiology?.heartRateSettlingMinutes?.count || 0,
    physiology?.restingBpm?.count || 0,
  );
  if (!coverage) return null;
  return (
    <section className="physiology-card">
      <div className="section-heading-row"><div><span className="eyebrow">PHYSIOLOGY IN THIS PATTERN</span><h3>Night heart-rate shape</h3></div><span className="physiology-chip">Used in Pattern recognition</span></div>
      <div className="physiology-grid physiology-grid-wide">
        <div><strong>{bpmRange(physiology.sleepMedianBpm)}</strong><span>Typical sleep HR</span></div>
        <div><strong>{bpmRange(physiology.sleepLowBpm)}</strong><span>Night HR low</span></div>
        <div><strong>{physiology.heartRateSettlingMinutes?.count ? `${Math.round(physiology.heartRateSettlingMinutes.low)}–${Math.round(physiology.heartRateSettlingMinutes.high)} min` : "No reliable data"}</strong><span>HR settling after sleep start</span></div>
        <div><strong>{pattern.sleepStructure?.first90DisruptionEvents?.count ? `${Math.round(pattern.sleepStructure.first90DisruptionEvents.low)}–${Math.round(pattern.sleepStructure.first90DisruptionEvents.high)}` : "No reliable data"}</strong><span>First-90-min disruption events</span></div>
        <div><strong>{bpmRange(physiology.restingBpm)}</strong><span>Resting HR</span></div>
        <div><strong>{coverage} / {pattern.includedDays.length}</strong><span>Sleep Days with HR evidence</span></div>
      </div>
      <p>Heart-rate settling and Fitbit sleep-stage interruptions describe the first 90 minutes. PMData does not contain body-position or environmental-noise streams, so DUVA leaves those signals unavailable in this validation.</p>
    </section>
  );
}

function PatternDetail({ participant, pattern, window: rhythmWindow, onBack, onEvidence, historical = false }) {
  if (!pattern) return null;
  const stageDays = pattern.includedDays;
  const deep = stageDays.map((day) => day.stages?.deep ?? 0);
  const light = stageDays.map((day) => day.stages?.light ?? 0);
  const rem = stageDays.map((day) => day.stages?.rem ?? 0);
  return (
    <div className="screen-content detail-screen">
      <button className="back-button" onClick={onBack}>‹ <span>{historical ? "Rhythm history" : "Current Rhythm"}</span></button>
      <header className="detail-header">
        <div><span className="eyebrow">{historical ? `HISTORICAL PATTERN · ${formatDate(pattern.periodStart)}–${formatDate(pattern.periodEnd)}` : `CURRENT PATTERN · WINDOW ENDING ${formatDate(rhythmWindow.end)}`}</span><h1>{pattern.name}</h1><p>{pattern.description}</p></div>
        <div className="detail-score-card"><EmergenceBlock pattern={pattern} archived={historical} /><span>Confidence {pattern.confidence}%</span></div>
      </header>
      <StageBandChart pattern={pattern} historical={historical} />
      <div className="detail-columns">
        <section className="detail-card"><span className="eyebrow">WHAT DEFINES THIS PATTERN</span><h3>{pattern.definitionTitle}</h3><p>Sleep start usually falls within {pattern.sleepStartRange}; wake usually falls within {pattern.wakeRange}.</p><h3>A compact primary-sleep range</h3><p>Sleep duration stays inside a representative range of {pattern.durationRange} after the outer observations are removed.</p>{pattern.additionalSleepDefinesPattern ? <><h3>Additional sleep recurs in this shape</h3><p>{pattern.napCount} of {pattern.includedDays.length} core Sleep Days contain additional sleep across {pattern.napWeekCount} observed weeks.</p></> : <><h3>Usually one main sleep period</h3><p>{pattern.includedDays.length - pattern.napCount} of {pattern.includedDays.length} core Sleep Days contain only the primary sleep period.</p></>}</section>
        <section className="detail-card"><div className="section-heading-row"><div><span className="eyebrow">WHY THIS PATTERN IS CLEAR</span><h3>Emergence dimensions</h3></div><span className={`status-chip ${statusTone(pattern.emergence)}`}>{pattern.status}</span></div><DimensionRows pattern={pattern} /><p className="method-note">The state above comes from Emergence. Sleep-day count is displayed as evidence and contributes through Effective support.</p></section>
      </div>
      <section className="composition-card">
        <div><span className="eyebrow">TYPICAL SLEEP COMPOSITION</span><h3>Supporting context · primary sleep</h3></div>
        <div className="composition-bar"><i className="deep" style={{ width: `${quantile(deep, .5) * 100}%` }} /><i className="light" style={{ width: `${quantile(light, .5) * 100}%` }} /><i className="rem" style={{ width: `${quantile(rem, .5) * 100}%` }} /></div>
        <div className="composition-labels"><span>Deep {Math.round(quantile(deep, .5) * 100)}%</span><span>Light {Math.round(quantile(light, .5) * 100)}%</span><span>REM {Math.round(quantile(rem, .5) * 100)}%</span></div>
        <p>Stage mix describes the Pattern. Timing, duration, repeated Sleep Day structure and sufficiently covered physiology signals remain the recognition inputs.</p>
        {pattern.napCount > 0 && !pattern.additionalSleepDefinesPattern && <div className="variation-note"><span className="eyebrow">OBSERVED VARIATION · OUTSIDE THE PATTERN DEFINITION</span><strong>{pattern.napCount === 1 ? "Additional sleep was seen once" : `Additional sleep was seen on ${pattern.napCount} Sleep Days`}</strong><p>{pattern.napCount} of {pattern.includedDays.length} core Sleep Days contain additional sleep. It has not repeated often enough across this window to define the Pattern.</p></div>}
        {pattern.boundaryDays.length > 0 && <div className="variation-note"><span className="eyebrow">PATTERN MEMBERSHIP</span><strong>{pattern.boundaryDays.length} nearby Sleep {pattern.boundaryDays.length === 1 ? "Day stays" : "Days stay"} outside this Pattern’s definition</strong><p>These nights are close to this shape but their fit is weaker or less distinct. They contribute reduced support to Emergence and do not shape the chart or Context evidence.</p></div>}
      </section>
      <PhysiologyCard pattern={pattern} />
      {!historical && <ContextAssociations pattern={pattern} window={rhythmWindow} foodAvailable={participant.sourceStatus?.foodAvailable !== false} />}
      <section className="evidence-card"><div className="section-heading-row"><div><span className="eyebrow">SLEEP DAYS DEFINING THIS PATTERN</span><h3>{pattern.includedDays.length} core Sleep Days</h3><p>Repeated across {Math.min(6, Math.ceil(rhythmWindow.availableDays / 7))} observed weeks · {pattern.boundaryDays.length} nearby {pattern.boundaryDays.length === 1 ? "night" : "nights"} kept outside the definition.</p></div><span>{formatDate(rhythmWindow.start)}–{formatDate(rhythmWindow.end)}</span></div><EvidenceDots pattern={pattern} window={rhythmWindow} />{!historical && <button className="text-link wide" onClick={onEvidence}>Review core Sleep Days <span>›</span></button>}</section>
    </div>
  );
}

function EvidenceScreen({ pattern, window: rhythmWindow, onBack }) {
  return (
    <div className="screen-content evidence-screen">
      <button className="back-button" onClick={onBack}>‹ <span>{pattern.name}</span></button>
      <header className="page-header"><span className="eyebrow">CURRENT PATTERN EVIDENCE</span><h1>Sleep Days in this Pattern</h1><p>{pattern.name} · {formatDate(rhythmWindow.start)}–{formatDate(rhythmWindow.end)}</p></header>
      <section className="evidence-summary-card"><strong>{pattern.includedDays.length} core Sleep Days</strong><p>Every row below directly shaped the Pattern at the selected window end. Nearby boundary nights remain visible in the calendar as outlined dots.</p><div className="summary-metrics"><div><strong>{pattern.includedDays.length}</strong><span>Core</span></div><div><strong>{pattern.boundaryDays.length}</strong><span>Boundary</span></div><div><strong>{Math.min(6, Math.ceil(rhythmWindow.availableDays / 7))}</strong><span>Weeks observed</span></div><div><strong>{pattern.napCount}</strong><span>With additional sleep</span></div><div><strong>{pattern.confidence}%</strong><span>Confidence</span></div></div><EvidenceDots pattern={pattern} window={rhythmWindow} /></section>
      <section className="sleep-days-table-card"><div className="section-heading-row"><div><span className="eyebrow">FIXED EVIDENCE</span><h2>Core Sleep Days</h2></div><span>Newest first</span></div><div className="sleep-table" role="table"><div className="sleep-row sleep-head" role="row"><span>Date</span><span>Primary sleep</span><span>Stage mix</span><span>Total sleep</span><span>Context</span></div>{pattern.includedDays.map((day) => <div className="sleep-row" role="row" key={day.id}><span>{formatLongDate(day.date)}</span><span>{formatClock(day.bed)}–{formatClock(day.wake)}</span><span>{Math.round((day.stages?.deep ?? 0) * 100)}% deep · {Math.round((day.stages?.rem ?? 0) * 100)}% REM</span><span>{formatDuration(day.duration + (day.napDuration || 0))}</span><span className="context-cell">{day.context?.exercise?.eveningExercise ? "Later exercise" : day.context?.food?.alcohol ? "Alcohol logged" : day.nap ? "Additional sleep" : "—"}</span></div>)}</div></section>
    </div>
  );
}

function HistoryScreen({ participant, currentWindow, onBack, onOpen }) {
  const history = useMemo(() => makeHistory(participant, currentWindow.end), [participant, currentWindow.end]);
  return (
    <div className="screen-content history-screen">
      <button className="back-button" onClick={onBack}>‹ <span>Current Rhythm</span></button>
      <header className="page-header"><span className="eyebrow">PATTERNS BEFORE THE SELECTED WINDOW</span><h1>Rhythm history</h1><p>History uses non-overlapping earlier windows and refreshes whenever the selected window end date changes.</p></header>
      <section className="current-window-strip"><div><span className="eyebrow">SELECTED RHYTHM WINDOW</span><strong>{formatDate(currentWindow.start)}–{formatDate(currentWindow.end)}</strong></div><span>History is relative to this window</span></section>
      <section className="history-list">{history.length ? history.map((pattern) => <article className={`history-card ${pattern.color}`} key={pattern.historyId}><span className="eyebrow">EARLIER WINDOW · {formatDate(pattern.periodStart)}–{formatDate(pattern.periodEnd, { year: "numeric" })}</span><EmergenceBlock pattern={pattern} compact archived /><h2>{pattern.name}</h2><p>{pattern.description}</p><MiniTimeline pattern={pattern} /><button className="text-link" onClick={() => onOpen(pattern)}>View this Pattern period <span>›</span></button></article>) : <div className="insufficient-card"><h2>No earlier Pattern reaches Taking shape before this window</h2><p>Move the selected end date later to include more earlier history.</p></div>}</section>
      <section className="history-footnote"><h3>What stays in history</h3><p>Past Sleep Days remain linked to the Pattern version active at that time. Earlier periods do not shape the current Rhythm.</p></section>
    </div>
  );
}

function UpdateSheet({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="update-sheet" role="dialog" aria-modal="true" aria-labelledby="updates-title">
        <div className="sheet-grabber" /><button className="close-button" onClick={onClose} aria-label="Close">×</button>
        <h2 id="updates-title">How your Rhythm updates</h2><p>DUVA refreshes Rhythm after each valid Sleep Day. The selected date controls which evidence was available at that time.</p><span className="eyebrow">WHAT HAPPENS</span>
        {[["01", "A new Sleep Day arrives", "It enters the latest six-week maximum window as the oldest record leaves."], ["02", "One to four Candidate shapes are tested", "Timing, duration, heart-rate settling and early-night sleep structure are compared. Extra shapes remain only when support, separation and repeated-sample stability hold."], ["03", "Membership is checked", "Close and distinct nights become core evidence. Weaker nearby nights stay at the boundary with reduced weight. Nights that fit no Candidate remain unassigned variation."], ["04", "Emergence and Confidence refresh", "Emergence determines each Pattern state. Confidence includes data coverage and clustering stability, and controls whether the result is safe to publish."], ["05", "Cross-signal associations refresh separately", "DUVA compares physiology and early-night structure with work/rest timing and available lifestyle context. These associations never increase Pattern Emergence."]].map(([number, title, copy]) => <div className="update-step" key={number}><span>{number}</span><div><strong>{title}</strong><p>{copy}</p></div></div>)}
        <div className="sheet-fixed"><h3>What stays fixed</h3><p>Past Sleep Days remain linked to the Pattern version that was active at the time.</p></div>
      </section>
    </div>
  );
}

function Sidebar({ participants, participant, onParticipantChange, realData, validation }) {
  return (
    <aside className="sidebar">
      <div className="brand"><img className="brand-orb" src="/assets/duva-orb.svg" alt="" /><div><strong>DUVA</strong><span>Rhythm Explorer</span></div></div>
      <div className="dataset-badge"><span className="live-dot" /> {realData ? "PMData connected" : "Mock fallback"}</div>
      <div className="sidebar-section-title"><span>Participants</span><small>{participants.length}</small></div>
      <div className="participant-list">{participants.map((item) => { const eligible = item.sourceStatus?.patternEligible !== false; return <button key={item.id} className={`participant-button ${item.id === participant.id ? "active" : ""}`} onClick={() => onParticipantChange(item.id)}><span className="participant-avatar">{item.id.slice(1)}</span><span><strong>{item.label}</strong><small>{item.sourceStatus?.validStageNights ?? item.days.filter((day) => day.valid).length} staged nights</small></span><i className={eligible ? "eligible" : "limited"}>{eligible ? `${item.coverage}%` : "limited"}</i></button>; })}</div>
      <div className="sidebar-foot"><span>Source snapshot</span><strong>{validation?.totals?.mainStageRecords?.toLocaleString() ?? "1,905"} staged records</strong><p>PMData · 2019–2020 · context stays outside Pattern Emergence.</p></div>
    </aside>
  );
}

function DateController({ participant, endIndex, onChange, window: rhythmWindow, playing, onPlay, dailyMode = false }) {
  const currentDay = participant.days[endIndex];
  return (
    <section className={`date-controller ${dailyMode ? "daily-mode" : ""}`}>
      <div className="date-controller-copy"><span className="eyebrow">{dailyMode ? "SLEEP DAY" : "WINDOW END"}</span><strong>{formatLongDate(currentDay.date)}</strong><p>{dailyMode ? `${currentDay.valid ? "Complete staged primary sleep" : "No valid staged primary sleep"} · reference uses earlier nights only` : `${rhythmWindow.isFullWindow ? "Previous 42 calendar days" : `First ${rhythmWindow.availableDays} available calendar days`} · ${rhythmWindow.validDays.length} valid Sleep Days`}</p></div>
      <button className="step-button" aria-label="Previous date" onClick={() => onChange(Math.max(0, endIndex - 1))}>‹</button>
      <input className="date-slider" type="range" min="0" max={participant.days.length - 1} value={endIndex} onChange={(event) => onChange(Number(event.target.value))} aria-label={dailyMode ? "Select a Sleep Day" : "Slide the Rhythm window end date"} />
      <button className="step-button" aria-label="Next date" onClick={() => onChange(Math.min(participant.days.length - 1, endIndex + 1))}>›</button>
      {!dailyMode && <button className={`play-button ${playing ? "active" : ""}`} onClick={onPlay}>{playing ? "Pause" : "Play evolution"}</button>}
    </section>
  );
}

export function App() {
  const datasetState = useDataset();
  const dataset = datasetState.data;
  const participants = dataset?.participants || mockParticipants;
  const requested = useMemo(() => new URLSearchParams(window.location.search), []);
  const requestedScreen = requested.get("view") === "sleep" ? "sleep-records" : "overview";
  const [participantId, setParticipantId] = useState(requested.get("participant") || "p01");
  const participant = participants.find((item) => item.id === participantId) || participants[0];
  const [endIndex, setEndIndex] = useState(0);
  const [screen, setScreen] = useState(requestedScreen);
  const [selectedPatternId, setSelectedPatternId] = useState(null);
  const [historicalPattern, setHistoricalPattern] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const workspaceScrollRef = useRef(null);

  useEffect(() => {
    const latestValid = participant.days.findLastIndex((day) => day.valid);
    const requestedEnd = requested.get("end");
    const requestedIndex = requestedEnd ? participant.days.findIndex((day) => day.date === requestedEnd) : -1;
    setEndIndex(requestedIndex >= 0 ? requestedIndex : latestValid >= 0 ? latestValid : Math.max(0, participant.days.length - 1));
    setScreen(requestedScreen);
    setSelectedPatternId(null);
    setHistoricalPattern(null);
    setPlaying(false);
  }, [participant.id, dataset, requested, requestedScreen]);

  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => setEndIndex((current) => {
      if (current >= participant.days.length - 1) { setPlaying(false); return current; }
      return current + 1;
    }), 480);
    return () => window.clearInterval(timer);
  }, [playing, participant.days.length]);

  useEffect(() => {
    workspaceScrollRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [screen, participant.id, selectedPatternId]);

  const safeEndIndex = Math.min(Math.max(0, endIndex), Math.max(0, participant.days.length - 1));
  const rhythmWindow = useMemo(() => deriveWindow(participant, safeEndIndex), [participant, safeEndIndex]);
  const resonance = useMemo(() => deriveResonance(participant, safeEndIndex), [participant, safeEndIndex]);
  const selectedDay = participant.days[safeEndIndex];
  const selectedPattern = rhythmWindow.visiblePatterns.find((pattern) => pattern.id === selectedPatternId) || rhythmWindow.visiblePatterns[0] || rhythmWindow.patterns[0];
  const openPattern = (id) => { setSelectedPatternId(id); setScreen("pattern"); };

  useEffect(() => {
    if (screen === "resonance" && !resonance.pattern) setScreen("sleep-records");
  }, [screen, resonance.pattern]);

  useEffect(() => {
    if (historicalPattern && historicalPattern.referenceWindowEnd !== rhythmWindow.end) {
      setHistoricalPattern(null);
      if (screen === "historical") setScreen("history");
    }
  }, [historicalPattern, rhythmWindow.end, screen]);

  if (!participant) return null;

  return (
    <div className="app-shell">
      <Sidebar participants={participants} participant={participant} onParticipantChange={setParticipantId} realData={Boolean(dataset)} validation={dataset?.validation} />
      <main className="workspace">
        <header className="topbar"><div><span className="topbar-path">My health</span><strong>{screen === "sleep-records" || screen === "resonance" ? "Sleep records" : "Rhythm"}</strong></div><nav aria-label="My health views"><button className={screen === "sleep-records" || screen === "resonance" ? "active" : ""} onClick={() => setScreen("sleep-records")}>Sleep records</button><button className={screen === "overview" || screen === "pattern" || screen === "evidence" ? "active" : ""} onClick={() => setScreen("overview")}>Rhythm</button><button className={screen === "history" || screen === "historical" ? "active" : ""} onClick={() => setScreen("history")}>History</button></nav><div className="topbar-actions">{datasetState.loading && <span className="load-state">Loading PMData…</span>}{datasetState.error && <span className="load-state warning">Mock fallback active</span>}<button onClick={() => setSheetOpen(true)}>How updates work</button></div></header>
        <DateController participant={participant} endIndex={safeEndIndex} onChange={setEndIndex} window={rhythmWindow} playing={playing} dailyMode={screen === "sleep-records" || screen === "resonance"} onPlay={() => { if (!playing && safeEndIndex >= participant.days.length - 1) setEndIndex(0); setPlaying((value) => !value); }} />
        <div className="workspace-scroll" ref={workspaceScrollRef}>
          {screen === "sleep-records" && <DailySleepRecords day={selectedDay} resonance={resonance} onOpenResonance={() => resonance.pattern && setScreen("resonance")} />}
          {screen === "resonance" && resonance.pattern && <ResonanceDetail resonance={resonance} onBack={() => setScreen("sleep-records")} />}
          {screen === "overview" && <Overview participant={participant} window={rhythmWindow} onOpenPattern={openPattern} onOpenUpdates={() => setSheetOpen(true)} onHistory={() => setScreen("history")} />}
          {screen === "pattern" && <PatternDetail participant={participant} pattern={selectedPattern} window={rhythmWindow} onBack={() => setScreen("overview")} onEvidence={() => setScreen("evidence")} />}
          {screen === "evidence" && selectedPattern && <EvidenceScreen pattern={selectedPattern} window={rhythmWindow} onBack={() => setScreen("pattern")} />}
          {screen === "history" && <HistoryScreen participant={participant} currentWindow={rhythmWindow} onBack={() => setScreen("overview")} onOpen={(pattern) => { setHistoricalPattern(pattern); setScreen("historical"); }} />}
          {screen === "historical" && historicalPattern && <PatternDetail participant={participant} pattern={historicalPattern} window={{ ...rhythmWindow, start: historicalPattern.periodStart, end: historicalPattern.periodEnd }} historical onBack={() => setScreen("history")} />}
        </div>
      </main>
      <UpdateSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  );
}
