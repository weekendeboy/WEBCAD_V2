/**
 * @license
 * CAD 3D Parametric Feature Viewport (Three.js / React Three Fiber)
 *
 * 使用 @react-three/fiber 與 @react-three/drei 實現專業工業級 CAD 3D 視圖：
 * 1. 支援 OrbitControls（旋轉/平移/縮放）、網格地板 (GridHelper)、環境光與多向平行光照明。
 * 2. 訂閱 FeatureRebuilder 的 3D 網格狀態，使用 <bufferGeometry> 動態渲染實體與特徵邊線。
 * 3. 賦予專業 CAD 風格之 MeshStandardMaterial（金屬光澤、粗糙度與雙向正反面著色）。
 * 4. 保留完整的視角切換控制條 (Isometric / Front / Top / Right) 與特徵參數即時編輯器。
 */

import React, { useRef, useMemo, useState, useEffect } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import {
  OrbitControls,
  GizmoHelper,
  GizmoViewport
} from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import {
  useCadStore,
  useActiveFeatureId,
  useCADDocument
} from '../contexts/CadContext.tsx';
import {
  ExtrudeFeature,
  CutFeature,
  SolidMesh3D
} from '../types/cad.ts';
import { useModelRebuilder } from '../core/features/FeatureRebuilder.ts';
import {
  Rotate3d,
  Sliders,
  Scissors,
  Cpu,
  Maximize2,
  Box
} from 'lucide-react';

// ============================================================================
// 1. Camera View Controller Component (Inside Canvas)
// ============================================================================

interface CameraControllerProps {
  viewPreset: 'iso' | 'front' | 'top' | 'right' | null;
  target: [number, number, number];
  onPresetApplied: () => void;
}

const CameraController: React.FC<CameraControllerProps> = ({
  viewPreset,
  target,
  onPresetApplied
}) => {
  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null);

  useEffect(() => {
    if (!viewPreset) return;

    if (viewPreset === 'iso') {
      camera.position.set(160, 140, 170);
      camera.up.set(0, 1, 0);
    } else if (viewPreset === 'front') {
      camera.position.set(target[0], target[1], 240);
      camera.up.set(0, 1, 0);
    } else if (viewPreset === 'top') {
      camera.position.set(target[0], 250, target[2]);
      camera.up.set(0, 0, -1);
    } else if (viewPreset === 'right') {
      camera.position.set(250, target[1], target[2]);
      camera.up.set(0, 1, 0);
    }

    camera.lookAt(target[0], target[1], target[2]);

    if (controlsRef.current) {
      controlsRef.current.target.set(target[0], target[1], target[2]);
      controlsRef.current.update();
    }

    onPresetApplied();
  }, [viewPreset, camera, target, onPresetApplied]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      target={target}
      enableDamping
      dampingFactor={0.08}
      minDistance={10}
      maxDistance={900}
    />
  );
};

// ============================================================================
// 2. CAD Solid Mesh Item Component (Dynamic BufferGeometry + Material)
// ============================================================================

interface CADMeshItemProps {
  mesh: SolidMesh3D;
  isActive: boolean;
  displayStyle: 'shaded_edges' | 'wireframe' | 'shaded';
  onSelect: (featureId: string) => void;
}

const CADMeshItem: React.FC<CADMeshItemProps> = ({
  mesh,
  isActive,
  displayStyle,
  onSelect
}) => {
  const [hovered, setHovered] = useState(false);

  // 1. Dynamic BufferGeometry with Positions, Normals, and Triangle Indices
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(mesh.positions, 3)
    );

    if (mesh.normals && mesh.normals.length > 0) {
      geo.setAttribute(
        'normal',
        new THREE.Float32BufferAttribute(mesh.normals, 3)
      );
    } else {
      geo.computeVertexNormals();
    }

    if (mesh.indices && mesh.indices.length > 0) {
      geo.setIndex(mesh.indices);
    }

    return geo;
  }, [mesh.positions, mesh.normals, mesh.indices]);

  // 2. CAD Wireframe Feature Edges
  const edgeGeometry = useMemo(() => {
    if (!mesh.edges || mesh.edges.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.edges, 3));
    return geo;
  }, [mesh.edges]);

  const isCut = mesh.isCut;
  const isWireframe = displayStyle === 'wireframe';
  const showEdges = displayStyle === 'shaded_edges';

  // Professional CAD metallic palette
  const materialColor = isCut
    ? isActive
      ? '#fb7185'
      : '#e11d48'
    : isActive
    ? '#38bdf8'
    : hovered
    ? '#0284c7'
    : '#0369a1';

  return (
    <group
      onClick={(e) => {
        e.stopPropagation();
        onSelect(mesh.featureId);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {/* 3D Solid Surface Mesh */}
      <mesh geometry={geometry}>
        <meshStandardMaterial
          color={materialColor}
          metalness={isCut ? 0.2 : 0.48}
          roughness={isCut ? 0.35 : 0.26}
          wireframe={isWireframe}
          transparent={isCut}
          opacity={isCut ? 0.62 : 1.0}
          depthWrite={!isCut}
          polygonOffset={showEdges}
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* CAD Feature Sharp Outline Edges */}
      {showEdges && edgeGeometry && (
        <lineSegments geometry={edgeGeometry}>
          <lineBasicMaterial
            color={isActive ? '#38bdf8' : '#090d16'}
            linewidth={isActive ? 2 : 1}
          />
        </lineSegments>
      )}
    </group>
  );
};

// ============================================================================
// 3. Main CAD3DViewport Component
// ============================================================================

export const CAD3DViewport: React.FC = () => {
  const document = useCADDocument();
  const activeFeatureId = useActiveFeatureId();
  const updateFeature = useCadStore((s) => s.updateFeature);
  const setActiveFeatureId = useCadStore((s) => s.setActiveFeatureId);

  // Subscribe to dynamically rebuilt 3D meshes from FeatureRebuilder
  const { meshes, isRebuilding } = useModelRebuilder(20);

  const [viewPreset, setViewPreset] = useState<'iso' | 'front' | 'top' | 'right' | null>('iso');
  const [displayStyle, setDisplayStyle] = useState<'shaded_edges' | 'wireframe' | 'shaded'>('shaded_edges');

  // Extract Boss-Extrude and Cut-Extrude features from document
  const extrudeFeature = document.featureTree.find(
    (f) => f.type === 'extrude' && !f.suppressed
  ) as ExtrudeFeature | undefined;

  const cutFeature = document.featureTree.find(
    (f) => f.type === 'cut' && !f.suppressed
  ) as CutFeature | undefined;

  const extrudeDepth = extrudeFeature?.depth ?? 30;
  const cutDepth = cutFeature?.depth ?? 30;

  // Center of the sample model (100 x 80 x 30 mm)
  const modelCenter: [number, number, number] = useMemo(() => {
    if (meshes.length === 0) return [50, 40, 15];
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const m of meshes) {
      minX = Math.min(minX, m.boundingBox.min.x);
      minY = Math.min(minY, m.boundingBox.min.y);
      minZ = Math.min(minZ, m.boundingBox.min.z);
      maxX = Math.max(maxX, m.boundingBox.max.x);
      maxY = Math.max(maxY, m.boundingBox.max.y);
      maxZ = Math.max(maxZ, m.boundingBox.max.z);
    }

    return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  }, [meshes]);

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-xl overflow-hidden border border-slate-800 text-slate-100 shadow-md">
      {/* 3D Viewport Controls Bar */}
      <div className="px-4 py-2.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 font-mono text-slate-300">
            <Rotate3d className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold">3D Parametric CAD Viewport</span>
            <span className="text-slate-500">|</span>
            <span className="text-emerald-400 font-mono">
              Depth: {extrudeDepth}mm
            </span>
          </div>

          {/* OcctBridge & Rebuilder live kernel status */}
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-[11px] font-mono">
            <Cpu className="w-3 h-3 text-sky-400" />
            <span className="text-slate-400">Kernel:</span>
            <span className="text-sky-300 font-semibold">{meshes.length} Meshes</span>
            <span className="text-slate-600">|</span>
            <span className="text-emerald-400">
              {meshes.reduce((acc, m) => acc + m.triangleCount, 0)} Tris
            </span>
            {isRebuilding && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" title="Rebuilding..." />
            )}
          </div>
        </div>

        {/* Orbit & View Presets */}
        <div className="flex items-center gap-2">
          <button
            id="view-iso-btn"
            onClick={() => setViewPreset('iso')}
            className={`px-2.5 py-1 rounded transition-colors ${
              viewPreset === 'iso' ? 'bg-indigo-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
            }`}
          >
            Isometric
          </button>
          <button
            id="view-front-btn"
            onClick={() => setViewPreset('front')}
            className={`px-2.5 py-1 rounded transition-colors ${
              viewPreset === 'front' ? 'bg-indigo-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
            }`}
          >
            Front
          </button>
          <button
            id="view-top-btn"
            onClick={() => setViewPreset('top')}
            className={`px-2.5 py-1 rounded transition-colors ${
              viewPreset === 'top' ? 'bg-indigo-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
            }`}
          >
            Top
          </button>
          <button
            id="view-right-btn"
            onClick={() => setViewPreset('right')}
            className={`px-2.5 py-1 rounded transition-colors ${
              viewPreset === 'right' ? 'bg-indigo-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
            }`}
          >
            Right
          </button>

          <div className="h-4 w-px bg-slate-800 mx-1" />

          {/* Shaded with Edges vs Wireframe */}
          <button
            id="toggle-wireframe-btn"
            onClick={() =>
              setDisplayStyle((s) => (s === 'shaded_edges' ? 'wireframe' : s === 'wireframe' ? 'shaded' : 'shaded_edges'))
            }
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
          >
            {displayStyle === 'shaded_edges'
              ? 'Shaded + Edges'
              : displayStyle === 'wireframe'
              ? 'Wireframe'
              : 'Shaded'}
          </button>
        </div>
      </div>

      {/* 3D WebGL Canvas Area */}
      <div className="relative flex-1 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 min-h-[420px] overflow-hidden">
        <Canvas
          camera={{ position: [160, 140, 170], fov: 45, near: 1, far: 2000 }}
          className="w-full h-full cursor-grab active:cursor-grabbing"
          gl={{ antialias: true, alpha: true }}
        >
          {/* Ambient & Studio CAD Directional Lighting */}
          <ambientLight intensity={0.85} />
          <directionalLight position={[180, 240, 180]} intensity={1.4} castShadow />
          <directionalLight position={[-160, 140, -140]} intensity={0.75} />
          <directionalLight position={[0, -100, 120]} intensity={0.35} />

          {/* Grid Floor at Y=0 (Base Plane) */}
          <gridHelper
            args={[360, 36, '#475569', '#1e293b']}
            position={[50, 0, 15]}
          />

          {/* 3D Origin Axes Indicator (X=Red, Y=Green, Z=Blue) */}
          <axesHelper args={[40]} position={[0, 0, 0]} />

          {/* Dynamic 3D Solid Meshes from FeatureRebuilder */}
          {meshes.map((mesh) => (
            <CADMeshItem
              key={mesh.id}
              mesh={mesh}
              isActive={activeFeatureId === mesh.featureId}
              displayStyle={displayStyle}
              onSelect={(id) => setActiveFeatureId(id)}
            />
          ))}

          {/* Camera Controller & OrbitControls */}
          <CameraController
            viewPreset={viewPreset}
            target={modelCenter}
            onPresetApplied={() => setViewPreset(null)}
          />

          {/* Bottom-left Interactive 3D Orientation Gizmo */}
          <GizmoHelper alignment="bottom-left" margin={[60, 60]}>
            <GizmoViewport
              axisColors={['#f43f5e', '#10b981', '#38bdf8']}
              labelColor="#ffffff"
            />
          </GizmoHelper>
        </Canvas>

        {/* 3D Origin Indicator Overlay */}
        <div className="absolute top-3 left-3 bg-slate-950/80 backdrop-blur border border-slate-800/80 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-slate-400 flex items-center gap-2 shadow-lg pointer-events-none">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            <span>X</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500 ml-1" />
            <span>Y</span>
            <span className="w-2 h-2 rounded-full bg-sky-500 ml-1" />
            <span>Z</span>
          </div>
          <span className="text-slate-600">|</span>
          <span className="text-slate-300">R3F Canvas</span>
        </div>

        {/* Parametric Feature Settings Overlay Inspector */}
        <div className="absolute bottom-3 right-3 bg-slate-950/90 backdrop-blur border border-slate-800 rounded-xl p-3.5 text-xs shadow-2xl max-w-xs space-y-2.5">
          <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
            <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5" />
              Parametric Feature Settings
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              Active: {activeFeatureId}
            </span>
          </div>

          {/* Boss-Extrude Feature Depth Slider */}
          {extrudeFeature && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-300">
                <span className="flex items-center gap-1">
                  <Box className="w-3 h-3 text-sky-400" />
                  Boss Extrusion Depth:
                </span>
                <span className="font-mono text-emerald-400 font-bold">
                  {extrudeDepth} mm
                </span>
              </div>
              <input
                id="extrude-depth-slider"
                type="range"
                min="10"
                max="100"
                step="5"
                value={extrudeDepth}
                onChange={(e) => {
                  updateFeature(extrudeFeature.id, {
                    depth: Number(e.target.value)
                  } as Partial<ExtrudeFeature>);
                }}
                className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-800 rounded"
              />
            </div>
          )}

          {/* Cut-Extrude Feature Depth Slider */}
          {cutFeature && (
            <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
              <div className="flex items-center justify-between text-[11px] text-slate-300">
                <span className="text-rose-300 flex items-center gap-1">
                  <Scissors className="w-3 h-3" /> Cut Bore Depth:
                </span>
                <span className="font-mono text-rose-400 font-bold">
                  {cutDepth} mm
                </span>
              </div>
              <input
                id="cut-depth-slider"
                type="range"
                min="5"
                max="50"
                step="5"
                value={cutDepth}
                onChange={(e) => {
                  updateFeature(cutFeature.id, {
                    depth: Number(e.target.value)
                  } as Partial<CutFeature>);
                }}
                className="w-full accent-rose-500 cursor-pointer h-1.5 bg-slate-800 rounded"
              />
            </div>
          )}

          {/* Active Mesh Kernel Geometry Stats */}
          {(() => {
            const activeMesh = meshes.find((m) => m.featureId === activeFeatureId);
            if (!activeMesh) return null;
            return (
              <div className="pt-1.5 border-t border-slate-800 text-[10px] font-mono text-slate-400 flex items-center justify-between">
                <span>Kernel 3D Mesh:</span>
                <span className="text-sky-300 font-semibold">
                  {activeMesh.triangleCount} tris ({activeMesh.vertexCount} verts)
                </span>
              </div>
            );
          })()}

          <div className="text-[10px] text-slate-500">
            Click solid body to select feature. Drag canvas to orbit 3D model. Parameter sliders immediately regenerate 3D meshes via FeatureRebuilder!
          </div>
        </div>
      </div>
    </div>
  );
};
