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
  SketchFeature,
  SketchProfile,
  Constraint,
  Dimension
} from '../types/cad.ts';
import { sampleCADDocument } from '../core/sampleCadModel.ts';
import {
  solveConstraints,
  analyzeSketchState
} from '../core/solver/ConstraintSolver.ts';

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
  // Feature currently opened for editing in the right property manager panel
  editingFeatureId: string | null;
  // Currently active sketch ID for 2D entity additions
  activeSketchId: string | null;
  // Currently selected 2D entity IDs
  selectedEntityIds: string[];

  // History stacks for Undo / Redo
  history: CADDocument[];
  future: CADDocument[];

  // Actions
  setTool: (tool: CADTool) => void;
  setViewMode: (mode: CADViewMode) => void;
  setActiveFeatureId: (featureId: string | null) => void;
  setEditingFeatureId: (featureId: string | null) => void;
  setActiveSketchId: (sketchId: string | null) => void;
  setSelectedEntityIds: (ids: string[]) => void;
  addEntity: (sketchId: string, entity: CADEntity2D) => void;
  updateEntity: (sketchId: string, entityId: string, partial: Partial<CADEntity2D>) => void;
  deleteEntity: (sketchId: string, entityId: string) => void;
  addConstraint: (sketchId: string, constraint: Constraint) => void;
  addDimension: (sketchId: string, dimension: Dimension) => void;
  updateFeature: (featureId: string, partial: Partial<ParametricFeature>) => void;
  toggleSuppressFeature: (featureId: string) => void;
  rollbackToFeature: (featureId: string | null) => void;
  rollbackToIndex: (index: number) => void;
  setSketchProfiles: (sketchId: string, profiles: SketchProfile[]) => void;
  undo: () => void;
  redo: () => void;
  resetDocument: (newDoc?: CADDocument) => void;
}

export const useCadStore = create<CadState>((set, get) => ({
  document: sampleCADDocument,
  viewMode: '2D',
  currentTool: 'SELECT',
  activeFeatureId: sampleCADDocument.activeFeatureId || 'feat_sketch_1',
  editingFeatureId: null,
  activeSketchId: sampleCADDocument.activeSketchId || 'feat_sketch_1',
  selectedEntityIds: [],
  history: [],
  future: [],

  setTool: (tool: CADTool) => {
    if (get().currentTool === tool) return;
    set({ currentTool: tool });
  },

  setSelectedEntityIds: (ids: string[]) => {
    set({ selectedEntityIds: ids });
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
        const newEntities = [...sketch.entities, entity];
        const analysis = analyzeSketchState(newEntities, sketch.constraints);
        return {
          ...sketch,
          entities: analysis.entities,
          solverState: analysis.status,
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
        const remainingEntities = sketch.entities.filter((ent) => ent.id !== entityId);
        const remainingConstraints = sketch.constraints.filter((c) => !c.entityIds.includes(entityId));
        const remainingDimensions = sketch.dimensions.filter((d) => !d.entityIds.includes(entityId));
        const analysis = analyzeSketchState(remainingEntities, remainingConstraints);
        return {
          ...sketch,
          entities: analysis.entities,
          constraints: remainingConstraints,
          dimensions: remainingDimensions,
          solverState: analysis.status
        };
      }
      return feature;
    });

    set({
      document: {
        ...document,
        featureTree: updatedFeatureTree
      },
      selectedEntityIds: get().selectedEntityIds.filter((id) => id !== entityId),
      history: newHistory,
      future: []
    });
  },

  addConstraint: (sketchId: string, constraint: Constraint) => {
    const { document, history } = get();

    const previousSnapshot = cloneDoc(document);
    const newHistory = [...history, previousSnapshot].slice(-MAX_HISTORY_LENGTH);

    const updatedFeatureTree = document.featureTree.map((feature) => {
      if (feature.id === sketchId && feature.type === 'sketch') {
        const sketch = feature as SketchFeature;
        const updatedConstraints = [...sketch.constraints, constraint];

        // 呼叫幾何約束求解器與自由度分析
        const solved = solveConstraints(sketch.entities, updatedConstraints);
        const analysis = analyzeSketchState(solved, updatedConstraints);

        return {
          ...sketch,
          entities: analysis.entities,
          constraints: updatedConstraints,
          solverState: analysis.status,
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
      future: []
    });
  },

  addDimension: (sketchId: string, dimension: Dimension) => {
    const { document, history } = get();

    const previousSnapshot = cloneDoc(document);
    const newHistory = [...history, previousSnapshot].slice(-MAX_HISTORY_LENGTH);

    const updatedFeatureTree = document.featureTree.map((feature) => {
      if (feature.id === sketchId && feature.type === 'sketch') {
        const sketch = feature as SketchFeature;
        return {
          ...sketch,
          dimensions: [...sketch.dimensions, dimension],
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

  setEditingFeatureId: (featureId: string | null) => {
    set({ editingFeatureId: featureId });
  },

  /**
   * SolidWorks 風格退回棒 (Rollback Bar)
   * 將退回棒移動到某個特徵 (featureId) 上方/後方。
   * 該特徵之後的所有特徵狀態皆設為 suppressed = true；
   * 該特徵及之前的特徵狀態皆設為 suppressed = false。
   * 若 featureId 為 null，代表退回至最頂部（所有特徵皆被抑制）。
   */
  rollbackToFeature: (featureId: string | null) => {
    const { document, history } = get();
    const previousSnapshot = cloneDoc(document);
    const newHistory = [...history, previousSnapshot].slice(-MAX_HISTORY_LENGTH);

    const targetIndex = featureId === null
      ? -1
      : document.featureTree.findIndex((f) => f.id === featureId);

    const updatedFeatureTree = document.featureTree.map((feature, idx) => {
      if (targetIndex === -1) {
        // Rolled back to before all features
        return { ...feature, suppressed: true } as ParametricFeature;
      }
      return {
        ...feature,
        suppressed: idx > targetIndex
      } as ParametricFeature;
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

  /**
   * 依特徵索引位置放置退回棒 (index: -1 ~ featureTree.length - 1)
   */
  rollbackToIndex: (index: number) => {
    const { document, history } = get();
    const previousSnapshot = cloneDoc(document);
    const newHistory = [...history, previousSnapshot].slice(-MAX_HISTORY_LENGTH);

    const updatedFeatureTree = document.featureTree.map((feature, idx) => {
      return {
        ...feature,
        suppressed: idx > index
      } as ParametricFeature;
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

  setSketchProfiles: (sketchId: string, profiles: SketchProfile[]) => {
    const { document } = get();
    const targetSketch = document.featureTree.find(
      (f) => f.id === sketchId && f.type === 'sketch'
    ) as SketchFeature | undefined;

    if (!targetSketch) return;

    // Check if profiles are already structurally identical
    const existing = targetSketch.profiles || [];
    const isSame =
      existing.length === profiles.length &&
      existing.every((ep, i) => {
        const np = profiles[i];
        return (
          ep.id === np.id &&
          ep.area === np.area &&
          ep.isIsland === np.isIsland &&
          ep.contourEntityIds.length === np.contourEntityIds.length &&
          ep.contourEntityIds.every((id, j) => id === np.contourEntityIds[j])
        );
      });

    if (isSame) return;

    const updatedFeatureTree = document.featureTree.map((feature) => {
      if (feature.id === sketchId && feature.type === 'sketch') {
        const sketch = feature as SketchFeature;
        return {
          ...sketch,
          profiles
        };
      }
      return feature;
    });

    set({
      document: {
        ...document,
        featureTree: updatedFeatureTree
      }
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
      selectedEntityIds: [],
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
export const useEditingFeatureId = () => useCadStore((s) => s.editingFeatureId);
export const useActiveSketchId = () => useCadStore((s) => s.activeSketchId);
export const useSelectedEntityIds = () => useCadStore((s) => s.selectedEntityIds);
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
    setEditingFeatureId: useCadStore.getState().setEditingFeatureId,
    setActiveSketchId: useCadStore.getState().setActiveSketchId,
    setSelectedEntityIds: useCadStore.getState().setSelectedEntityIds,
    addEntity: useCadStore.getState().addEntity,
    updateEntity: useCadStore.getState().updateEntity,
    deleteEntity: useCadStore.getState().deleteEntity,
    addConstraint: useCadStore.getState().addConstraint,
    addDimension: useCadStore.getState().addDimension,
    updateFeature: useCadStore.getState().updateFeature,
    toggleSuppressFeature: useCadStore.getState().toggleSuppressFeature,
    rollbackToFeature: useCadStore.getState().rollbackToFeature,
    rollbackToIndex: useCadStore.getState().rollbackToIndex,
    undo: useCadStore.getState().undo,
    redo: useCadStore.getState().redo,
    resetDocument: useCadStore.getState().resetDocument
  };
};
