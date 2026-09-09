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
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react';

export default function App() {
  // 自動監聽並防抖計算草圖封閉面
  useAutoSketchProfilesSync();

  const docTitle = useCadStore((s) => s.document.title);
  const docUnits = useCadStore((s) => s.document.units);
  const planesMap = useCadStore((s) => s.document.planes);
  const featureTree = useCadStore((s) => s.document.featureTree);
  const viewMode = useViewMode();
  const currentTool = useCurrentTool();
  const activeFeatureId = useActiveFeatureId();
  const activeSketch = useActiveSketch();

  const setActiveFeatureId = useCadStore((s) => s.setActiveFeatureId);
  const toggleSuppressFeature = useCadStore((s) => s.toggleSuppressFeature);

  const [activeTab, setActiveTab] = useState<'cad' | 'planes' | 'types'>('cad');
  const [selectedPlaneId, setSelectedPlaneId] = useState<string>('plane_datum_front');
  
  // 控制左側特徵樹收合狀態
  const [showLeftPanel, setShowLeftPanel] = useState<boolean>(true);

  const planesList = Object.values(planesMap);

  return (
    <div className="h-screen w-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none overflow-hidden">
      {/* Top Application Header Bar */}
      <header className="h-14 flex-shrink-0 border-b border-slate-800 bg-slate-950/90 backdrop-blur px-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          {/* 左側面板收合按鈕 */}
          <button 
            onClick={() => setShowLeftPanel(!showLeftPanel)}
            className="p-1.5 hover:bg-slate-800 rounded-md text-slate-400 hover:text-sky-400 transition-colors"
            title="Toggle FeatureManager"
          >
            {showLeftPanel ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
          </button>
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
            </div>
            <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2">
              <span className="text-slate-200 font-semibold">{docTitle}</span>
              <span className="text-slate-600">•</span>
              <span>Unit: {docUnits}</span>
              <span className="text-slate-600">•</span>
              <span>Mode: <strong className="text-sky-300">{viewMode}</strong></span>
            </div>
          </div>
        </div>

        {/* View / Inspector Navigation Tabs */}
        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 p-1 rounded-lg">
          <button
            onClick={() => setActiveTab('cad')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              activeTab === 'cad' ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Layers className="w-3.5 h-3.5" /> CAD Canvas
          </button>
          <button
            onClick={() => setActiveTab('planes')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              activeTab === 'planes' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Compass className="w-3.5 h-3.5" /> CustomPlane
          </button>
          <button
            onClick={() => setActiveTab('types')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              activeTab === 'types' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" /> Types
          </button>
        </div>
      </header>

      {/* Main Content Layout */}
      <div className="flex-1 flex overflow-hidden p-3 gap-3 relative">
        {/* Left Column: FeatureManager Tree (DAG) - 動態收合 */}
        {showLeftPanel && (
          <div className="w-72 flex-shrink-0 h-full flex flex-col gap-2 animate-in slide-in-from-left duration-200">
            <FeatureTreeViewer
              features={featureTree}
              selectedFeatureId={activeFeatureId || ''}
              onSelectFeature={setActiveFeatureId}
              onToggleSuppress={toggleSuppressFeature}
            />
          </div>
        )}

        {/* Right Main Viewport Area - 加上 relative 讓屬性面板浮動 */}
        <div className="flex-1 h-full flex flex-col gap-2 min-w-0 relative">
          {activeTab === 'cad' && (
            <>
              <CADToolbar />
              <div className="flex-1 min-h-0 relative rounded-xl overflow-hidden">
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
                
                {/* 絕對定位的屬性面板，浮動疊加在畫布右上角 */}
                <FeaturePropertyManager />
              </div>
            </>
          )}

          {activeTab === 'planes' && (
            <div className="flex-1 min-h-0">
              <PlaneInspector planes={planesList} selectedPlaneId={selectedPlaneId} onSelectPlane={setSelectedPlaneId} />
            </div>
          )}

          {activeTab === 'types' && (
            <div className="flex-1 min-h-0">
              <TypeReferenceViewer />
            </div>
          )}
        </div>
      </div>

      {/* Footer / Status Bar */}
      <footer className="h-7 flex-shrink-0 border-t border-slate-900 bg-slate-950 px-4 flex items-center justify-between text-[11px] text-slate-500 font-mono">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1 text-slate-400">
            <Cpu className="w-3 h-3 text-sky-400" />
            Wasm & Multi-Thread Worker Ready
          </span>
          <span className="text-slate-600">|</span>
          <span>Active Feature: <span className="text-slate-300">{activeFeatureId || 'None'}</span></span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-emerald-400 font-semibold">Zustand Reactive Architecture</span>
        </div>
      </footer>
    </div>
  );
}