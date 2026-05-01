"use client";

/**
 * Top-down 16-bit RPG style pipeline view. Cars drive between stage stations
 * on a little road. Drawn at low logical resolution to a <canvas>, then CSS
 * scaled up with `image-rendering: pixelated` so every pixel is crisp.
 *
 * Filename kept as Pipeline3D for import stability — it's now 2D pixel art.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface PipelineVideo {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}

interface Stage {
  id: string;
  label: string;
  roof: string;
  wall: string;
  trim: string;
  carBody: string;
  carShade: string;
  x: number; // station logical x (center)
}

/* ─── World constants ──────────────────────────────────────────────────────── */

const LOGICAL_W = 480;
const LOGICAL_H = 270;
const ROAD_TOP = 162;
const ROAD_BOTTOM = 222;
const ROAD_CENTER = (ROAD_TOP + ROAD_BOTTOM) / 2;
const STATION_BASE_Y = 158; // bottom of station building
const PLOT_BASE_Y = ROAD_BOTTOM + 4;

/* Cozy palette inspired by the reference: warm wood/brown, sage green, dusty
   teal, cream, soft red. Every color picked so they sit together. */
const PAL = {
  bgSky: "#cfd8c5",
  grass1: "#7a9962",
  grass2: "#638253",
  grass3: "#8eae72",
  flowerPink: "#c97a8b",
  flowerYellow: "#e8c167",
  treeLeaves: "#456a3a",
  treeLeavesHi: "#5e8a4a",
  treeTrunk: "#6b4a32",
  asphalt: "#42454c",
  asphaltDark: "#33363c",
  asphaltLight: "#535762",
  stripe: "#e8c878",
  curb: "#c5b491",
  curbShade: "#9a8a6a",
  building1: "#a3805c",
  building1Shade: "#7c5e40",
  building1Light: "#c3a07c",
  buildingWindow: "#c8d8d8",
  text: "#3b2f2a",
  textLight: "#fff4dc",
  shadow: "rgba(28, 24, 22, 0.32)",
  fence: "#7a5a3c",
  fenceShade: "#5a3f29",
  lampPost: "#3a3128",
  lampGlow: "#fde29a",
  pathDirt: "#c6a275",
  pathDirtDark: "#a78256",
  vendingRed: "#b04a45",
  vendingTrim: "#d6cdb6",
  pipeline: "#3a4a40",
};

const STAGES: Stage[] = [
  { id: "queued",     label: "QUEUE",   roof: "#8c98ad", wall: "#aab7cc", trim: "#5d6a82", carBody: "#a8b4c8", carShade: "#5d6a82", x: 48 },
  { id: "recording",  label: "RECORD",  roof: "#3f6fcc", wall: "#7ba3e6", trim: "#274a8a", carBody: "#5b8de8", carShade: "#2f5fb7", x: 110 },
  { id: "narrating",  label: "VOICE",   roof: "#7a4ec0", wall: "#b18edb", trim: "#4d2e85", carBody: "#9f72d4", carShade: "#65459b", x: 178 },
  { id: "rendering",  label: "RENDER",  roof: "#c25d83", wall: "#e599b4", trim: "#7e3554", carBody: "#d97797", carShade: "#9c4b66", x: 246 },
  { id: "review",     label: "REVIEW",  roof: "#c4862f", wall: "#e8b765", trim: "#7e5414", carBody: "#d4a256", carShade: "#9a6f2a", x: 312 },
  { id: "publishing", label: "PUBLISH", roof: "#3d8d65", wall: "#7bbf99", trim: "#23583e", carBody: "#5fb084", carShade: "#347955", x: 374 },
  { id: "published",  label: "DONE",    roof: "#4f9f5e", wall: "#8fcf95", trim: "#2f6638", carBody: "#79c285", carShade: "#3f8454", x: 432 },
];

const FAILED_STAGE: Stage = {
  id: "failed", label: "JUNK",
  roof: "#7a3530", wall: "#b56b65", trim: "#4d1f1c",
  carBody: "#a85b54", carShade: "#6c2f2c", x: 462,
};

const STAGE_BY_ID = new Map([...STAGES, FAILED_STAGE].map((s) => [s.id, s]));

/* ─── Tiny stable RNG so decoration positions don't dance per frame ───────── */

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/* ─── Public component ────────────────────────────────────────────────────── */

export function Pipeline3D({ videos }: { videos: PipelineVideo[] }) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{
    id: string;
    title: string;
    brand: string;
    x: number;
    y: number;
  } | null>(null);

  // Lay every video out at a station + lane offset.
  const placed = useMemo(() => {
    const buckets = new Map<string, PipelineVideo[]>();
    for (const v of videos) {
      const arr = buckets.get(v.status) ?? [];
      arr.push(v);
      buckets.set(v.status, arr);
    }
    const out: Array<{ video: PipelineVideo; stage: Stage; col: number; row: number }> = [];
    for (const [status, arr] of buckets) {
      const stage = STAGE_BY_ID.get(status);
      if (!stage) continue;
      arr.forEach((video, idx) => {
        // queue cars in 2 rows, several columns; junkyard packs in a 3-col grid
        const isJunk = stage.id === "failed";
        const cols = isJunk ? 3 : 6;
        out.push({
          video,
          stage,
          col: idx % cols,
          row: Math.floor(idx / cols),
        });
      });
    }
    return out;
  }, [videos]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of videos) c[v.status] = (c[v.status] ?? 0) + 1;
    return c;
  }, [videos]);

  // Hit map (logical-pixel rects) rebuilt each frame; kept on a ref so the click
  // handler can read the latest version without state churn.
  const hitsRef = useRef<Array<{ x: number; y: number; w: number; h: number; video: PipelineVideo }>>([]);

  /* ─── Animation loop ─────────────────────────────────────────────────── */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = LOGICAL_W;
    canvas.height = LOGICAL_H;
    ctx.imageSmoothingEnabled = false;

    let raf = 0;
    let start = performance.now();

    const tick = (now: number) => {
      const t = (now - start) / 1000;
      drawScene(ctx, placed, counts, t, hitsRef);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [placed, counts]);

  /* ─── Pointer handling ───────────────────────────────────────────────── */

  const toLogical = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * LOGICAL_W;
    const y = ((clientY - rect.top) / rect.height) * LOGICAL_H;
    return { x, y };
  };

  const onMove = (e: React.MouseEvent) => {
    const p = toLogical(e.clientX, e.clientY);
    if (!p) return;
    const hit = hitsRef.current.find(
      (r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h,
    );
    if (hit) {
      setHover({
        id: hit.video.id,
        title: hit.video.title,
        brand: pickCarKind(hit.video.id).name,
        x: e.clientX,
        y: e.clientY,
      });
      if (canvasRef.current) canvasRef.current.style.cursor = "pointer";
    } else {
      setHover(null);
      if (canvasRef.current) canvasRef.current.style.cursor = "default";
    }
  };

  const onClick = (e: React.MouseEvent) => {
    const p = toLogical(e.clientX, e.clientY);
    if (!p) return;
    const hit = hitsRef.current.find(
      (r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h,
    );
    if (hit) router.push(`/videos/${hit.video.id}`);
  };

  return (
    <div ref={wrapRef} className="absolute inset-0 bg-[#cfd8c5]">
      <canvas
        ref={canvasRef}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onClick={onClick}
        style={{
          imageRendering: "pixelated",
          width: "100%",
          height: "100%",
          display: "block",
        }}
      />
      {hover ? (
        <div
          className="pointer-events-none fixed z-50 px-2 py-1 rounded bg-amber-50 text-stone-900 text-xs shadow-md border border-stone-700"
          style={{
            left: hover.x + 14,
            top: hover.y + 14,
            fontFamily: '"Courier New", monospace',
            maxWidth: 280,
          }}
        >
          <div className="text-[10px] uppercase tracking-wider text-stone-500">
            {hover.brand}
          </div>
          <div className="font-semibold leading-tight">{hover.title}</div>
        </div>
      ) : null}
    </div>
  );
}

/* ─── Scene rendering ─────────────────────────────────────────────────────── */

function drawScene(
  ctx: CanvasRenderingContext2D,
  placed: Array<{ video: PipelineVideo; stage: Stage; col: number; row: number }>,
  counts: Record<string, number>,
  t: number,
  hitsRef: { current: Array<{ x: number; y: number; w: number; h: number; video: PipelineVideo }> },
) {
  ctx.imageSmoothingEnabled = false;
  hitsRef.current = [];

  drawGrass(ctx);
  drawBackPath(ctx);
  drawRoad(ctx, t);
  drawCurbs(ctx);
  drawDecorationsBack(ctx);
  drawStations(ctx, counts);
  drawDecorationsFront(ctx);
  drawCars(ctx, placed, t, hitsRef);
  drawTitleBar(ctx);
}

/* ── Background grass with tiled speckle ──────────────────────────────────── */

function drawGrass(ctx: CanvasRenderingContext2D) {
  // Sky-ish band at top
  ctx.fillStyle = PAL.bgSky;
  ctx.fillRect(0, 0, LOGICAL_W, 18);

  // Main grass
  ctx.fillStyle = PAL.grass1;
  ctx.fillRect(0, 18, LOGICAL_W, LOGICAL_H - 18);

  // Speckle pattern — deterministic so it doesn't shimmer
  const rand = mulberry32(7919);
  for (let i = 0; i < 360; i++) {
    const x = Math.floor(rand() * LOGICAL_W);
    const y = 18 + Math.floor(rand() * (LOGICAL_H - 18));
    // Avoid road area for non-edge speckles
    const inRoad = y > ROAD_TOP - 4 && y < ROAD_BOTTOM + 4;
    if (inRoad) continue;
    ctx.fillStyle = rand() > 0.5 ? PAL.grass2 : PAL.grass3;
    ctx.fillRect(x, y, 1, 1);
  }

  // A few tiny flowers
  const r2 = mulberry32(31337);
  for (let i = 0; i < 36; i++) {
    const x = Math.floor(r2() * LOGICAL_W);
    const y = 24 + Math.floor(r2() * (ROAD_TOP - 30));
    ctx.fillStyle = r2() > 0.5 ? PAL.flowerPink : PAL.flowerYellow;
    ctx.fillRect(x, y, 1, 1);
    ctx.fillRect(x + 1, y, 1, 1);
  }
  for (let i = 0; i < 24; i++) {
    const x = Math.floor(r2() * LOGICAL_W);
    const y = ROAD_BOTTOM + 8 + Math.floor(r2() * (LOGICAL_H - ROAD_BOTTOM - 14));
    ctx.fillStyle = r2() > 0.5 ? PAL.flowerPink : PAL.flowerYellow;
    ctx.fillRect(x, y, 1, 1);
    ctx.fillRect(x + 1, y, 1, 1);
  }
}

/* ── Dirt path connecting stations ────────────────────────────────────────── */

function drawBackPath(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = PAL.pathDirt;
  ctx.fillRect(20, ROAD_TOP - 14, LOGICAL_W - 40, 4);
  ctx.fillStyle = PAL.pathDirtDark;
  ctx.fillRect(20, ROAD_TOP - 11, LOGICAL_W - 40, 1);
  // dotted texture
  for (let x = 24; x < LOGICAL_W - 22; x += 5) {
    ctx.fillStyle = PAL.pathDirtDark;
    ctx.fillRect(x, ROAD_TOP - 13, 1, 1);
    ctx.fillRect(x + 2, ROAD_TOP - 12, 1, 1);
  }
}

/* ── Road with center line ────────────────────────────────────────────────── */

function drawRoad(ctx: CanvasRenderingContext2D, t: number) {
  // Edge bands (slightly lighter) framing asphalt
  ctx.fillStyle = PAL.asphaltLight;
  ctx.fillRect(0, ROAD_TOP, LOGICAL_W, 2);
  ctx.fillRect(0, ROAD_BOTTOM - 2, LOGICAL_W, 2);

  // Asphalt
  ctx.fillStyle = PAL.asphalt;
  ctx.fillRect(0, ROAD_TOP + 2, LOGICAL_W, ROAD_BOTTOM - ROAD_TOP - 4);

  // Pebble texture
  const rand = mulberry32(54321);
  for (let i = 0; i < 280; i++) {
    const x = Math.floor(rand() * LOGICAL_W);
    const y = ROAD_TOP + 3 + Math.floor(rand() * (ROAD_BOTTOM - ROAD_TOP - 6));
    ctx.fillStyle = rand() > 0.5 ? PAL.asphaltDark : PAL.asphaltLight;
    ctx.fillRect(x, y, 1, 1);
  }

  // Subtly drifting yellow dashed center line (animation = sense of motion)
  const dashOffset = Math.floor(t * 14) % 12;
  ctx.fillStyle = PAL.stripe;
  for (let x = -dashOffset; x < LOGICAL_W; x += 12) {
    ctx.fillRect(x, ROAD_CENTER - 1, 6, 2);
  }
}

/* ── Sidewalk-style curbs ─────────────────────────────────────────────────── */

function drawCurbs(ctx: CanvasRenderingContext2D) {
  // Top curb
  ctx.fillStyle = PAL.curb;
  ctx.fillRect(0, ROAD_TOP - 4, LOGICAL_W, 2);
  ctx.fillStyle = PAL.curbShade;
  ctx.fillRect(0, ROAD_TOP - 2, LOGICAL_W, 1);
  // Slab divisions
  for (let x = 0; x < LOGICAL_W; x += 16) {
    ctx.fillStyle = PAL.curbShade;
    ctx.fillRect(x, ROAD_TOP - 4, 1, 2);
  }

  // Bottom curb
  ctx.fillStyle = PAL.curb;
  ctx.fillRect(0, ROAD_BOTTOM + 1, LOGICAL_W, 2);
  ctx.fillStyle = PAL.curbShade;
  ctx.fillRect(0, ROAD_BOTTOM + 3, LOGICAL_W, 1);
  for (let x = 0; x < LOGICAL_W; x += 16) {
    ctx.fillStyle = PAL.curbShade;
    ctx.fillRect(x, ROAD_BOTTOM + 1, 1, 2);
  }
}

/* ── Trees, fences, lamp posts, planters ──────────────────────────────────── */

function drawDecorationsBack(ctx: CanvasRenderingContext2D) {
  // Trees behind stations (between buildings) — fixed positions
  const trees = [16, 80, 145, 211, 280, 345, 405, 467];
  for (const x of trees) {
    drawTree(ctx, x, 95);
  }

  // Lamp posts at curb between stations
  for (const x of [78, 144, 210, 278, 342, 404]) {
    drawLampPost(ctx, x, ROAD_TOP - 6);
  }

  // Fence along bottom curb — short pickets
  ctx.fillStyle = PAL.fence;
  for (let x = 4; x < LOGICAL_W; x += 8) {
    ctx.fillRect(x, ROAD_BOTTOM + 5, 2, 5);
  }
  ctx.fillStyle = PAL.fenceShade;
  for (let x = 4; x < LOGICAL_W; x += 8) {
    ctx.fillRect(x, ROAD_BOTTOM + 9, 2, 1);
  }
  ctx.fillRect(0, ROAD_BOTTOM + 7, LOGICAL_W, 1);
}

function drawDecorationsFront(ctx: CanvasRenderingContext2D) {
  // Plants in front of bottom fence — give it a foreground layer
  const r = mulberry32(8675309);
  for (let i = 0; i < 18; i++) {
    const x = 6 + Math.floor(r() * (LOGICAL_W - 12));
    const y = ROAD_BOTTOM + 12 + Math.floor(r() * (LOGICAL_H - ROAD_BOTTOM - 18));
    drawTuft(ctx, x, y);
  }
}

function drawTree(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  // trunk
  ctx.fillStyle = PAL.treeTrunk;
  ctx.fillRect(cx - 1, cy + 8, 3, 6);
  // canopy — clumpy circle out of squares
  ctx.fillStyle = PAL.treeLeaves;
  ctx.fillRect(cx - 6, cy - 2, 13, 12);
  ctx.fillRect(cx - 8, cy + 2, 17, 6);
  ctx.fillRect(cx - 4, cy - 5, 9, 4);
  // highlights
  ctx.fillStyle = PAL.treeLeavesHi;
  ctx.fillRect(cx - 5, cy - 1, 4, 3);
  ctx.fillRect(cx, cy - 3, 3, 2);
  ctx.fillRect(cx + 3, cy + 1, 3, 2);
  // shadow under tree
  ctx.fillStyle = PAL.shadow;
  ctx.fillRect(cx - 5, cy + 13, 11, 2);
}

function drawLampPost(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = PAL.lampPost;
  ctx.fillRect(x, y - 14, 1, 14);
  ctx.fillRect(x - 1, y - 16, 3, 2);
  // glow
  ctx.fillStyle = PAL.lampGlow;
  ctx.fillRect(x - 1, y - 17, 3, 1);
  ctx.fillStyle = "rgba(253, 226, 154, 0.35)";
  ctx.fillRect(x - 3, y - 18, 7, 4);
}

function drawTuft(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = PAL.treeLeaves;
  ctx.fillRect(x, y, 3, 2);
  ctx.fillRect(x + 1, y - 1, 1, 1);
  ctx.fillStyle = PAL.treeLeavesHi;
  ctx.fillRect(x + 1, y, 1, 1);
}

/* ── Stations: small RPG-shop buildings with stage-colored roofs ──────────── */

function drawStations(ctx: CanvasRenderingContext2D, counts: Record<string, number>) {
  for (const stage of STAGES) {
    drawStation(ctx, stage, counts[stage.id] ?? 0);
  }
  drawJunkyard(ctx, counts["failed"] ?? 0);
}

function drawStation(ctx: CanvasRenderingContext2D, stage: Stage, count: number) {
  const cx = stage.x;
  const baseY = STATION_BASE_Y;
  const w = 50;
  const h = 46;

  // Drop shadow
  ctx.fillStyle = PAL.shadow;
  ctx.fillRect(cx - w / 2 + 2, baseY - 1, w, 4);

  // Wall
  ctx.fillStyle = stage.wall;
  ctx.fillRect(cx - w / 2, baseY - h, w, h);

  // Wall trim (lighter top edge)
  ctx.fillStyle = lighten(stage.wall, 28);
  ctx.fillRect(cx - w / 2, baseY - h, w, 2);

  // Roof — overhanging trapezoid done in two bands
  ctx.fillStyle = stage.roof;
  ctx.fillRect(cx - w / 2 - 4, baseY - h - 8, w + 8, 6);
  ctx.fillRect(cx - w / 2 - 2, baseY - h - 11, w + 4, 3);
  // roof shade
  ctx.fillStyle = stage.trim;
  ctx.fillRect(cx - w / 2 - 4, baseY - h - 2, w + 8, 2);

  // Window
  ctx.fillStyle = stage.trim;
  ctx.fillRect(cx - 14, baseY - h + 8, 12, 9);
  ctx.fillStyle = PAL.buildingWindow;
  ctx.fillRect(cx - 13, baseY - h + 9, 10, 7);
  // window cross
  ctx.fillStyle = stage.trim;
  ctx.fillRect(cx - 8, baseY - h + 9, 1, 7);
  ctx.fillRect(cx - 13, baseY - h + 12, 10, 1);

  // Door
  ctx.fillStyle = stage.trim;
  ctx.fillRect(cx + 3, baseY - 18, 11, 18);
  ctx.fillStyle = lighten(stage.trim, 25);
  ctx.fillRect(cx + 4, baseY - 17, 9, 16);
  // doorknob
  ctx.fillStyle = PAL.flowerYellow;
  ctx.fillRect(cx + 11, baseY - 9, 1, 1);

  // Sign hanging above door
  ctx.fillStyle = PAL.text;
  ctx.fillRect(cx - 14, baseY - h - 2, 28, 1); // pole
  ctx.fillStyle = stage.roof;
  ctx.fillRect(cx - 14, baseY - h, 28, 8);
  ctx.fillStyle = stage.trim;
  ctx.fillRect(cx - 14, baseY - h + 7, 28, 1);

  // Sign text
  drawPixelText(ctx, stage.label, cx, baseY - h + 4, "#fff4dc", "center");

  // Count badge on right side
  if (count > 0) {
    ctx.fillStyle = PAL.flowerYellow;
    ctx.fillRect(cx + w / 2 - 10, baseY - h - 12, 12, 9);
    ctx.fillStyle = PAL.text;
    ctx.fillRect(cx + w / 2 - 10, baseY - h - 12, 12, 1);
    ctx.fillRect(cx + w / 2 - 10, baseY - h - 4, 12, 1);
    ctx.fillRect(cx + w / 2 - 10, baseY - h - 12, 1, 9);
    ctx.fillRect(cx + w / 2 + 1, baseY - h - 12, 1, 9);
    drawPixelText(ctx, String(count), cx + w / 2 - 4, baseY - h - 8, PAL.text, "center");
  }

  // Plant in pot at door — cozy detail
  ctx.fillStyle = PAL.curbShade;
  ctx.fillRect(cx - 19, baseY - 6, 5, 5);
  ctx.fillStyle = PAL.treeLeaves;
  ctx.fillRect(cx - 19, baseY - 11, 5, 5);
  ctx.fillStyle = PAL.treeLeavesHi;
  ctx.fillRect(cx - 17, baseY - 10, 2, 2);
}

function drawJunkyard(ctx: CanvasRenderingContext2D, count: number) {
  const cx = FAILED_STAGE.x;
  // small fenced area in upper-right corner
  const baseY = 60;
  ctx.fillStyle = PAL.shadow;
  ctx.fillRect(cx - 22, baseY + 2, 44, 3);

  // dirt patch
  ctx.fillStyle = PAL.pathDirt;
  ctx.fillRect(cx - 22, baseY - 18, 44, 22);
  ctx.fillStyle = PAL.pathDirtDark;
  for (let i = 0; i < 16; i++) {
    const x = cx - 22 + Math.floor(((i * 53) % 41));
    const y = baseY - 18 + Math.floor(((i * 31) % 21));
    ctx.fillRect(x, y, 1, 1);
  }

  // fence around it
  ctx.fillStyle = PAL.fence;
  for (let x = cx - 22; x < cx + 22; x += 4) {
    ctx.fillRect(x, baseY - 22, 2, 5);
  }
  ctx.fillRect(cx - 22, baseY - 19, 44, 1);

  // sign post
  ctx.fillStyle = PAL.fence;
  ctx.fillRect(cx - 1, baseY - 30, 2, 8);
  ctx.fillStyle = FAILED_STAGE.roof;
  ctx.fillRect(cx - 12, baseY - 36, 24, 8);
  ctx.fillStyle = FAILED_STAGE.trim;
  ctx.fillRect(cx - 12, baseY - 36, 24, 1);
  ctx.fillRect(cx - 12, baseY - 29, 24, 1);
  drawPixelText(ctx, "JUNK", cx, baseY - 32, "#fff4dc", "center");

  if (count > 0) {
    ctx.fillStyle = PAL.flowerYellow;
    ctx.fillRect(cx + 13, baseY - 38, 9, 8);
    ctx.fillStyle = PAL.text;
    ctx.fillRect(cx + 13, baseY - 38, 9, 1);
    ctx.fillRect(cx + 13, baseY - 31, 9, 1);
    ctx.fillRect(cx + 13, baseY - 38, 1, 8);
    ctx.fillRect(cx + 21, baseY - 38, 1, 8);
    drawPixelText(ctx, String(count), cx + 17, baseY - 34, PAL.text, "center");
  }
}

/* ── Supercar lineup ──────────────────────────────────────────────────────── */
/* Each video is hashed to one of these — assignment is deterministic by ID,
   so the same video always shows the same car. Cars are 18×10 (or 20×10 for
   the wider hypercars), drawn top-down with the front of the car pointing
   right (+X). Brand silhouettes share a base shape but vary cockpit position,
   stripes, intakes, exhausts and headlight pattern. */

interface CarKind {
  id: string;
  name: string;       // shown in tooltip
  primary: string;    // body color
  accent: string;     // stripe / detail color
  dark: string;       // bottom shade band
  width: number;      // 18 or 20
  draw: (ctx: CanvasRenderingContext2D, x: number, y: number, k: CarKind) => void;
}

const CAR_KINDS: CarKind[] = [
  { id: "ferrari", name: "Ferrari F8 Tributo",     primary: "#d42a2a", accent: "#1a1a1a", dark: "#7a0e0e", width: 18, draw: drawFerrari },
  { id: "lambo",   name: "Lamborghini Huracán", primary: "#f7d600", accent: "#1a1a1a", dark: "#9c8800", width: 18, draw: drawLambo },
  { id: "porsche", name: "Porsche 911 GT3",         primary: "#e2e2e2", accent: "#1a1a1a", dark: "#8c8c8c", width: 18, draw: drawPorsche },
  { id: "pagani",  name: "Pagani Huayra",           primary: "#1f2c47", accent: "#c9a25a", dark: "#0d1424", width: 18, draw: drawPagani },
  { id: "mclaren", name: "McLaren 720S",            primary: "#ff7a1a", accent: "#1a1a1a", dark: "#8a3f00", width: 18, draw: drawMcLaren },
  { id: "bugatti", name: "Bugatti Chiron",          primary: "#244ea3", accent: "#0a0f24", dark: "#0f2566", width: 20, draw: drawBugatti },
  { id: "koenig",  name: "Koenigsegg Jesko",        primary: "#f4f4f4", accent: "#c5a455", dark: "#9a9a9a", width: 18, draw: drawKoenigsegg },
  { id: "aston",   name: "Aston Martin Valkyrie",   primary: "#2d6552", accent: "#d4af37", dark: "#16382a", width: 18, draw: drawAston },
];

function pickCarKind(videoId: string): CarKind {
  let h = 0;
  for (let i = 0; i < videoId.length; i++) {
    h = ((h * 31) + videoId.charCodeAt(i)) >>> 0;
  }
  return CAR_KINDS[h % CAR_KINDS.length];
}

/* ── Cars ─────────────────────────────────────────────────────────────────── */

function drawCars(
  ctx: CanvasRenderingContext2D,
  placed: Array<{ video: PipelineVideo; stage: Stage; col: number; row: number }>,
  t: number,
  hitsRef: { current: Array<{ x: number; y: number; w: number; h: number; video: PipelineVideo }> },
) {
  for (const { video, stage, col, row } of placed) {
    if (stage.id === "failed") {
      drawFailedCar(ctx, video, col, row, t, hitsRef);
      continue;
    }

    const kind = pickCarKind(video.id);
    // Slightly wider columns to make room for the 20-wide Bugatti without
    // eating its neighbor too aggressively.
    const baseX = stage.x - 22 + col * 9;
    const baseY = row === 0 ? ROAD_CENTER - 7 : ROAD_CENTER + 5;
    drawCar(ctx, video, kind, baseX, baseY, hitsRef);
  }
}

function drawCar(
  ctx: CanvasRenderingContext2D,
  video: PipelineVideo,
  kind: CarKind,
  x: number,
  y: number,
  hitsRef: { current: Array<{ x: number; y: number; w: number; h: number; video: PipelineVideo }> },
) {
  // shadow under car
  ctx.fillStyle = PAL.shadow;
  ctx.fillRect(x, y + 7, kind.width, 2);

  // wheels first so the body sits over the inner edges (top-down look)
  ctx.fillStyle = "#0f0c0a";
  ctx.fillRect(x + 2, y - 1, 3, 2);
  ctx.fillRect(x + kind.width - 5, y - 1, 3, 2);
  ctx.fillRect(x + 2, y + 8, 3, 2);
  ctx.fillRect(x + kind.width - 5, y + 8, 3, 2);

  // delegate the body to the brand-specific renderer
  kind.draw(ctx, x, y, kind);

  // hit rect — generous so small variant widths still feel clickable
  hitsRef.current.push({ x: x - 1, y: y - 1, w: kind.width + 2, h: 12, video });
}

/* ── Brand silhouettes (each function only paints the body — wheels/shadow
       are already drawn by drawCar). All views are top-down with front=right. */

function carBase(ctx: CanvasRenderingContext2D, x: number, y: number, k: CarKind) {
  // base body block
  ctx.fillStyle = k.primary;
  ctx.fillRect(x, y, k.width, 8);
  // bottom shade band
  ctx.fillStyle = k.dark;
  ctx.fillRect(x, y + 6, k.width, 2);
  // top highlight
  ctx.fillStyle = lighten(k.primary, 22);
  ctx.fillRect(x, y, k.width, 1);
  // tail lights
  ctx.fillStyle = "#cc3a3a";
  ctx.fillRect(x, y + 1, 1, 1);
  ctx.fillRect(x, y + 6, 1, 1);
}

function drawFerrari(ctx: CanvasRenderingContext2D, x: number, y: number, k: CarKind) {
  carBase(ctx, x, y, k);
  // Cockpit pulled slightly back (mid-engine)
  ctx.fillStyle = k.dark;
  ctx.fillRect(x + 5, y + 1, 8, 6);
  ctx.fillStyle = k.primary;
  ctx.fillRect(x + 6, y + 2, 6, 4);
  // Twin black hood stripes (signature Ferrari racing stripes)
  ctx.fillStyle = k.accent;
  ctx.fillRect(x + 12, y + 2, 4, 1);
  ctx.fillRect(x + 12, y + 5, 4, 1);
  // Front splitter / nose
  ctx.fillStyle = k.accent;
  ctx.fillRect(x + 16, y + 3, 1, 2);
  // Quad exhausts at rear (silver squares)
  ctx.fillStyle = "#bcbcbc";
  ctx.fillRect(x, y + 3, 1, 1);
  ctx.fillRect(x, y + 4, 1, 1);
  // Windshield tint
  ctx.fillStyle = "#7fa8b8";
  ctx.fillRect(x + 11, y + 3, 1, 2);
  // Headlights — split halogen pair
  ctx.fillStyle = "#fff4dc";
  ctx.fillRect(x + 17, y + 1, 1, 1);
  ctx.fillRect(x + 17, y + 6, 1, 1);
}

function drawLambo(ctx: CanvasRenderingContext2D, x: number, y: number, k: CarKind) {
  carBase(ctx, x, y, k);
  // Hard angular wedge — clip the front nose corners with the road color
  // so the silhouette reads as a Lambo's signature sharp wedge.
  ctx.fillStyle = PAL.asphalt;
  ctx.fillRect(x + 16, y, 2, 2);
  ctx.fillRect(x + 16, y + 6, 2, 2);
  // Cockpit pulled forward, narrow (Huracán driver-forward look)
  ctx.fillStyle = k.accent;
  ctx.fillRect(x + 4, y + 1, 7, 6);
  ctx.fillStyle = k.dark;
  ctx.fillRect(x + 5, y + 2, 5, 4);
  // Side intakes flanking the cockpit
  ctx.fillStyle = k.accent;
  ctx.fillRect(x + 4, y, 2, 1);
  ctx.fillRect(x + 4, y + 7, 2, 1);
  // Y-shaped headlight (3 pixels)
  ctx.fillStyle = "#fff4dc";
  ctx.fillRect(x + 15, y + 1, 1, 1);
  ctx.fillRect(x + 16, y + 2, 1, 1);
  ctx.fillRect(x + 15, y + 6, 1, 1);
  ctx.fillRect(x + 16, y + 5, 1, 1);
  // Quad exhaust hexagon at rear
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(x + 1, y + 3, 1, 2);
}

function drawPorsche(ctx: CanvasRenderingContext2D, x: number, y: number, k: CarKind) {
  carBase(ctx, x, y, k);
  // Round off corners (Porsche 911 silhouette is famously rounded)
  ctx.fillStyle = PAL.asphalt;
  ctx.fillRect(x, y, 1, 1);
  ctx.fillRect(x, y + 7, 1, 1);
  ctx.fillRect(x + k.width - 1, y, 1, 1);
  ctx.fillRect(x + k.width - 1, y + 7, 1, 1);
  // Long sloping rear engine cover (rear-engine flat-six)
  ctx.fillStyle = k.dark;
  ctx.fillRect(x + 1, y + 2, 4, 4);
  // Centered cockpit/roof — classic teardrop
  ctx.fillStyle = k.accent;
  ctx.fillRect(x + 6, y + 1, 7, 6);
  ctx.fillStyle = k.dark;
  ctx.fillRect(x + 7, y + 2, 5, 4);
  // Round headlights — Porsche's signature paired ovals
  ctx.fillStyle = "#fff4dc";
  ctx.fillRect(x + 16, y + 1, 1, 2);
  ctx.fillRect(x + 16, y + 5, 1, 2);
  // Front splitter
  ctx.fillStyle = k.accent;
  ctx.fillRect(x + 17, y + 3, 1, 2);
}

function drawPagani(ctx: CanvasRenderingContext2D, x: number, y: number, k: CarKind) {
  carBase(ctx, x, y, k);
  // Sweeping cockpit canopy (centered)
  ctx.fillStyle = lighten(k.primary, 12);
  ctx.fillRect(x + 5, y + 1, 8, 6);
  ctx.fillStyle = k.dark;
  ctx.fillRect(x + 6, y + 2, 6, 4);
  // Gold pinstripe down the spine
  ctx.fillStyle = k.accent;
  ctx.fillRect(x + 1, y + 3, k.width - 2, 1);
  // Side exhaust ports — quad center cluster at rear (gold = signature)
  ctx.fillStyle = k.accent;
  ctx.fillRect(x, y + 2, 1, 1);
  ctx.fillRect(x, y + 5, 1, 1);
  ctx.fillStyle = "#fde29a";
  ctx.fillRect(x + 1, y + 4, 1, 1);
  // Windshield tint
  ctx.fillStyle = "#5d7a85";
  ctx.fillRect(x + 11, y + 3, 1, 2);
  // Headlights — wide eyebrow LED strip
  ctx.fillStyle = "#fff4dc";
  ctx.fillRect(x + 16, y + 1, 1, 1);
  ctx.fillRect(x + 17, y + 2, 1, 1);
  ctx.fillRect(x + 16, y + 6, 1, 1);
  ctx.fillRect(x + 17, y + 5, 1, 1);
}

function drawMcLaren(ctx: CanvasRenderingContext2D, x: number, y: number, k: CarKind) {
  carBase(ctx, x, y, k);
  // Low canopy, pulled back (driver sits very low, mid-engine)
  ctx.fillStyle = k.accent;
  ctx.fillRect(x + 4, y + 2, 6, 4);
  ctx.fillStyle = "#202020";
  ctx.fillRect(x + 5, y + 3, 4, 2);
  // Aero air-channel cutouts on the flanks (signature 720S body openings)
  ctx.fillStyle = k.accent;
  ctx.fillRect(x + 11, y, 3, 1);
  ctx.fillRect(x + 11, y + 7, 3, 1);
  // Teardrop headlight
  ctx.fillStyle = "#fff4dc";
  ctx.fillRect(x + 16, y + 1, 2, 1);
  ctx.fillRect(x + 16, y + 6, 2, 1);
  // Rear diffuser / dual-exit exhaust
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(x, y + 3, 2, 2);
  // Roof scoop / snorkel
  ctx.fillStyle = k.accent;
  ctx.fillRect(x + 6, y + 4, 1, 1);
}

function drawBugatti(ctx: CanvasRenderingContext2D, x: number, y: number, k: CarKind) {
  // Bugatti is wider — 20 wide
  carBase(ctx, x, y, k);
  // Two-tone — top half gets the accent (almost black) running the length
  ctx.fillStyle = k.accent;
  ctx.fillRect(x + 1, y + 1, k.width - 2, 2);
  // Centered horseshoe grille (Bugatti's signature) — round-ish at front
  ctx.fillStyle = k.accent;
  ctx.fillRect(x + k.width - 2, y + 3, 1, 2);
  ctx.fillStyle = "#c5a455";
  ctx.fillRect(x + k.width - 1, y + 3, 1, 2);
  // Cockpit (paired bubble canopy)
  ctx.fillStyle = "#0a1024";
  ctx.fillRect(x + 6, y + 2, 7, 4);
  ctx.fillStyle = "#3b5a96";
  ctx.fillRect(x + 7, y + 3, 5, 2);
  // C-shaped side line (signature Chiron sweep)
  ctx.fillStyle = "#c5a455";
  ctx.fillRect(x + 6, y + 1, 4, 1);
  ctx.fillRect(x + 6, y + 6, 4, 1);
  // Quad LED headlights
  ctx.fillStyle = "#fff4dc";
  ctx.fillRect(x + k.width - 1, y + 1, 1, 1);
  ctx.fillRect(x + k.width - 1, y + 6, 1, 1);
}

function drawKoenigsegg(ctx: CanvasRenderingContext2D, x: number, y: number, k: CarKind) {
  carBase(ctx, x, y, k);
  // Twin gold racing stripes down the length
  ctx.fillStyle = k.accent;
  ctx.fillRect(x, y + 2, k.width, 1);
  ctx.fillRect(x, y + 5, k.width, 1);
  // Cockpit (centered, narrow — dihedral synchro-helix vibes)
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(x + 5, y + 1, 8, 6);
  ctx.fillStyle = "#3a3a3a";
  ctx.fillRect(x + 6, y + 2, 6, 4);
  // Tall rear wing — extends past the body silhouette
  ctx.fillStyle = k.accent;
  ctx.fillRect(x, y - 1, 4, 1);
  ctx.fillRect(x, y + 8, 4, 1);
  // Narrow nose (bumper notch)
  ctx.fillStyle = k.accent;
  ctx.fillRect(x + k.width - 1, y + 3, 1, 2);
  // Headlights
  ctx.fillStyle = "#fff4dc";
  ctx.fillRect(x + k.width - 2, y + 1, 1, 1);
  ctx.fillRect(x + k.width - 2, y + 6, 1, 1);
}

function drawAston(ctx: CanvasRenderingContext2D, x: number, y: number, k: CarKind) {
  carBase(ctx, x, y, k);
  // Pointed nose (Valkyrie's needle front)
  ctx.fillStyle = PAL.asphalt;
  ctx.fillRect(x + k.width - 1, y, 1, 2);
  ctx.fillRect(x + k.width - 1, y + 6, 1, 2);
  // Gold pinstripe down the center spine
  ctx.fillStyle = k.accent;
  ctx.fillRect(x + 1, y + 3, k.width - 2, 1);
  ctx.fillRect(x + 1, y + 4, k.width - 2, 1);
  // Cockpit canopy (pulled forward, low)
  ctx.fillStyle = "#1a2a22";
  ctx.fillRect(x + 5, y + 1, 7, 6);
  ctx.fillStyle = "#0e1a14";
  ctx.fillRect(x + 6, y + 2, 5, 4);
  // Roof scoop (gold accent)
  ctx.fillStyle = k.accent;
  ctx.fillRect(x + 8, y + 3, 1, 2);
  // Side fender vents — small dark slots
  ctx.fillStyle = "#0a1a14";
  ctx.fillRect(x + 11, y, 2, 1);
  ctx.fillRect(x + 11, y + 7, 2, 1);
  // Headlights
  ctx.fillStyle = "#fff4dc";
  ctx.fillRect(x + k.width - 2, y + 2, 1, 1);
  ctx.fillRect(x + k.width - 2, y + 5, 1, 1);
}

function drawFailedCar(
  ctx: CanvasRenderingContext2D,
  video: PipelineVideo,
  col: number,
  row: number,
  _t: number,
  hitsRef: { current: Array<{ x: number; y: number; w: number; h: number; video: PipelineVideo }> },
) {
  // In the junkyard the car is the failed video's normal supercar — but
  // dented: missing a wheel, slumped to one side, panels rusted toward red.
  const baseX = FAILED_STAGE.x - 18 + col * 12;
  const baseY = 50 + row * 9;
  const kind = pickCarKind(video.id);

  ctx.fillStyle = PAL.shadow;
  ctx.fillRect(baseX, baseY + 6, 14, 2);

  // shrunken body
  ctx.fillStyle = mix(kind.primary, "#6c2f2c", 0.55);
  ctx.fillRect(baseX, baseY, 14, 7);
  ctx.fillStyle = kind.dark;
  ctx.fillRect(baseX, baseY + 5, 14, 2);
  // Smashed cockpit
  ctx.fillStyle = "#2a201c";
  ctx.fillRect(baseX + 4, baseY + 1, 7, 4);
  // dent / busted panel
  ctx.fillStyle = "#1a1310";
  ctx.fillRect(baseX + 9, baseY + 2, 2, 1);

  // 3 wheels — back-right is missing (signature wreck pose)
  ctx.fillStyle = "#0f0c0a";
  ctx.fillRect(baseX + 2, baseY - 1, 3, 2);
  ctx.fillRect(baseX + 1, baseY + 7, 3, 2);
  ctx.fillRect(baseX + 10, baseY + 7, 3, 2);
  // small puddle / oil under missing-wheel corner
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(baseX + 9, baseY + 8, 4, 1);

  hitsRef.current.push({ x: baseX - 1, y: baseY - 1, w: 16, h: 11, video });
}

/* Tiny color mix helper for the rusted look — ratio 0..1 toward `b` */
function mix(a: string, b: string, ratio: number): string {
  const ah = a.replace("#", "");
  const bh = b.replace("#", "");
  const ar = parseInt(ah.slice(0, 2), 16);
  const ag = parseInt(ah.slice(2, 4), 16);
  const ab = parseInt(ah.slice(4, 6), 16);
  const br = parseInt(bh.slice(0, 2), 16);
  const bg = parseInt(bh.slice(2, 4), 16);
  const bb = parseInt(bh.slice(4, 6), 16);
  const r = Math.round(ar + (br - ar) * ratio);
  const g = Math.round(ag + (bg - ag) * ratio);
  const bl = Math.round(ab + (bb - ab) * ratio);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl
    .toString(16)
    .padStart(2, "0")}`;
}

/* ── Title bar ─────────────────────────────────────────────────────────────── */

function drawTitleBar(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "rgba(28, 24, 22, 0.55)";
  ctx.fillRect(0, 0, LOGICAL_W, 14);
  drawPixelText(ctx, "GHL VIDEO PIPELINE", 6, 4, PAL.textLight, "left");
  drawPixelText(ctx, "CLICK A CAR FOR DETAILS", LOGICAL_W - 6, 4, PAL.textLight, "right");
}

/* ─── Tiny pixel font (5×7 caps + digits) ──────────────────────────────────── */

const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10001", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10001", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00000", "00100"],
  ":": ["00000", "00100", "00000", "00000", "00000", "00100", "00000"],
};

function drawPixelText(
  ctx: CanvasRenderingContext2D,
  raw: string,
  x: number,
  y: number,
  color: string,
  align: "left" | "center" | "right" = "left",
) {
  const text = raw.toUpperCase();
  const charW = 6; // 5 + 1 spacing
  const totalW = text.length * charW - 1;
  let startX = x;
  if (align === "center") startX = x - Math.floor(totalW / 2);
  else if (align === "right") startX = x - totalW;

  ctx.fillStyle = color;
  for (let i = 0; i < text.length; i++) {
    const glyph = FONT[text[i]] ?? FONT[" "];
    for (let row = 0; row < glyph.length; row++) {
      const line = glyph[row];
      for (let col = 0; col < line.length; col++) {
        if (line[col] === "1") ctx.fillRect(startX + i * charW + col, y + row, 1, 1);
      }
    }
  }
}

/* ── Tiny color helper: lighten a hex by mixing toward white ──────────────── */

function lighten(hex: string, percent: number): string {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  const t = Math.min(1, Math.max(0, percent / 100));
  const lr = Math.round(r + (255 - r) * t);
  const lg = Math.round(g + (255 - g) * t);
  const lb = Math.round(b + (255 - b) * t);
  return `#${lr.toString(16).padStart(2, "0")}${lg.toString(16).padStart(2, "0")}${lb
    .toString(16)
    .padStart(2, "0")}`;
}
