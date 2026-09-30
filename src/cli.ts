#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Table from 'cli-table3';
import pc from 'picocolors';
import { VideoAnalyzer } from './analyzer.js';
import { DirectorPlanner } from './planner.js';
import { VideoRenderer } from './renderer.js';
import { EditDecisionListSchema, type EditDecisionList, type MountProfile } from './models.js';

const program = new Command();

program
  .name('director')
  .description('Automated Director Agent for Insta360 Gravel Cycling 360° Footage')
  .version('1.0.0');

function printEdlSummary(edl: EditDecisionList) {
  console.log('\n' + pc.bold(pc.cyan('🎬 Edit Decision List (EDL) Summary:')));
  console.log(`  Source Files   : ${edl.sourceFiles.length} file(s) (${edl.totalSourceDurationSec.toFixed(1)}s total)`);
  console.log(`  Target Duration: ${(edl.targetDurationSec / 60).toFixed(1)} min (${edl.targetDurationSec}s)`);
  console.log(`  Actual Duration: ${(edl.actualDurationSec / 60).toFixed(1)} min (${edl.actualDurationSec.toFixed(1)}s)`);
  console.log(`  Mount Profile  : ${pc.yellow(edl.mountType.toUpperCase())}`);
  console.log(`  Total Shots    : ${edl.segments.length} shots\n`);

  const table = new Table({
    head: [
      pc.bold('#'),
      pc.bold('Clip'),
      pc.bold('Start'),
      pc.bold('End'),
      pc.bold('Dur'),
      pc.bold('Shot Type'),
      pc.bold('Yaw (Pan)'),
      pc.bold('Pitch'),
      pc.bold('Reason'),
    ],
    colWidths: [4, 18, 9, 9, 7, 16, 17, 8, 38],
  });

  edl.segments.forEach((seg, idx) => {
    const isPan = seg.isPan;
    const typeLabel = isPan ? pc.magenta(`${seg.shotType} (PAN)`) : pc.green(seg.shotType);
    const yawLabel = isPan
      ? `${seg.yawStart}° → ${seg.yawEnd}°`
      : `${seg.yawStart}°`;
    const pitchLabel = `${seg.pitchStart}°`;
    const clipName = path.basename(seg.sourceFile);

    table.push([
      idx + 1,
      clipName.length > 16 ? clipName.slice(0, 13) + '...' : clipName,
      `${seg.startSec.toFixed(1)}s`,
      `${seg.endSec.toFixed(1)}s`,
      `${seg.duration.toFixed(1)}s`,
      typeLabel,
      yawLabel,
      pitchLabel,
      seg.reason,
    ]);
  });

  console.log(table.toString());
}

program
  .command('auto')
  .description('Run complete automated pipeline: analyze -> plan -> render')
  .argument('<inputs...>', 'Input 360 MP4 video file(s)')
  .option('-o, --output <file>', 'Output 16:9 overview video path', 'overview_14min.mp4')
  .option('-m, --mount <type>', 'Mount position: cockpit or rear', 'cockpit')
  .option('-t, --target-duration <seconds>', 'Target duration in seconds', '840')
  .option('--draft', 'Fast draft preview mode (720p)', false)
  .option('--burn-in', 'Burn in shot number, clip name, timestamps, and angle HUD (defaults to true in --draft mode)')
  .option('--no-burn-in', 'Disable HUD burn-in overlay')
  .option('--skip-vision', 'Skip YOLO rider tracking (use audio/motion only)', false)
  .option('--edl-out <file>', 'Save generated EDL JSON path', 'edl.json')
  .action(async (inputs: string[], opts) => {
    try {
      console.log(pc.bold(pc.green('\n🚴 Starting Insta360 Director Agent (Autonomous Mode)\n')));

      // 1. Analyze
      const analyzer = new VideoAnalyzer({
        skipVision: opts.skipVision,
        onProgress: (cur, tot, stage) => {
          console.log(`[${cur}/${tot}] ${pc.cyan(stage)}`);
        },
      });

      console.log(pc.bold('🔍 Stage 1: Multi-Clip Proxy Analysis...'));
      const analyses = await analyzer.analyzeClips(inputs);

      // 2. Plan
      console.log(pc.bold('\n🧠 Stage 2: Directing & Shot Selection...'));
      const planner = new DirectorPlanner({
        mountType: opts.mount as MountProfile,
        targetDurationSec: Number(opts.targetDuration),
      });

      const edl = planner.plan(analyses);
      printEdlSummary(edl);

      if (opts.edlOut) {
        fs.writeFileSync(opts.edlOut, JSON.stringify(edl, null, 2), 'utf8');
        console.log(pc.dim(`Saved EDL to: ${opts.edlOut}`));
      }

      // 3. Render
      console.log(pc.bold('\n🎞️  Stage 3: Rendering 16:9 Widescreen Output via FFmpeg v360...'));
      const renderer = new VideoRenderer({
        outputFile: opts.output,
        draft: opts.draft,
        burnIn: opts.burnIn,
        onProgress: (cur, tot, msg) => {
          console.log(`[${cur}/${tot}] ${msg}`);
        },
      });

      const outputPath = await renderer.render(edl);
      console.log(pc.bold(pc.green(`\n✅ Render complete! Output saved to: ${outputPath}\n`)));
    } catch (err: any) {
      console.error(pc.red(`\n❌ Error: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('plan')
  .description('Analyze video(s) and export EDL without rendering (Human-in-the-loop)')
  .argument('<inputs...>', 'Input 360 MP4 video file(s)')
  .option('-o, --output <file>', 'Output EDL JSON path', 'edl.json')
  .option('-m, --mount <type>', 'Mount position: cockpit or rear', 'cockpit')
  .option('-t, --target-duration <seconds>', 'Target duration in seconds', '840')
  .option('--skip-vision', 'Skip YOLO rider tracking (use audio/motion only)', false)
  .action(async (inputs: string[], opts) => {
    try {
      console.log(pc.bold(pc.green('\n🚴 Starting Director Planning Phase\n')));

      const analyzer = new VideoAnalyzer({
        skipVision: opts.skipVision,
        onProgress: (cur, tot, stage) => {
          console.log(`[${cur}/${tot}] ${pc.cyan(stage)}`);
        },
      });

      console.log(pc.bold('🔍 Stage 1: Multi-Clip Proxy Analysis...'));
      const analyses = await analyzer.analyzeClips(inputs);

      console.log(pc.bold('\n🧠 Stage 2: Directing & Shot Selection...'));
      const planner = new DirectorPlanner({
        mountType: opts.mount as MountProfile,
        targetDurationSec: Number(opts.targetDuration),
      });

      const edl = planner.plan(analyses);
      printEdlSummary(edl);

      fs.writeFileSync(opts.output, JSON.stringify(edl, null, 2), 'utf8');
      console.log(pc.bold(pc.green(`\n✅ EDL successfully saved to: ${opts.output}`)));
      console.log(pc.dim('You can now inspect or edit this file, then run:'));
      console.log(pc.cyan(`  pnpm director render ${inputs[0]} --edl ${opts.output} -o final.mp4\n`));
    } catch (err: any) {
      console.error(pc.red(`\n❌ Error: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('render')
  .description('Render final video from an existing EDL JSON file')
  .argument('[inputs...]', 'Optional source video files (defaults to sources listed in EDL)')
  .requiredOption('--edl <file>', 'Path to Edit Decision List (EDL JSON)')
  .option('-o, --output <file>', 'Output video path', 'final_overview.mp4')
  .option('--draft', 'Fast draft preview mode (720p)', false)
  .option('--burn-in', 'Burn in shot number, clip name, timestamps, and angle HUD (defaults to true in --draft mode)')
  .option('--no-burn-in', 'Disable HUD burn-in overlay')
  .action(async (inputs: string[], opts) => {
    try {
      if (!fs.existsSync(opts.edl)) {
        throw new Error(`EDL file not found: ${opts.edl}`);
      }

      const rawEdl = JSON.parse(fs.readFileSync(opts.edl, 'utf8'));
      const edl = EditDecisionListSchema.parse(rawEdl);

      printEdlSummary(edl);

      console.log(pc.bold('\n🎞️  Rendering 16:9 Widescreen Output via FFmpeg v360...'));
      const renderer = new VideoRenderer({
        outputFile: opts.output,
        draft: opts.draft,
        burnIn: opts.burnIn,
        onProgress: (cur, tot, msg) => {
          console.log(`[${cur}/${tot}] ${msg}`);
        },
      });

      const outputPath = await renderer.render(edl);
      console.log(pc.bold(pc.green(`\n✅ Render complete! Output saved to: ${outputPath}\n`)));
    } catch (err: any) {
      console.error(pc.red(`\n❌ Error: ${err.message}`));
      process.exit(1);
    }
  });

program.parse(process.argv);
