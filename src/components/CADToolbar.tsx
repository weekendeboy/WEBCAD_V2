/**
 * @license
 * CAD Workbench Main Action & Tool Bar
 * Employs Zustand atomic selectors to avoid superfluous re-renders across views.
 */

import React, { useEffect } from 'react';
import {
  useCadStore,
  useCurrentTool,
  useViewMode,
  useHistoryStatus,
  useActiveSketchId,
  useActiveFeatureId
} from '../contexts/CadContext.tsx';
import { CADTool, LineEntity, CircleEntity } from '../types/cad.ts';
import {
  MousePointer,
  Slash,
  Circle,
  Square,
  Compass,
  Ruler,
  Hand,
  Undo2,
  Redo2,
  Plus,
  Box,
  Layers,
  Sparkles,
  RefreshCw
} from 'lucide-react';

export const CADToolbar: React.FC = () => {
  // Fine-grained Zustand atomic selectors
  const currentTool = useCurrentTool();
  const viewMode = useViewMode();
  const activeSketchId = useActiveSketchId();
  const activeFeatureId = useActiveFeatureId();
  const { canUndo, canRedo, undoCount, redoCount } = useHistoryStatus();

  // Stable actions from the store
  const { setTool, setViewMode, undo, redo, addEntity, updateFeature, createExtrudeFeature, createCutFeature } = useCadStore.getState();

  // Keyboard shortcut listener: Ctrl+Z / Cmd+Z for undo, Ctrl+Y / Cmd+Shift+Z for redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  // Handler to add an arbitrary entity to active sketch (demonstrates addEntity action)
  const handleQuickAddLine = () => {
    if (!activeSketchId) return;
    const randomOffset = Math.floor(Math.random() * 30);
    const newLine: LineEntity = {
      id: `ent_line_user_${Date.now()}`,
      type: 'line',
      layer: 'layer_outline',
      color: '#38bdf8',
      state: 'under_constrained',
      isConstruction: false,
      start: { x: 10 + randomOffset, y: 15 + randomOffset },
      end: { x: 70 + randomOffset, y: 55 + randomOffset }
    };
    addEntity(activeSketchId, newLine);
  };

  const handleQuickAddCircle = () => {
    if (!activeSketchId) return;
    const randomOffset = Math.floor(Math.random() * 25);
    const newCircle: CircleEntity = {
      id: `ent_circle_user_${Date.now()}`,
      type: 'circle',
      layer: 'layer_outline',
      color: '#f59e0b',
      state: 'under_constrained',
      isConstruction: false,
      center: { x: 30 + randomOffset, y: 50 + randomOffset },
      radius: 12
    };
    addEntity(activeSketchId, newCircle);
  };

  const handleAdjustDepth = (delta: number) => {
    if (!activeFeatureId) return;
    // Check if active feature is extrude or cut
    const doc = useCadStore.getState().document;
    const feat = doc.featureTree.find((f) => f.id === activeFeatureId);
    if (feat && (feat.type === 'extrude' || feat.type === 'cut')) {
      const currentDepth = (feat as any).depth || 30;
      updateFeature(activeFeatureId, {
        depth: Math.max(5, currentDepth + delta)
      } as any);
    }
  };

  const tools: { id: CADTool; label: string; icon: React.ReactNode }[] = [
    { id: 'SELECT', label: 'Select (Esc)', icon: <MousePointer className="w-3.5 h-3.5" /> },
    { id: 'LINE', label: 'Line (L)', icon: <Slash className="w-3.5 h-3.5" /> },
    { id: 'CIRCLE', label: 'Circle (C)', icon: <Circle className="w-3.5 h-3.5" /> },
    { id: 'RECTANGLE', label: 'Rectangle (R)', icon: <Square className="w-3.5 h-3.5" /> },
    { id: 'ARC', label: 'Arc (A)', icon: <Compass className="w-3.5 h-3.5" /> },
    { id: 'DIMENSION', label: 'Smart Dimension (D)', icon: <Ruler className="w-3.5 h-3.5" /> },
    { id: 'PAN', label: 'Pan (Space)', icon: <Hand className="w-3.5 h-3.5" /> }
  ];

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 flex items-center justify-between flex-wrap gap-2 text-xs shadow-md">
      {/* 2D / 3D View Mode Toggle */}
      <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 p-0.5 rounded-lg">
        <button
          id="toggle-view-2d"
          onClick={() => setViewMode('2D')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all ${
            viewMode === '2D'
              ? 'bg-sky-600 text-white shadow'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          2D Sketch
        </button>
        <button
          id="toggle-view-3d"
          onClick={() => setViewMode('3D')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all ${
            viewMode === '3D'
              ? 'bg-emerald-600 text-white shadow'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          <Box className="w-3.5 h-3.5" />
          3D Feature
        </button>
      </div>

      {/* CAD Drafting Tool Palette */}
      <div className="flex items-center gap-1 bg-slate-900/90 border border-slate-800 p-1 rounded-lg">
        {tools.map((t) => (
          <button
            key={t.id}
            id={`cad-tool-${t.id.toLowerCase()}`}
            onClick={() => setTool(t.id)}
            title={t.label}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded transition-colors ${
              currentTool === t.id
                ? 'bg-indigo-600 text-white font-medium shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            {t.icon}
            <span className="hidden md:inline text-[11px]">{t.id}</span>
          </button>
        ))}
      </div>

      {/* Mutating Actions: Quick Add Entity & Feature Parameter Adjust */}
      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-1">
          <button
            id="quick-add-line-btn"
            onClick={handleQuickAddLine}
            title="Add dynamic line entity to active sketch (invokes addEntity action)"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-sky-950/80 text-sky-300 border border-sky-800 hover:bg-sky-900 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ Line</span>
          </button>
          <button
            id="quick-add-circle-btn"
            onClick={handleQuickAddCircle}
            title="Add dynamic circle entity to active sketch (invokes addEntity action)"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800 hover:bg-amber-900 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ Circle</span>
          </button>
        </div>

        {/* Feature Creation Buttons */}
        <div className="flex items-center gap-1">
          <button
            id="create-extrude-btn"
            onClick={() => {
              if (activeSketchId) {
                createExtrudeFeature(activeSketchId);
                setViewMode('3D');
              }
            }}
            disabled={!activeSketchId}
            title="Create Extrude from Active Sketch"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800 hover:bg-emerald-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Box className="w-3.5 h-3.5" />
            <span>Extrude</span>
          </button>
          <button
            id="create-cut-btn"
            onClick={() => {
              if (activeSketchId) {
                createCutFeature(activeSketchId);
                setViewMode('3D');
              }
            }}
            disabled={!activeSketchId}
            title="Create Cut from Active Sketch"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-rose-950/80 text-rose-300 border border-rose-800 hover:bg-rose-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Slash className="w-3.5 h-3.5" />
            <span>Cut</span>
          </button>
        </div>

        {/* Feature Depth Parameter Quick Tweaks */}
        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 px-2 py-1 rounded text-[11px]">
          <span className="text-slate-400 font-mono">Depth:</span>
          <button
            id="depth-decrease-btn"
            onClick={() => handleAdjustDepth(-5)}
            className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700"
            title="Decrease 3D Extrude Depth by 5mm (updateFeature)"
          >
            -5
          </button>
          <button
            id="depth-increase-btn"
            onClick={() => handleAdjustDepth(5)}
            className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700"
            title="Increase 3D Extrude Depth by 5mm (updateFeature)"
          >
            +5
          </button>
        </div>

        <div className="h-4 w-px bg-slate-800 mx-1" />

        {/* Undo / Redo Actions with history badge */}
        <div className="flex items-center gap-1">
          <button
            id="undo-btn"
            onClick={undo}
            disabled={!canUndo}
            title={`Undo (Ctrl+Z) - ${undoCount} state(s)`}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded transition-colors ${
              canUndo
                ? 'bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white border border-slate-700'
                : 'text-slate-600 bg-slate-900 cursor-not-allowed border border-transparent'
            }`}
          >
            <Undo2 className="w-3.5 h-3.5" />
            <span>Undo</span>
            {undoCount > 0 && (
              <span className="text-[10px] px-1 py-0.2 rounded bg-sky-950 text-sky-400 font-mono">
                {undoCount}
              </span>
            )}
          </button>

          <button
            id="redo-btn"
            onClick={redo}
            disabled={!canRedo}
            title={`Redo (Ctrl+Y) - ${redoCount} state(s)`}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded transition-colors ${
              canRedo
                ? 'bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white border border-slate-700'
                : 'text-slate-600 bg-slate-900 cursor-not-allowed border border-transparent'
            }`}
          >
            <Redo2 className="w-3.5 h-3.5" />
            <span>Redo</span>
          </button>
        </div>
      </div>
    </div>
  );
};
