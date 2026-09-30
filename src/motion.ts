import { spawn } from 'node:child_process';
import type { TimeScore } from './models.js';

export interface MotionAnalysisResult {
  fps: number;
  durationSec: number;
  motionScores: TimeScore[];
  sceneCuts: number[]; // timestamps where abrupt scene cuts occurred
}

/**
 * Extracts low-resolution grayscale thumbnail frames (160x90 @ 2fps)
 * and computes inter-frame motion scores and scene cuts.
 *
 * For a 30-minute clip, total stream size is only ~52 MB.
 */
export async function extractAndScoreMotion(
  videoPath: string,
  sampleFps = 2
): Promise<MotionAnalysisResult> {
  return new Promise((resolve, reject) => {
    const width = 160;
    const height = 90;
    const frameBytes = width * height;

    const args = [
      '-v', 'error',
      '-i', videoPath,
      '-vf', `fps=${sampleFps},scale=${width}:${height},format=gray`,
      '-f', 'rawvideo',
      'pipe:1',
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let leftover = Buffer.alloc(0);
    let prevFrame: Uint8Array | null = null;
    let frameIndex = 0;

    const motionScores: TimeScore[] = [];
    const sceneCuts: number[] = [];
    let maxDiff = 1e-4;

    proc.stdout.on('data', (chunk: Buffer) => {
      const data = Buffer.concat([leftover, chunk]);
      let offset = 0;

      while (offset + frameBytes <= data.length) {
        const frame = new Uint8Array(data.buffer, data.byteOffset + offset, frameBytes);
        const timeSec = Number((frameIndex / sampleFps).toFixed(2));

        if (prevFrame) {
          let sumDiff = 0;
          for (let i = 0; i < frameBytes; i++) {
            sumDiff += Math.abs(frame[i] - prevFrame[i]);
          }
          const meanDiff = sumDiff / frameBytes; // Range 0..255
          const normalized = meanDiff / 255.0;

          if (normalized > maxDiff) {
            maxDiff = normalized;
          }

          // Abrupt jump detection (scene change cut)
          if (normalized > 0.40) {
            sceneCuts.push(timeSec);
          }

          motionScores.push({
            timeSec,
            score: normalized,
          });
        } else {
          // First frame
          motionScores.push({ timeSec: 0, score: 0 });
        }

        prevFrame = new Uint8Array(frame); // copy for comparison
        frameIndex++;
        offset += frameBytes;
      }

      leftover = Buffer.from(data.subarray(offset));
    });

    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0 && motionScores.length === 0) {
        reject(new Error(`FFmpeg motion analysis failed: ${stderr}`));
        return;
      }

      // Normalize scores relative to maxDiff
      const normalizedScores = motionScores.map((s) => ({
        timeSec: s.timeSec,
        score: Number(Math.min(1.0, s.score / maxDiff).toFixed(4)),
      }));

      const durationSec = frameIndex / sampleFps;

      resolve({
        fps: sampleFps,
        durationSec,
        motionScores: normalizedScores,
        sceneCuts,
      });
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}
