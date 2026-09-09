/**
 * @license
 * CAD Feature PropertyManager (Right-Side Inspector Panel)
 * SolidWorks-style parametric feature editing panel.
 */

import React from 'react';
import {
  useCadStore,
  useEditingFeatureId,
  useCADDocument,
  useViewMode
} from '../contexts/CadContext.tsx';
import {
  ExtrudeFeature,
  CutFeature,
  SketchFeature
} from '../types/cad.ts';
import {
  Sliders, X, Box, Scissors, Pencil, Check, Eye, EyeOff, ArrowRight, Sparkles
} from 'lucide-react';

export const FeaturePropertyManager: React.FC = () => {
  const editingFeatureId = useEditingFeatureId();
  const setEditingFeatureId = useCadStore((s) => s.setEditingFeatureId);
  const updateFeature = useCadStore((s) => s.updateFeature);
  const toggleSuppressFeature = useCadStore((s) => s.toggleSuppressFeature);
  const setViewMode = useCadStore((s) => s.setViewMode);
  const setActiveSketchId = useCadStore((s) => s.setActiveSketchId);
  const document = useCADDocument();
  const viewMode = useViewMode();

  if (!editingFeatureId) return null;

  const feature = document.featureTree.find((f) => f.id === editingFeatureId);
  if (!feature) return null;

  const isSketch = feature.type === 'sketch';
  const isExtrude = feature.type === 'extrude';
  const isCut = feature.type === 'cut';

  const sketchFeat = isSketch ? (feature as SketchFeature) : null;
  const extrudeFeat = isExtrude ? (feature as ExtrudeFeature) : null;
  const cutFeat = isCut ? (feature as CutFeature) : null;

  return (
    <div
      id="feature-property-manager-panel"
      className="absolute top-0 bottom-0 right-0 w-72 z-40 bg-slate-950/95 backdrop-blur-md border-l border-slate-800 flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-right duration-200"
    >
      {/* PropertyManager Header */}
      <div className="px-4 py-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-sky-400" />
          <div>
            <h3 className="font-semibold text-xs text-slate-100 flex items-center gap-1.5">
              <span>PropertyManager</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-sky-950 text-sky-400 border border-sky-800/60">
                {feature.type.toUpperCase()}
              </span>
            </h3>
            <div className="text-[10px] text-slate-400 font-mono">
              Editing: {feature.name}
            </div>
          </div>
        </div>
        <button
          onClick={() => setEditingFeatureId(null)}
          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Feature Content Scrollable Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {/* Feature Identity Card */}
        <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-[11px] font-medium">Feature Name</span>
            <span className="font-mono text-[10px] text-slate-500">ID: {feature.id}</span>
          </div>
          <input
            type="text"
            value={feature.name}
            onChange={(e) => updateFeature(feature.id, { name: e.target.value })}
            className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 font-medium focus:outline-none focus:border-sky-500"
          />

          <div className="flex items-center justify-between pt-1 border-t border-slate-800/80">
            <span className="text-slate-400 text-[11px]">Feature Suppression</span>
            <button
              onClick={() => toggleSuppressFeature(feature.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
                feature.suppressed
                  ? 'bg-rose-950/60 border-rose-800 text-rose-300 hover:bg-rose-900/60'
                  : 'bg-emerald-950/60 border-emerald-800 text-emerald-300 hover:bg-emerald-900/60'
              }`}
            >
              {feature.suppressed ? <><EyeOff className="w-3.5 h-3.5" /> Suppressed</> : <><Eye className="w-3.5 h-3.5" /> Active</>}
            </button>
          </div>
        </div>

        {/* 1. EXTRUDE FEATURE */}
        {extrudeFeat && (
          <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-3 space-y-3.5">
            <div className="flex items-center gap-1.5 text-emerald-400 font-semibold border-b border-slate-800 pb-1.5">
              <Box className="w-4 h-4" /> <span>Extrusion Parameters</span>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-300 font-medium">Depth (深度):</span>
                <span className="font-mono text-emerald-400 font-bold">{extrudeFeat.depth} mm</span>
              </div>
              <input
                type="range" min="5" max="120" step="5" value={extrudeFeat.depth}
                onChange={(e) => updateFeature(extrudeFeat.id, { depth: Number(e.target.value) } as any)}
                className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-800 rounded"
              />
            </div>
          </div>
        )}

        {/* 2. CUT FEATURE */}
        {cutFeat && (
          <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-3 space-y-3.5">
            <div className="flex items-center gap-1.5 text-rose-400 font-semibold border-b border-slate-800 pb-1.5">
              <Scissors className="w-4 h-4" /> <span>Cut Parameters</span>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-300 font-medium">Depth (深度):</span>
                <span className="font-mono text-rose-400 font-bold">{cutFeat.depth} mm</span>
              </div>
              <input
                type="range" min="5" max="60" step="5" value={cutFeat.depth}
                onChange={(e) => updateFeature(cutFeat.id, { depth: Number(e.target.value) } as any)}
                className="w-full accent-rose-500 cursor-pointer h-1.5 bg-slate-800 rounded"
              />
            </div>
          </div>
        )}

        {/* 3. SKETCH FEATURE */}
        {sketchFeat && (
          <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-3 space-y-3">
            <div className="flex items-center gap-1.5 text-sky-400 font-semibold border-b border-slate-800 pb-1.5">
              <Pencil className="w-4 h-4" /> <span>Sketch Info</span>
            </div>
            <div className="space-y-1.5 text-[11px] text-slate-400">
              <div className="flex justify-between"><span>Plane:</span><span className="text-slate-200">{sketchFeat.plane.name}</span></div>
              <div className="flex justify-between"><span>Entities:</span><span className="text-sky-400">{sketchFeat.entities.length}</span></div>
            </div>
            <button
              onClick={() => {
                setActiveSketchId(sketchFeat.id);
                setViewMode('2D');
              }}
              className="w-full mt-2 py-2 px-3 bg-sky-600 hover:bg-sky-500 text-white rounded font-medium flex items-center justify-center gap-2 transition-colors text-xs"
            >
              <Pencil className="w-3.5 h-3.5" /> 編輯 2D 草圖 <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="bg-slate-950/60 border border-slate-800/60 rounded-lg p-2.5 text-[11px] text-slate-400 flex items-start gap-2">
          <Sparkles className="w-4 h-4 text-sky-400 flex-shrink-0 mt-0.5" />
          <span>參數即時連動 Zustand 全局狀態並觸發 Worker 重建。</span>
        </div>
      </div>

      <div className="px-4 py-2.5 bg-slate-900 border-t border-slate-800">
        <button
          onClick={() => setEditingFeatureId(null)}
          className="w-full py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex justify-center items-center gap-1.5"
        >
          <Check className="w-3.5 h-3.5 text-emerald-400" /> Done
        </button>
      </div>
    </div>
  );
};