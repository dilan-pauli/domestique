import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ort from 'onnxruntime-node';
import type { DetectionItem } from './models.js';
import { equirectToSpherical } from './coordinates.js';

export const COCO_CLASSES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
  'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat',
  'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack',
  'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball',
  'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket',
  'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
  'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake',
  'chair', 'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop',
  'mouse', 'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
  'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'
];

// Target classes relevant for cycling action
const CYCLING_TARGET_CLASS_IDS = new Set([
  0, // person (cyclist / hero)
  1, // bicycle
  2, // car
  3, // motorcycle
  14, // bird
  15, // cat
  16, // dog
  17, // horse (often on gravel roads!)
]);

export interface DetectorOptions {
  modelPath?: string;
  confidenceThreshold?: number;
  iouThreshold?: number;
  sampleFps?: number;
}

export class ObjectDetector {
  private session: ort.InferenceSession | null = null;
  private modelPath: string;
  private confThreshold: number;
  private iouThreshold: number;

  constructor(options: DetectorOptions = {}) {
    this.modelPath =
      options.modelPath ||
      path.resolve(process.cwd(), 'models/yolo11n.onnx');
    this.confThreshold = options.confidenceThreshold ?? 0.35;
    this.iouThreshold = options.iouThreshold ?? 0.45;
  }

  async init(): Promise<boolean> {
    if (!fs.existsSync(this.modelPath)) {
      // Fallback check in parent or local directory
      const alt = path.resolve(process.cwd(), 'models/yolov8n.onnx');
      if (fs.existsSync(alt)) {
        this.modelPath = alt;
      } else {
        return false;
      }
    }

    try {
      this.session = await ort.InferenceSession.create(this.modelPath, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      });
      return true;
    } catch (err) {
      console.warn(`Could not initialize ONNX detector: ${err}`);
      return false;
    }
  }

  /**
   * Processes a video file by sampling frames at `sampleFps` (default 1fps)
   * and returning detected subjects mapped to spherical coordinates.
   */
  async detectInVideo(videoPath: string, sampleFps = 1): Promise<DetectionItem[]> {
    if (!this.session) {
      const ready = await this.init();
      if (!ready) return [];
    }

    const netWidth = 640;
    const netHeight = 640;
    const padTop = 140; // 640x360 scaled into 640x640 has 140px pad top & bottom
    const scaledHeight = 360;
    const frameBytes = netWidth * netHeight * 3; // RGB24

    const args = [
      '-v', 'error',
      '-i', videoPath,
      '-vf', `fps=${sampleFps},scale=${netWidth}:${scaledHeight},pad=${netWidth}:${netHeight}:0:${padTop}:black`,
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      'pipe:1',
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const detections: DetectionItem[] = [];

    let leftover = Buffer.alloc(0);
    let frameIndex = 0;

    for await (const chunk of proc.stdout) {
      const data = Buffer.concat([leftover, chunk]);
      let offset = 0;

      while (offset + frameBytes <= data.length) {
        const frameBuffer = data.subarray(offset, offset + frameBytes);
        const timeSec = Number((frameIndex / sampleFps).toFixed(2));

        const frameDetections = await this.detectInFrame(
          frameBuffer,
          timeSec,
          netWidth,
          netHeight,
          padTop,
          scaledHeight
        );
        detections.push(...frameDetections);

        frameIndex++;
        offset += frameBytes;
      }

      leftover = Buffer.from(data.subarray(offset));
    }

    return detections;
  }

  private async detectInFrame(
    rgbBuffer: Uint8Array,
    timeSec: number,
    netWidth: number,
    netHeight: number,
    padTop: number,
    scaledHeight: number
  ): Promise<DetectionItem[]> {
    if (!this.session) return [];

    const numPixels = netWidth * netHeight;
    const floatData = new Float32Array(3 * numPixels);

    // HWC (RGBRGB...) to CHW (RRR...GGG...BBB...) normalized to [0, 1]
    const rOffset = 0;
    const gOffset = numPixels;
    const bOffset = 2 * numPixels;

    for (let i = 0; i < numPixels; i++) {
      floatData[rOffset + i] = rgbBuffer[i * 3] / 255.0;
      floatData[gOffset + i] = rgbBuffer[i * 3 + 1] / 255.0;
      floatData[bOffset + i] = rgbBuffer[i * 3 + 2] / 255.0;
    }

    const tensor = new ort.Tensor('float32', floatData, [1, 3, netHeight, netWidth]);
    const feeds: Record<string, ort.Tensor> = {};
    feeds[this.session.inputNames[0]] = tensor;

    const results = await this.session.run(feeds);
    const outputTensor = results[this.session.outputNames[0]];
    const outputData = outputTensor.data as Float32Array;

    // Output shape is [1, 84, 8400]
    const numAttributes = 84;
    const numCandidates = outputTensor.dims[2]; // 8400

    const candidates: Array<{
      box: [number, number, number, number]; // [cx, cy, w, h] in 640x640
      score: number;
      classId: number;
    }> = [];

    for (let i = 0; i < numCandidates; i++) {
      let maxClassScore = 0;
      let bestClassId = -1;

      for (let c = 0; c < 80; c++) {
        if (!CYCLING_TARGET_CLASS_IDS.has(c)) continue;
        const score = outputData[(4 + c) * numCandidates + i];
        if (score > maxClassScore) {
          maxClassScore = score;
          bestClassId = c;
        }
      }

      if (maxClassScore >= this.confThreshold) {
        const cx = outputData[0 * numCandidates + i];
        const cy = outputData[1 * numCandidates + i];
        const w = outputData[2 * numCandidates + i];
        const h = outputData[3 * numCandidates + i];

        candidates.push({
          box: [cx, cy, w, h],
          score: maxClassScore,
          classId: bestClassId,
        });
      }
    }

    // Apply NMS (Non-Maximum Suppression)
    const filtered = this.nms(candidates, this.iouThreshold);

    // Map back to unpadded equirectangular coordinates
    const items: DetectionItem[] = [];
    for (const cand of filtered) {
      const [cx, cy, w, h] = cand.box;

      // Adjust for padTop and scale to 0..1 in original 16:9 / equirectangular space
      const normX = Math.max(0, Math.min(1, cx / netWidth));
      const normY = Math.max(0, Math.min(1, (cy - padTop) / scaledHeight));
      const normW = w / netWidth;
      const normH = h / scaledHeight;

      const { yaw, pitch } = equirectToSpherical(normX, normY);

      items.push({
        timeSec,
        bbox: [normX, normY, normW, normH],
        label: COCO_CLASSES[cand.classId] || 'object',
        confidence: Number(cand.score.toFixed(3)),
        yaw: Number(yaw.toFixed(1)),
        pitch: Number(pitch.toFixed(1)),
      });
    }

    return items;
  }

  private nms(
    boxes: Array<{ box: [number, number, number, number]; score: number; classId: number }>,
    iouThresh: number
  ) {
    boxes.sort((a, b) => b.score - a.score);
    const selected: typeof boxes = [];

    for (const b of boxes) {
      let keep = true;
      for (const s of selected) {
        if (b.classId === s.classId && this.computeIoU(b.box, s.box) > iouThresh) {
          keep = false;
          break;
        }
      }
      if (keep) selected.push(b);
    }

    return selected;
  }

  private computeIoU(
    boxA: [number, number, number, number],
    boxB: [number, number, number, number]
  ): number {
    const [ax, ay, aw, ah] = boxA;
    const [bx, by, bw, bh] = boxB;

    const aX1 = ax - aw / 2;
    const aY1 = ay - ah / 2;
    const aX2 = ax + aw / 2;
    const aY2 = ay + ah / 2;

    const bX1 = bx - bw / 2;
    const bY1 = by - bh / 2;
    const bX2 = bx + bw / 2;
    const bY2 = by + bh / 2;

    const interX1 = Math.max(aX1, bX1);
    const interY1 = Math.max(aY1, bY1);
    const interX2 = Math.min(aX2, bX2);
    const interY2 = Math.min(aY2, bY2);

    const interW = Math.max(0, interX2 - interX1);
    const interH = Math.max(0, interY2 - interY1);
    const interArea = interW * interH;

    const areaA = aw * ah;
    const areaB = bw * bh;
    const unionArea = areaA + areaB - interArea;

    return unionArea > 0 ? interArea / unionArea : 0;
  }
}
