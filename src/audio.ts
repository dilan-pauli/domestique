import { spawn } from 'node:child_process';
import type { TimeScore } from './models.js';

/**
 * 2nd-order Biquad High-Pass Filter implementation.
 * Used to strip low-frequency wind buffeting from action camera microphones.
 */
export class BiquadHighPass {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;

  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(cutoffHz = 200, sampleRate = 16000, Q = 0.7071) {
    const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
    const cosw0 = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Q);

    const a0 = 1 + alpha;
    this.b0 = ((1 + cosw0) / 2) / a0;
    this.b1 = (-(1 + cosw0)) / a0;
    this.b2 = ((1 + cosw0) / 2) / a0;
    this.a1 = (-2 * cosw0) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  processSample(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  processBuffer(samples: Float32Array): Float32Array {
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      out[i] = this.processSample(samples[i]);
    }
    return out;
  }
}

/**
 * Computes windowed Root-Mean-Square (RMS) energy across audio samples.
 * Returns an array of { timeSec, score } normalized into [0, 1].
 */
export function computeRmsScores(
  samples: Float32Array,
  sampleRate = 16000,
  windowDurationSec = 0.5
): TimeScore[] {
  const windowSize = Math.floor(sampleRate * windowDurationSec);
  const totalWindows = Math.floor(samples.length / windowSize);

  if (totalWindows === 0) return [];

  const rawRms: number[] = new Array(totalWindows);
  let maxRms = 1e-6;

  for (let w = 0; w < totalWindows; w++) {
    const start = w * windowSize;
    let sumSq = 0;
    for (let i = 0; i < windowSize; i++) {
      const val = samples[start + i];
      sumSq += val * val;
    }
    const rms = Math.sqrt(sumSq / windowSize);
    rawRms[w] = rms;
    if (rms > maxRms) maxRms = rms;
  }

  const scores: TimeScore[] = [];
  for (let w = 0; w < totalWindows; w++) {
    const timeSec = (w + 0.5) * windowDurationSec;
    const normalizedScore = Math.min(1.0, rawRms[w] / maxRms);
    scores.push({
      timeSec: Number(timeSec.toFixed(2)),
      score: Number(normalizedScore.toFixed(4)),
    });
  }

  return scores;
}

/**
 * Extracts mono 16kHz PCM audio from a video file using FFmpeg,
 * applies a 200 Hz high-pass filter to strip wind noise,
 * and returns windowed RMS scores.
 */
export async function extractAndScoreAudio(
  videoPath: string,
  windowSec = 0.5,
  cutoffHz = 200
): Promise<TimeScore[]> {
  return new Promise((resolve, reject) => {
    const sampleRate = 16000;
    const args = [
      '-v', 'error',
      '-i', videoPath,
      '-vn',
      '-ac', '1',
      '-ar', String(sampleRate),
      '-f', 's16le',
      'pipe:1',
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];

    proc.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        // If file has no audio stream (code != 0), return empty scores gracefully
        resolve([]);
        return;
      }

      const totalBuffer = Buffer.concat(chunks);
      const sampleCount = Math.floor(totalBuffer.length / 2);
      const samples = new Float32Array(sampleCount);

      // Convert 16-bit signed PCM to normalized float [-1.0, 1.0]
      for (let i = 0; i < sampleCount; i++) {
        const int16 = totalBuffer.readInt16LE(i * 2);
        samples[i] = int16 / 32768.0;
      }

      // Filter out low-frequency gravel/wind buffeting
      const filter = new BiquadHighPass(cutoffHz, sampleRate);
      const filtered = filter.processBuffer(samples);

      const scores = computeRmsScores(filtered, sampleRate, windowSec);
      resolve(scores);
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}
