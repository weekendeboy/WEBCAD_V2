/**
 * @license
 * 2D Sketch Topology Engine (AutoCAD 2D Drafting + SolidWorks 3D Parametric Features)
 *
 * 拓撲分析模組 (Topology Analysis Module):
 * 1. buildGraph(entities, tolerance):
 *    - 將所有線段 (LineEntity) 與圓弧 (ArcEntity) 提取出頂點 (Nodes) 與邊 (Edges)。
 *    - 合併容差內 (預設 tolerance 1e-5) 的重合點。
 *    - 計算精確之出射切線角度並依逆時針 (CCW) 排序出射半邊。
 * 2. findFaces(graph):
 *    - 依據 DCEL 雙向鏈結邊表，使用最左轉角法 (Left-most Turn / 最小內角演算法) 尋找所有封閉面 (Closed Profiles)。
 *    - 採用鞋帶公式 (Shoelace formula) 計算各封閉多邊形之代數面積 (Area)。
 *    - 正面積即為逆時針方向圍成的封閉實體面；負面積為無邊界之外表面 (Exterior face)；零或微小面積為懸空天線線段。
 *    - 支援獨立圓形圖元以及內孔/島嶼 (Islands/Voids) 嵌套檢測。
 * 3. computeSketchProfiles(entities, tolerance):
 *    - 串聯 buildGraph -> findFaces 的高階拓撲分析工具管線。
 * 4. 防抖 (Debounced) 更新機制:
 *    - useSketchTopology(sketchId, debounceMs): React Hook，防抖監聽 Zustand 中的 entities 更新並同步計算 profiles。
 *    - useAutoSketchProfilesSync(debounceMs): 全域 React Hook，自動保持 featureTree 中所有草圖特徵的 profiles 處於最新狀態。
 *    - debouncedComputeAndStoreProfiles(sketchId, entities, debounceMs, tolerance, onComplete): 支援取消的防抖工具函式。
 *    - updateSketchProfilesInStore(sketchId, entities, tolerance): 即時同步寫入 Zustand store。
 */

import { useState, useEffect, useRef } from 'react';
import {
  CADEntity2D,
  LineEntity,
  ArcEntity,
  CircleEntity,
  PolylineEntity,
  Point2D,
  SketchProfile,
  SketchFeature
} from '../../types/cad.ts';
import { useCadStore } from '../../contexts/index.ts';

// ============================================================================
// 1. Types & Topology Graph Data Structures
// ============================================================================

export interface TopologyNode {
  id: string;
  point: Point2D;
  /** List of outgoing half-edge IDs sorted in counter-clockwise order */
  outgoingEdgeIds: string[];
}

export interface TopologyEdge {
  id: string;
  nodeA: string;
  nodeB: string;
  entityId: string;
  entityType: 'line' | 'arc' | 'polyline_seg';
  length: number;
  halfEdgeFwdId: string;
  halfEdgeRevId: string;
}

export interface TopologyHalfEdge {
  id: string;
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  entityId: string;
  entityType: 'line' | 'arc' | 'polyline_seg';
  isReversed: boolean;
  /** Normalized outgoing polar angle in radians [0, 2π) */
  angle: number;
  /** Discretized coordinates from fromNode to toNode along the geometry */
  points: Point2D[];
  twinId: string;
  visited?: boolean;
}

export interface TopologyGraph {
  nodes: Map<string, TopologyNode>;
  edges: TopologyEdge[];
  halfEdges: Map<string, TopologyHalfEdge>;
  tolerance: number;
  /** Standalone circles that constitute full closed profiles */
  isolatedCircles: CircleEntity[];
}

// ============================================================================
// 2. Geometric Math Utilities
// ============================================================================

/**
 * Normalizes an angle in radians to the canonical interval [0, 2π).
 */
export function normalizeAngle(rad: number): number {
  const twoPi = 2 * Math.PI;
  return ((rad % twoPi) + twoPi) % twoPi;
}

/**
 * Finds an existing vertex within Euclidean distance tolerance (default 1e-5),
 * or creates and registers a new vertex node in the graph.
 */
export function findOrCreateNode(
  pt: Point2D,
  nodes: Map<string, TopologyNode>,
  tolerance: number = 1e-5
): string {
  for (const node of nodes.values()) {
    const dist = Math.hypot(node.point.x - pt.x, node.point.y - pt.y);
    if (dist <= tolerance) {
      return node.id;
    }
  }

  const id = `node_${nodes.size}`;
  nodes.set(id, {
    id,
    point: { x: pt.x, y: pt.y },
    outgoingEdgeIds: []
  });
  return id;
}

/**
 * Discretizes points along an arc curve with analytical departure tangents.
 */
export function sampleArcPoints(arc: ArcEntity): {
  startPt: Point2D;
  endPt: Point2D;
  forwardPoints: Point2D[];
  startTangent: number;
  endTangent: number;
  sweep: number;
} {
  const isCCW = arc.counterClockwise !== false;
  let startA = arc.startAngle;
  let endA = arc.endAngle;

  let sweep: number;
  if (isCCW) {
    while (endA <= startA) endA += 2 * Math.PI;
    sweep = endA - startA;
  } else {
    while (endA >= startA) endA -= 2 * Math.PI;
    sweep = startA - endA;
  }

  const startPt: Point2D = {
    x: arc.center.x + arc.radius * Math.cos(arc.startAngle),
    y: arc.center.y + arc.radius * Math.sin(arc.startAngle)
  };

  const endPt: Point2D = {
    x: arc.center.x + arc.radius * Math.cos(arc.endAngle),
    y: arc.center.y + arc.radius * Math.sin(arc.endAngle)
  };

  // Adaptive subdivision based on arc sweep angle
  const numSegments = Math.max(8, Math.min(64, Math.ceil((sweep / Math.PI) * 16)));
  const pts: Point2D[] = [];

  for (let i = 0; i <= numSegments; i++) {
    if (i === 0) {
      pts.push({ ...startPt });
      continue;
    }
    if (i === numSegments) {
      pts.push({ ...endPt });
      continue;
    }
    const t = i / numSegments;
    const ang = isCCW ? startA + t * sweep : startA - t * sweep;
    pts.push({
      x: arc.center.x + arc.radius * Math.cos(ang),
      y: arc.center.y + arc.radius * Math.sin(ang)
    });
  }

  // Analytical departure tangent angle leaving startPt along forward direction:
  const startTangent = normalizeAngle(
    isCCW ? arc.startAngle + Math.PI / 2 : arc.startAngle - Math.PI / 2
  );

  // Analytical departure tangent angle leaving endPt along reverse direction (towards startPt):
  const endTangent = normalizeAngle(
    isCCW ? arc.endAngle - Math.PI / 2 : arc.endAngle + Math.PI / 2
  );

  return {
    startPt,
    endPt,
    forwardPoints: pts,
    startTangent,
    endTangent,
    sweep
  };
}

/**
 * Ray-casting algorithm: determines whether a test point is strictly inside a 2D polygon.
 */
export function isPointInPolygon(pt: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  const n = polygon.length;
  if (n < 3) return false;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}

// ============================================================================
// 3. buildGraph (Extraction of Nodes & Edges, Tolerance Merging)
// ============================================================================

/**
 * Builds a planar topology graph from 2D CAD sketch entities:
 * - Filters out construction lines (reference geometry only, per CAD standards).
 * - Extracts vertices (Nodes) and undirected/directed edges from lines, arcs, and polyline segments.
 * - Merges coincident points within tolerance (default 1e-5).
 * - Generates pairs of directed half-edges with outward tangent angles.
 * - Sorts all outgoing half-edges at each node in counter-clockwise order.
 */
export function buildGraph(
  entities: CADEntity2D[],
  tolerance: number = 1e-5
): TopologyGraph {
  const nodes = new Map<string, TopologyNode>();
  const edges: TopologyEdge[] = [];
  const halfEdges = new Map<string, TopologyHalfEdge>();
  const isolatedCircles: CircleEntity[] = [];

  let edgeCounter = 0;

  const registerEdge = (
    entityId: string,
    entityType: 'line' | 'arc' | 'polyline_seg',
    startPt: Point2D,
    endPt: Point2D,
    forwardPts: Point2D[],
    explicitFwdAngle?: number,
    explicitRevAngle?: number
  ) => {
    const rawLen = Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y);

    // Merge coincident endpoints within tolerance
    const u = findOrCreateNode(startPt, nodes, tolerance);
    const v = findOrCreateNode(endPt, nodes, tolerance);

    // Skip degenerate edge if endpoints collapse into the same node
    if (u === v) return;

    const edgeId = `edge_${edgeCounter++}`;
    const fwdId = `${edgeId}_fwd`;
    const revId = `${edgeId}_rev`;

    // Forward outgoing tangent angle leaving u towards v
    const fwdAngle =
      explicitFwdAngle !== undefined
        ? explicitFwdAngle
        : normalizeAngle(
            Math.atan2(forwardPts[1].y - forwardPts[0].y, forwardPts[1].x - forwardPts[0].x)
          );

    const reversedPts = [...forwardPts].reverse();

    // Reverse outgoing tangent angle leaving v towards u
    const revAngle =
      explicitRevAngle !== undefined
        ? explicitRevAngle
        : normalizeAngle(
            Math.atan2(reversedPts[1].y - reversedPts[0].y, reversedPts[1].x - reversedPts[0].x)
          );

    const fwdHalfEdge: TopologyHalfEdge = {
      id: fwdId,
      edgeId,
      fromNodeId: u,
      toNodeId: v,
      entityId,
      entityType,
      isReversed: false,
      angle: fwdAngle,
      points: forwardPts,
      twinId: revId,
      visited: false
    };

    const revHalfEdge: TopologyHalfEdge = {
      id: revId,
      edgeId,
      fromNodeId: v,
      toNodeId: u,
      entityId,
      entityType,
      isReversed: true,
      angle: revAngle,
      points: reversedPts,
      twinId: fwdId,
      visited: false
    };

    halfEdges.set(fwdId, fwdHalfEdge);
    halfEdges.set(revId, revHalfEdge);

    nodes.get(u)!.outgoingEdgeIds.push(fwdId);
    nodes.get(v)!.outgoingEdgeIds.push(revId);

    edges.push({
      id: edgeId,
      nodeA: u,
      nodeB: v,
      entityId,
      entityType,
      length: rawLen,
      halfEdgeFwdId: fwdId,
      halfEdgeRevId: revId
    });
  };

  for (const entity of entities) {
    // In SolidWorks and AutoCAD, construction geometry does not participate in solid feature boundaries
    if (entity.isConstruction) continue;

    if (entity.type === 'line') {
      const line = entity as LineEntity;
      const fwdAngle = normalizeAngle(
        Math.atan2(line.end.y - line.start.y, line.end.x - line.start.x)
      );
      const revAngle = normalizeAngle(
        Math.atan2(line.start.y - line.end.y, line.start.x - line.end.x)
      );

      registerEdge(
        line.id,
        'line',
        line.start,
        line.end,
        [line.start, line.end],
        fwdAngle,
        revAngle
      );
    } else if (entity.type === 'arc') {
      const arc = entity as ArcEntity;
      const sampled = sampleArcPoints(arc);

      // Check if arc forms a full 360-degree circle
      if (
        Math.hypot(sampled.endPt.x - sampled.startPt.x, sampled.endPt.y - sampled.startPt.y) <= tolerance &&
        sampled.sweep >= 2 * Math.PI - 1e-4
      ) {
        isolatedCircles.push({
          id: arc.id,
          type: 'circle',
          layer: arc.layer,
          state: arc.state,
          isConstruction: false,
          center: arc.center,
          radius: arc.radius
        });
      } else {
        registerEdge(
          arc.id,
          'arc',
          sampled.startPt,
          sampled.endPt,
          sampled.forwardPoints,
          sampled.startTangent,
          sampled.endTangent
        );
      }
    } else if (entity.type === 'circle') {
      isolatedCircles.push(entity as CircleEntity);
    } else if (entity.type === 'polyline') {
      const poly = entity as PolylineEntity;
      const verts = poly.vertices;
      if (verts && verts.length >= 2) {
        const segCount = poly.isClosed ? verts.length : verts.length - 1;
        for (let i = 0; i < segCount; i++) {
          const v1 = verts[i].point;
          const v2 = verts[(i + 1) % verts.length].point;
          registerEdge(poly.id, 'polyline_seg', v1, v2, [v1, v2]);
        }
      }
    }
  }

  // Sort outgoing half-edges counter-clockwise at each node
  for (const node of nodes.values()) {
    node.outgoingEdgeIds.sort((idA, idB) => {
      const edgeA = halfEdges.get(idA)!;
      const edgeB = halfEdges.get(idB)!;
      return edgeA.angle - edgeB.angle;
    });
  }

  return {
    nodes,
    edges,
    halfEdges,
    tolerance,
    isolatedCircles
  };
}

// ============================================================================
// 4. findFaces (Left-Most Turn & Shoelace Area Algorithm)
// ============================================================================

/**
 * Finds all closed profiles (faces) in the planar topology graph:
 * - Uses the DCEL Left-most Turn (Minimum Interior Angle) algorithm:
 *   When traversing from u -> v along half-edge e, twin(e) leaves v towards u.
 *   Rotating clockwise around node v starting from twin(e) gives the first outgoing edge on your left.
 *   In the CCW-sorted outgoing list, this is precisely `(twinIdx - 1 + N) % N`.
 * - Computes polygon signed area using the Shoelace formula.
 * - Positive signed area identifies bounded interior profiles; negative signed area (outer unbounded face) is discarded.
 * - Integrates standalone full circles.
 * - Detects islands/voids (profiles enclosed inside other profiles).
 */
export function findFaces(graph: TopologyGraph): SketchProfile[] {
  const profiles: SketchProfile[] = [];
  const visitedHalfEdges = new Set<string>();

  let profileIndex = 1;

  for (const startEdge of graph.halfEdges.values()) {
    if (visitedHalfEdges.has(startEdge.id)) continue;

    const path: TopologyHalfEdge[] = [];
    const pathSet = new Set<string>();
    let curr: TopologyHalfEdge | undefined = startEdge;
    let cycleFound = false;
    let cycleStartIdx = -1;

    while (curr && !pathSet.has(curr.id)) {
      pathSet.add(curr.id);
      path.push(curr);

      const targetNode = graph.nodes.get(curr.toNodeId);
      if (!targetNode) break;

      const twin = graph.halfEdges.get(curr.twinId);
      if (!twin) break;

      const outgoing = targetNode.outgoingEdgeIds
        .map((id) => graph.halfEdges.get(id)!)
        .filter(Boolean);

      if (outgoing.length === 0) break;

      // Find twin's index in the CCW-sorted outgoing list of targetNode
      const twinIdx = outgoing.findIndex((e) => e.id === twin.id);
      if (twinIdx === -1) break;

      // Left-most turn in Cartesian plane: take the edge immediately clockwise from twin
      const nextIdx = (twinIdx - 1 + outgoing.length) % outgoing.length;
      const nextEdge = outgoing[nextIdx];

      if (pathSet.has(nextEdge.id)) {
        cycleFound = true;
        cycleStartIdx = path.findIndex((e) => e.id === nextEdge.id);
        break;
      }

      curr = nextEdge;
    }

    // Mark traversed edges so we avoid infinite retries
    for (const e of path) {
      visitedHalfEdges.add(e.id);
    }

    if (cycleFound && cycleStartIdx !== -1) {
      const cycleEdges = path.slice(cycleStartIdx);
      if (cycleEdges.length >= 2) {
        // Collect stitched contour points along the cycle
        const contourPoints: Point2D[] = [];
        const entityIds: string[] = [];

        for (const edge of cycleEdges) {
          entityIds.push(edge.entityId);
          // Append points excluding the last duplicate coordinate
          for (let i = 0; i < edge.points.length - 1; i++) {
            contourPoints.push(edge.points[i]);
          }
        }

        if (contourPoints.length >= 3) {
          // Close the polygon
          contourPoints.push({ ...contourPoints[0] });

          // Calculate signed area using Shoelace formula
          let signedArea = 0;
          for (let i = 0; i < contourPoints.length - 1; i++) {
            const p1 = contourPoints[i];
            const p2 = contourPoints[i + 1];
            signedArea += p1.x * p2.y - p2.x * p1.y;
          }
          signedArea *= 0.5;

          // Positive signed area = Counter-Clockwise Bounded Interior Face!
          // (Negative signed area corresponds to the infinite exterior face)
          if (signedArea > 1e-4) {
            profiles.push({
              id: `profile_${profileIndex++}`,
              contourEntityIds: Array.from(new Set(entityIds)),
              isIsland: false,
              area: Math.round(signedArea * 100) / 100,
              points: contourPoints
            });
          }
        }
      }
    }
  }

  // Process standalone full circles
  for (const circle of graph.isolatedCircles) {
    const area = Math.PI * circle.radius * circle.radius;
    // Generate sampled boundary points for 3D extrusion/triangulation
    const circlePoints: Point2D[] = [];
    const segments = 48;
    for (let i = 0; i <= segments; i++) {
      const ang = (i / segments) * 2 * Math.PI;
      circlePoints.push({
        x: circle.center.x + circle.radius * Math.cos(ang),
        y: circle.center.y + circle.radius * Math.sin(ang)
      });
    }

    profiles.push({
      id: `profile_circle_${profileIndex++}`,
      contourEntityIds: [circle.id],
      isIsland: false,
      area: Math.round(area * 100) / 100,
      points: circlePoints
    });
  }

  // Detect interior islands/holes (voids enclosed inside larger profiles)
  for (let i = 0; i < profiles.length; i++) {
    for (let j = 0; j < profiles.length; j++) {
      if (i === j) continue;
      const pOuter = profiles[i];
      const pInner = profiles[j];

      if (
        pOuter.area &&
        pInner.area &&
        pOuter.area > pInner.area &&
        pOuter.points &&
        pInner.points &&
        pInner.points.length > 0
      ) {
        // Test if a representative point of pInner is inside pOuter
        const testPt = pInner.points[0];
        if (isPointInPolygon(testPt, pOuter.points)) {
          pInner.isIsland = true;
        }
      }
    }
  }

  return profiles;
}

// ============================================================================
// 5. Convenience Pipeline & Direct Store Sync
// ============================================================================

/**
 * Direct pipeline: builds graph from entities and solves all closed profiles.
 */
export function computeSketchProfiles(
  entities: CADEntity2D[],
  tolerance: number = 1e-5
): SketchProfile[] {
  const graph = buildGraph(entities, tolerance);
  return findFaces(graph);
}

/**
 * Calculates sketch profiles from entities and directly commits them to the Zustand store.
 */
export function updateSketchProfilesInStore(
  sketchId: string,
  entities: CADEntity2D[],
  tolerance: number = 1e-5
): SketchProfile[] {
  const profiles = computeSketchProfiles(entities, tolerance);
  const state = useCadStore.getState();
  state.setSketchProfiles(sketchId, profiles);
  return profiles;
}

/**
 * Debounced utility function: computes sketch profiles and commits them to Zustand store.
 * Returns a cancel function.
 */
let globalDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export function debouncedComputeAndStoreProfiles(
  sketchId: string,
  entities: CADEntity2D[],
  debounceMs: number = 150,
  tolerance: number = 1e-5,
  onComplete?: (profiles: SketchProfile[]) => void
): () => void {
  if (globalDebounceTimer) {
    clearTimeout(globalDebounceTimer);
  }

  globalDebounceTimer = setTimeout(() => {
    const profiles = updateSketchProfilesInStore(sketchId, entities, tolerance);
    onComplete?.(profiles);
    globalDebounceTimer = null;
  }, debounceMs);

  return () => {
    if (globalDebounceTimer) {
      clearTimeout(globalDebounceTimer);
      globalDebounceTimer = null;
    }
  };
}

// ============================================================================
// 6. Debounced React Hooks (useSketchTopology & useAutoSketchProfilesSync)
// ============================================================================

/**
 * React Hook: Watches sketch entities in the Zustand global store with debounce (default 150ms).
 * Automatically computes closed profiles and writes them into sketch.profiles in the Zustand store
 * so they are immediately available for the 3D FeatureManager DAG tree and Boss/Cut extrusions.
 */
export function useSketchTopology(
  sketchId: string | null,
  debounceMs: number = 150
): SketchProfile[] {
  const sketch = useCadStore((s) => {
    if (!sketchId) return null;
    return s.document.featureTree.find(
      (f) => f.id === sketchId && f.type === 'sketch'
    ) as SketchFeature | undefined;
  });

  const setSketchProfiles = useCadStore((s) => s.setSketchProfiles);
  const entities = sketch?.entities;
  const existingProfiles = sketch?.profiles || [];

  const [profiles, setProfiles] = useState<SketchProfile[]>(existingProfiles);
  const prevProfilesRef = useRef<SketchProfile[]>(existingProfiles);

  useEffect(() => {
    if (!sketchId || !entities || entities.length === 0) {
      if (prevProfilesRef.current.length > 0) {
        prevProfilesRef.current = [];
        setProfiles([]);
        if (setSketchProfiles && sketchId) {
          setSketchProfiles(sketchId, []);
        }
      }
      return;
    }

    const timer = setTimeout(() => {
      const calculated = computeSketchProfiles(entities);

      // Check if profiles genuinely changed to prevent infinite re-renders
      const prev = prevProfilesRef.current;
      const isDifferent =
        calculated.length !== prev.length ||
        calculated.some((p, idx) => {
          const ep = prev[idx];
          if (!ep) return true;
          return (
            ep.area !== p.area ||
            ep.isIsland !== p.isIsland ||
            ep.contourEntityIds.length !== p.contourEntityIds.length ||
            ep.contourEntityIds.some((id, i) => id !== p.contourEntityIds[i])
          );
        });

      if (isDifferent) {
        prevProfilesRef.current = calculated;
        setProfiles(calculated);
        if (setSketchProfiles) {
          setSketchProfiles(sketchId, calculated);
        }
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [sketchId, entities, debounceMs, setSketchProfiles]);

  return profiles;
}

/**
 * Global React Hook: Automatically keeps profiles synchronized for all sketch features in the
 * active CAD document. Ideal for invocation at root App level to ensure 3D features and the DAG
 * tree always reflect updated 2D closed contours even if 2D canvas is unmounted.
 */
export function useAutoSketchProfilesSync(debounceMs: number = 150): void {
  const featureTree = useCadStore((s) => s.document.featureTree);
  const setSketchProfiles = useCadStore((s) => s.setSketchProfiles);

  useEffect(() => {
    const sketchFeatures = featureTree.filter(
      (f) => f.type === 'sketch'
    ) as SketchFeature[];

    const timer = setTimeout(() => {
      for (const sketch of sketchFeatures) {
        const calculated = computeSketchProfiles(sketch.entities);
        setSketchProfiles(sketch.id, calculated);
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [featureTree, debounceMs, setSketchProfiles]);
}
