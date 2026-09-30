import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ClipAnalysis } from './models.js';
import { extractAndScoreAudio } from './audio.js';
import { extractAndScoreMotion } from './motion.js';
import { ObjectDetector } from './detector.js';

export interface AnalyzerOptions {
  sampleFps?: number;
  skipVision?: boolean;
  modelPath?: string;
  cacheDir?: string;
  onProgress?: (clipIndex: number, totalClips: number, stage: string) => void;
}

export class VideoAnalyzer {
  private sampleFps: number;
  private skipVision: boolean;
  private modelPath?: string;
  private cacheDir: string;
  private detector?: ObjectDetector;
  private onProgress?: (clipIndex: number, totalClips: number, stage: string) => void;

  constructor(options: AnalyzerOptions = {}) {
    this.sampleFps = options.sampleFps ?? 2;
    this.skipVision = options.skipVision ?? false;
    this.modelPath = options.modelPath;
    this.cacheDir = options.cacheDir ?? path.resolve(process.cwd(), '.analysis_cache');
    this.onProgress = options.onProgress;

    if (!this.skipVision) {
      this.detector = new ObjectDetector({ modelPath: this.modelPath });
    }
  }

  async analyzeClips(videoPaths: string[]): Promise<ClipAnalysis[]> {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }

    const analyses: ClipAnalysis[] = [];
    const total = videoPaths.length;

    for (let i = 0; i < total; i++) {
      const vPath = path.resolve(process.cwd(), videoPaths[i]);
      if (!fs.existsSync(vPath)) {
        throw new Error(`Input file not found: ${vPath}`);
      }

      const cacheFile = this.getCacheFilePath(vPath);
      if (fs.existsSync(cacheFile)) {
        try {
          const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as ClipAnalysis;
          cached.clipIndex = i;
          cached.sourceFile = vPath;
          analyses.push(cached);
          if (this.onProgress) {
            this.onProgress(i + 1, total, `Loaded analysis from cache: ${path.basename(vPath)}`);
          }
          continue;
        } catch {
          // Cache invalid, recompute
        }
      }

      if (this.onProgress) {
        this.onProgress(i + 1, total, `Analyzing motion: ${path.basename(vPath)}`);
      }
      const motionRes = await extractAndScoreMotion(vPath, this.sampleFps);

      if (this.onProgress) {
        this.onProgress(i + 1, total, `Filtering audio & wind noise: ${path.basename(vPath)}`);
      }
      const audioScores = await extractAndScoreAudio(vPath, 0.5, 200);

      let detections: any[] = [];
      if (!this.skipVision && this.detector) {
        if (this.onProgress) {
          this.onProgress(i + 1, total, `Running YOLOv11 rider tracking: ${path.basename(vPath)}`);
        }
        detections = await this.detector.detectInVideo(vPath, 1);
      }

      const analysis: ClipAnalysis = {
        sourceFile: vPath,
        clipIndex: i,
        durationSec: motionRes.durationSec,
        audioScores,
        motionScores: motionRes.motionScores,
        detections,
      };

      // Write to cache
      fs.writeFileSync(cacheFile, JSON.stringify(analysis, null, 2), 'utf8');
      analyses.push(analysis);
    }

    return analyses;
  }

  private getCacheFilePath(vPath: string): string {
    const stats = fs.statSync(vPath);
    const hash = `${path.basename(vPath)}_${stats.size}_${stats.mtimeMs}`;
    const safeHash = hash.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.cacheDir, `analysis_${safeHash}.json`);
  }
}
