import type { BarkFeatures } from "./bark-scoring";

export type BarkAudioFrame = {
  timeMs: number;
  rms: number;
  peak: number;
  zcr: number;
  brightness: number;
  flatness: number;
  depth: number;
  pitchHz: number | null;
};

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

function percentile(values: number[], quantile: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = clamp(quantile) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const mix = position - lower;
  return sorted[lower] * (1 - mix) + sorted[upper] * mix;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(
    values.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) /
      values.length,
  );
}

function estimatePitch(samples: Float32Array, sampleRate: number, rms: number) {
  if (rms < 0.012) return null;
  let mean = 0;
  for (const sample of samples) mean += sample;
  mean /= samples.length;

  const minLag = Math.max(2, Math.floor(sampleRate / 1000));
  const maxLag = Math.min(samples.length - 3, Math.ceil(sampleRate / 70));
  let bestLag = 0;
  let bestCorrelation = 0;
  const correlations = new Float32Array(maxLag + 1);

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let product = 0;
    let energyA = 0;
    let energyB = 0;
    const limit = samples.length - lag;
    for (let index = 0; index < limit; index += 1) {
      const left = samples[index] - mean;
      const right = samples[index + lag] - mean;
      product += left * right;
      energyA += left * left;
      energyB += right * right;
    }
    const correlation = product / Math.sqrt(energyA * energyB + 1e-12);
    correlations[lag] = correlation;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (bestCorrelation < 0.52 || !bestLag) return null;
  const preferredPeak = Math.max(0.55, bestCorrelation * 0.9);
  for (let lag = minLag + 1; lag < bestLag; lag += 1) {
    if (
      correlations[lag] >= preferredPeak &&
      correlations[lag] >= correlations[lag - 1] &&
      correlations[lag] > correlations[lag + 1]
    ) {
      bestLag = lag;
      break;
    }
  }
  const left = correlations[bestLag - 1] ?? correlations[bestLag];
  const center = correlations[bestLag];
  const right = correlations[bestLag + 1] ?? correlations[bestLag];
  const denominator = left - 2 * center + right;
  const offset = Math.abs(denominator) > 1e-6 ? 0.5 * (left - right) / denominator : 0;
  const refinedLag = bestLag + clamp(offset, -0.5, 0.5);
  const pitch = sampleRate / refinedLag;
  return pitch >= 70 && pitch <= 1000 ? pitch : null;
}

export function analyseAudioFrame(
  timeMs: number,
  samples: Float32Array,
  spectrum: Uint8Array,
  sampleRate: number,
): BarkAudioFrame {
  let energy = 0;
  let peak = 0;
  let zeroCrossings = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    energy += value * value;
    peak = Math.max(peak, Math.abs(value));
    if (index > 0 && samples[index - 1] * value < 0) zeroCrossings += 1;
  }
  const rms = Math.sqrt(energy / samples.length);

  const binHz = sampleRate / (spectrum.length * 2);
  const maxBin = Math.min(spectrum.length - 1, Math.ceil(6000 / binHz));
  const lowBin = Math.ceil(450 / binHz);
  let spectralEnergy = 0;
  let lowEnergy = 0;
  let weightedFrequency = 0;
  let logMagnitude = 0;
  let countedBins = 0;
  for (let index = 1; index <= maxBin; index += 1) {
    const magnitude = Math.pow(spectrum[index] / 255, 2) + 1e-8;
    spectralEnergy += magnitude;
    if (index <= lowBin) lowEnergy += magnitude;
    weightedFrequency += index * binHz * magnitude;
    logMagnitude += Math.log(magnitude);
    countedBins += 1;
  }
  const centroid = spectralEnergy ? weightedFrequency / spectralEnergy : 0;
  const arithmeticMean = spectralEnergy / Math.max(1, countedBins);
  const geometricMean = Math.exp(logMagnitude / Math.max(1, countedBins));

  return {
    timeMs,
    rms,
    peak,
    zcr: zeroCrossings / samples.length,
    brightness: clamp(centroid / 5000),
    flatness: clamp(geometricMean / Math.max(arithmeticMean, 1e-8)),
    depth: clamp(lowEnergy / Math.max(spectralEnergy, 1e-8)),
    pitchHz: estimatePitch(samples, sampleRate, rms),
  };
}

export function summarizeBarkFrames(
  frames: BarkAudioFrame[],
  durationMs = 10_000,
): BarkFeatures {
  if (!frames.length) {
    return {
      loudness: 0,
      peak: 0,
      dynamics: 0,
      activity: 0,
      silence: 1,
      attackRate: 0,
      rhythm: 0,
      sustain: 0,
      pitchHeight: 0.5,
      pitchRange: 0,
      pitchRise: 0.5,
      pitchStability: 0,
      brightness: 0,
      roughness: 0,
      depth: 0,
    };
  }

  const rmsValues = frames.map((frame) => frame.rms);
  const noiseFloor = Math.max(0.006, percentile(rmsValues, 0.12));
  const activityThreshold = Math.max(0.014, noiseFloor * 2.2);
  const active = frames.map((frame) => frame.rms > activityThreshold);
  const activeFrames = frames.filter((_, index) => active[index]);
  const measuredFrames = activeFrames.length ? activeFrames : frames;
  const loudnessValues = measuredFrames.map((frame) =>
    clamp((20 * Math.log10(Math.max(frame.rms, 1e-5)) + 55) / 45),
  );
  const peakValues = measuredFrames.map((frame) =>
    clamp((20 * Math.log10(Math.max(frame.peak, 1e-5)) + 50) / 45),
  );
  const activityRatio = activeFrames.length / frames.length;

  const onsets: number[] = [];
  let previousRms = noiseFloor;
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const rising =
      active[index] &&
      frame.rms > Math.max(activityThreshold * 1.25, previousRms * 1.45);
    if (rising && (!onsets.length || frame.timeMs - onsets.at(-1)! > 140)) {
      onsets.push(frame.timeMs);
    }
    previousRms = frame.rms;
  }
  const onsetIntervals = onsets.slice(1).map((time, index) => time - onsets[index]);
  const averageInterval = onsetIntervals.length
    ? onsetIntervals.reduce((sum, value) => sum + value, 0) / onsetIntervals.length
    : 0;
  const rhythm =
    onsetIntervals.length >= 2
      ? clamp(1 - standardDeviation(onsetIntervals) / Math.max(averageInterval, 1))
      : onsets.length === 1
        ? 0.55
        : 0;

  let longestRun = 0;
  let currentRun = 0;
  for (const isActive of active) {
    currentRun = isActive ? currentRun + 1 : 0;
    longestRun = Math.max(longestRun, currentRun);
  }

  const pitchedFrames = activeFrames.filter(
    (frame): frame is BarkAudioFrame & { pitchHz: number } => frame.pitchHz !== null,
  );
  const pitchSemitones = pitchedFrames.map((frame) => 12 * Math.log2(frame.pitchHz / 70));
  const pitchHeight = pitchedFrames.length
    ? clamp(
        (Math.log2(percentile(pitchedFrames.map((frame) => frame.pitchHz), 0.5)) -
          Math.log2(70)) /
          (Math.log2(900) - Math.log2(70)),
      )
    : 0.5;
  const pitchRange = pitchedFrames.length >= 3
    ? clamp((percentile(pitchSemitones, 0.9) - percentile(pitchSemitones, 0.1)) / 18)
    : 0;
  const pitchStability = pitchedFrames.length >= 3
    ? clamp(1 - standardDeviation(pitchSemitones) / 5.5)
    : 0;

  let pitchRise = 0.5;
  if (pitchedFrames.length >= 4) {
    const firstTime = pitchedFrames[0].timeMs;
    const times = pitchedFrames.map((frame) => (frame.timeMs - firstTime) / 1000);
    const averageTime = times.reduce((sum, value) => sum + value, 0) / times.length;
    const averagePitch = pitchSemitones.reduce((sum, value) => sum + value, 0) / pitchSemitones.length;
    let covariance = 0;
    let timeVariance = 0;
    for (let index = 0; index < times.length; index += 1) {
      covariance += (times[index] - averageTime) * (pitchSemitones[index] - averagePitch);
      timeVariance += Math.pow(times[index] - averageTime, 2);
    }
    const slope = covariance / Math.max(timeVariance, 1e-6);
    const observedDuration = Math.max(0.5, times.at(-1)! - times[0]);
    pitchRise = clamp(0.5 + (slope * observedDuration) / 18);
  }

  const average = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const brightness = average(measuredFrames.map((frame) => frame.brightness));
  const flatness = average(measuredFrames.map((frame) => frame.flatness));
  const zcr = average(measuredFrames.map((frame) => frame.zcr));

  return {
    loudness: average(loudnessValues),
    peak: percentile(peakValues, 0.95),
    dynamics: clamp(percentile(loudnessValues, 0.9) - percentile(loudnessValues, 0.1)),
    activity: clamp(activityRatio),
    silence: clamp(1 - activityRatio),
    attackRate: clamp((onsets.length / Math.max(durationMs / 1000, 1)) / 3.5),
    rhythm,
    sustain: clamp(longestRun / frames.length),
    pitchHeight,
    pitchRange,
    pitchRise,
    pitchStability,
    brightness,
    roughness: clamp(zcr / 0.18 * 0.55 + flatness * 0.45),
    depth: average(measuredFrames.map((frame) => frame.depth)),
  };
}
