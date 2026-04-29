"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Text, RoundedBox, Stars, Line } from "@react-three/drei";
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
  emissive: string;
  x: number;
  y: number;
}

const STAGES: Stage[] = [
  { id: "queued", label: "Queued", color: "#64748b", emissive: "#334155", x: -12, y: 0 },
  { id: "recording", label: "Recording", color: "#3b82f6", emissive: "#1d4ed8", x: -8, y: 0 },
  { id: "narrating", label: "Narrating", color: "#8b5cf6", emissive: "#6d28d9", x: -4, y: 0 },
  { id: "rendering", label: "Rendering", color: "#ec4899", emissive: "#be185d", x: 0, y: 0 },
  { id: "review", label: "Review", color: "#f59e0b", emissive: "#b45309", x: 4, y: 0 },
  { id: "publishing", label: "Publishing", color: "#10b981", emissive: "#047857", x: 8, y: 0 },
  { id: "published", label: "Published", color: "#22c55e", emissive: "#15803d", x: 12, y: 0 },
  { id: "failed", label: "Failed", color: "#ef4444", emissive: "#991b1b", x: 12, y: -5 },
];

const STAGE_BY_ID = Object.fromEntries(STAGES.map((s) => [s.id, s]));

export function Pipeline3D({ videos }: { videos: PipelineVideo[] }) {
  // Group by stage and assign each video a position offset within that stage
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
    <div className="h-[640px] w-full bg-gradient-to-b from-slate-950 to-slate-900 sm:rounded-xl overflow-hidden border-y sm:border border-slate-800">
      <Canvas
        camera={{ position: [0, 6, 18], fov: 55 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <Suspense fallback={null}>
          <color attach="background" args={["#020617"]} />
          <fog attach="fog" args={["#020617", 25, 50]} />

          {/* Ambient + key lights */}
          <ambientLight intensity={0.25} />
          <pointLight position={[0, 10, 10]} intensity={1.5} color="#ffffff" />
          <pointLight position={[-15, 5, -5]} intensity={0.8} color="#3b82f6" />
          <pointLight position={[15, 5, -5]} intensity={0.8} color="#22c55e" />

          {/* Background stars */}
          <Stars radius={80} depth={50} count={2000} factor={3} fade speed={0.5} />

          {/* Track baseline */}
          <Track />

          {/* Stage pillars */}
          {STAGES.map((s) => (
            <StagePillar key={s.id} stage={s} count={counts[s.id] ?? 0} />
          ))}

          {/* Video cars parked at their stage */}
          {positioned.map(({ video, stage, offsetIndex, total }) => (
            <Car
              key={video.id}
              video={video}
              stage={stage}
              offsetIndex={offsetIndex}
              total={total}
            />
          ))}

          {/* Ground reflection plane */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3.2, 0]}>
            <planeGeometry args={[80, 40]} />
            <meshStandardMaterial color="#0f172a" roughness={0.6} metalness={0.4} />
          </mesh>

          {/* Camera + interaction */}
          <OrbitControls
            enablePan={false}
            minDistance={10}
            maxDistance={32}
            maxPolarAngle={Math.PI / 2.05}
            autoRotate
            autoRotateSpeed={0.4}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

function Track() {
  // Glowing line connecting stages along x-axis
  const points = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let x = -13; x <= 13; x += 0.5) pts.push(new THREE.Vector3(x, 0, 0));
    return pts;
  }, []);
  return (
    <Line
      points={points}
      color="#475569"
      lineWidth={1.5}
      transparent
      opacity={0.6}
      dashed={false}
    />
  );
}

function StagePillar({ stage, count }: { stage: Stage; count: number }) {
  const ref = useRef<THREE.Mesh>(null);
  // Subtle pulsing emission
  useFrame((state) => {
    if (!ref.current) return;
    const m = ref.current.material as THREE.MeshStandardMaterial;
    m.emissiveIntensity = 0.5 + Math.sin(state.clock.elapsedTime * 1.2 + stage.x) * 0.15;
  });

  return (
    <group position={[stage.x, stage.y, 0]}>
      {/* The pillar */}
      <mesh ref={ref} position={[0, 1.3, 0]}>
        <cylinderGeometry args={[0.4, 0.5, 2.6, 24]} />
        <meshStandardMaterial
          color={stage.color}
          emissive={stage.emissive}
          emissiveIntensity={0.6}
          roughness={0.4}
          metalness={0.6}
          transparent
          opacity={0.85}
        />
      </mesh>

      {/* Base disc */}
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.9, 1.0, 0.1, 32]} />
        <meshStandardMaterial color={stage.color} emissive={stage.emissive} emissiveIntensity={0.4} />
      </mesh>

      {/* Label above */}
      <Text
        position={[0, 3.2, 0]}
        fontSize={0.48}
        color="#f1f5f9"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.02}
        outlineColor="#020617"
      >
        {stage.label}
      </Text>

      {/* Count badge */}
      {count > 0 ? (
        <Text
          position={[0, 2.6, 0]}
          fontSize={0.38}
          color={stage.color}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.02}
          outlineColor="#020617"
        >
          {`× ${count}`}
        </Text>
      ) : null}
    </group>
  );
}

/**
 * A small car composed of primitives:
 *   - body (RoundedBox)
 *   - cabin/roof (smaller RoundedBox on top)
 *   - 4 wheels (cylinders, side-rotated)
 *   - headlights (white emissive spheres at +x face)
 *   - tail lights (red emissive spheres at -x face)
 *   - title floats above the roof
 *
 * Wheels spin while the video is in an active stage (queued/recording/narrating/
 * rendering/publishing). Cars at terminal stages (review/published/failed) sit still.
 * Failed cars also tilt forward like they've broken down.
 */
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
}: {
  video: PipelineVideo;
  stage: Stage;
  offsetIndex: number;
  total: number;
}) {
  const router = useRouter();
  const ref = useRef<THREE.Group>(null);
  const wheelFL = useRef<THREE.Group>(null);
  const wheelFR = useRef<THREE.Group>(null);
  const wheelRL = useRef<THREE.Group>(null);
  const wheelRR = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  // Multiple cars at the same stage line up in a parking column along z, alternating sides
  const zOffset = (offsetIndex - (total - 1) / 2) * 2.0;
  const yBase = 0.45;
  const isActive = ACTIVE_STAGES.has(video.status);
  const isFailed = video.status === "failed";

  useFrame((state) => {
    const t = state.clock.elapsedTime + offsetIndex * 0.6;

    // Idle bob + tiny side-to-side rocking (parked engine purring)
    if (ref.current) {
      ref.current.position.y = yBase + Math.sin(t * 2.2) * 0.03;
      ref.current.rotation.z = isFailed ? -0.18 : Math.sin(t * 1.7) * 0.012;
    }

    // Wheel spin — rotate around z (the axle direction in world frame)
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

  // Slight color darkening for car body, brighter for accents
  const bodyColor = stage.color;
  const roofColor = stage.emissive;

  return (
    <group
      ref={ref}
      position={[stage.x, yBase, zOffset]}
      // Cars face along +x by default (toward the next stage) — except failed cars face the other way
      rotation={[0, isFailed ? Math.PI : 0, 0]}
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
      scale={hovered ? 1.15 : 1}
    >
      {/* Body */}
      <RoundedBox args={[1.8, 0.45, 0.85]} radius={0.12} smoothness={3} position={[0, 0.22, 0]}>
        <meshStandardMaterial
          color={bodyColor}
          emissive={stage.emissive}
          emissiveIntensity={hovered ? 0.7 : 0.35}
          roughness={0.35}
          metalness={0.75}
        />
      </RoundedBox>

      {/* Cabin / roof — slightly inset, sits on top */}
      <RoundedBox
        args={[1.0, 0.36, 0.78]}
        radius={0.1}
        smoothness={3}
        position={[-0.05, 0.62, 0]}
      >
        <meshStandardMaterial
          color={roofColor}
          emissive={stage.emissive}
          emissiveIntensity={0.25}
          roughness={0.5}
          metalness={0.6}
        />
      </RoundedBox>

      {/* Windshield — slight tilt, tinted glass */}
      <mesh position={[0.46, 0.6, 0]} rotation={[0, 0, -0.5]}>
        <boxGeometry args={[0.06, 0.36, 0.7]} />
        <meshStandardMaterial
          color="#0ea5e9"
          transparent
          opacity={0.45}
          roughness={0.05}
          metalness={0.9}
          emissive="#0369a1"
          emissiveIntensity={0.2}
        />
      </mesh>

      {/* Wheels — 4x cylinder rotated to lie flat as wheels */}
      <Wheel ref={wheelFL} position={[0.55, 0.18, 0.46]} />
      <Wheel ref={wheelFR} position={[0.55, 0.18, -0.46]} />
      <Wheel ref={wheelRL} position={[-0.55, 0.18, 0.46]} />
      <Wheel ref={wheelRR} position={[-0.55, 0.18, -0.46]} />

      {/* Headlights — front +x face */}
      <mesh position={[0.92, 0.27, 0.3]}>
        <sphereGeometry args={[0.07, 12, 12]} />
        <meshStandardMaterial color="#fff7ed" emissive="#fde68a" emissiveIntensity={1.5} />
      </mesh>
      <mesh position={[0.92, 0.27, -0.3]}>
        <sphereGeometry args={[0.07, 12, 12]} />
        <meshStandardMaterial color="#fff7ed" emissive="#fde68a" emissiveIntensity={1.5} />
      </mesh>

      {/* Tail lights — rear -x face */}
      <mesh position={[-0.92, 0.27, 0.3]}>
        <sphereGeometry args={[0.06, 12, 12]} />
        <meshStandardMaterial color="#fca5a5" emissive="#dc2626" emissiveIntensity={1.2} />
      </mesh>
      <mesh position={[-0.92, 0.27, -0.3]}>
        <sphereGeometry args={[0.06, 12, 12]} />
        <meshStandardMaterial color="#fca5a5" emissive="#dc2626" emissiveIntensity={1.2} />
      </mesh>

      {/* Title floating above (un-rotates so it always reads forward) */}
      <group rotation={[0, isFailed ? -Math.PI : 0, 0]}>
        <Text
          position={[0, 1.4, 0]}
          fontSize={0.22}
          color="#f8fafc"
          anchorX="center"
          anchorY="middle"
          maxWidth={3.2}
          outlineWidth={0.012}
          outlineColor="#0f172a"
        >
          {truncatedTitle}
        </Text>
      </group>
    </group>
  );
}

const Wheel = forwardRef<THREE.Group, { position: [number, number, number] }>(
  function Wheel(props, ref) {
    // Group is positioned at the wheel location and gets rotated for spinning.
    // Inner mesh re-orients the cylinder so its axle aligns with the group's z-axis,
    // so rotating the group around z spins the cylinder around its own axle.
    return (
      <group ref={ref} position={props.position}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.18, 0.18, 0.14, 18]} />
          <meshStandardMaterial color="#0f172a" roughness={0.7} metalness={0.4} />
        </mesh>
      </group>
    );
  },
);
