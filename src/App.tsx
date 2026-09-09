/**
 * @license
 * CAD Architecture Workbench (AutoCAD 2D + SolidWorks 3D Parametric)
 * Powered by Zustand Global Store for high-performance selective re-rendering.
 */

import React, { useState } from 'react';
import {
  useCadStore,
  useViewMode,
  useCurrentTool,
  useActiveFeatureId,
  useActiveSketch
} from './contexts/index.ts';
import { useAutoSketchProfilesSync } from './core/2d/TopologyEngine.ts';
import {
  CADSketchCanvas,
  CADToolbar,
  CAD3DViewport,
  FeatureTreeViewer,
  FeaturePropertyManager,
  PlaneInspector,
  TypeReferenceViewer
} from './components/index.ts';
import {
  Layers,
  Box,
  Compass,
  Code2,
  Cpu,
  Sparkles,
  MousePointer,
  Rotate3d
} from 'lucide-react';

export default function App() {
  // 自動監聽並防抖計算草圖封閉面 profiles，同步至 Zustand store 與 3D 特徵樹
  useAutoSketchProfilesSync();

  // Fine-grained Zustand atomic selectors (only updates when specific slice changes)
  const docTitle = useCadStore((s) => s.document.title);
  const docUnits = useCadStore((s) => s.document.units);
  const planesMap = useCadStore((s) => s.document.planes);
  const featureTree = useCadStore((s) => s.document.featureTree);
  const viewMode = useViewMode();
  const currentTool = useCurrentTool();
  const activeFeatureId = useActiveFeatureId();
  const activeSketch = useActiveSketch();

  // Stable actions from Zustand store
  const setActiveFeatureId = useCadStore((s) => s.setActiveFeatureId);
  const toggleSuppressFeature = useCadStore((s) => s.toggleSuppressFeature);

  // Local navigation tab for non-document auxiliary panels
  const [activeTab, setActiveTab] = useState<'cad' | 'planes' | 'types'>('cad');
  const [selectedPlaneId, setSelectedPlaneId] = useState<string>('plane_datum_front');

  const planesList = Object.values(planesMap);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none">
      {/* Top Application Header Bar */}
      <header className="h-14 border-b border-slate-800 bg-slate-950/90 backdrop-blur px-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center shadow-sm">
            <Box className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-slate-100 tracking-tight">
                Parametric CAD Core
              </h1>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-950 text-sky-400 border border-sky-800/80 font-mono">
                AutoCAD 2D + SolidWorks 3D
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/80 font-mono">
                Zustand Store Active
              </span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2">
              <span className="text-slate-200 font-semibold">{docTitle}</span>
              <span className="text-slate-600">•</span>
              <span>Unit: {docUnits}</span>
              <span className="text-slate-600">•</span>
              <span>Mode: <strong className="text-sky-300">{viewMode}</strong></span>
              <span className="text-slate-600">•</span>
              <span>Tool: <strong className="text-indigo-300">{currentTool}</strong></span>
            </div>
          </div>
        </div>

        {/* View / Inspector Navigation Tabs */}
        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 p-1 rounded-lg">
          <button
            id="tab-cad-btn"
            onClick={() => setActiveTab('cad')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              activeTab === 'cad'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            CAD Canvas ({viewMode})
          </button>
          <button
            id="tab-planes-btn"
            onClick={() => setActiveTab('planes')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              activeTab === 'planes'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            CustomPlane (4 Vectors)
          </button>
          <button
            id="tab-types-btn"
            onClick={() => setActiveTab('types')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              activeTab === 'types'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            Types Definition
          </button>
        </div>
      </header>

      {/* Main Content Layout */}
      <div className="flex-1 flex overflow-hidden p-3 gap-3">
        {/* Left Column: FeatureManager Tree (DAG) */}
        <div className="w-80 flex-shrink-0 h-full flex flex-col gap-2">
          <FeatureTreeViewer
            features={featureTree}
            selectedFeatureId={activeFeatureId || ''}
            onSelectFeature={setActiveFeatureId}
            onToggleSuppress={toggleSuppressFeature}
          />
        </div>

        {/* Right Main Viewport Area */}
        <div className="flex-1 h-full flex flex-col gap-2 min-w-0">
          {activeTab === 'cad' && (
            <>
              {/* CAD Action & Tool Bar (Zustand-powered) */}
              <CADToolbar />

              {/* Viewport switching based on viewMode ('2D' vs '3D') */}
              <div className="flex-1 min-h-0">
                {viewMode === '2D' ? (
                  <CADSketchCanvas
                    entities={activeSketch?.entities || []}
                    constraints={activeSketch?.constraints || []}
                    dimensions={activeSketch?.dimensions || []}
                    planeName={activeSketch?.plane.name || 'Front Plane'}
                    solverState={activeSketch?.solverState || 'fully_constrained'}
                    sketchId={activeSketch?.id}
                  />
                ) : (
                  <CAD3DViewport />
                )}
              </div>
            </>
          )}

          {activeTab === 'planes' && (
            <div className="flex-1 min-h-0">
              <PlaneInspector
                planes={planesList}
                selectedPlaneId={selectedPlaneId}
                onSelectPlane={setSelectedPlaneId}
              />
            </div>
          )}

          {activeTab === 'types' && (
            <div className="flex-1 min-h-0">
              <TypeReferenceViewer />
            </div>
          )}
        </div>

        {/* Right Column: Feature PropertyManager Panel (展开参数修改) */}
        <FeaturePropertyManager />
      </div>

      {/* Footer / Status Bar */}
      <footer className="h-7 border-t border-slate-900 bg-slate-950 px-4 flex items-center justify-between text-[11px] text-slate-500 font-mono">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1 text-slate-400">
            <Cpu className="w-3 h-3 text-sky-400" />
            Wasm & Multi-Thread Worker Ready
          </span>
          <span className="text-slate-600">|</span>
          <span>Active Feature: <span className="text-slate-300">{activeFeatureId || 'None'}</span></span>
          <span className="text-slate-600">|</span>
          <span>Tool: <span className="text-indigo-400">{currentTool}</span></span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-emerald-400 font-semibold">Zustand Reactive Architecture</span>
          <span className="text-slate-600">•</span>
          <span>COOP / COEP Enabled</span>
          <span className="text-slate-600">•</span>
          <span className="text-slate-400">src/contexts/CadContext.tsx</span>
        </div>
      </footer>
    </div>
  );
}

