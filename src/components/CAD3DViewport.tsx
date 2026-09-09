/**
 * @license
 * CAD 3D Parametric Feature Viewport (Three.js / React Three Fiber)
 */

import React, { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import {
  useCadStore, useActiveFeatureId, useCADDocument, useCurrentTool, useActiveSketch, useCadActions, useViewMode
} from '../contexts/CadContext.tsx';
import {
  SolidMesh3D, CustomPlane, CADEntity2D, Point3D
} from '../types/cad.ts';
import { useModelRebuilder } from '../core/features/FeatureRebuilder.ts';
import {
  createCustomPlaneFromFace, createLocalCoordinateSystem, calculateFaceCentroid, computeSlopeAngle
} from '../core/math/SketchOnFaceMath.ts';
import { SketchOnFaceOverlay } from './SketchOnFaceOverlay.tsx';
import {
  Rotate3d, Cpu, Target, Compass, Pencil, Binary, Gauge, Play, Pause, CheckCircle2
} from 'lucide-react';

// ============================================================================
// 1. High-Precision 60 FPS Monitor Component
// ============================================================================
const FpsTracker: React.FC<{ onFpsUpdate: (fps: number) => void }> = ({ onFpsUpdate }) => {
  const frameDeltas = useRef<number[]>([]);
  const lastReport = useRef<number>(performance.now());

  useFrame((_, delta) => {
    frameDeltas.current.push(delta);
    if (frameDeltas.current.length > 30) frameDeltas.current.shift();

    const now = performance.now();
    if (now - lastReport.current > 200) {
      const avgDelta = frameDeltas.current.reduce((a, b) => a + b, 0) / (frameDeltas.current.length || 1);
      const measuredFps = Math.min(60, Math.round((1 / (avgDelta || 0.0166)) * 10) / 10);
      onFpsUpdate(measuredFps);
      lastReport.current = now;
    }
  });
  return null;
};

// ============================================================================
// 2. Camera View Controller Component
// ============================================================================
const CameraController: React.FC<{ viewPreset: string | null; normalToPlane: CustomPlane | null; target: [number, number, number]; onPresetApplied: () => void }> = ({ viewPreset, normalToPlane, target, onPresetApplied }) => {
  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null);

  useEffect(() => {
    if (!viewPreset) return;
    if (viewPreset === 'iso') { camera.position.set(160, 140, 170); camera.up.set(0, 1, 0); }
    else if (viewPreset === 'front') { camera.position.set(target[0], target[1], 240); camera.up.set(0, 1, 0); }
    else if (viewPreset === 'top') { camera.position.set(target[0], 250, target[2]); camera.up.set(0, 0, -1); }
    else if (viewPreset === 'right') { camera.position.set(250, target[1], target[2]); camera.up.set(0, 1, 0); }
    camera.lookAt(target[0], target[1], target[2]);
    if (controlsRef.current) { controlsRef.current.target.set(target[0], target[1], target[2]); controlsRef.current.update(); }
    onPresetApplied();
  }, [viewPreset, camera, target, onPresetApplied]);

  useEffect(() => {
    if (!normalToPlane) return;
    const lcs = createLocalCoordinateSystem(normalToPlane.origin, normalToPlane.normal, normalToPlane.xAxis);
    const dist = 180;
    camera.position.set(lcs.origin.x + lcs.normal.x * dist, lcs.origin.y + lcs.normal.y * dist, lcs.origin.z + lcs.normal.z * dist);
    camera.up.set(lcs.yAxis.x, lcs.yAxis.y, lcs.yAxis.z);
    camera.lookAt(lcs.origin.x, lcs.origin.y, lcs.origin.z);
    if (controlsRef.current) { controlsRef.current.target.set(lcs.origin.x, lcs.origin.y, lcs.origin.z); controlsRef.current.update(); }
    onPresetApplied();
  }, [normalToPlane, camera, onPresetApplied]);

  return <OrbitControls ref={controlsRef} makeDefault target={target} enableDamping dampingFactor={0.08} minDistance={10} maxDistance={900} />;
};

// ============================================================================
// 3. CAD Solid Mesh Item Component
// ============================================================================
const CADMeshItem: React.FC<{ mesh: SolidMesh3D; isActive: boolean; displayStyle: string; sketchOnFaceMode: boolean; onSelect: (id: string) => void; onFaceHover: (info: any) => void; onFaceClick: (info: any) => void }> = ({ mesh, isActive, displayStyle, sketchOnFaceMode, onSelect, onFaceHover, onFaceClick }) => {
  const [hovered, setHovered] = useState(false);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
    if (mesh.normals && mesh.normals.length > 0) geo.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3));
    else geo.computeVertexNormals();
    if (mesh.indices && mesh.indices.length > 0) {
      geo.setIndex(Array.isArray(mesh.indices) ? mesh.indices : new THREE.BufferAttribute(mesh.indices, 1));
    }
    return geo;
  }, [mesh.positions, mesh.normals, mesh.indices]);

  const edgeGeometry = useMemo(() => {
    if (!mesh.edges || mesh.edges.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.edges, 3));
    return geo;
  }, [mesh.edges]);

  const isCut = mesh.isCut;
  const materialColor = isCut ? (isActive ? '#fb7185' : '#e11d48') : (isActive ? '#38bdf8' : hovered ? '#0284c7' : '#0369a1');

  return (
    <group
      onClick={(e) => {
        e.stopPropagation();
        if (sketchOnFaceMode && e.face) {
          const worldNormal = e.face.normal.clone().transformDirection(e.object.matrixWorld).normalize();
          const normal3D = { x: worldNormal.x, y: worldNormal.y, z: worldNormal.z };
          const point3D = { x: e.point.x, y: e.point.y, z: e.point.z };
          onFaceClick({ point: point3D, normal: normal3D, slope: computeSlopeAngle(normal3D), centroid: calculateFaceCentroid(mesh.positions, mesh.indices, normal3D, point3D), parentFeatureId: mesh.featureId });
        } else {
          onSelect(mesh.featureId);
        }
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
        setHovered(true);
        if (sketchOnFaceMode && e.face) {
          const worldNormal = e.face.normal.clone().transformDirection(e.object.matrixWorld).normalize();
          const normal3D = { x: worldNormal.x, y: worldNormal.y, z: worldNormal.z };
          const point3D = { x: e.point.x, y: e.point.y, z: e.point.z };
          onFaceHover({ point: point3D, normal: normal3D, slope: computeSlopeAngle(normal3D), centroid: calculateFaceCentroid(mesh.positions, mesh.indices, normal3D, point3D), parentFeatureId: mesh.featureId });
        }
      }}
      onPointerOut={() => { setHovered(false); onFaceHover(null); }}
    >
      <mesh geometry={geometry}>
        <meshStandardMaterial
          color={materialColor} metalness={isCut ? 0.2 : 0.48} roughness={isCut ? 0.35 : 0.26}
          wireframe={displayStyle === 'wireframe'} transparent={isCut} opacity={isCut ? 0.62 : 1.0}
          depthWrite={!isCut} polygonOffset={displayStyle === 'shaded_edges'} polygonOffsetFactor={1} polygonOffsetUnits={1} side={THREE.DoubleSide}
        />
      </mesh>
      {displayStyle === 'shaded_edges' && edgeGeometry && (
        <lineSegments geometry={edgeGeometry}>
          <lineBasicMaterial color={isActive ? '#38bdf8' : '#090d16'} linewidth={isActive ? 2 : 1} />
        </lineSegments>
      )}
    </group>
  );
};

// ============================================================================
// 4. Main CAD3DViewport Component
// ============================================================================
export const CAD3DViewport: React.FC = () => {
  const activeFeatureId = useActiveFeatureId();
  const setActiveFeatureId = useCadStore((s) => s.setActiveFeatureId);
  const { createSketchOnFace, addEntity, setViewMode } = useCadActions();
  const activeSketch = useActiveSketch();
  const currentTool = useCurrentTool();

  const { meshes, isRebuilding } = useModelRebuilder(20);

  const [viewPreset, setViewPreset] = useState<'iso' | 'front' | 'top' | 'right' | null>('iso');
  const [displayStyle, setDisplayStyle] = useState<'shaded_edges' | 'wireframe' | 'shaded'>('shaded_edges');

  const [sketchOnFaceMode, setSketchOnFaceMode] = useState<boolean>(true);
  const [hoveredFaceInfo, setHoveredFaceInfo] = useState<any | null>(null);
  const [normalToPlane, setNormalToPlane] = useState<CustomPlane | null>(null);
  const [showMatrixInspector, setShowMatrixInspector] = useState<boolean>(false);
  const [notificationMessage, setNotificationMessage] = useState<{ text: string; subtext?: string } | null>(null);

  const [fps, setFps] = useState<number>(60.0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isStressTesting, setIsStressTesting] = useState<boolean>(false);

  const handleFaceClick = useCallback((info: any) => {
    const slopeLabel = info.slope === 0 ? 'Horizontal (0°)' : info.slope === 90 ? 'Vertical (90°)' : `Inclined ${info.slope}°`;
    const customPlane = createCustomPlaneFromFace(info.centroid, info.normal, `Plane (${slopeLabel})`);
    if (info.parentFeatureId) customPlane.parentFeatureId = info.parentFeatureId;
    createSketchOnFace(customPlane, `Sketch on Face (${slopeLabel})`);
    setNormalToPlane(customPlane);
    setNotificationMessage({ text: `Created Sketch on ${slopeLabel}`, subtext: `Normal [${info.normal.x.toFixed(2)}, ${info.normal.y.toFixed(2)}, ${info.normal.z.toFixed(2)}]` });
    setTimeout(() => setNotificationMessage(null), 4500);
  }, [createSketchOnFace]);

  const modelCenter: [number, number, number] = useMemo(() => {
    if (meshes.length === 0) return [50, 40, 15];
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const m of meshes) {
      minX = Math.min(minX, m.boundingBox.min.x); minY = Math.min(minY, m.boundingBox.min.y); minZ = Math.min(minZ, m.boundingBox.min.z);
      maxX = Math.max(maxX, m.boundingBox.max.x); maxY = Math.max(maxY, m.boundingBox.max.y); maxZ = Math.max(maxZ, m.boundingBox.max.z);
    }
    return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  }, [meshes]);

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-xl overflow-hidden border border-slate-800 text-slate-100 shadow-md relative">
      {/* 3D Viewport Controls Bar */}
      <div className="px-4 py-2 bg-slate-950 border-b border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs">
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-1.5 font-mono text-slate-300">
            <Rotate3d className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold">3D CAD Viewport</span>
          </div>

          <div className="h-4 w-px bg-slate-800 mx-0.5" />

          {/* SolidWorks Sketch on Face Mode Toggle */}
          <button
            onClick={() => setSketchOnFaceMode((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              sketchOnFaceMode ? 'bg-sky-600 text-white shadow-sm ring-1 ring-sky-400/50' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
            }`}
          >
            <Target className={`w-3.5 h-3.5 ${sketchOnFaceMode ? 'text-sky-200' : 'text-slate-400'}`} />
            <span>Sketch on Face</span>
          </button>

          {activeSketch?.plane && (
            <button
              onClick={() => setNormalToPlane({ ...activeSketch.plane })}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-900/60 hover:bg-indigo-800/80 text-indigo-200 border border-indigo-700/60 font-mono transition-colors"
            >
              <Compass className="w-3.5 h-3.5 text-indigo-400" /> <span>Normal To</span>
            </button>
          )}
          
          <div id="fps-counter-badge" className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-950/70 border border-emerald-800/80 text-[11px] font-mono shadow-sm">
            <Gauge className="w-3 h-3 text-emerald-400" />
            <span className="text-emerald-300 font-bold">{fps.toFixed(1)} FPS</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button onClick={() => setViewPreset('iso')} className={`px-2 py-1 rounded transition-colors ${viewPreset === 'iso' ? 'bg-indigo-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-400'}`}>Iso</button>
          <button onClick={() => setViewPreset('front')} className={`px-2 py-1 rounded transition-colors ${viewPreset === 'front' ? 'bg-indigo-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-400'}`}>Front</button>
          <button onClick={() => setViewPreset('top')} className={`px-2 py-1 rounded transition-colors ${viewPreset === 'top' ? 'bg-indigo-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-400'}`}>Top</button>
          
          <div className="h-4 w-px bg-slate-800 mx-0.5" />
          <button onClick={() => setDisplayStyle((s) => (s === 'shaded_edges' ? 'wireframe' : s === 'wireframe' ? 'shaded' : 'shaded_edges'))} className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs">
            {displayStyle === 'shaded_edges' ? 'Shaded + Edges' : displayStyle === 'wireframe' ? 'Wireframe' : 'Shaded'}
          </button>
        </div>
      </div>

      {/* 3D WebGL Canvas Area - 乾淨無遮蔽的空間 */}
      <div
        className="relative flex-1 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 min-h-0 overflow-hidden select-none"
        onPointerDown={() => setIsDragging(true)}
        onPointerUp={() => setIsDragging(false)}
        onPointerLeave={() => setIsDragging(false)}
      >
        <Canvas camera={{ position: [160, 140, 170], fov: 45, near: 1, far: 2000 }} className="w-full h-full cursor-grab active:cursor-grabbing" gl={{ antialias: true, alpha: true }}>
          <FpsTracker onFpsUpdate={setFps} />
          <ambientLight intensity={0.85} />
          <directionalLight position={[180, 240, 180]} intensity={1.4} castShadow />
          <directionalLight position={[-160, 140, -140]} intensity={0.75} />
          
          <gridHelper args={[360, 36, '#475569', '#1e293b']} position={[50, 0, 15]} />
          <axesHelper args={[40]} position={[0, 0, 0]} />

          {meshes.map((mesh) => (
            <CADMeshItem key={mesh.id} mesh={mesh} isActive={activeFeatureId === mesh.featureId} displayStyle={displayStyle} sketchOnFaceMode={sketchOnFaceMode} onSelect={setActiveFeatureId} onFaceHover={setHoveredFaceInfo} onFaceClick={handleFaceClick} />
          ))}

          <SketchOnFaceOverlay activeSketch={activeSketch} currentTool={currentTool} hoveredFaceInfo={hoveredFaceInfo} onPlaneDrawnEntity={(ent) => { if (activeSketch?.id) addEntity(activeSketch.id, ent); }} />
          <CameraController viewPreset={viewPreset} normalToPlane={normalToPlane} target={modelCenter} onPresetApplied={() => { setViewPreset(null); setNormalToPlane(null); }} />
        </Canvas>

        {/* 3D Origin Indicator Overlay */}
        <div className="absolute top-3 left-3 bg-slate-950/80 backdrop-blur border border-slate-800/80 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-slate-400 flex items-center gap-2 shadow-lg pointer-events-none">
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-500" /><span>X</span><span className="w-2 h-2 rounded-full bg-emerald-500 ml-1" /><span>Y</span><span className="w-2 h-2 rounded-full bg-sky-500 ml-1" /><span>Z</span></div>
          <span className="text-slate-600">|</span><span className="text-slate-300">R3F Canvas</span>
        </div>

        {/* 🎯 Real-time Raycaster Face Hover HUD */}
        {hoveredFaceInfo && sketchOnFaceMode && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-slate-950/95 backdrop-blur-md border border-sky-500/60 rounded-xl px-4 py-2 text-xs shadow-2xl flex items-center gap-3 text-slate-200 pointer-events-none animate-fadeIn">
            <div className="p-1.5 rounded-lg bg-sky-500/20 text-sky-400"><Target className="w-4 h-4 animate-spin-slow" /></div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sky-300">Face Detected ({hoveredFaceInfo.slope.toFixed(1)}°)</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800">Click to Sketch</span>
              </div>
            </div>
          </div>
        )}

        {/* Creation Toast Notification */}
        {notificationMessage && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 bg-emerald-950/95 backdrop-blur border border-emerald-500 rounded-xl px-4 py-2.5 shadow-2xl text-xs text-emerald-100 flex items-center gap-2.5 animate-fadeIn z-20">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="font-semibold text-emerald-300">{notificationMessage.text}</div>
          </div>
        )}
      </div>
    </div>
  );
};