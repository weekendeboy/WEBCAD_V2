/**
 * @license
 * CAD Workbench Global State Store (Zustand)
 * Manages the CADDocument, 2D/3D view modes, active drawing tools, and parametric feature modifications with full undo/redo capabilities.
 */

import { create } from 'zustand';
import {
  CADDocument,
  CADEntity2D,
  CADTool,
  CADViewMode,
  ParametricFeature,
  SketchFeature
} from '../types/cad.ts';
import { sampleCADDocument } from '../core/sampleCadModel.ts';

// Deep clone utility for immutable undo/redo history snapshots
function cloneDoc(doc: CADDocument): CADDocument {
  return JSON.parse(JSON.stringify(doc));
}

const MAX_HISTORY_LENGTH = 30;

export interface CadState {
  // Core CAD document model
  document: CADDocument;
  // View mode: 2D sketch plane or 3D parametric isometric viewport
  viewMode: CADViewMode;
  // Current active drafting/sketch tool
  currentTool: CADTool;
  // Currently highlighted or selected feature node in the DAG
  activeFeatureId: string | null;
  // Currently active sketch ID for 2D entity additions
  activeSketchId: string | null;

  // History stacks for Undo / Redo
  history: CADDocument[];
  future: CADDocument[];

  // Actions
  setTool: (tool: CADTool) => void;
  setViewMode: (mode: CADViewMode) => void;
  setActiveFeatureId: (featureId: string | null) => void;
  setActiveSketchId: (sketchId: string | null) => void;
  addEntity: (sketchId: string, entity: CADEntity2D) => void;
  updateEntity: (sketchId: string, entityId: string, partial: Partial<CADEntity2D>) => void;
  deleteEntity: (sketchId: string, entityId: string) => void;
  updateFeature: (featureId: string, partial: Partial<ParametricFeature>) => void;
  toggleSuppressFeature: (featureId: string) => void;
  undo: () => void;
  redo: () => void;
  resetDocument: (newDoc?: CADDocument) => void;
}

export const useCadStore = create<CadState>((set, get) => ({
  document: sampleCADDocument,
  viewMode: '2D',
  currentTool: 'SELECT',
  activeFeatureId: sampleCADDocument.activeFeatureId || 'feat_sketch_1',
  activeSketchId: sampleCADDocument.activeSketchId || 'feat_sketch_1',
  history: [],
  future: [],

  setTool: (tool: CADTool) => {
    if (get().currentTool === tool) return;
    set({ currentTool: tool });
  },

  setViewMode: (mode: CADViewMode) => {
    if (get().viewMode === mode) return;
    set({ viewMode: mode });
  },

  setActiveFeatureId: (featureId: string | null) => {
    const state = get();
    if (state.activeFeatureId === featureId) return;

    // If selected feature is a sketch, also update activeSketchId
    const targetFeature = state.document.featureTree.find((f) => f.id === featureId);
    const newSketchId = targetFeature?.type === 'sketch' ? featureId : state.activeSketchId;

    set({
      activeFeatureId: featureId,
      activeSketchId: newSketchId
    });
  },

  setActiveSketchId: (sketchId: string | null) => {
    if (get().activeSketchId === sketchId) return;
    set({ activeSketchId: sketchId });
  },

  addEntity: (sketchId: string, entity: CADEntity2D) => {
    const { document, history } = get();

    // Snapshot for Undo before mutation
    const previousSnapshot = cloneDoc(document);
    const newHistory = [...history, previousSnapshot].slice(-MAX_HISTORY_LENGTH);

    const updatedFeatureTree = document.featureTree.map((feature) => {
      if (feature.id === sketchId && feature.type === 'sketch') {
        const sketch = feature as SketchFeature;
        return {
          ...sketch,
          entities: [...sketch.entities, entity],
          status: 'clean' as const
        };
      }
      return feature;
    });

    set({
      document: {
        ...document,
        featureTree: updatedFeatureTree
      },
      history: newHistory,
      future: [] // Clear redo stack on new action
    });
  },

  updateEntity: (sketchId: string, entityId: string, partial: Partial<CADEntity2D>) => {
    const { document, history } = get();

    const previousSnapshot = cloneDoc(document);
    const newHistory = [...history, previousSnapshot].slice(-MAX_HISTORY_LENGTH);

    const updatedFeatureTree = document.featureTree.map((feature) => {
      if (feature.id === sketchId && feature.type === 'sketch') {
        const sketch = feature as SketchFeature;
        const updatedEntities = sketch.entities.map((ent) =>
          ent.id === entityId ? ({ ...ent, ...partial } as CADEntity2D) : ent
        );
        return {
          ...sketch,
          entities: updatedEntities
        };
      }
      return feature;
    });

    set({
      document: {
        ...document,
        featureTree: updatedFeatureTree
      },
      history: newHistory,
      future: []
    });
  },

  deleteEntity: (sketchId: string, entityId: string) => {
    const { document, history } = get();

    const previousSnapshot = cloneDoc(document);
    const newHistory = [...history, previousSnapshot].slice(-MAX_HISTORY_LENGTH);

    const updatedFeatureTree = document.featureTree.map((feature) => {
      if (feature.id === sketchId && feature.type === 'sketch') {
        const sketch = feature as SketchFeature;
        return {
          ...sketch,
          entities: sketch.entities.filter((ent) => ent.id !== entityId),
          // Also strip related constraints and dimensions
          constraints: sketch.constraints.filter((c) => !c.entityIds.includes(entityId)),
          dimensions: sketch.dimensions.filter((d) => !d.entityIds.includes(entityId))
        };
      }
      return feature;
    });

    set({
      document: {
        ...document,
        featureTree: updatedFeatureTree
      },
      history: newHistory,
      future: []
    });
  },

  updateFeature: (featureId: string, partial: Partial<ParametricFeature>) => {
    const { document, history } = get();

    const previousSnapshot = cloneDoc(document);
    const newHistory = [...history, previousSnapshot].slice(-MAX_HISTORY_LENGTH);

    const updatedFeatureTree = document.featureTree.map((feature) => {
      if (feature.id === featureId) {
        return {
          ...feature,
          ...partial
        } as ParametricFeature;
      }
      return feature;
    });

    set({
      document: {
        ...document,
        featureTree: updatedFeatureTree
      },
      history: newHistory,
      future: []
    });
  },

  toggleSuppressFeature: (featureId: string) => {
    const { document, history } = get();

    const previousSnapshot = cloneDoc(document);
    const newHistory = [...history, previousSnapshot].slice(-MAX_HISTORY_LENGTH);

    const updatedFeatureTree = document.featureTree.map((feature) => {
      if (feature.id === featureId) {
        return {
          ...feature,
          suppressed: !feature.suppressed
        } as ParametricFeature;
      }
      return feature;
    });

    set({
      document: {
        ...document,
        featureTree: updatedFeatureTree
      },
      history: newHistory,
      future: []
    });
  },

  undo: () => {
    const { history, document, future } = get();
    if (history.length === 0) return;

    const previousDoc = history[history.length - 1];
    const newHistory = history.slice(0, history.length - 1);
    const currentDocClone = cloneDoc(document);

    set({
      document: previousDoc,
      history: newHistory,
      future: [currentDocClone, ...future].slice(0, MAX_HISTORY_LENGTH)
    });
  },

  redo: () => {
    const { history, document, future } = get();
    if (future.length === 0) return;

    const nextDoc = future[0];
    const newFuture = future.slice(1);
    const currentDocClone = cloneDoc(document);

    set({
      document: nextDoc,
      history: [...history, currentDocClone].slice(-MAX_HISTORY_LENGTH),
      future: newFuture
    });
  },

  resetDocument: (newDoc?: CADDocument) => {
    set({
      document: newDoc ? cloneDoc(newDoc) : cloneDoc(sampleCADDocument),
      history: [],
      future: []
    });
  }
}));

// ============================================================================
// Fine-grained selector hooks to eliminate unnecessary re-renders
// ============================================================================

export const useCADDocument = () => useCadStore((s) => s.document);
export const useViewMode = () => useCadStore((s) => s.viewMode);
export const useCurrentTool = () => useCadStore((s) => s.currentTool);
export const useActiveFeatureId = () => useCadStore((s) => s.activeFeatureId);
export const useActiveSketchId = () => useCadStore((s) => s.activeSketchId);
export const useFeatureTree = () => useCadStore((s) => s.document.featureTree);
export const useHistoryStatus = () => {
  const canUndo = useCadStore((s) => s.history.length > 0);
  const canRedo = useCadStore((s) => s.future.length > 0);
  const undoCount = useCadStore((s) => s.history.length);
  const redoCount = useCadStore((s) => s.future.length);
  return {
    canUndo,
    canRedo,
    undoCount,
    redoCount
  };
};

export const useActiveSketch = (): SketchFeature | undefined => {
  const activeSketchId = useCadStore((s) => s.activeSketchId);
  const activeFeatureId = useCadStore((s) => s.activeFeatureId);
  const featureTree = useCadStore((s) => s.document.featureTree);

  const activeId = activeSketchId || activeFeatureId;
  const feat = featureTree.find(
    (f) => f.id === activeId && f.type === 'sketch'
  );
  if (feat) return feat as SketchFeature;
  // Fallback to first sketch feature
  return featureTree.find((f) => f.type === 'sketch') as SketchFeature | undefined;
};

export const useCadActions = () => {
  return {
    setTool: useCadStore.getState().setTool,
    setViewMode: useCadStore.getState().setViewMode,
    setActiveFeatureId: useCadStore.getState().setActiveFeatureId,
    setActiveSketchId: useCadStore.getState().setActiveSketchId,
    addEntity: useCadStore.getState().addEntity,
    updateEntity: useCadStore.getState().updateEntity,
    deleteEntity: useCadStore.getState().deleteEntity,
    updateFeature: useCadStore.getState().updateFeature,
    toggleSuppressFeature: useCadStore.getState().toggleSuppressFeature,
    undo: useCadStore.getState().undo,
    redo: useCadStore.getState().redo,
    resetDocument: useCadStore.getState().resetDocument
  };
};
