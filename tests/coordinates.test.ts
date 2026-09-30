import { describe, it, expect } from 'vitest';
import {
  normalizeYaw,
  shortestAngularDelta,
  equirectToSpherical,
  interpolateYaw,
  cosineEase,
  generateFFmpegPanExpression,
} from '../src/coordinates.js';

describe('coordinates', () => {
  it('normalizes yaw angles properly', () => {
    expect(normalizeYaw(0)).toBe(0);
    expect(normalizeYaw(180)).toBe(-180); // canonical boundary
    expect(normalizeYaw(-180)).toBe(-180);
    expect(normalizeYaw(190)).toBe(-170);
    expect(normalizeYaw(-190)).toBe(170);
    expect(normalizeYaw(540)).toBe(-180);
    expect(normalizeYaw(-540)).toBe(-180);
  });

  it('converts equirectangular pixel coordinates to spherical angles', () => {
    // Center: x=0.5, y=0.5 -> forward (yaw=0, pitch=0)
    const center = equirectToSpherical(0.5, 0.5);
    expect(center.yaw).toBeCloseTo(0);
    expect(center.pitch).toBeCloseTo(0);

    // Left edge: x=0, y=0.5 -> yaw=-180
    const left = equirectToSpherical(0, 0.5);
    expect(left.yaw).toBeCloseTo(-180);
    expect(left.pitch).toBeCloseTo(0);

    // Top center: x=0.5, y=0.0 -> pitch=+90
    const top = equirectToSpherical(0.5, 0.0);
    expect(top.yaw).toBeCloseTo(0);
    expect(top.pitch).toBeCloseTo(90);

    // Bottom center: x=0.5, y=1.0 -> pitch=-90
    const bottom = equirectToSpherical(0.5, 1.0);
    expect(bottom.yaw).toBeCloseTo(0);
    expect(bottom.pitch).toBeCloseTo(-90);
  });

  it('computes shortest angular distance across -180/180 boundary', () => {
    // Standard delta
    expect(shortestAngularDelta(0, 45)).toBe(45);
    expect(shortestAngularDelta(45, 0)).toBe(-45);

    // Seam crossing: from +170 to -170 should be +20 degrees (turning clockwise past 180)
    expect(shortestAngularDelta(170, -170)).toBe(20);

    // Seam crossing: from -170 to +170 should be -20 degrees (turning counter-clockwise past -180)
    expect(shortestAngularDelta(-170, 170)).toBe(-20);

    // Exact opposite: from 0 to 180
    expect(Math.abs(shortestAngularDelta(0, 180))).toBe(180);
  });

  it('computes cosine easing curve', () => {
    expect(cosineEase(0)).toBeCloseTo(0);
    expect(cosineEase(0.5)).toBeCloseTo(0.5);
    expect(cosineEase(1)).toBeCloseTo(1);
  });

  it('interpolates yaw across shortest path', () => {
    // Halfway from +170 to -170 should be -180 (or 180)
    const mid = interpolateYaw(170, -170, 0.5);
    expect(Math.abs(mid)).toBe(180);

    // Start
    expect(interpolateYaw(170, -170, 0)).toBe(170);
    // End
    expect(interpolateYaw(170, -170, 1)).toBe(-170);
  });

  it('generates valid FFmpeg pan expressions', () => {
    const { yawExpr, pitchExpr } = generateFFmpegPanExpression(170, -170, 0, 5, 4.0);
    expect(yawExpr).toContain('170');
    expect(yawExpr).toContain('(20)');
    expect(yawExpr).toContain('t/4');
    expect(pitchExpr).toContain('0+(5)');
  });
});
