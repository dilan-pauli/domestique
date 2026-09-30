import type {
  ClipAnalysis,
  EditDecisionList,
  MountProfile,
  ShotSegment,
  ShotType,
  TimeScore,
} from './models.js';
import { shortestAngularDelta } from './coordinates.js';

export interface PlannerOptions {
  mountType?: MountProfile;
  targetDurationSec?: number; // default 14 minutes = 840s
  minShotDuration?: number;   // default 4.0s
  maxShotDuration?: number;   // default 8.5s
  panPercentage?: number;     // default 0.15 (15% pans, 85% clean cuts)
}

interface CandidateChunk {
  clipIndex: number;
  sourceFile: string;
  startSec: number;
  endSec: number;
  duration: number;
  score: number;
  motionAvg: number;
  audioAvg: number;
  hasDetections: boolean;
  detectionsYawAvg?: number;
}

export class DirectorPlanner {
  private mount: MountProfile;
  private targetDuration: number;
  private minDuration: number;
  private maxDuration: number;
  private panRatio: number;

  constructor(options: PlannerOptions = {}) {
    this.mount = options.mountType ?? 'cockpit';
    this.targetDuration = options.targetDurationSec ?? 840; // 14 mins
    this.minDuration = options.minShotDuration ?? 4.0;
    this.maxDuration = options.maxShotDuration ?? 8.5;
    this.panRatio = options.panPercentage ?? 0.15;
  }

  plan(analyses: ClipAnalysis[]): EditDecisionList {
    if (analyses.length === 0) {
      throw new Error('No clip analyses provided to planner');
    }

    const totalSourceDuration = analyses.reduce((sum, a) => sum + a.durationSec, 0);
    const sourceFiles = analyses.map((a) => a.sourceFile);

    // 1. Generate candidate chunks across each clip
    const allCandidates: CandidateChunk[] = [];
    for (const analysis of analyses) {
      const chunks = this.generateCandidatesForClip(analysis);
      allCandidates.push(...chunks);
    }

    // 2. Select best chunks respecting proportional multi-clip distribution
    const selectedChunks = this.selectBalancedChunks(allCandidates, analyses, totalSourceDuration);

    // 3. Assign camera angles, shot types, and 85/15 cut-vs-pan transitions
    const segments = this.assignCinematography(selectedChunks);

    const actualDurationSec = Number(
      segments.reduce((sum, s) => sum + s.duration, 0).toFixed(2)
    );

    return {
      sourceFiles,
      totalSourceDurationSec: Number(totalSourceDuration.toFixed(2)),
      targetDurationSec: this.targetDuration,
      actualDurationSec,
      mountType: this.mount,
      segments,
    };
  }

  private generateCandidatesForClip(analysis: ClipAnalysis): CandidateChunk[] {
    const candidates: CandidateChunk[] = [];
    const clipDur = analysis.durationSec;
    let t = 0;

    // Nominal chunk length around 6.0 seconds
    const nominalDuration = (this.minDuration + this.maxDuration) / 2;

    while (t < clipDur) {
      let chunkEnd = Math.min(clipDur, t + nominalDuration);
      const rem = clipDur - chunkEnd;
      // Avoid tiny trailing fragments
      if (rem > 0 && rem < this.minDuration) {
        chunkEnd = clipDur;
      }
      const dur = chunkEnd - t;
      if (dur < this.minDuration && candidates.length > 0) {
        // Merge into previous if too short
        const prev = candidates[candidates.length - 1];
        prev.endSec = chunkEnd;
        prev.duration = prev.endSec - prev.startSec;
        break;
      }

      // Compute score for chunk [t, chunkEnd]
      const { score, motionAvg, audioAvg, hasDetections, detectionsYawAvg } =
        this.evaluateChunkWindow(analysis, t, chunkEnd);

      candidates.push({
        clipIndex: analysis.clipIndex,
        sourceFile: analysis.sourceFile,
        startSec: Number(t.toFixed(2)),
        endSec: Number(chunkEnd.toFixed(2)),
        duration: Number(dur.toFixed(2)),
        score,
        motionAvg,
        audioAvg,
        hasDetections,
        detectionsYawAvg,
      });

      t = chunkEnd;
    }

    return candidates;
  }

  private evaluateChunkWindow(analysis: ClipAnalysis, startSec: number, endSec: number) {
    const motionInWindow = analysis.motionScores.filter(
      (s) => s.timeSec >= startSec && s.timeSec <= endSec
    );
    const audioInWindow = analysis.audioScores.filter(
      (s) => s.timeSec >= startSec && s.timeSec <= endSec
    );
    const detsInWindow = analysis.detections.filter(
      (d) => d.timeSec >= startSec && d.timeSec <= endSec
    );

    const motionAvg =
      motionInWindow.length > 0
        ? motionInWindow.reduce((a, b) => a + b.score, 0) / motionInWindow.length
        : 0.5;

    const audioAvg =
      audioInWindow.length > 0
        ? audioInWindow.reduce((a, b) => a + b.score, 0) / audioInWindow.length
        : 0.5;

    const hasDetections = detsInWindow.length > 0;
    let detectionsYawAvg: number | undefined;
    if (hasDetections) {
      detectionsYawAvg =
        detsInWindow.reduce((sum, d) => sum + d.yaw, 0) / detsInWindow.length;
    }

    const detScore = hasDetections ? 1.0 : 0.2;
    // Composite weighted score
    const score = Number((0.40 * motionAvg + 0.35 * audioAvg + 0.25 * detScore).toFixed(4));

    return { score, motionAvg, audioAvg, hasDetections, detectionsYawAvg };
  }

  private selectBalancedChunks(
    allCandidates: CandidateChunk[],
    analyses: ClipAnalysis[],
    totalSourceDuration: number
  ): CandidateChunk[] {
    // If source duration is already under target, keep all chunks chronologically
    if (totalSourceDuration <= this.targetDuration) {
      return allCandidates;
    }

    const selected: CandidateChunk[] = [];

    // Distribute budget proportionally across clips
    for (const analysis of analyses) {
      const clipRatio = analysis.durationSec / totalSourceDuration;
      const clipBudget = this.targetDuration * clipRatio;

      const clipCandidates = allCandidates.filter(
        (c) => c.clipIndex === analysis.clipIndex
      );

      // Sort by score descending to pick top action
      const sortedByScore = [...clipCandidates].sort((a, b) => b.score - a.score);

      const keptSet = new Set<CandidateChunk>();
      let accumulated = 0;

      for (const cand of sortedByScore) {
        if (accumulated + cand.duration <= clipBudget * 1.05) {
          keptSet.add(cand);
          accumulated += cand.duration;
        }
      }

      // Re-sort selected chunks back into strict chronological order
      const clipSelected = clipCandidates.filter((c) => keptSet.has(c));
      selected.push(...clipSelected);
    }

    return selected;
  }

  private assignCinematography(chunks: CandidateChunk[]): ShotSegment[] {
    const segments: ShotSegment[] = [];
    let previousShotType: ShotType | null = null;
    let panCounter = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      panCounter++;

      // Decide whether this cut should be a dynamic pan (~15% of shots)
      // Condition: Every ~6-7 cuts, and not the very first or very last cut
      const isPanCandidate =
        panCounter >= Math.round(1 / this.panRatio) &&
        i > 0 &&
        i < chunks.length - 1;

      if (this.mount === 'cockpit') {
        const seg = this.planCockpitShot(chunk, previousShotType, isPanCandidate);
        if (seg.isPan) panCounter = 0;
        previousShotType = seg.shotType;
        segments.push(seg);
      } else {
        const seg = this.planRearShot(chunk, previousShotType, isPanCandidate);
        if (seg.isPan) panCounter = 0;
        previousShotType = seg.shotType;
        segments.push(seg);
      }
    }

    return segments;
  }

  private planCockpitShot(
    chunk: CandidateChunk,
    previous: ShotType | null,
    allowPan: boolean
  ): ShotSegment {
    // Cockpit mount heuristics:
    // 1. High motion / technical -> trail_forward (Yaw 0, Pitch -2)
    // 2. High audio / vocal reaction or steady pace -> hero_rider face cam (Yaw 180, Pitch +12)
    // 3. Side rider detected -> pack_flank (Yaw +/- 60, Pitch 0)
    // 4. Occasional pan -> scenic_pan from Yaw 0 to Yaw 90, or 180 to 0

    let shotType: ShotType = 'trail_forward';
    let yawStart = 0;
    let pitchStart = -2;
    let yawEnd = 0;
    let pitchEnd = -2;
    let isPan = false;
    let fov = 105;
    let reason = 'Trail forward action';

    if (chunk.hasDetections && chunk.detectionsYawAvg !== undefined) {
      const absYaw = Math.abs(chunk.detectionsYawAvg);
      if (absYaw >= 35 && absYaw <= 120) {
        shotType = 'pack_flank';
        yawStart = Number(chunk.detectionsYawAvg.toFixed(1));
        pitchStart = 0;
        yawEnd = yawStart;
        pitchEnd = 0;
        reason = `Pack flank view (rider detected at yaw ${yawStart}°)`;
      }
    }

    if (shotType === 'trail_forward') {
      // Alternate between forward action and hero rider face view
      if (previous === 'trail_forward' && (chunk.audioAvg > 0.6 || chunk.score < 0.65)) {
        shotType = 'hero_rider';
        yawStart = 180;
        pitchStart = 12;
        yawEnd = 180;
        pitchEnd = 12;
        fov = 100;
        reason = 'Hero rider face cam (audio surge / steady effort)';
      }
    }

    if (allowPan && chunk.duration >= 5.0) {
      isPan = true;
      shotType = 'scenic_pan';
      if (previous === 'hero_rider') {
        yawStart = 180;
        pitchStart = 12;
        yawEnd = 0;
        pitchEnd = -2;
        reason = 'Dynamic pan from hero rider forward to trail';
      } else {
        yawStart = 0;
        pitchStart = -2;
        yawEnd = 80;
        pitchEnd = 2;
        reason = 'Scenic sweep across landscape';
      }
    }

    return {
      sourceFile: chunk.sourceFile,
      clipIndex: chunk.clipIndex,
      startSec: chunk.startSec,
      endSec: chunk.endSec,
      duration: chunk.duration,
      shotType,
      yawStart,
      pitchStart,
      yawEnd,
      pitchEnd,
      isPan,
      fov,
      score: chunk.score,
      reason,
    };
  }

  private planRearShot(
    chunk: CandidateChunk,
    previous: ShotType | null,
    allowPan: boolean
  ): ShotSegment {
    // Rear mount heuristics:
    // 1. Primary: hero_rider looking forward past the rider (Yaw 0, Pitch -5)
    // 2. The Chase: pack_chase looking behind (Yaw 180, Pitch +2)
    // 3. Scenic: lateral vista (Yaw +/- 90)

    let shotType: ShotType = 'hero_rider';
    let yawStart = 0;
    let pitchStart = -5;
    let yawEnd = 0;
    let pitchEnd = -5;
    let isPan = false;
    let fov = 105;
    let reason = 'Hero rider in foreground looking ahead';

    if (previous === 'hero_rider' && (chunk.audioAvg > 0.55 || chunk.hasDetections)) {
      shotType = 'pack_chase';
      yawStart = 180;
      pitchStart = 2;
      yawEnd = 180;
      pitchEnd = 2;
      reason = 'Pack chase view looking backward';
    }

    if (allowPan && chunk.duration >= 5.0) {
      isPan = true;
      shotType = 'scenic_pan';
      yawStart = 180;
      pitchStart = 2;
      yawEnd = 0;
      pitchEnd = -5;
      reason = 'Dynamic pan from trailing pack to hero forward';
    }

    return {
      sourceFile: chunk.sourceFile,
      clipIndex: chunk.clipIndex,
      startSec: chunk.startSec,
      endSec: chunk.endSec,
      duration: chunk.duration,
      shotType,
      yawStart,
      pitchStart,
      yawEnd,
      pitchEnd,
      isPan,
      fov,
      score: chunk.score,
      reason,
    };
  }
}
