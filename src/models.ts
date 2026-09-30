import { z } from 'zod';

export const MountProfileSchema = z.enum(['cockpit', 'rear']);
export type MountProfile = z.infer<typeof MountProfileSchema>;

export const ShotTypeSchema = z.enum([
  'trail_forward',
  'hero_rider',
  'pack_flank',
  'pack_chase',
  'scenic_pan',
  'scenic_vista',
]);
export type ShotType = z.infer<typeof ShotTypeSchema>;

export const ShotSegmentSchema = z.object({
  sourceFile: z.string(),
  clipIndex: z.number().int().nonnegative(),
  startSec: z.number().nonnegative(),
  endSec: z.number().positive(),
  duration: z.number().positive(),
  shotType: ShotTypeSchema,
  yawStart: z.number(),
  pitchStart: z.number(),
  yawEnd: z.number(),
  pitchEnd: z.number(),
  isPan: z.boolean(),
  fov: z.number().default(105),
  score: z.number(),
  reason: z.string(),
});
export type ShotSegment = z.infer<typeof ShotSegmentSchema>;

export const EditDecisionListSchema = z.object({
  sourceFiles: z.array(z.string()).min(1),
  totalSourceDurationSec: z.number().nonnegative(),
  targetDurationSec: z.number().positive(),
  actualDurationSec: z.number().nonnegative(),
  mountType: MountProfileSchema,
  segments: z.array(ShotSegmentSchema),
});
export type EditDecisionList = z.infer<typeof EditDecisionListSchema>;

export const DetectionItemSchema = z.object({
  timeSec: z.number(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]), // [normX, normY, normW, normH]
  label: z.string(),
  confidence: z.number(),
  yaw: z.number(),
  pitch: z.number(),
});
export type DetectionItem = z.infer<typeof DetectionItemSchema>;

export const TimeScoreSchema = z.object({
  timeSec: z.number(),
  score: z.number(),
});
export type TimeScore = z.infer<typeof TimeScoreSchema>;

export const ClipAnalysisSchema = z.object({
  sourceFile: z.string(),
  clipIndex: z.number(),
  durationSec: z.number(),
  audioScores: z.array(TimeScoreSchema),
  motionScores: z.array(TimeScoreSchema),
  detections: z.array(DetectionItemSchema),
});
export type ClipAnalysis = z.infer<typeof ClipAnalysisSchema>;
