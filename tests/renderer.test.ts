import { describe, it, expect } from 'vitest';
import { VideoRenderer } from '../src/renderer.js';
import type { ShotSegment } from '../src/models.js';

describe('video renderer', () => {
  const renderer = new VideoRenderer({
    outputFile: 'dummy_output.mp4',
    draft: false,
    resolution: '1080p',
  });

  it('builds valid v360 filter for static cuts', () => {
    const staticCut: ShotSegment = {
      sourceFile: 'test.mp4',
      clipIndex: 0,
      startSec: 10,
      endSec: 16,
      duration: 6,
      shotType: 'trail_forward',
      yawStart: 0,
      pitchStart: -2,
      yawEnd: 0,
      pitchEnd: -2,
      isPan: false,
      fov: 105,
      score: 0.8,
      reason: 'Forward trail',
    };

    const filter = renderer.buildFilterString(staticCut);
    expect(filter).toContain('v360=input=e:output=rectilinear:yaw=0:pitch=-2:h_fov=105');
    expect(filter).toContain('scale=1920:1080');
  });

  it('builds valid animated v360 expression for dynamic pans', () => {
    const panShot: ShotSegment = {
      sourceFile: 'test.mp4',
      clipIndex: 0,
      startSec: 20,
      endSec: 25,
      duration: 5,
      shotType: 'scenic_pan',
      yawStart: 180,
      pitchStart: 12,
      yawEnd: 0,
      pitchEnd: -2,
      isPan: true,
      fov: 100,
      score: 0.9,
      reason: 'Hero to trail pan',
    };

    const filter = renderer.buildFilterString(panShot);
    expect(filter).toContain('v360=input=e:output=rectilinear:yaw=');
    expect(filter).toContain('cos(PI*min(1,max(0,t/5)))');
    expect(filter).toContain('h_fov=100');
    expect(filter).toContain('scale=1920:1080');
  });

  it('adjusts scale dimensions in draft mode', () => {
    const draftRenderer = new VideoRenderer({
      outputFile: 'draft.mp4',
      draft: true,
    });

    const cut: ShotSegment = {
      sourceFile: 'test.mp4',
      clipIndex: 0,
      startSec: 0,
      endSec: 5,
      duration: 5,
      shotType: 'trail_forward',
      yawStart: 0,
      pitchStart: 0,
      yawEnd: 0,
      pitchEnd: 0,
      isPan: false,
      fov: 105,
      score: 0.5,
      reason: 'test',
    };

    const filter = draftRenderer.buildFilterString(cut);
    expect(filter).toContain('scale=1280:720');
  });
});
