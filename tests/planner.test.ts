import { describe, it, expect } from 'vitest';
import { DirectorPlanner } from '../src/planner.js';
import type { ClipAnalysis } from '../src/models.js';

function createMockAnalysis(
  sourceFile: string,
  clipIndex: number,
  durationSec: number
): ClipAnalysis {
  const audioScores = [];
  const motionScores = [];
  const detections = [];

  for (let t = 0; t < durationSec; t += 1.0) {
    // Alternate higher and lower activity
    const activity = 0.3 + 0.6 * Math.sin((t / 20) * Math.PI);
    audioScores.push({ timeSec: t, score: Math.max(0.1, activity) });
    motionScores.push({ timeSec: t, score: Math.max(0.1, 1.0 - activity) });

    if (t % 15 === 0) {
      detections.push({
        timeSec: t,
        bbox: [0.65, 0.45, 0.1, 0.2] as [number, number, number, number],
        label: 'bicycle',
        confidence: 0.88,
        yaw: 55.0, // flanking rider
        pitch: 0.0,
      });
    }
  }

  return {
    sourceFile,
    clipIndex,
    durationSec,
    audioScores,
    motionScores,
    detections,
  };
}

describe('director planner', () => {
  it('respects target budget and chronological ordering across multiple clips', () => {
    // 2 clips, each 600 seconds (10 mins) = 1200 seconds (20 mins) total
    const clip1 = createMockAnalysis('ride_part1.mp4', 0, 600);
    const clip2 = createMockAnalysis('ride_part2.mp4', 1, 600);

    const planner = new DirectorPlanner({
      targetDurationSec: 480, // target 8 minutes
      mountType: 'cockpit',
    });

    const edl = planner.plan([clip1, clip2]);

    expect(edl.segments.length).toBeGreaterThan(0);
    expect(edl.actualDurationSec).toBeLessThanOrEqual(520); // within 10% budget margin

    // Verify clips from BOTH files were selected
    const clip0Segments = edl.segments.filter((s) => s.clipIndex === 0);
    const clip1Segments = edl.segments.filter((s) => s.clipIndex === 1);
    expect(clip0Segments.length).toBeGreaterThan(0);
    expect(clip1Segments.length).toBeGreaterThan(0);

    // Verify chronological order within each clip
    for (let i = 1; i < clip0Segments.length; i++) {
      expect(clip0Segments[i].startSec).toBeGreaterThanOrEqual(clip0Segments[i - 1].endSec);
    }
    for (let i = 1; i < clip1Segments.length; i++) {
      expect(clip1Segments[i].startSec).toBeGreaterThanOrEqual(clip1Segments[i - 1].endSec);
    }

    // Verify pacing: no shot below minShotDuration (4.0s)
    for (const seg of edl.segments) {
      expect(seg.duration).toBeGreaterThanOrEqual(3.8);
    }
  });

  it('allocates mostly clean cuts and occasional dynamic pans', () => {
    const clip = createMockAnalysis('ride_full.mp4', 0, 900); // 15 mins
    const planner = new DirectorPlanner({
      targetDurationSec: 500,
      mountType: 'cockpit',
      panPercentage: 0.15,
    });

    const edl = planner.plan([clip]);
    const pans = edl.segments.filter((s) => s.isPan);
    const cleanCuts = edl.segments.filter((s) => !s.isPan);

    expect(cleanCuts.length).toBeGreaterThan(pans.length);
    // Pan ratio should be between 5% and 25%
    const panRatio = pans.length / edl.segments.length;
    expect(panRatio).toBeGreaterThan(0.05);
    expect(panRatio).toBeLessThan(0.25);
  });

  it('generates rear mount cinematography correctly', () => {
    const clip = createMockAnalysis('rear_ride.mp4', 0, 300);
    const planner = new DirectorPlanner({
      targetDurationSec: 150,
      mountType: 'rear',
    });

    const edl = planner.plan([clip]);
    expect(edl.mountType).toBe('rear');

    const shotTypes = new Set(edl.segments.map((s) => s.shotType));
    // Should have hero_rider or pack_chase
    expect(shotTypes.has('hero_rider') || shotTypes.has('pack_chase')).toBe(true);
  });
});
