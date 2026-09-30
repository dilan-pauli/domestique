import { describe, it, expect } from 'vitest';
import { BiquadHighPass, computeRmsScores } from '../src/audio.js';

describe('audio processing', () => {
  it('attenuates low frequency signals while preserving high frequencies', () => {
    const sampleRate = 16000;
    const durationSec = 1.0;
    const numSamples = sampleRate * durationSec;
    const filter = new BiquadHighPass(200, sampleRate); // 200 Hz cutoff

    // Generate 50 Hz sine wave (representing low frequency wind drone)
    const lowFreq = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      lowFreq[i] = Math.sin((2 * Math.PI * 50 * i) / sampleRate);
    }

    // Generate 1000 Hz sine wave (representing speech / bell / tire crunch)
    const highFreq = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      highFreq[i] = Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
    }

    const filteredLow = filter.processBuffer(lowFreq);
    const filter2 = new BiquadHighPass(200, sampleRate);
    const filteredHigh = filter2.processBuffer(highFreq);

    // Compute average magnitude after transient response
    let sumLow = 0;
    let sumHigh = 0;
    const startSample = Math.floor(sampleRate * 0.1); // ignore initial transient
    for (let i = startSample; i < numSamples; i++) {
      sumLow += Math.abs(filteredLow[i]);
      sumHigh += Math.abs(filteredHigh[i]);
    }
    const avgLow = sumLow / (numSamples - startSample);
    const avgHigh = sumHigh / (numSamples - startSample);

    // 50 Hz should be significantly attenuated compared to 1000 Hz
    expect(avgLow).toBeLessThan(0.15); // > 15 dB attenuation
    expect(avgHigh).toBeGreaterThan(0.60); // passes through with minimal loss
  });

  it('computes normalized windowed RMS scores', () => {
    const sampleRate = 16000;
    const samples = new Float32Array(sampleRate * 2); // 2 seconds

    // First second: quiet (0.1 amplitude)
    for (let i = 0; i < sampleRate; i++) {
      samples[i] = 0.1 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }
    // Second second: loud burst (1.0 amplitude)
    for (let i = sampleRate; i < samples.length; i++) {
      samples[i] = 1.0 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }

    const scores = computeRmsScores(samples, sampleRate, 0.5); // 0.5s windows -> 4 scores
    expect(scores.length).toBe(4);

    // First two windows (quiet) should have lower scores than last two windows (loud)
    expect(scores[0].score).toBeLessThan(scores[2].score);
    expect(scores[1].score).toBeLessThan(scores[3].score);
    // Peak window should be 1.0 (normalized)
    expect(scores[3].score).toBeCloseTo(1.0);
  });
});
