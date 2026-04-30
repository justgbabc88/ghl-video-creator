"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import { forwardRef, useRef, useState, useMemo, Suspense } from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";

export interface PipelineVideo {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}

interface Stage {
  id: string;
  label: string;
  color: string;
  shadow: string;
  x: number;
}

// Saturated 8-bit-ish palette
const STAGES: Stage[] = [
  { id: "queued", label: "QUEUED", color: "#94a3b8", shadow: "#475569", x: -15 },
  { id: "recording", label: "RECORDING", color: "#3b82f6", shadow: "#1e3a8a", x: -10 },
  { id: "narrating", label: "NARRATING", color: "#a855f7", shadow: "#581c87", x: -5 },
  { id: "rendering", label: "RENDERING", color: "#ec4899", shadow: "#831843", x: 0 },
  { id: "review", label: "REVIEW", color: "#f59e0b", shadow: "#78350f", x: 5 },
  { id: "publishing", label: "PUBLISHING", color: "#10b981", shadow: "#064e3b", x: 10 },
  { id: "published", label: "PUBLISHED", color: "#22c55e", shadow: "#14532d", x: 15 },
  { id: "failed", label: "FAILED", color: "#ef4444", shadow: "#7f1d1d", x: 0 },
];

const STAGE_BY_ID = Object.fromEntries(STAGES.map((s) => [s.id, s]));

const ROAD_WIDTH = 6.5;
const ROAD_LENGTH = 50;

export function Pipeline3D({ videos }: { videos: PipelineVideo[] }) {
  const positioned = useMemo(() => {
    const byStage = new Map<string, PipelineVideo[]>();
    for (const v of videos) {
      const arr = byStage.get(v.status) ?? [];
      arr.push(v);
      byStage.set(v.status, arr);
    }
    const out: Array<{ video: PipelineVideo; stage: Stage; offsetIndex: number; total: number }> = [];
    for (const [stageId, arr] of byStage.entries()) {
      const stage = STAGE_BY_ID[stageId];
      if (!stage) continue;
      arr.forEach((video, idx) => {
        out.push({ video, stage, offsetIndex: idx, total: arr.length });
      });
    }
    return out;
  }, [videos]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of videos) c[v.status] = (c[v.status] ?? 0) + 1;
    return c;
  }, [videos]);

  return (
    <div className="absolute inset-0">
      <Canvas
        // Low DPR = chunky framebuffer pixels. The CSS image-rendering: pixelated
        // ensures the upscale is a hard nearest-neighbor — that's what gives the 8-bit feel.
        dpr={[0.45, 0.45]}
        camera={{ position: [0, 8, 18], fov: 55 }}
        gl={{ antialias: false, powerPreference: "high-performance" }}
        style={{ imageRendering: "pixelated", height: "100%", width: "100%" }}
      >
        <Suspense fallback={null}>
          <color attach="background" args={["#0b0f24"]} />

          {/* Hard cartoon lighting — flat hemisphere + a single key directional. No fog,
              no point-light bloom, nothing that would smear the chunky look. */}
          <hemisphereLight args={["#7dd3fc", "#1e1b4b", 0.55]} />
          <directionalLight position={[8, 14, 6]} intensity={1.0} color="#ffffff" />

          <PixelStars count={140} />
          <Road />
          {STAGES.filter((s) => s.id !== "failed").map((s) => (
            <PixelSign key={s.id} stage={s} count={counts[s.id] ?? 0} />
          ))}
          <Junkyard count={counts["failed"] ?? 0} />

          {positioned.map(({ video, stage, offsetIndex, total }) =>
            video.status === "failed" ? (
              <Car
                key={video.id}
                video={video}
                stage={{ ...stage, x: 18 }}
                offsetIndex={offsetIndex}
                total={total}
                inJunkyard
              />
            ) : (
              <Car
                key={video.id}
                video={video}
                stage={stage}
                offsetIndex={offsetIndex}
                total={total}
              />
            ),
          )}

          {/* No autoRotate — camera holds still until the user drags. */}
          <OrbitControls
            enablePan={false}
            minDistance={9}
            maxDistance={36}
            maxPolarAngle={Math.PI / 2.05}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

/* ─── Static pixel stars (replaces drei's <Stars> for a chunkier look) ──────── */

function PixelStars({ count = 120 }: { count?: number }) {
  const positions = useMemo(() => {
    const arr: [number, number, number][] = [];
    for (let i = 0; i < count; i++) {
      const r = 35 + Math.random() * 25;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.5; // upper hemisphere only
      arr.push([
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi) + 6,
        r * Math.sin(phi) * Math.sin(theta) - 8,
      ]);
    }
    return arr;
  }, [count]);
  return (
    <group>
      {positions.map((p, i) => (
        <mesh key={i} position={p}>
          <boxGeometry args={[0.18, 0.18, 0.18]} />
          <meshBasicMaterial color="#f8fafc" />
        </mesh>
      ))}
    </group>
  );
}

/* ─── Road (boxy, saturated, no AA) ─────────────────────────────────────────── */

function Road() {
  const dashes = useMemo(() => {
    const n = Math.floor(ROAD_LENGTH / 2);
    return Array.from({ length: n }, (_, i) => -ROAD_LENGTH / 2 + 1 + i * 2);
  }, []);

  return (
    <group>
      {/* Asphalt — flat lambert for the chunky cell-shade vibe */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[ROAD_LENGTH, ROAD_WIDTH]} />
        <meshLambertMaterial color="#1f2937" />
      </mesh>

      {/* Edge stripes — bright pixel-white */}
      {[-ROAD_WIDTH / 2 + 0.18, ROAD_WIDTH / 2 - 0.18].map((z, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, z]}>
          <planeGeometry args={[ROAD_LENGTH, 0.18]} />
          <meshBasicMaterial color="#fefefe" />
        </mesh>
      ))}

      {/* Yellow dashed center line */}
      {dashes.map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.005, 0]}>
          <planeGeometry args={[1.0, 0.16]} />
          <meshBasicMaterial color="#fde047" />
        </mesh>
      ))}

      {/* Surrounding ground — simple dark plane so the road has context */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]}>
        <planeGeometry args={[ROAD_LENGTH * 4, ROAD_WIDTH * 8]} />
        <meshLambertMaterial color="#0b1220" />
      </mesh>
    </group>
  );
}

/* ─── Highway sign in pixel style (boxy posts + glowing panel) ──────────────── */

function PixelSign({ stage, count }: { stage: Stage; count: number }) {
  const postZ = ROAD_WIDTH / 2 + 0.15;
  const postHeight = 5.2;

  return (
    <group position={[stage.x, 0, 0]}>
      {/* Two posts (boxes — chunkier than cylinders) */}
      <mesh position={[0, postHeight / 2, -postZ]}>
        <boxGeometry args={[0.22, postHeight, 0.22]} />
        <meshLambertMaterial color="#475569" />
      </mesh>
      <mesh position={[0, postHeight / 2, postZ]}>
        <boxGeometry args={[0.22, postHeight, 0.22]} />
        <meshLambertMaterial color="#475569" />
      </mesh>

      {/* Cross-beam */}
      <mesh position={[0, postHeight + 0.1, 0]}>
        <boxGeometry args={[0.28, 0.28, postZ * 2]} />
        <meshLambertMaterial color="#475569" />
      </mesh>

      {/* Sign panel — solid color block, no gradient/PBR */}
      <mesh position={[0, postHeight - 0.45, 0]}>
        <boxGeometry args={[2.6, 1.05, 0.18]} />
        <meshLambertMaterial color={stage.color} emissive={stage.shadow} emissiveIntensity={0.6} />
      </mesh>

      {/* Sign text */}
      <Text
        position={[0, postHeight - 0.32, 0.105]}
        fontSize={0.34}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.025}
        outlineColor={stage.shadow}
        characters="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789×: "
      >
        {stage.label}
      </Text>
      {count > 0 ? (
        <Text
          position={[0, postHeight - 0.7, 0.105]}
          fontSize={0.26}
          color="#fde047"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.02}
          outlineColor="#0b1220"
        >
          {`× ${count}`}
        </Text>
      ) : null}
    </group>
  );
}

function Junkyard({ count }: { count: number }) {
  return (
    <group position={[18, 0, 6]}>
      <mesh position={[0, 1.6, 0]}>
        <boxGeometry args={[0.18, 3.2, 0.18]} />
        <meshLambertMaterial color="#3f3f46" />
      </mesh>
      <mesh position={[0, 2.7, 0]}>
        <boxGeometry args={[1.8, 0.7, 0.14]} />
        <meshLambertMaterial color="#7f1d1d" emissive="#dc2626" emissiveIntensity={0.5} />
      </mesh>
      <Text
        position={[0, 2.78, 0.08]}
        fontSize={0.3}
        color="#fef2f2"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.02}
        outlineColor="#7f1d1d"
        characters="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789×× "
      >
        FAILED
      </Text>
      {count > 0 ? (
        <Text
          position={[0, 2.5, 0.08]}
          fontSize={0.22}
          color="#fde047"
          anchorX="center"
          anchorY="middle"
        >
          {`× ${count}`}
        </Text>
      ) : null}
    </group>
  );
}

/* ─── Car (pixelated: chunky boxes, hexagonal wheels, no PBR materials) ─────── */

const ACTIVE_STAGES = new Set([
  "queued",
  "recording",
  "narrating",
  "rendering",
  "publishing",
]);

function Car({
  video,
  stage,
  offsetIndex,
  total,
  inJunkyard,
}: {
  video: PipelineVideo;
  stage: Stage;
  offsetIndex: number;
  total: number;
  inJunkyard?: boolean;
}) {
  const router = useRouter();
  const ref = useRef<THREE.Group>(null);
  const wheelFL = useRef<THREE.Group>(null);
  const wheelFR = useRef<THREE.Group>(null);
  const wheelRL = useRef<THREE.Group>(null);
  const wheelRR = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  const lane = offsetIndex % 2 === 0 ? -1 : 1;
  const xBack = -Math.floor(offsetIndex / 2) * 1.9;

  const isActive = ACTIVE_STAGES.has(video.status);
  const isFailed = video.status === "failed" || !!inJunkyard;

  useFrame((state) => {
    const t = state.clock.elapsedTime + offsetIndex * 0.6;
    if (ref.current) {
      // Snap bobbing to discrete steps for a stop-motion feel
      const bob = Math.round(Math.sin(t * 2.2) * 4) / 100;
      ref.current.position.y = 0.18 + bob;
      ref.current.rotation.z = isFailed ? -0.15 : 0;
    }
    if (isActive) {
      const spin = state.clock.elapsedTime * 6;
      if (wheelFL.current) wheelFL.current.rotation.z = spin;
      if (wheelFR.current) wheelFR.current.rotation.z = spin;
      if (wheelRL.current) wheelRL.current.rotation.z = spin;
      if (wheelRR.current) wheelRR.current.rotation.z = spin;
    }
  });

  const truncatedTitle =
    video.title.length > 26 ? video.title.slice(0, 24) + "…" : video.title;

  const positionX = inJunkyard ? stage.x + (offsetIndex % 3) * 1.4 - 1.4 : stage.x + xBack;
  const positionZ = inJunkyard ? -2 + Math.floor(offsetIndex / 3) * 1.6 : lane;
  const baseRotationY = isFailed ? Math.PI * 0.85 : 0;

  return (
    <group
      ref={ref}
      position={[positionX, 0.18, positionZ]}
      rotation={[0, baseRotationY, 0]}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "default";
      }}
      onClick={(e) => {
        e.stopPropagation();
        router.push(`/videos/${video.id}`);
      }}
      scale={hovered ? 1.12 : 1}
    >
      {/* Body — flat colored block */}
      <mesh position={[0, 0.22, 0]}>
        <boxGeometry args={[1.8, 0.45, 0.85]} />
        <meshLambertMaterial color={stage.color} emissive={stage.shadow} emissiveIntensity={hovered ? 0.5 : 0.25} />
      </mesh>

      {/* Cabin */}
      <mesh position={[-0.05, 0.62, 0]}>
        <boxGeometry args={[1.0, 0.36, 0.78]} />
        <meshLambertMaterial color={stage.shadow} />
      </mesh>

      {/* Windshield slab */}
      <mesh position={[0.46, 0.62, 0]}>
        <boxGeometry args={[0.06, 0.32, 0.7]} />
        <meshLambertMaterial color="#0ea5e9" />
      </mesh>

      {/* Wheels — hexagonal cylinder for that boxy 8-bit feel */}
      <Wheel ref={wheelFL} position={[0.55, 0, 0.46]} />
      <Wheel ref={wheelFR} position={[0.55, 0, -0.46]} />
      <Wheel ref={wheelRL} position={[-0.55, 0, 0.46]} />
      <Wheel ref={wheelRR} position={[-0.55, 0, -0.46]} />

      {/* Headlights — small white cubes */}
      <mesh position={[0.92, 0.27, 0.3]}>
        <boxGeometry args={[0.08, 0.1, 0.1]} />
        <meshBasicMaterial color="#fef9c3" />
      </mesh>
      <mesh position={[0.92, 0.27, -0.3]}>
        <boxGeometry args={[0.08, 0.1, 0.1]} />
        <meshBasicMaterial color="#fef9c3" />
      </mesh>

      {/* Tail lights — small red cubes */}
      <mesh position={[-0.92, 0.27, 0.3]}>
        <boxGeometry args={[0.08, 0.1, 0.1]} />
        <meshBasicMaterial color="#dc2626" />
      </mesh>
      <mesh position={[-0.92, 0.27, -0.3]}>
        <boxGeometry args={[0.08, 0.1, 0.1]} />
        <meshBasicMaterial color="#dc2626" />
      </mesh>

      {/* Floating title — counter-rotated so it always reads forward */}
      <group rotation={[0, -baseRotationY, 0]}>
        <Text
          position={[0, 1.45, 0]}
          fontSize={0.22}
          color="#f8fafc"
          anchorX="center"
          anchorY="middle"
          maxWidth={3.2}
          outlineWidth={0.018}
          outlineColor="#0b1220"
        >
          {truncatedTitle}
        </Text>
      </group>
    </group>
  );
}

const Wheel = forwardRef<THREE.Group, { position: [number, number, number] }>(
  function Wheel(props, ref) {
    return (
      <group ref={ref} position={props.position}>
        {/* 6-segment cylinder — hexagonal, very 8-bit */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.18, 0.18, 0.14, 6]} />
          <meshLambertMaterial color="#0f172a" />
        </mesh>
      </group>
    );
  },
);
