/**
 * @license
 * CAD 3D Parametric Feature Viewport
 * Renders 3D solid geometry generated from 2D sketches and Extrude/Cut features.
 */

import React, { useState } from 'react';
import {
  useCadStore,
  useActiveFeatureId,
  useCADDocument
} from '../contexts/CadContext.tsx';
import { ExtrudeFeature, CutFeature, SketchFeature } from '../types/cad.ts';
import {
  Box,
  Rotate3d,
  Layers,
  Sparkles,
  Sliders,
  Scissors,
  CheckCircle,
  Eye
} from 'lucide-react';

export const CAD3DViewport: React.FC = () => {
  const document = useCADDocument();
  const activeFeatureId = useActiveFeatureId();
  const updateFeature = useCadStore((s) => s.updateFeature);
  const setActiveFeatureId = useCadStore((s) => s.setActiveFeatureId);

  const [rotX, setRotX] = useState(25);
  const [rotY, setRotY] = useState(-35);
  const [zoom, setZoom] = useState(1.0);
  const [displayStyle, setDisplayStyle] = useState<'shaded_edges' | 'wireframe' | 'shaded'>('shaded_edges');

  // Extract Boss-Extrude and Cut-Extrude features from document featureTree
  const extrudeFeature = document.featureTree.find(
    (f) => f.type === 'extrude' && !f.suppressed
  ) as ExtrudeFeature | undefined;

  const cutFeature = document.featureTree.find(
    (f) => f.type === 'cut' && !f.suppressed
  ) as CutFeature | undefined;

  const extrudeDepth = extrudeFeature?.depth ?? 30;
  const cutDepth = cutFeature?.depth ?? 30;
  const isCutActive = activeFeatureId === cutFeature?.id;
  const isExtrudeActive = activeFeatureId === extrudeFeature?.id;

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-xl overflow-hidden border border-slate-800 text-slate-100 shadow-md">
      {/* 3D Viewport Controls Bar */}
      <div className="px-4 py-2.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 font-mono text-slate-300">
            <Rotate3d className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold">3D Parametric Solid Model</span>
            <span className="text-slate-500">|</span>
            <span className="text-emerald-400 font-mono">
              Depth: {extrudeDepth}mm
            </span>
          </div>
        </div>

        {/* Orbit & View Presets */}
        <div className="flex items-center gap-2">
          <button
            id="view-iso-btn"
            onClick={() => {
              setRotX(25);
              setRotY(-35);
            }}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
          >
            Isometric
          </button>
          <button
            id="view-front-btn"
            onClick={() => {
              setRotX(0);
              setRotY(0);
            }}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
          >
            Front
          </button>
          <button
            id="view-top-btn"
            onClick={() => {
              setRotX(90);
              setRotY(0);
            }}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
          >
            Top
          </button>

          <div className="h-4 w-px bg-slate-800 mx-1" />

          {/* Shaded vs Wireframe */}
          <button
            id="toggle-wireframe-btn"
            onClick={() =>
              setDisplayStyle((s) => (s === 'shaded_edges' ? 'wireframe' : 'shaded_edges'))
            }
            className={`px-2.5 py-1 rounded ${
              displayStyle === 'shaded_edges'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            {displayStyle === 'shaded_edges' ? 'Shaded with Edges' : 'Wireframe'}
          </button>
        </div>
      </div>

      {/* 3D Canvas Rendering Area */}
      <div className="relative flex-1 bg-gradient-to-b from-slate-950 to-slate-900 min-h-[380px] overflow-hidden select-none flex items-center justify-center">
        {/* CSS 3D Stage */}
        <div
          className="w-full h-full flex items-center justify-center cursor-grab active:cursor-grabbing"
          style={{ perspective: 1000 }}
          onMouseDown={(e) => {
            const startX = e.clientX;
            const startY = e.clientY;
            const initRotX = rotX;
            const initRotY = rotY;

            const onMouseMove = (moveEvent: MouseEvent) => {
              const deltaX = moveEvent.clientX - startX;
              const deltaY = moveEvent.clientY - startY;
              setRotY(initRotY + deltaX * 0.5);
              setRotX(initRotX - deltaY * 0.5);
            };

            const onMouseUp = () => {
              window.removeEventListener('mousemove', onMouseMove);
              window.removeEventListener('mouseup', onMouseUp);
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
          }}
        >
          <div
            className="relative transition-transform duration-75 ease-out"
            style={{
              width: '260px',
              height: '180px',
              transformStyle: 'preserve-3d',
              transform: `scale(${zoom}) rotateX(${rotX}deg) rotateY(${rotY}deg)`
            }}
          >
            {/* 3D Datum Origin Indicator */}
            <div
              className="absolute -left-12 -bottom-12 font-mono text-[10px] text-slate-500 flex items-center gap-1"
              style={{ transform: 'translateZ(0px)' }}
            >
              <div className="w-2 h-2 rounded-full bg-amber-400" />
              <span>(0,0,0) Origin</span>
            </div>

            {/* Front Solid Face of Extruded Plate */}
            <div
              onClick={() => extrudeFeature && setActiveFeatureId(extrudeFeature.id)}
              className={`absolute inset-0 rounded-tr-3xl transition-colors cursor-pointer border-2 ${
                isExtrudeActive
                  ? 'bg-sky-600/90 border-sky-300 shadow-xl'
                  : displayStyle === 'wireframe'
                  ? 'bg-transparent border-sky-400'
                  : 'bg-gradient-to-tr from-sky-700 to-indigo-700 border-sky-400/80'
              }`}
              style={{
                transform: `translateZ(${extrudeDepth * 2}px)`
              }}
            >
              {/* Hole Feature (Bore cut through) */}
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  if (cutFeature) setActiveFeatureId(cutFeature.id);
                }}
                className={`absolute w-14 h-14 rounded-full border-2 transition-all flex items-center justify-center ${
                  isCutActive
                    ? 'bg-rose-950/80 border-rose-400 shadow-lg'
                    : 'bg-slate-950 border-rose-500/70'
                }`}
                style={{
                  left: '35%',
                  top: '30%',
                  boxShadow: 'inset 0 0 12px rgba(0,0,0,0.8)'
                }}
              >
                <span className="text-[10px] font-mono text-rose-300">Ø25</span>
              </div>

              {/* Parametric Dimension annotation on 3D face */}
              <div className="absolute bottom-2 left-4 text-[10px] font-mono text-white/90 bg-black/40 px-1.5 py-0.5 rounded">
                100 × 80 mm
              </div>
            </div>

            {/* Back Solid Face */}
            <div
              className={`absolute inset-0 rounded-tr-3xl border-2 ${
                displayStyle === 'wireframe'
                  ? 'bg-transparent border-slate-700'
                  : 'bg-slate-800/80 border-slate-700'
              }`}
              style={{
                transform: 'translateZ(0px)'
              }}
            />

            {/* Top Extruded Flange */}
            <div
              className="absolute left-0 top-0 w-full bg-sky-800/90 border border-sky-500/60"
              style={{
                height: `${extrudeDepth * 2}px`,
                transformOrigin: 'top center',
                transform: 'rotateX(-90deg)'
              }}
            />

            {/* Bottom Extruded Base */}
            <div
              className="absolute left-0 bottom-0 w-full bg-sky-900/90 border border-sky-500/60"
              style={{
                height: `${extrudeDepth * 2}px`,
                transformOrigin: 'bottom center',
                transform: 'rotateX(90deg)'
              }}
            />

            {/* Left Extruded Side Wall */}
            <div
              className="absolute left-0 top-0 h-full bg-indigo-800/90 border border-indigo-500/60"
              style={{
                width: `${extrudeDepth * 2}px`,
                transformOrigin: 'left center',
                transform: 'rotateY(90deg)'
              }}
            />

            {/* Right Extruded Side Wall */}
            <div
              className="absolute right-0 top-0 h-full bg-indigo-900/90 border border-indigo-500/60"
              style={{
                width: `${extrudeDepth * 2}px`,
                transformOrigin: 'right center',
                transform: 'rotateY(-90deg)'
              }}
            />

            {/* 3D Bore Depth Cylinder Visualization */}
            {cutFeature && (
              <div
                className="absolute w-14 rounded-full border border-rose-400/80 bg-rose-950/40"
                style={{
                  left: '35%',
                  top: '30%',
                  height: '56px',
                  transform: `translateZ(${extrudeDepth}px) rotateY(15deg)`
                }}
              />
            )}
          </div>
        </div>

        {/* 3D Parametric Feature Quick Property Inspector */}
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

          {extrudeFeature && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-300">
                <span>Extrusion Depth (mm):</span>
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
                  } as any);
                }}
                className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-800 rounded"
              />
            </div>
          )}

          {cutFeature && (
            <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
              <div className="flex items-center justify-between text-[11px] text-slate-300">
                <span className="text-rose-300 flex items-center gap-1">
                  <Scissors className="w-3 h-3" /> Cut Depth:
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
                  } as any);
                }}
                className="w-full accent-rose-500 cursor-pointer h-1.5 bg-slate-800 rounded"
              />
            </div>
          )}

          <div className="text-[10px] text-slate-500">
            Drag canvas to orbit 3D model. Parameter sliders immediately update CAD state and push undo history!
          </div>
        </div>
      </div>
    </div>
  );
};
