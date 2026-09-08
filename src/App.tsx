/**
 * @license
 * CAD Architecture Workbench (AutoCAD 2D + SolidWorks 3D Parametric)
 */

import React, { useState } from 'react';
import {
  sampleCADDocument,
  datumFrontPlane,
  datumTopPlane,
  customAngledPlane,
  sketchFeature1
} from './core/sampleCadModel.ts';
import {
  CADSketchCanvas,
  FeatureTreeViewer,
  PlaneInspector,
  TypeReferenceViewer
} from './components/index.ts';
import { ParametricFeature } from './types/cad.ts';
import {
  Layers,
  Box,
  Compass,
  Code2,
  Cpu,
  Sparkles,
  FileCode,
  HardDrive
} from 'lucide-react';

export default function App() {
  const [doc, setDoc] = useState(sampleCADDocument);
  const [activeTab, setActiveTab] = useState<'sketch' | 'planes' | 'types'>('sketch');
  const [selectedFeatureId, setSelectedFeatureId] = useState<string>('feat_sketch_1');
  const [selectedPlaneId, setSelectedPlaneId] = useState<string>(datumFrontPlane.id);

  const handleToggleSuppress = (featureId: string) => {
    setDoc((prev) => ({
      ...prev,
      featureTree: prev.featureTree.map((feat) =>
        feat.id === featureId
          ? ({ ...feat, suppressed: !feat.suppressed } as ParametricFeature)
          : feat
      )
    }));
  };

  const planesList = [datumFrontPlane, datumTopPlane, customAngledPlane];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none">
      {/* Top Application Bar */}
      <header className="h-14 border-b border-slate-800 bg-slate-950/80 backdrop-blur px-4 flex items-center justify-between z-10">
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
            </div>
            <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2">
              <span>{doc.title}</span>
              <span className="text-slate-600">•</span>
              <span>Unit: {doc.units}</span>
              <span className="text-slate-600">•</span>
              <span className="text-emerald-400">TypeScript 5.8+</span>
            </div>
          </div>
        </div>

        {/* View Mode Switcher */}
        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 p-1 rounded-lg">
          <button
            id="tab-sketch-btn"
            onClick={() => setActiveTab('sketch')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              activeTab === 'sketch'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            2D Sketch & Drafting
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
        <div className="w-80 flex-shrink-0 h-full">
          <FeatureTreeViewer
            features={doc.featureTree}
            selectedFeatureId={selectedFeatureId}
            onSelectFeature={setSelectedFeatureId}
            onToggleSuppress={handleToggleSuppress}
          />
        </div>

        {/* Right Main Viewport Area */}
        <div className="flex-1 h-full flex flex-col">
          {activeTab === 'sketch' && (
            <CADSketchCanvas
              entities={sketchFeature1.entities}
              constraints={sketchFeature1.constraints}
              dimensions={sketchFeature1.dimensions}
              planeName={sketchFeature1.plane.name}
              solverState={sketchFeature1.solverState}
            />
          )}

          {activeTab === 'planes' && (
            <PlaneInspector
              planes={planesList}
              selectedPlaneId={selectedPlaneId}
              onSelectPlane={setSelectedPlaneId}
            />
          )}

          {activeTab === 'types' && <TypeReferenceViewer />}
        </div>
      </div>

      {/* Footer / Status Bar */}
      <footer className="h-7 border-t border-slate-900 bg-slate-950 px-4 flex items-center justify-between text-[11px] text-slate-500 font-mono">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1 text-slate-400">
            <Cpu className="w-3 h-3 text-sky-400" />
            Wasm & Multi-Thread Worker Ready
          </span>
          <span className="text-slate-600">|</span>
          <span>Active Feature: {selectedFeatureId}</span>
        </div>
        <div className="flex items-center gap-3">
          <span>COOP / COEP Enabled</span>
          <span className="text-slate-600">•</span>
          <span className="text-emerald-400">src/types/cad.ts</span>
        </div>
      </footer>
    </div>
  );
}
