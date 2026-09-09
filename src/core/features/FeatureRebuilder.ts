/**
 * @license
 * CAD Parametric Feature Rebuilder Engine
 *
 * 負責依據特徵歷史樹的相依性拓撲排序 (Topological Sort) 重新計算並再生 3D 模型。
 *
 * 核心功能：
 * 1. topologicalSortFeatures:
 *    使用 Kahn's 演算法對未抑制 (suppressed === false) 的特徵節點進行拓撲排序，
 *    並具備循環相依 (Circular Dependency) 檢測與無效相依性處理。
 * 2. rebuildModel(featureTree):
 *    依序遍歷排序後之特徵節點。遇 ExtrudeFeature 或 CutFeature 時，
 *    呼叫 OcctBridge.computeFeature 獲取 3D 網格資料，
 *    並回傳一個包含所有 3D 網格 (SolidMesh3D[]) 的陣列供渲染層使用。
 * 3. useModelRebuilder:
 *    React Hook，自動監聽 Zustand store 中 featureTree 的異動，
 *    並以防抖機制 (Debounce) 即時觸發再生模型，提供極致流暢的 3D CAD 互動體驗。
 */

import { useEffect, useState, useMemo, useRef } from 'react';
import {
  ParametricFeature,
  SketchFeature,
  ExtrudeFeature,
  CutFeature,
  SolidMesh3D,
  FeatureId
} from '../../types/cad.ts';
import { OcctBridge, FeatureRebuildContext } from './OcctBridge.ts';
import { useCadStore } from '../../contexts/CadContext.tsx';
import {
  OcctWorkerClient,
  WorkerStatusInfo,
  WorkerKernelMetrics
} from '../../workers/index.ts';

// ============================================================================
// 1. Topological Sorting for Parametric DAG (Directed Acyclic Graph)
// ============================================================================

export interface TopologicalSortResult {
  sorted: ParametricFeature[];
  hasCycle: boolean;
  cycleNodeIds: FeatureId[];
  missingDependencies: Map<FeatureId, FeatureId[]>;
}

/**
 * 依據特徵間的 dependencies 進行拓撲排序 (Topological Sort)。
 * 只處理 suppressed === false 的節點。
 *
 * @param featureTree 特徵歷史樹節點列表
 * @returns 排序後的特徵陣列與相依性檢測結果
 */
export function topologicalSortFeatures(
  featureTree: ParametricFeature[]
): TopologicalSortResult {
  // 1. Filter out suppressed features
  const activeFeatures = featureTree.filter((f) => !f.suppressed);
  const activeIds = new Set<FeatureId>(activeFeatures.map((f) => f.id));
  const featureMap = new Map<FeatureId, ParametricFeature>(
    activeFeatures.map((f) => [f.id, f])
  );

  // 2. Build graph: in-degrees and adjacency (parent -> dependents)
  const inDegree = new Map<FeatureId, number>();
  const dependentsMap = new Map<FeatureId, FeatureId[]>();
  const missingDeps = new Map<FeatureId, FeatureId[]>();

  for (const feat of activeFeatures) {
    inDegree.set(feat.id, 0);
    dependentsMap.set(feat.id, []);
  }

  for (const feat of activeFeatures) {
    const rawDeps = feat.dependencies || [];
    for (const depId of rawDeps) {
      if (!activeIds.has(depId)) {
        // Dependency is missing or suppressed
        const missing = missingDeps.get(feat.id) || [];
        missing.push(depId);
        missingDeps.set(feat.id, missing);
        continue;
      }

      // Valid active dependency: depId must come before feat.id
      inDegree.set(feat.id, (inDegree.get(feat.id) || 0) + 1);
      const list = dependentsMap.get(depId) || [];
      list.push(feat.id);
      dependentsMap.set(depId, list);
    }
  }

  // 3. Collect 0-in-degree nodes (stable: preserve original tree order)
  const queue: FeatureId[] = [];
  for (const feat of activeFeatures) {
    if ((inDegree.get(feat.id) || 0) === 0) {
      queue.push(feat.id);
    }
  }

  const sorted: ParametricFeature[] = [];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const node = featureMap.get(currentId);
    if (node) {
      sorted.push(node);
    }

    const dependents = dependentsMap.get(currentId) || [];
    for (const depId of dependents) {
      const deg = (inDegree.get(depId) || 0) - 1;
      inDegree.set(depId, deg);
      if (deg === 0) {
        queue.push(depId);
      }
    }
  }

  // 4. Cycle Detection
  const hasCycle = sorted.length < activeFeatures.length;
  const cycleNodeIds: FeatureId[] = [];

  if (hasCycle) {
    const sortedIds = new Set(sorted.map((s) => s.id));
    for (const feat of activeFeatures) {
      if (!sortedIds.has(feat.id)) {
        cycleNodeIds.push(feat.id);
      }
    }
    console.warn('[FeatureRebuilder] Circular dependency detected in feature tree:', cycleNodeIds);
  }

  return {
    sorted,
    hasCycle,
    cycleNodeIds,
    missingDependencies: missingDeps
  };
}

// ============================================================================
// 2. rebuildModel Engine
// ============================================================================

export interface RebuildOptions {
  /** Stop processing on first feature computation error */
  stopOnError?: boolean;
}

/**
 * 重建並再生 CAD 模型 (rebuildModel)。
 *
 * 核心流程：
 * 1. 遍歷 featureTree 中 suppressed === false 的節點。
 * 2. 確保特徵依照 dependencies 的順序進行拓撲排序 (Topological Sort)。
 * 3. 依序遍歷排序後節點：
 *    - 當遇到 SketchFeature 時，更新草圖快取。
 *    - 當遇到 ExtrudeFeature 或 CutFeature 時，呼叫 OcctBridge.computeFeature 獲取 3D 網格資料。
 * 4. 回傳一個包含所有 3D 網格的陣列 (SolidMesh3D[]) 供渲染層使用。
 *
 * @param featureTree 當前 CAD 文件中的特徵樹
 * @param options 可選配置
 * @returns 包含所有 3D 網格的陣列
 */
export function rebuildModel(
  featureTree: ParametricFeature[],
  options?: RebuildOptions
): SolidMesh3D[] {
  if (!featureTree || featureTree.length === 0) {
    return [];
  }

  // 1. Perform Topological Sort
  const { sorted, missingDependencies } = topologicalSortFeatures(featureTree);

  // 2. Initialize Rebuild Context
  const context: FeatureRebuildContext = {
    featureTree: sorted,
    featureMap: new Map<string, ParametricFeature>(),
    sketchMap: new Map<string, SketchFeature>(),
    computedMeshes: []
  };

  for (const feat of featureTree) {
    context.featureMap.set(feat.id, feat);
    if (feat.type === 'sketch') {
      context.sketchMap.set(feat.id, feat as SketchFeature);
    }
  }

  const meshes: SolidMesh3D[] = [];

  // 3. Sequentially process topologically ordered active features
  for (const feature of sorted) {
    // If feature has missing or suppressed parent dependencies, skip or flag
    const missing = missingDependencies.get(feature.id);
    if (missing && missing.length > 0) {
      console.warn(
        `[FeatureRebuilder] Skipping feature "${feature.name}" due to missing dependencies: ${missing.join(', ')}`
      );
      if (options?.stopOnError) break;
      continue;
    }

    if (feature.type === 'sketch') {
      // Store sketch for subsequent 3D extrusion/cut features
      context.sketchMap.set(feature.id, feature as SketchFeature);
    } else if (feature.type !== 'datum_plane') {
      // Encountered 3D Solid Feature: Call OcctBridge to compute 3D mesh
      try {
        const mesh = OcctBridge.computeFeature(
          feature,
          context
        );

        if (mesh) {
          meshes.push(mesh);
          context.computedMeshes.push(mesh);
        }
      } catch (err) {
        console.error(`[FeatureRebuilder] Error computing feature "${feature.name}":`, err);
        if (options?.stopOnError) break;
      }
    }
  }

  return meshes;
}

// ============================================================================
// 3. React Hook for Zustand Synchronization
// ============================================================================

export interface UseModelRebuilderResult {
  meshes: SolidMesh3D[];
  isRebuilding: boolean;
  activeFeatureCount: number;
  lastRebuiltAt: number;
  workerStatus: WorkerStatusInfo;
  workerMetrics: WorkerKernelMetrics;
}

/**
 * 響應式 React Hook：當 Zustand store 中的 featureTree 更新時，
 * 自動透過 OcctWorkerClient (WebWorker) 非同步計算 3D 實體模型與布林運算。
 *
 * 核心優勢：
 * - 耗時之 OpenCASCADE WASM (BRepPrimAPI_MakePrism / BRepAlgoAPI_Cut / Tessellation)
 *   完全移至獨立 WebWorker 執行緒。
 * - UI 主執行緒在使用者進行 3D 視角旋轉、拖曳時維持極限流暢的 60 FPS！
 *
 * @param debounceMs 防抖毫秒數（預設 20ms，兼顧高頻參數拖曳與渲染流暢度）
 */
export function useModelRebuilder(debounceMs = 20): UseModelRebuilderResult {
  const featureTree = useCadStore((state) => state.document.featureTree);

  const [meshes, setMeshes] = useState<SolidMesh3D[]>(() => rebuildModel(featureTree));
  const [isRebuilding, setIsRebuilding] = useState<boolean>(false);
  const [lastRebuiltAt, setLastRebuiltAt] = useState<number>(() => Date.now());

  const client = useMemo(() => OcctWorkerClient.getInstance(), []);
  const [workerStatus, setWorkerStatus] = useState<WorkerStatusInfo>(() => client.getStatus());
  const [workerMetrics, setWorkerMetrics] = useState<WorkerKernelMetrics>(() => client.getMetrics());

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subscribe to worker status & metrics
  useEffect(() => {
    const unsubStatus = client.subscribeStatus(setWorkerStatus);
    const unsubMetrics = client.subscribeMetrics(setWorkerMetrics);
    return () => {
      unsubStatus();
      unsubMetrics();
    };
  }, [client]);

  // Trigger asynchronous model rebuild inside WebWorker upon featureTree change
  useEffect(() => {
    setIsRebuilding(true);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(async () => {
      try {
        const newMeshes = await client.rebuildModelAsync(featureTree);
        if (newMeshes && newMeshes.length > 0) {
          setMeshes(newMeshes);
        } else {
          // If worker returned empty, fall back to synchronous calculation
          setMeshes(rebuildModel(featureTree));
        }
      } catch (err) {
        console.warn('[useModelRebuilder] Worker rebuild error, applying fallback:', err);
        setMeshes(rebuildModel(featureTree));
      } finally {
        setIsRebuilding(false);
        setLastRebuiltAt(Date.now());
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [featureTree, debounceMs, client]);

  const activeFeatureCount = useMemo(
    () => featureTree.filter((f) => !f.suppressed).length,
    [featureTree]
  );

  return {
    meshes,
    isRebuilding,
    activeFeatureCount,
    lastRebuiltAt,
    workerStatus,
    workerMetrics
  };
}
