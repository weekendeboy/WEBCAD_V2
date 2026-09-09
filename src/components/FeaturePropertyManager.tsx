/**
 * @license
 * CAD Feature PropertyManager (Right-Side Inspector Panel)
 * SolidWorks-style parametric feature editing panel.
 *
 * 支援：
 * 1. 擠出特徵 (ExtrudeFeature)：深度 (Depth)、終止條件 (End Condition)、拔模角 (Draft)、布林運算。
 * 2. 除料特徵 (CutFeature)：除料深度 (Depth)、除料方向、終止條件、參考草圖。
 * 3. 草圖特徵 (SketchFeature)：基準面資訊、幾何圖元統計、封閉輪廓面積、一鍵切換至 2D 編輯模式。
 * 4. 參數變更即時透過 Zustand store 的 updateFeature 響應，並觸發 3D 幾何即時重建。
 */

import React from 'react';
import {
  useCadStore,
  useEditingFeatureId,
  useCADDocument,
  useViewMode
} from '../contexts/CadContext.tsx';
import {
  ParametricFeature,
  ExtrudeFeature,
  CutFeature,
  SketchFeature
} from '../types/cad.ts';
import {
  Sliders,
  X,
  Box,
  Scissors,
  Pencil,
  Check,
  Eye,
  EyeOff,
  Layers,
  ArrowRight,
  Maximize2,
  Minimize2,
  Sparkles
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

  if (!editingFeatureId) {
    return null;
  }

  const feature = document.featureTree.find((f) => f.id === editingFeatureId);
  if (!feature) {
    return null;
  }

  const isSketch = feature.type === 'sketch';
  const isExtrude = feature.type === 'extrude';
  const isCut = feature.type === 'cut';

  const sketchFeat = isSketch ? (feature as SketchFeature) : null;
  const extrudeFeat = isExtrude ? (feature as ExtrudeFeature) : null;
  const cutFeat = isCut ? (feature as CutFeature) : null;

  return (
    <div
      id="feature-property-manager-panel"
      className="w-80 flex-shrink-0 h-full bg-slate-900 border border-slate-800 rounded-xl flex flex-col shadow-xl overflow-hidden animate-in slide-in-from-right duration-200"
    >
      {/* PropertyManager Header */}
      <div className="px-4 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
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

        <div className="flex items-center gap-1">
          <button
            id="close-property-manager-btn"
            onClick={() => setEditingFeatureId(null)}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            title="Close PropertyManager"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
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
            id="edit-feature-name-input"
            type="text"
            value={feature.name}
            onChange={(e) => updateFeature(feature.id, { name: e.target.value })}
            className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 font-medium focus:outline-none focus:border-sky-500"
          />

          <div className="flex items-center justify-between pt-1 border-t border-slate-800/80">
            <span className="text-slate-400 text-[11px]">Feature Suppression</span>
            <button
              id="property-toggle-suppress-btn"
              onClick={() => toggleSuppressFeature(feature.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
                feature.suppressed
                  ? 'bg-rose-950/60 border-rose-800 text-rose-300 hover:bg-rose-900/60'
                  : 'bg-emerald-950/60 border-emerald-800 text-emerald-300 hover:bg-emerald-900/60'
              }`}
            >
              {feature.suppressed ? (
                <>
                  <EyeOff className="w-3.5 h-3.5" />
                  Suppressed (已抑制)
                </>
              ) : (
                <>
                  <Eye className="w-3.5 h-3.5" />
                  Unsuppressed (未抑制)
                </>
              )}
            </button>
          </div>
        </div>

        {/* 1. EXTRUDE FEATURE PROPERTIES */}
        {extrudeFeat && (
          <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-3 space-y-3.5">
            <div className="flex items-center gap-1.5 text-emerald-400 font-semibold border-b border-slate-800 pb-1.5">
              <Box className="w-4 h-4" />
              <span>Extrusion Parameters (凸台擠出參數)</span>
            </div>

            {/* Depth Slider & Input */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-300 font-medium">Extrude Depth (深度):</span>
                <span className="font-mono text-emerald-400 font-bold">
                  {extrudeFeat.depth} mm
                </span>
              </div>
              <input
                id="prop-extrude-depth-slider"
                type="range"
                min="5"
                max="120"
                step="5"
                value={extrudeFeat.depth}
                onChange={(e) =>
                  updateFeature(extrudeFeat.id, {
                    depth: Number(e.target.value)
                  } as Partial<ExtrudeFeature>)
                }
                className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-800 rounded"
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                <span>5 mm</span>
                <span>60 mm</span>
                <span>120 mm</span>
              </div>
            </div>

            {/* End Condition */}
            <div className="space-y-1">
              <label className="text-slate-400 text-[11px]">End Condition (終止條件)</label>
              <select
                id="prop-extrude-end-condition"
                value={extrudeFeat.endCondition}
                onChange={(e) =>
                  updateFeature(extrudeFeat.id, {
                    endCondition: e.target.value as any
                  } as Partial<ExtrudeFeature>)
                }
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
              >
                <option value="blind">Blind (給定深度)</option>
                <option value="through_all">Through All (貫穿全部)</option>
                <option value="mid_plane">Mid Plane (兩側對稱)</option>
                <option value="up_to_surface">Up To Surface (成形至下一面)</option>
              </select>
            </div>

            {/* Draft Angle */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Draft Angle (拔模角):</span>
                <span className="font-mono text-slate-200">{extrudeFeat.draftAngle || 0}°</span>
              </div>
              <input
                id="prop-extrude-draft-slider"
                type="range"
                min="0"
                max="25"
                step="1"
                value={extrudeFeat.draftAngle || 0}
                onChange={(e) =>
                  updateFeature(extrudeFeat.id, {
                    draftAngle: Number(e.target.value)
                  } as Partial<ExtrudeFeature>)
                }
                className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-800 rounded"
              />
            </div>

            {/* Boolean Operation */}
            <div className="space-y-1">
              <label className="text-slate-400 text-[11px]">Boolean Operation (布林運算)</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    updateFeature(extrudeFeat.id, {
                      booleanOperation: 'union'
                    } as Partial<ExtrudeFeature>)
                  }
                  className={`py-1.5 px-2 rounded border text-center transition-colors ${
                    extrudeFeat.booleanOperation === 'union'
                      ? 'bg-emerald-950/70 border-emerald-500 text-emerald-300'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  Merge / Union
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateFeature(extrudeFeat.id, {
                      booleanOperation: 'new_body'
                    } as Partial<ExtrudeFeature>)
                  }
                  className={`py-1.5 px-2 rounded border text-center transition-colors ${
                    extrudeFeat.booleanOperation === 'new_body'
                      ? 'bg-emerald-950/70 border-emerald-500 text-emerald-300'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  New Body
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 2. CUT FEATURE PROPERTIES */}
        {cutFeat && (
          <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-3 space-y-3.5">
            <div className="flex items-center gap-1.5 text-rose-400 font-semibold border-b border-slate-800 pb-1.5">
              <Scissors className="w-4 h-4" />
              <span>Cut-Extrude Parameters (除料開孔參數)</span>
            </div>

            {/* Depth Slider & Input */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-300 font-medium">Cut Depth (深度):</span>
                <span className="font-mono text-rose-400 font-bold">
                  {cutFeat.depth} mm
                </span>
              </div>
              <input
                id="prop-cut-depth-slider"
                type="range"
                min="5"
                max="60"
                step="5"
                value={cutFeat.depth}
                onChange={(e) =>
                  updateFeature(cutFeat.id, {
                    depth: Number(e.target.value)
                  } as Partial<CutFeature>)
                }
                className="w-full accent-rose-500 cursor-pointer h-1.5 bg-slate-800 rounded"
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                <span>5 mm</span>
                <span>30 mm</span>
                <span>60 mm</span>
              </div>
            </div>

            {/* End Condition */}
            <div className="space-y-1">
              <label className="text-slate-400 text-[11px]">End Condition (終止條件)</label>
              <select
                id="prop-cut-end-condition"
                value={cutFeat.endCondition}
                onChange={(e) =>
                  updateFeature(cutFeat.id, {
                    endCondition: e.target.value as any
                  } as Partial<CutFeature>)
                }
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-rose-500"
              >
                <option value="blind">Blind (盲孔深度)</option>
                <option value="through_all">Through All (全貫穿)</option>
                <option value="up_to_surface">Up To Surface (貫穿至指定面)</option>
              </select>
            </div>

            {/* Flip Side To Cut */}
            <div className="flex items-center justify-between pt-1">
              <span className="text-slate-400 text-[11px]">Flip Side to Cut (反轉除料側)</span>
              <input
                id="prop-cut-flip-side"
                type="checkbox"
                checked={cutFeat.flipSideToCut || false}
                onChange={(e) =>
                  updateFeature(cutFeat.id, {
                    flipSideToCut: e.target.checked
                  } as Partial<CutFeature>)
                }
                className="w-4 h-4 accent-rose-500 rounded cursor-pointer"
              />
            </div>
          </div>
        )}

        {/* 3. SKETCH FEATURE PROPERTIES */}
        {sketchFeat && (
          <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-3 space-y-3">
            <div className="flex items-center gap-1.5 text-sky-400 font-semibold border-b border-slate-800 pb-1.5">
              <Pencil className="w-4 h-4" />
              <span>Sketch Definition (草圖定義)</span>
            </div>

            <div className="space-y-1.5 text-[11px] text-slate-400">
              <div className="flex justify-between">
                <span>Datum Plane:</span>
                <span className="font-mono text-slate-200 font-semibold">
                  {sketchFeat.plane.name}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Entities Count:</span>
                <span className="font-mono text-sky-400">{sketchFeat.entities.length} items</span>
              </div>
              <div className="flex justify-between">
                <span>Solver State:</span>
                <span className="font-mono text-emerald-400 font-semibold uppercase">
                  {sketchFeat.solverState}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Closed Profiles:</span>
                <span className="font-mono text-amber-400 font-semibold">
                  {sketchFeat.profiles?.length || 0} loops
                </span>
              </div>
              {sketchFeat.profiles && sketchFeat.profiles[0] && (
                <div className="flex justify-between">
                  <span>Profile Area:</span>
                  <span className="font-mono text-amber-300">
                    {sketchFeat.profiles[0].area} mm²
                  </span>
                </div>
              )}
            </div>

            {/* Jump to 2D Sketch Editor Button */}
            <button
              id="switch-to-sketch-editor-btn"
              onClick={() => {
                setActiveSketchId(sketchFeat.id);
                setViewMode('2D');
              }}
              className="w-full mt-2 py-2 px-3 bg-sky-600 hover:bg-sky-500 text-white rounded font-medium flex items-center justify-center gap-2 transition-colors shadow-sm text-xs"
            >
              <Pencil className="w-3.5 h-3.5" />
              進入 2D 草圖編輯模式
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Live Rebuild Feedback info */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded-lg p-2.5 text-[11px] text-slate-400 flex items-start gap-2">
          <Sparkles className="w-4 h-4 text-sky-400 flex-shrink-0 mt-0.5" />
          <span>
            參數即時連動 Zustand 全局狀態。任何變更皆會自動觸發 DAG 拓撲排序並重新計算 3D 實體幾何。
          </span>
        </div>
      </div>

      {/* Footer / Confirm */}
      <div className="px-4 py-2.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
        <button
          id="finish-edit-feature-btn"
          onClick={() => setEditingFeatureId(null)}
          className="w-full py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
        >
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          完成編輯 (Done)
        </button>
      </div>
    </div>
  );
};
