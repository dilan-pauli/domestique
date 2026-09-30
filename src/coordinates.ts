/**
 * Coordinate conversions and spherical angle utilities for 360 equirectangular video.
 */

/**
 * Normalizes an angle into the canonical range [-180, 180).
 */
export function normalizeYaw(yaw: number): number {
  let norm = ((yaw + 180) % 360 + 360) % 360 - 180;
  // Edge case: exactly 180 wraps to -180
  if (norm === 180) norm = -180;
  return norm;
}

/**
 * Clamps pitch to [-90, 90].
 */
export function clampPitch(pitch: number): number {
  return Math.max(-90, Math.min(90, pitch));
}

/**
 * Converts normalized equirectangular coordinates (0..1, where 0,0 is top-left)
 * to spherical Yaw and Pitch in degrees.
 *
 * - x=0.5 (center) -> Yaw = 0° (Forward)
 * - x=0.0 (left edge) -> Yaw = -180°
 * - x=1.0 (right edge) -> Yaw = +180°
 * - y=0.5 (equator) -> Pitch = 0° (Horizon level)
 * - y=0.0 (top zenith) -> Pitch = +90°
 * - y=1.0 (bottom nadir) -> Pitch = -90°
 */
export function equirectToSpherical(normX: number, normY: number): { yaw: number; pitch: number } {
  const yaw = (normX - 0.5) * 360;
  const pitch = (0.5 - normY) * 180;
  return {
    yaw: normalizeYaw(yaw),
    pitch: clampPitch(pitch),
  };
}

/**
 * Calculates the shortest angular distance (delta) between two yaw angles in degrees.
 * Handles wrapping around the -180° / +180° seam.
 *
 * Example:
 *   from +170° to -170° -> returns +20° (not -340°)
 *   from -170° to +170° -> returns -20° (not +340°)
 */
export function shortestAngularDelta(fromYaw: number, toYaw: number): number {
  const diff = toYaw - fromYaw;
  return ((((diff + 180) % 360) + 360) % 360) - 180;
}

/**
 * Evaluates a cosine ease-in-out curve for smooth camera transitions.
 * tNorm: normalized progress from 0.0 to 1.0.
 * Returns eased value in [0.0, 1.0].
 */
export function cosineEase(tNorm: number): number {
  const clamped = Math.max(0, Math.min(1, tNorm));
  return (1 - Math.cos(Math.PI * clamped)) / 2;
}

/**
 * Interpolates between two angles across the shortest path using cosine easing.
 */
export function interpolateYaw(fromYaw: number, toYaw: number, tNorm: number): number {
  const delta = shortestAngularDelta(fromYaw, toYaw);
  const eased = cosineEase(tNorm);
  return normalizeYaw(fromYaw + delta * eased);
}

/**
 * Generates an FFmpeg expression string for animated yaw during a dynamic pan.
 * durationSec: length of the shot in seconds.
 * Expression evaluates relative to shot start time 't' (where t runs from 0 to durationSec).
 */
export function generateFFmpegPanExpression(
  fromYaw: number,
  toYaw: number,
  fromPitch: number,
  toPitch: number,
  durationSec: number
): { yawExpr: string; pitchExpr: string } {
  const deltaYaw = shortestAngularDelta(fromYaw, toYaw);
  const deltaPitch = toPitch - fromPitch;

  // FFmpeg expression: fromYaw + deltaYaw * (1 - cos(PI * min(1, max(0, t/D)))) / 2
  const yawExpr = `${fromYaw}+(${deltaYaw})*(1-cos(PI*min(1,max(0,t/${durationSec}))))/2`;
  const pitchExpr = `${fromPitch}+(${deltaPitch})*(1-cos(PI*min(1,max(0,t/${durationSec}))))/2`;

  return { yawExpr, pitchExpr };
}
