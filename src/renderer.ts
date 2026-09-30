import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EditDecisionList, ShotSegment } from './models.js';
import { generateFFmpegPanExpression } from './coordinates.js';

export interface RenderOptions {
  outputFile: string;
  resolution?: '1080p' | '4k' | '720p'; // default 1080p (1920x1080)
  draft?: boolean;                      // fast draft preview mode
  burnIn?: boolean;                     // burn-in shot index, clip name, timestamps, yaw/pitch HUD
  useHardwareAccel?: boolean;           // use Intel VAAPI
  tempDir?: string;
  onProgress?: (current: number, total: number, msg: string) => void;
}

export class VideoRenderer {
  private output: string;
  private res: '1080p' | '4k' | '720p';
  private draft: boolean;
  private burnIn: boolean;
  private hwAccel: boolean;
  private tempDir: string;
  private onProgress?: (current: number, total: number, msg: string) => void;

  constructor(options: RenderOptions) {
    this.output = path.resolve(process.cwd(), options.outputFile);
    this.res = options.resolution ?? '1080p';
    this.draft = options.draft ?? false;
    this.burnIn = options.burnIn ?? (options.draft ?? false);
    this.tempDir = options.tempDir ?? path.resolve(process.cwd(), '.director_tmp');
    this.onProgress = options.onProgress;

    // Check if VAAPI is physically available
    const hasVaapi = fs.existsSync('/dev/dri/renderD128');
    this.hwAccel = options.useHardwareAccel ?? (hasVaapi && !this.draft);
  }

  /**
   * Builds the FFmpeg video filter graph for an individual shot segment.
   */
  buildFilterString(segment: ShotSegment, shotIndex?: number, totalShots?: number): string {
    const fov = segment.fov ?? 105;
    let v360Filter: string;

    if (segment.isPan) {
      const { yawExpr, pitchExpr } = generateFFmpegPanExpression(
        segment.yawStart,
        segment.yawEnd,
        segment.pitchStart,
        segment.pitchEnd,
        segment.duration
      );
      v360Filter = `v360=input=e:output=rectilinear:yaw='${yawExpr}':pitch='${pitchExpr}':h_fov=${fov}`;
    } else {
      v360Filter = `v360=input=e:output=rectilinear:yaw=${segment.yawStart}:pitch=${segment.pitchStart}:h_fov=${fov}`;
    }

    const scale = this.getScaleDimensions();
    let filter = `${v360Filter},scale=${scale.w}:${scale.h}`;

    if (this.burnIn) {
      const idxText = shotIndex !== undefined ? `Shot #${shotIndex}${totalShots ? '/' + totalShots : ''} | ` : '';
      const clipName = path.basename(segment.sourceFile);
      const panText = segment.isPan ? ` -> ${segment.yawEnd}°` : '';
      const hudText = `${idxText}${clipName} [${segment.startSec.toFixed(1)}s-${segment.endSec.toFixed(1)}s] | ${segment.shotType} | Yaw ${segment.yawStart}°${panText}`;
      const safeHud = hudText.replace(/'/g, '').replace(/:/g, '\\:');
      filter += `,drawtext=text='${safeHud}':x=20:y=20:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=6`;
    }

    return filter;
  }

  private getScaleDimensions(): { w: number; h: number } {
    if (this.draft || this.res === '720p') {
      return { w: 1280, h: 720 };
    }
    if (this.res === '4k') {
      return { w: 3840, h: 2160 };
    }
    return { w: 1920, h: 1080 }; // 1080p default
  }

  /**
   * Renders the complete EditDecisionList into the final output video.
   */
  async render(edl: EditDecisionList): Promise<string> {
    if (edl.segments.length === 0) {
      throw new Error('EDL has no segments to render');
    }

    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    const segmentFiles: string[] = [];
    const totalSegments = edl.segments.length;

    try {
      // 1. Render each segment individually
      for (let i = 0; i < totalSegments; i++) {
        const seg = edl.segments[i];
        const segFilename = path.join(this.tempDir, `seg_${String(i).padStart(4, '0')}.mp4`);

        if (this.onProgress) {
          this.onProgress(
            i + 1,
            totalSegments,
            `Rendering shot ${i + 1}/${totalSegments}: ${seg.shotType} (${seg.duration}s)`
          );
        }

        await this.renderSegment(seg, segFilename, i + 1, totalSegments);
        segmentFiles.push(segFilename);
      }

      // 2. Concatenate all segments seamlessly
      if (this.onProgress) {
        this.onProgress(totalSegments, totalSegments, 'Assembling final overview video...');
      }

      await this.concatenateSegments(segmentFiles, this.output);

      return this.output;
    } finally {
      // Cleanup temp segment files
      try {
        for (const file of segmentFiles) {
          if (fs.existsSync(file)) fs.unlinkSync(file);
        }
        const concatTxt = path.join(this.tempDir, 'concat_list.txt');
        if (fs.existsSync(concatTxt)) fs.unlinkSync(concatTxt);
        if (fs.existsSync(this.tempDir) && fs.readdirSync(this.tempDir).length === 0) {
          fs.rmdirSync(this.tempDir);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Renders a single segment from its source video file using FFmpeg.
   */
  async renderSegment(
    segment: ShotSegment,
    outputFile: string,
    shotIndex?: number,
    totalShots?: number
  ): Promise<void> {
    const filter = this.buildFilterString(segment, shotIndex, totalShots);
    const args: string[] = [
      '-y',
      '-ss', String(segment.startSec),
      '-t', String(segment.duration),
      '-i', segment.sourceFile,
      '-vf', filter,
    ];

    if (this.hwAccel) {
      // Hardware-accelerated Intel VAAPI encoding
      args.push(
        '-vaapi_device', '/dev/dri/renderD128',
        '-vf', `${filter},format=nv12,hwupload`,
        '-c:v', 'h264_vaapi',
        '-b:v', this.draft ? '8M' : '22M'
      );
    } else {
      // Fast CPU software encoding
      args.push(
        '-c:v', 'libx264',
        '-preset', this.draft ? 'ultrafast' : 'fast',
        '-crf', this.draft ? '26' : '19',
        '-pix_fmt', 'yuv420p'
      );
    }

    // Standard high quality stereo audio
    args.push('-c:a', 'aac', '-b:a', '192k', outputFile);

    await this.runFFmpeg(args);
  }

  /**
   * Stitches all cut segments together via the FFmpeg concat demuxer.
   */
  async concatenateSegments(segmentFiles: string[], finalOutput: string): Promise<void> {
    const concatListFile = path.join(this.tempDir, 'concat_list.txt');
    const content = segmentFiles
      .map((f) => `file '${f.replace(/'/g, "'\\''")}'`)
      .join('\n');

    fs.writeFileSync(concatListFile, content, 'utf8');

    const args = [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListFile,
      '-c', 'copy',
      finalOutput,
    ];

    await this.runFFmpeg(args);
  }

  private runFFmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';

      proc.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}:\n${stderr.slice(-1000)}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }
}
