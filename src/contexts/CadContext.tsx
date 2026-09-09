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
  ExtrudeFeature,
  CutFeature,
  SketchProfile,
  Constraint,
  Dimension,
  CustomPlane
} from '../types/cad.ts';
import { sampleCADDocument, datumFrontPlane, datumTopPlane } from '../core/sampleCadModel.ts';
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
  updateFeature: (featureId: string, partial: Partial<ParametricFeature>, skipHistory?: boolean) => void;
  toggleSuppressFeature: (featureId: string) => void;
  rollbackToFeature: (featureId: string | null) => void;
  rollbackToIndex: (index: number) => void;
  setSketchProfiles: (sketchId: string, profiles: SketchProfile[]) => void;
  createSketchOnFace: (plane: CustomPlane, name?: string) => string;
  createExtrudeFeature: (sketchId: string) => string;
  createCutFeature: (sketchId: string) => string;
  createRevolveFeature: (sketchId: string) => string;
  createSweepFeature: (profileSketchId: string, pathSketchId: string) => string;
  createLoftFeature: (sectionSketchIds: string[]) => string;
  createFilletFeature: (radius: number, edgeIds: string[]) => string;
  createChamferFeature: (distance: number, edgeIds: string[]) => string;
  addPlane: (plane: CustomPlane) => void;
  undo: () => void;
  redo: () => void;
  resetDocument: (newDoc?: CADDocument) => void;
}
// 建立一個乾淨的空白文件狀態
const blankDocument: CADDocument = {
  id: 'doc_new_01',
  title: 'Untitled_Part.cad',
  version: '1.0.0',
  units: 'mm',
  layers: {
    layer_outline: {
      id: 'layer_outline',
      name: '0 - Visible Geometry',
      color: '#38bdf8', // 預設亮藍色
      visible: true,
      locked: false,
      lineType: 'continuous',
      lineWidth: 0.5
    }
  },
  planes: {
    [datumFrontPlane.id]: datumFrontPlane,
    [datumTopPlane.id]: datumTopPlane,
  },
  // 建立一個預設的空白草圖供使用者立刻開始畫圖
  featureTree: [
    {
      id: 'feat_sketch_1',
      name: 'Sketch1 (Base)',
      type: 'sketch',
      dependencies: [],
      suppressed: false,
      status: 'clean',
      createdAt: Date.now(),
      planeId: datumFrontPlane.id,
      plane: datumFrontPlane,
      entities: [],
      constraints: [],
      dimensions: [],
      profiles: [],
      solverState: 'under_constrained'
    } as SketchFeature
  ],
  activeFeatureId: 'feat_sketch_1',
  activeSketchId: 'feat_sketch_1'
};

export const useCadStore = create<CadState>((set, get) => ({
  document: blankDocument,     // <--- 替換成乾淨的空白文件
  viewMode: '2D',              // <--- 一開始直接進入 2D 草圖繪製模式
  currentTool: 'LINE',         // <--- 預設拿起畫線工具
  activeFeatureId: 'feat_sketch_1',
  editingFeatureId: null,
  activeSketchId: 'feat_sketch_1',
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

  updateFeature: (featureId: string, partial: Partial<ParametricFeature>, skipHistory: boolean = false) => {
    const { document, history } = get();

    const previousSnapshot = skipHistory ? null : cloneDoc(document);
    const newHistory = skipHistory ? history : [...history, previousSnapshot!].slice(-MAX_HISTORY_LENGTH);

    const updatedFeatureTree = [...document.featureTree].map((feature) => {
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
      future: skipHistory ? get().future : []
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
    const state = get();
    const { document, history } = state;
    const previousSnapshot = cloneDoc(document);
    const newHistory = [...history, previousSnapshot].slice(-MAX_HISTORY_LENGTH);

    const updatedFeatureTree = document.featureTree.map((feature, idx) => {
      return {
        ...feature,
        suppressed: idx > index
      } as ParametricFeature;
    });

    // Determine new active feature (the one just above the rollback bar, or null if rolled to top)
    const newActiveFeatureId = index >= 0 && index < updatedFeatureTree.length
      ? updatedFeatureTree[index].id
      : null;

    let newEditingFeatureId = state.editingFeatureId;
    if (newEditingFeatureId) {
       const editingIdx = document.featureTree.findIndex(f => f.id === newEditingFeatureId);
       if (editingIdx > index) {
         newEditingFeatureId = null; // Close property manager if editing feature is rolled back
       }
    }

    set({
      document: {
        ...document,
        featureTree: updatedFeatureTree
      },
      activeFeatureId: newActiveFeatureId,
      editingFeatureId: newEditingFeatureId,
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

  createSketchOnFace: (plane: CustomPlane, name?: string) => {
    const { document, history } = get();
    const previousSnapshot = cloneDoc(document);
    const newHistory = [...history, previousSnapshot].slice(-MAX_HISTORY_LENGTH);

    const sketchId = `feat_sketch_face_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const sketchName = name || `Sketch (${plane.name})`;

    const newSketch: SketchFeature = {
      id: sketchId,
      name: sketchName,
      type: 'sketch',
      dependencies: plane.parentFeatureId ? [plane.parentFeatureId] : [],
      suppressed: false,
      status: 'clean',
      createdAt: Date.now(),
      planeId: plane.id,
      plane: plane,
      entities: [],
      constraints: [],
      dimensions: [],
      profiles: [],
      solverState: 'under_constrained'
    };

    set({
      document: {
        ...document,
        planes: {
          ...document.planes,
          [plane.id]: plane
        },
        featureTree: [...document.featureTree, newSketch]
      },
      activeSketchId: sketchId,
      activeFeatureId: sketchId,
      history: newHistory,
      future: []
    });

    return sketchId;
  },

  createExtrudeFeature: (sketchId: string) => {
    const { document, history } = get();
    const previousSnapshot = cloneDoc(document);
    const newHistory = [...history, previousSnapshot].slice(-MAX_HISTORY_LENGTH);

    const featId = `feat_extrude_${Date.now()}`;
    const newExtrude: ExtrudeFeature = {
      id: featId,
      name: `Boss-Extrude ${document.featureTree.length}`,
      type: 'extrude',
      dependencies: [sketchId],
      suppressed: false,
      status: 'clean',
      createdAt: Date.now(),
      sketchFeatureId: sketchId,
      depth: 10.0,
      endCondition: 'blind',
      booleanOperation: 'new_body'
    };

    set({
      document: {
        ...document,
        featureTree: [...document.featureTree, newExtrude]
      },
      activeFeatureId: featId,
      editingFeatureId: featId,
      history: newHistory,
      future: []
    });

    return featId;
  },

  createCutFeature: (sketchId: string) => {
    const { document, history } = get();
    const previousSnapshot = cloneDoc(document);
    const newHistory = [...history, previousSnapshot].slice(-MAX_HISTORY_LENGTH);

    const extrudeId = document.featureTree.find(f => f.type === 'extrude')?.id;
    const dependencies = [sketchId];
    if (extrudeId) dependencies.push(extrudeId);

    const featId = `feat_cut_${Date.now()}`;
    const newCut: CutFeature = {
      id: featId,
      name: `Cut-Extrude ${document.featureTree.length}`,
      type: 'cut',
      dependencies,
      suppressed: false,
      status: 'clean',
      createdAt: Date.now(),
      sketchFeatureId: sketchId,
      depth: 10.0,
      endCondition: 'through_all',
      flipSideToCut: false
    };

    set({
      document: {
        ...document,
        featureTree: [...document.featureTree, newCut]
      },
      activeFeatureId: featId,
      editingFeatureId: featId,
      history: newHistory,
      future: []
    });

    return featId;
  },

  createRevolveFeature: (sketchId: string) => {
    const { document, history } = get();
    const previousSnapshot = cloneDoc(document);
    const newHistory = [...history, previousSnapshot].slice(-MAX_HISTORY_LENGTH);

    const featId = `feat_revolve_${Date.now()}`;
    const newRevolve: ParametricFeature = {
      id: featId,
      name: `Revolve ${document.featureTree.length}`,
      type: 'revolve',
      dependencies: [sketchId],
      suppressed: false,
      status: 'clean',
      createdAt: Date.now(),
      sketchFeatureId: sketchId,
      angle: 360,
      booleanOperation: 'new_body'
    };

    set({
      document: {
        ...document,
        featureTree: [...document.featureTree, newRevolve]
      },
      activeFeatureId: featId,
      editingFeatureId: featId,
      history: newHistory,
      future: []
    });

    return featId;
  },

  createSweepFeature: (profileSketchId: string, pathSketchId: string) => {
    const { document, history } = get();
    const previousSnapshot = cloneDoc(document);
    const newHistory = [...history, previousSnapshot].slice(-MAX_HISTORY_LENGTH);

    const featId = `feat_sweep_${Date.now()}`;
    const newSweep: ParametricFeature = {
      id: featId,
      name: `Sweep ${document.featureTree.length}`,
      type: 'sweep',
      dependencies: [profileSketchId, pathSketchId],
      suppressed: false,
      status: 'clean',
      createdAt: Date.now(),
      profileSketchId,
      pathSketchId,
      booleanOperation: 'new_body'
    };

    set({
      document: {
        ...document,
        featureTree: [...document.featureTree, newSweep]
      },
      activeFeatureId: featId,
      editingFeatureId: featId,
      history: newHistory,
      future: []
    });

    return featId;
  },

  createLoftFeature: (sectionSketchIds: string[]) => {
    const { document, history } = get();
    const previousSnapshot = cloneDoc(document);
    const newHistory = [...history, previousSnapshot].slice(-MAX_HISTORY_LENGTH);

    const featId = `feat_loft_${Date.now()}`;
    const newLoft: ParametricFeature = {
      id: featId,
      name: `Loft ${document.featureTree.length}`,
      type: 'loft',
      dependencies: [...sectionSketchIds],
      suppressed: false,
      status: 'clean',
      createdAt: Date.now(),
      sectionSketchIds,
      booleanOperation: 'new_body'
    };

    set({
      document: {
        ...document,
        featureTree: [...document.featureTree, newLoft]
      },
      activeFeatureId: featId,
      editingFeatureId: featId,
      history: newHistory,
      future: []
    });

    return featId;
  },

  createFilletFeature: (radius: number, edgeIds: string[]) => {
    const { document, history } = get();
    const previousSnapshot = cloneDoc(document);
    const newHistory = [...history, previousSnapshot].slice(-MAX_HISTORY_LENGTH);

    const featId = `feat_fillet_${Date.now()}`;
    // Depends on the last solid feature
    const lastSolid = [...document.featureTree].reverse().find(f => ['extrude', 'cut', 'revolve', 'sweep', 'loft', 'fillet', 'chamfer'].includes(f.type));
    const dependencies = lastSolid ? [lastSolid.id] : [];

    const newFillet: ParametricFeature = {
      id: featId,
      name: `Fillet ${document.featureTree.length}`,
      type: 'fillet',
      dependencies,
      suppressed: false,
      status: 'clean',
      createdAt: Date.now(),
      radius,
      edgeIds
    };

    set({
      document: {
        ...document,
        featureTree: [...document.featureTree, newFillet]
      },
      activeFeatureId: featId,
      editingFeatureId: featId,
      history: newHistory,
      future: []
    });

    return featId;
  },

  createChamferFeature: (distance: number, edgeIds: string[]) => {
    const { document, history } = get();
    const previousSnapshot = cloneDoc(document);
    const newHistory = [...history, previousSnapshot].slice(-MAX_HISTORY_LENGTH);

    const featId = `feat_chamfer_${Date.now()}`;
    // Depends on the last solid feature
    const lastSolid = [...document.featureTree].reverse().find(f => ['extrude', 'cut', 'revolve', 'sweep', 'loft', 'fillet', 'chamfer'].includes(f.type));
    const dependencies = lastSolid ? [lastSolid.id] : [];

    const newChamfer: ParametricFeature = {
      id: featId,
      name: `Chamfer ${document.featureTree.length}`,
      type: 'chamfer',
      dependencies,
      suppressed: false,
      status: 'clean',
      createdAt: Date.now(),
      distance,
      edgeIds
    };

    set({
      document: {
        ...document,
        featureTree: [...document.featureTree, newChamfer]
      },
      activeFeatureId: featId,
      editingFeatureId: featId,
      history: newHistory,
      future: []
    });

    return featId;
  },

  addPlane: (plane: CustomPlane) => {
    const { document } = get();
    if (document.planes[plane.id]) return;
    set({
      document: {
        ...document,
        planes: {
          ...document.planes,
          [plane.id]: plane
        }
      }
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
    createSketchOnFace: useCadStore.getState().createSketchOnFace,
    createExtrudeFeature: useCadStore.getState().createExtrudeFeature,
    createCutFeature: useCadStore.getState().createCutFeature,
    createRevolveFeature: useCadStore.getState().createRevolveFeature,
    createSweepFeature: useCadStore.getState().createSweepFeature,
    createLoftFeature: useCadStore.getState().createLoftFeature,
    createFilletFeature: useCadStore.getState().createFilletFeature,
    createChamferFeature: useCadStore.getState().createChamferFeature,
    addPlane: useCadStore.getState().addPlane,
    undo: useCadStore.getState().undo,
    redo: useCadStore.getState().redo,
    resetDocument: useCadStore.getState().resetDocument
  };
};
