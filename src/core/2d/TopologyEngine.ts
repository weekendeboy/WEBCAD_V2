/**
 * @license
 * 2D Sketch Topology Engine (AutoCAD 2D + SolidWorks 3D Parametric)
 *
 * Provides:
 * 1. buildGraph(entities, tolerance):
 *    Extracts Nodes & Edges from lines and arcs, merging coincident vertices within tolerance (default 1e-5).
 * 2. findFaces(graph):
 *    Traverses planar half-edges using the Left-most Turn (Minimum Interior Angle) algorithm to discover
 *    all closed profiles (faces) and calculates their polygon area via the Shoelace formula.
 * 3. computeSketchProfiles(entities):
 *    Convenience pipeline connecting buildGraph -> findFaces with hole/island detection.
 * 4. useSketchTopology(sketchId, debounceMs):
 *    Debounced React Hook that watches entities in Zustand store and updates sketch.profiles automatically.
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
// Types & Graph Representation
// ============================================================================

export interface TopologyNode {
  id: string;
  point: Point2D;
  outgoingEdgeIds: string[];
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
  /** Discretized points along this directed half-edge (from fromNode to toNode) */
  points: Point2D[];
  twinId: string;
  visited?: boolean;
}

export interface TopologyGraph {
  nodes: Map<string, TopologyNode>;
  halfEdges: Map<string, TopologyHalfEdge>;
  tolerance: number;
  /** Isolated circles that directly constitute closed profiles */
  isolatedCircles: CircleEntity[];
}

// ============================================================================
// Helper Utilities
// ============================================================================

/**
 * Normalizes an angle in radians to the range [0, 2π).
 */
export function normalizeAngle(rad: number): number {
  const twoPi = 2 * Math.PI;
  return ((rad % twoPi) + twoPi) % twoPi;
}

/**
 * Finds an existing node within distance tolerance (default 1e-5),
 * or registers a new node in the graph.
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
 * Samples discretized points along an arc curve in proper traversal direction.
 */
function sampleArcPoints(arc: ArcEntity): {
  startPt: Point2D;
  endPt: Point2D;
  forwardPoints: Point2D[];
} {
  const isCCW = arc.counterClockwise !== false;
  let startA = arc.startAngle;
  let endA = arc.endAngle;

  if (isCCW) {
    while (endA <= startA) endA += 2 * Math.PI;
  } else {
    while (endA >= startA) endA -= 2 * Math.PI;
  }

  const sweep = Math.abs(endA - startA);
  const numSegments = Math.max(8, Math.min(48, Math.ceil((sweep / Math.PI) * 16)));
  const pts: Point2D[] = [];

  for (let i = 0; i <= numSegments; i++) {
    const t = i / numSegments;
    const ang = startA + t * (endA - startA);
    pts.push({
      x: arc.center.x + arc.radius * Math.cos(ang),
      y: arc.center.y + arc.radius * Math.sin(ang)
    });
  }

  return {
    startPt: pts[0],
    endPt: pts[pts.length - 1],
    forwardPoints: pts
  };
}

/**
 * Ray-casting algorithm: tests if a test point is strictly inside a closed 2D polygon.
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
// 1. buildGraph
// ============================================================================

/**
 * Builds a planar topology graph from 2D CAD entities:
 * - Filters out construction lines (reference geometry only).
 * - Extracts vertices and edges from lines, arcs, and polyline segments.
 * - Merges coincident vertices within tolerance (default 1e-5).
 * - Generates pairs of directed half-edges with outward tangent angles.
 * - Sorts all outgoing half-edges at each node in counter-clockwise order.
 */
export function buildGraph(
  entities: CADEntity2D[],
  tolerance: number = 1e-5
): TopologyGraph {
  const nodes = new Map<string, TopologyNode>();
  const halfEdges = new Map<string, TopologyHalfEdge>();
  const isolatedCircles: CircleEntity[] = [];

  let edgeCounter = 0;

  const registerEdge = (
    entityId: string,
    entityType: 'line' | 'arc' | 'polyline_seg',
    startPt: Point2D,
    endPt: Point2D,
    forwardPts: Point2D[]
  ) => {
    // Check for degenerate edge (length <= tolerance)
    const rawLen = Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y);
    if (rawLen <= tolerance) return;

    const u = findOrCreateNode(startPt, nodes, tolerance);
    const v = findOrCreateNode(endPt, nodes, tolerance);

    if (u === v) return; // Ignore self-loop degenerate edges

    const edgeId = `edge_${edgeCounter++}`;
    const fwdId = `${edgeId}_fwd`;
    const revId = `${edgeId}_rev`;

    // Calculate forward outgoing angle at u (direction from point 0 to point 1)
    const fwdAngle = normalizeAngle(
      Math.atan2(forwardPts[1].y - forwardPts[0].y, forwardPts[1].x - forwardPts[0].x)
    );

    // Reversed points
    const reversedPts = [...forwardPts].reverse();

    // Calculate reverse outgoing angle at v (direction from point 0 to point 1 in reverse)
    const revAngle = normalizeAngle(
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
  };

  for (const entity of entities) {
    // In SolidWorks and industrial CAD, construction geometry does not participate in solid feature boundaries
    if (entity.isConstruction) continue;

    if (entity.type === 'line') {
      const line = entity as LineEntity;
      registerEdge(
        line.id,
        'line',
        line.start,
        line.end,
        [line.start, line.end]
      );
    } else if (entity.type === 'arc') {
      const arc = entity as ArcEntity;
      const sampled = sampleArcPoints(arc);
      registerEdge(
        arc.id,
        'arc',
        sampled.startPt,
        sampled.endPt,
        sampled.forwardPoints
      );
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
    halfEdges,
    tolerance,
    isolatedCircles
  };
}

// ============================================================================
// 2. findFaces (Left-Most Turn & Shoelace Area)
// ============================================================================

/**
 * Finds all closed faces (bounded profiles) in the planar topology graph:
 * - Uses the DCEL Left-most Turn (Minimum Angular Deviation) algorithm:
 *   When traversing from u -> v, the twin is v -> u.
 *   Rotating clockwise around node v starting from the twin gives the first edge to your left.
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
// 3. Convenience Pipeline
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

// ============================================================================
// 4. Debounced React Hook (useSketchTopology)
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
        if (setSketchProfiles) {
          setSketchProfiles(sketchId || '', []);
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
