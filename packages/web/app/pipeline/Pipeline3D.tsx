"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Text, RoundedBox, Stars } from "@react-three/drei";
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
  { id: "queued", label: "Queued", color: "#94a3b8", emissive: "#475569", x: -15, y: 0 },
  { id: "recording", label: "Recording", color: "#3b82f6", emissive: "#1d4ed8", x: -10, y: 0 },
  { id: "narrating", label: "Narrating", color: "#8b5cf6", emissive: "#6d28d9", x: -5, y: 0 },
  { id: "rendering", label: "Rendering", color: "#ec4899", emissive: "#be185d", x: 0, y: 0 },
  { id: "review", label: "Review", color: "#f59e0b", emissive: "#b45309", x: 5, y: 0 },
  { id: "publishing", label: "Publishing", color: "#10b981", emissive: "#047857", x: 10, y: 0 },
  { id: "published", label: "Published", color: "#22c55e", emissive: "#15803d", x: 15, y: 0 },
  { id: "failed", label: "Failed", color: "#ef4444", emissive: "#991b1b", x: 0, y: 0 }, // junkyard handled separately
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
        camera={{ position: [0, 7, 18], fov: 55 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <Suspense fallback={null}>
          <color attach="background" args={["#020617"]} />
          <fog attach="fog" args={["#020617", 28, 60]} />

          <ambientLight intensity={0.35} />
          <directionalLight position={[6, 10, 8]} intensity={1.1} color="#ffffff" />
          <pointLight position={[-15, 8, 4]} intensity={0.7} color="#3b82f6" />
          <pointLight position={[15, 8, 4]} intensity={0.7} color="#22c55e" />

          <Stars radius={120} depth={70} count={3500} factor={3.4} fade speed={0.4} />

          <Road />
          <Shoulder />

          {STAGES.filter((s) => s.id !== "failed").map((s) => (
            <GantrySign key={s.id} stage={s} count={counts[s.id] ?? 0} />
          ))}

          {/* Junkyard area for failed cars (offset way to the side, off the road) */}
          <Junkyard count={counts["failed"] ?? 0} />

          {positioned.map(({ video, stage, offsetIndex, total }) =>
            video.status === "failed" ? (
              <Car
                key={video.id}
                video={video}
                stage={{ ...stage, x: 18, y: 0 }}
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

          <OrbitControls
            enablePan={false}
            minDistance={9}
            maxDistance={36}
            maxPolarAngle={Math.PI / 2.05}
            autoRotate
            autoRotateSpeed={0.35}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

/* ─── Road & environment ────────────────────────────────────────────────────── */

function Road() {
  // Center dashed line markings — one yellow dash every 2 units along x, near z=0
  const dashes = useMemo(() => {
    const n = Math.floor(ROAD_LENGTH / 2);
    return Array.from({ length: n }, (_, i) => -ROAD_LENGTH / 2 + 1 + i * 2);
  }, []);

  return (
    <group>
      {/* Asphalt base */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[ROAD_LENGTH, ROAD_WIDTH]} />
        <meshStandardMaterial color="#1e293b" roughness={0.95} metalness={0.05} />
      </mesh>

      {/* White edge stripes */}
      {[-ROAD_WIDTH / 2 + 0.18, ROAD_WIDTH / 2 - 0.18].map((z, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, z]}>
          <planeGeometry args={[ROAD_LENGTH, 0.12]} />
          <meshStandardMaterial
            color="#f1f5f9"
            emissive="#f1f5f9"
            emissiveIntensity={0.25}
            roughness={0.6}
          />
        </mesh>
      ))}

      {/* Yellow dashed center line */}
      {dashes.map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.005, 0]}>
          <planeGeometry args={[1.0, 0.12]} />
          <meshStandardMaterial
            color="#fbbf24"
            emissive="#fbbf24"
            emissiveIntensity={0.45}
            roughness={0.6}
          />
        </mesh>
      ))}
    </group>
  );
}

function Shoulder() {
  // Dirt-grey shoulders + far ground plane so the road doesn't float in space
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]}>
        <planeGeometry args={[ROAD_LENGTH * 4, ROAD_WIDTH * 8]} />
        <meshStandardMaterial color="#0b1220" roughness={1} metalness={0} />
      </mesh>
    </group>
  );
}

/* ─── Highway gantry sign (replaces the pillar) ─────────────────────────────── */

function GantrySign({ stage, count }: { stage: Stage; count: number }) {
  const ref = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((state) => {
    if (!ref.current) return;
    ref.current.emissiveIntensity =
      0.35 + Math.sin(state.clock.elapsedTime * 1.6 + stage.x * 0.3) * 0.12;
  });

  const postZ = ROAD_WIDTH / 2 + 0.15;
  const postHeight = 5.2;

  return (
    <group position={[stage.x, 0, 0]}>
      {/* Two posts straddling the road */}
      <mesh position={[0, postHeight / 2, -postZ]}>
        <cylinderGeometry args={[0.07, 0.09, postHeight, 8]} />
        <meshStandardMaterial color="#475569" metalness={0.7} roughness={0.4} />
      </mesh>
      <mesh position={[0, postHeight / 2, postZ]}>
        <cylinderGeometry args={[0.07, 0.09, postHeight, 8]} />
        <meshStandardMaterial color="#475569" metalness={0.7} roughness={0.4} />
      </mesh>

      {/* Cross-beam */}
      <mesh position={[0, postHeight + 0.1, 0]}>
        <boxGeometry args={[0.18, 0.18, postZ * 2]} />
        <meshStandardMaterial color="#475569" metalness={0.7} roughness={0.4} />
      </mesh>

      {/* Sign panel hanging just below the beam */}
      <RoundedBox
        args={[2.6, 1.05, 0.14]}
        radius={0.08}
        smoothness={3}
        position={[0, postHeight - 0.45, 0]}
      >
        <meshStandardMaterial
          ref={ref}
          color={stage.color}
          emissive={stage.emissive}
          emissiveIntensity={0.45}
          roughness={0.4}
          metalness={0.5}
        />
      </RoundedBox>

      {/* Sign text — a touch in front of the panel so it isn't z-fighting */}
      <Text
        position={[0, postHeight - 0.32, 0.085]}
        fontSize={0.36}
        color="#f8fafc"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.015}
        outlineColor="#0b1220"
      >
        {stage.label}
      </Text>
      {count > 0 ? (
        <Text
          position={[0, postHeight - 0.7, 0.085]}
          fontSize={0.24}
          color="#fde68a"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.012}
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
      {/* Faded sign on a single post */}
      <mesh position={[0, 1.6, 0]}>
        <cylinderGeometry args={[0.06, 0.07, 3.2, 8]} />
        <meshStandardMaterial color="#3f3f46" metalness={0.5} roughness={0.6} />
      </mesh>
      <RoundedBox args={[1.8, 0.7, 0.1]} radius={0.06} position={[0, 2.7, 0]}>
        <meshStandardMaterial color="#7f1d1d" emissive="#991b1b" emissiveIntensity={0.45} />
      </RoundedBox>
      <Text
        position={[0, 2.78, 0.06]}
        fontSize={0.28}
        color="#fee2e2"
        anchorX="center"
        anchorY="middle"
      >
        Failed
      </Text>
      {count > 0 ? (
        <Text
          position={[0, 2.5, 0.06]}
          fontSize={0.2}
          color="#fca5a5"
          anchorX="center"
          anchorY="middle"
        >
          {`× ${count}`}
        </Text>
      ) : null}
    </group>
  );
}

/* ─── Car ───────────────────────────────────────────────────────────────────── */

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

  // For a stage on the road: queue cars side-by-side in two lanes (z = -1 and +1),
  // alternating, then push back along x for additional pairs.
  const lane = offsetIndex % 2 === 0 ? -1 : 1;
  const xBack = -Math.floor(offsetIndex / 2) * 1.9;

  const isActive = ACTIVE_STAGES.has(video.status);
  const isFailed = video.status === "failed" || !!inJunkyard;

  useFrame((state) => {
    const t = state.clock.elapsedTime + offsetIndex * 0.6;
    if (ref.current) {
      ref.current.position.y = 0.18 + Math.sin(t * 2.2) * 0.025;
      ref.current.rotation.z = isFailed ? -0.15 : Math.sin(t * 1.7) * 0.01;
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
  const bodyColor = stage.color;
  const roofColor = stage.emissive;

  // Failed cars are scattered in the junkyard at varied positions
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

      {/* Cabin */}
      <RoundedBox args={[1.0, 0.36, 0.78]} radius={0.1} smoothness={3} position={[-0.05, 0.62, 0]}>
        <meshStandardMaterial
          color={roofColor}
          emissive={stage.emissive}
          emissiveIntensity={0.25}
          roughness={0.5}
          metalness={0.6}
        />
      </RoundedBox>

      {/* Windshield */}
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

      {/* Wheels — y=0 since car is already lifted to y=0.18 (wheel radius) */}
      <Wheel ref={wheelFL} position={[0.55, 0, 0.46]} />
      <Wheel ref={wheelFR} position={[0.55, 0, -0.46]} />
      <Wheel ref={wheelRL} position={[-0.55, 0, 0.46]} />
      <Wheel ref={wheelRR} position={[-0.55, 0, -0.46]} />

      {/* Headlights */}
      <mesh position={[0.92, 0.27, 0.3]}>
        <sphereGeometry args={[0.07, 12, 12]} />
        <meshStandardMaterial color="#fff7ed" emissive="#fde68a" emissiveIntensity={1.5} />
      </mesh>
      <mesh position={[0.92, 0.27, -0.3]}>
        <sphereGeometry args={[0.07, 12, 12]} />
        <meshStandardMaterial color="#fff7ed" emissive="#fde68a" emissiveIntensity={1.5} />
      </mesh>

      {/* Tail lights */}
      <mesh position={[-0.92, 0.27, 0.3]}>
        <sphereGeometry args={[0.06, 12, 12]} />
        <meshStandardMaterial color="#fca5a5" emissive="#dc2626" emissiveIntensity={1.2} />
      </mesh>
      <mesh position={[-0.92, 0.27, -0.3]}>
        <sphereGeometry args={[0.06, 12, 12]} />
        <meshStandardMaterial color="#fca5a5" emissive="#dc2626" emissiveIntensity={1.2} />
      </mesh>

      {/* Floating title — counter-rotated so it always reads forward to camera */}
      <group rotation={[0, -baseRotationY, 0]}>
        <Text
          position={[0, 1.45, 0]}
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
