/// <reference lib="webworker" />
import { IDLE_METRICS, type RenderCommand, type RenderMetrics } from './render-protocol';

/**
 * The data-flow field (§8 #1, #2, #5), drawn on an OffscreenCanvas in its
 * own worker.
 *
 * Why a second worker rather than a rAF loop on the main thread: during a
 * live run the main thread is doing React work, and a particle field
 * sharing it would drop frames *and* skew the timings React is rendering
 * (§8.1). Measurement already has its own worker; giving the visuals one
 * too means the two heaviest jobs never contend.
 *
 * Every value drawn arrives from a real measurement. There is no
 * decorative motion here that is not carrying data: particle speed and
 * density are throughput, their direction is the phase, turbulence is
 * jitter, and the swell is loaded latency. Nothing is invented to look
 * busy (§8, §5.7).
 */
declare const self: DedicatedWorkerGlobalScope;

interface Particle {
  x: number;
  y: number;
  /** 0–1 position across the pipe's width; kept so a particle keeps its lane as the pipe swells. */
  lane: number;
  speed: number;
  size: number;
}

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let particles: Particle[] = [];
let dpr = 1;
let frameIntervalMs = 1000 / 60;
let rafHandle: number | null = null;
let lastFrameMs = 0;

/**
 * Two copies of the metrics: what the measurement last reported, and what
 * is currently on screen. The drawn copy eases toward the reported one
 * every frame (§8.1 — "interpolate toward the latest sample inside rAF").
 *
 * Without this the gauge would jump between discrete samples, which reads
 * as a broken animation rather than a live reading. It is smoothing of
 * the *picture*, never of the data: the number rendered beside the field
 * comes straight from the sample, and this easing never feeds back into
 * anything recorded.
 */
let target: RenderMetrics = IDLE_METRICS;
let shown: RenderMetrics = IDLE_METRICS;

const PARTICLE_BASE_SPEED = 40; // px/sec at full scale — slow enough to read as flow, not static noise

function makeParticles(count: number, width: number, height: number): Particle[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    lane: Math.random(),
    speed: 0.5 + Math.random(),
    size: 0.6 + Math.random() * 1.8,
  }));
}

function approach(current: number, goal: number, rate: number): number {
  return current + (goal - current) * rate;
}

/** Colours are read from the page's own tokens by the main thread and baked in here. */
const COLORS = {
  download: [56, 132, 255],
  upload: [16, 168, 108],
  idle: [140, 148, 160],
} as const;

function draw(nowMs: number): void {
  rafHandle = self.requestAnimationFrame(draw);
  if (!canvas || !ctx) return;

  // Frame cap. The low-end tier lowers `maxFps` instead of dropping the
  // visual, so a weak phone still shows a real field, just less often.
  if (nowMs - lastFrameMs < frameIntervalMs) return;
  const deltaMs = Math.min(64, nowMs - lastFrameMs); // clamp so a backgrounded tab doesn't teleport particles
  lastFrameMs = nowMs;

  // Ease the drawn state toward the measured state. Congestion moves
  // slowest — a pipe backing up should look like it is filling, not
  // flickering between states.
  const ease = Math.min(1, deltaMs / 220);
  shown = {
    mbps: approach(shown.mbps, target.mbps, ease),
    ceilingMbps: approach(shown.ceilingMbps, target.ceilingMbps, ease),
    jitterMs: approach(shown.jitterMs, target.jitterMs, ease),
    congestion: approach(shown.congestion, target.congestion, ease * 0.5),
    direction: target.direction,
  };

  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  ctx.clearRect(0, 0, width, height);

  const intensity = Math.max(0, Math.min(1, shown.mbps / Math.max(1, shown.ceilingMbps)));
  const rgb = COLORS[shown.direction];

  // --- the pipe ---------------------------------------------------------
  // It swells with congestion: this is the bufferbloat "clog" (§8 #2).
  // A healthy link draws a slim, even channel; a bloated one bulges in the
  // middle where the queue is building.
  const baseHalfHeight = height * 0.16;
  const swell = 1 + shown.congestion * 1.5;
  const midY = height / 2;

  ctx.beginPath();
  for (let x = 0; x <= width; x += 4) {
    const bulge = Math.sin((x / width) * Math.PI); // fattest mid-pipe, where a queue would sit
    ctx.lineTo(x, midY - baseHalfHeight * (1 + bulge * (swell - 1)));
  }
  for (let x = width; x >= 0; x -= 4) {
    const bulge = Math.sin((x / width) * Math.PI);
    ctx.lineTo(x, midY + baseHalfHeight * (1 + bulge * (swell - 1)));
  }
  ctx.closePath();
  ctx.fillStyle = `rgba(${String(rgb[0])}, ${String(rgb[1])}, ${String(rgb[2])}, ${String(0.06 + shown.congestion * 0.1)})`;
  ctx.fill();

  // --- the particles ----------------------------------------------------
  const sign = shown.direction === 'upload' ? -1 : 1;
  // Turbulence is jitter: a link whose round trips vary is drawn churning.
  const turbulence = Math.min(1, shown.jitterMs / 60);
  // A congested pipe does not just swell, it slows — that is what a queue does.
  const congestionDrag = 1 - shown.congestion * 0.6;

  ctx.fillStyle = `rgba(${String(rgb[0])}, ${String(rgb[1])}, ${String(rgb[2])}, 0.85)`;
  const visible = Math.ceil(particles.length * (0.15 + intensity * 0.85));

  for (let i = 0; i < visible; i += 1) {
    const p = particles[i];
    if (!p) continue;

    const speed =
      PARTICLE_BASE_SPEED * p.speed * (0.2 + intensity * 1.8) * congestionDrag * (deltaMs / 1000);
    p.x += speed * sign;

    if (turbulence > 0) {
      p.y += (Math.random() - 0.5) * turbulence * 2.2;
    }

    // Wrap, and re-seed the lane so the field never settles into visible rows.
    if (p.x > width) {
      p.x = 0;
      p.lane = Math.random();
    } else if (p.x < 0) {
      p.x = width;
      p.lane = Math.random();
    }

    const halfHeight = baseHalfHeight * (1 + Math.sin((p.x / width) * Math.PI) * (swell - 1));
    const laneY = midY + (p.lane - 0.5) * 2 * halfHeight;
    p.y = approach(p.y, laneY, 0.08);

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function start(): void {
  if (rafHandle === null) {
    lastFrameMs = 0;
    rafHandle = self.requestAnimationFrame(draw);
  }
}

function stop(): void {
  if (rafHandle !== null) {
    self.cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
}

function resize(width: number, height: number): void {
  if (!canvas || !ctx) return;
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  particles = makeParticles(particles.length, width, height);
}

self.onmessage = (event: MessageEvent<RenderCommand>) => {
  const command = event.data;
  switch (command.type) {
    case 'init': {
      canvas = command.canvas;
      dpr = command.devicePixelRatio;
      frameIntervalMs = 1000 / Math.max(1, command.maxFps);
      ctx = canvas.getContext('2d');
      // A worker with no 2D context has nothing to draw; failing silently
      // is correct here, because the page must not break over a visual.
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = makeParticles(
        particleCountFor(canvas.width / dpr),
        canvas.width / dpr,
        canvas.height / dpr,
      );
      start();
      return;
    }
    case 'resize':
      resize(command.width, command.height);
      return;
    case 'metrics':
      target = command.metrics;
      return;
    case 'stop':
      stop();
      return;
  }
};

/** Fewer particles on a narrow canvas — density should read the same on a phone as on a desktop. */
function particleCountFor(cssWidth: number): number {
  return Math.round(Math.max(300, Math.min(2_000, cssWidth * 3)));
}
