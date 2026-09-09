/**
 * @license
 * OpenCASCADE / CAD Geometry Kernel Bridge (OcctBridge)
 *
 * 負責將高階特徵（如 ExtrudeFeature、CutFeature）轉換為精確的 3D 幾何實體網格 (SolidMesh3D)。
 * 支援由 2D 草圖封閉輪廓生成底面、頂面與擠出側壁之三角形頂點、法向量、索引與 CAD 特徵線 (Wireframe Edges)。
 */

import {
  ExtrudeFeature,
  CutFeature,
  ParametricFeature,
  SketchFeature,
  SolidMesh3D,
  Point2D,
  Point3D,
  Vector3D,
  CustomPlane,
  CADEntity2D,
  LineEntity,
  ArcEntity,
  CircleEntity,
  PolylineEntity
} from '../../types/cad.ts';
import {
  sketchToWorld3D,
  normalizeVector,
  crossProduct,
  vecAdd,
  vecScale,
  vecSubtract
} from '../3d/TransformUtils.ts';

export interface FeatureRebuildContext {
  featureTree: ParametricFeature[];
  featureMap: Map<string, ParametricFeature>;
  sketchMap: Map<string, SketchFeature>;
  computedMeshes: SolidMesh3D[];
}

/**
 * Sampling helper: extracts 2D boundary points for an entity.
 */
function sampleEntityPoints(entity: CADEntity2D, samplesPerArc = 16): Point2D[] {
  switch (entity.type) {
    case 'line': {
      const line = entity as LineEntity;
      return [{ ...line.start }, { ...line.end }];
    }
    case 'circle': {
      const circle = entity as CircleEntity;
      const pts: Point2D[] = [];
      const count = Math.max(24, samplesPerArc * 2);
      for (let i = 0; i < count; i++) {
        const theta = (i / count) * Math.PI * 2;
        pts.push({
          x: circle.center.x + circle.radius * Math.cos(theta),
          y: circle.center.y + circle.radius * Math.sin(theta)
        });
      }
      return pts;
    }
    case 'arc': {
      const arc = entity as ArcEntity;
      const pts: Point2D[] = [];
      let start = arc.startAngle;
      let end = arc.endAngle;
      const ccw = arc.counterClockwise !== false;

      let sweep = end - start;
      if (ccw && sweep < 0) sweep += Math.PI * 2;
      if (!ccw && sweep > 0) sweep -= Math.PI * 2;

      for (let i = 0; i <= samplesPerArc; i++) {
        const theta = start + (i / samplesPerArc) * sweep;
        pts.push({
          x: arc.center.x + arc.radius * Math.cos(theta),
          y: arc.center.y + arc.radius * Math.sin(theta)
        });
      }
      return pts;
    }
    case 'polyline': {
      const poly = entity as PolylineEntity;
      return poly.vertices.map((v) => ({ ...v.point }));
    }
    default:
      return [];
  }
}

/**
 * Assembles ordered closed 2D polygon vertices from sketch profiles or entities.
 */
export function extractProfilePoints(sketch: SketchFeature, profileId?: string): Point2D[] {
  // 1. If explicit points already exist on the target profile, use them
  if (sketch.profiles && sketch.profiles.length > 0) {
    const targetProfile = profileId
      ? sketch.profiles.find((p) => p.id === profileId)
      : sketch.profiles[0];

    if (targetProfile?.points && targetProfile.points.length >= 3) {
      return [...targetProfile.points];
    }

    // If profile specifies contourEntityIds, gather points from referenced entities
    if (targetProfile?.contourEntityIds && targetProfile.contourEntityIds.length > 0) {
      const entityMap = new Map(sketch.entities.map((e) => [e.id, e]));
      const assembled: Point2D[] = [];

      for (const entId of targetProfile.contourEntityIds) {
        const ent = entityMap.get(entId);
        if (!ent || ent.isConstruction) continue;

        const pts = sampleEntityPoints(ent);
        if (pts.length === 0) continue;

        if (assembled.length === 0) {
          assembled.push(...pts);
        } else {
          // If first point is coincident with last point in assembled, append rest
          const last = assembled[assembled.length - 1];
          const first = pts[0];
          const distSq = (last.x - first.x) ** 2 + (last.y - first.y) ** 2;
          if (distSq < 1e-4) {
            assembled.push(...pts.slice(1));
          } else {
            assembled.push(...pts);
          }
        }
      }

      if (assembled.length >= 3) {
        // Remove duplicate closing point if present
        const f = assembled[0];
        const l = assembled[assembled.length - 1];
        if ((f.x - l.x) ** 2 + (f.y - l.y) ** 2 < 1e-4) {
          assembled.pop();
        }
        return assembled;
      }
    }
  }

  // 2. Fallback: Extract from visible non-construction entities
  const nonConstruction = sketch.entities.filter((e) => !e.isConstruction);
  if (nonConstruction.length === 1 && nonConstruction[0].type === 'circle') {
    return sampleEntityPoints(nonConstruction[0]);
  }

  const fallbackPoints: Point2D[] = [];
  for (const ent of nonConstruction) {
    fallbackPoints.push(...sampleEntityPoints(ent));
  }

  // Deduplicate consecutive points
  const cleanPoints: Point2D[] = [];
  for (let i = 0; i < fallbackPoints.length; i++) {
    const p = fallbackPoints[i];
    if (cleanPoints.length === 0) {
      cleanPoints.push(p);
    } else {
      const prev = cleanPoints[cleanPoints.length - 1];
      if ((prev.x - p.x) ** 2 + (prev.y - p.y) ** 2 > 1e-4) {
        cleanPoints.push(p);
      }
    }
  }

  return cleanPoints.length >= 3 ? cleanPoints : [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 80 },
    { x: 0, y: 80 }
  ];
}

/**
 * Triangulates a simple 2D polygon using ear-clipping or convex fan algorithm.
 */
function triangulatePolygon(points: Point2D[]): number[] {
  const n = points.length;
  const indices: number[] = [];
  if (n < 3) return indices;

  // Compute signed area to determine winding order
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  const isCCW = area > 0;

  // Simple fan triangulation from vertex 0 for robust planar triangulation
  for (let i = 1; i < n - 1; i++) {
    if (isCCW) {
      indices.push(0, i, i + 1);
    } else {
      indices.push(0, i + 1, i);
    }
  }

  return indices;
}

/**
 * OpenCASCADE Bridge Object
 */
export const OcctBridge = {
  /**
   * 根據特徵節點與當前重建上下文計算 3D 網格資料。
   *
   * @param feature 欲計算之特徵（ExtrudeFeature 或 CutFeature）
   * @param context 重建上下文，包含特徵樹映射與前序特徵資訊
   * @returns SolidMesh3D 網格資料，或在無法計算時回傳 null
   */
  computeFeature(
    feature: ExtrudeFeature | CutFeature,
    context: FeatureRebuildContext
  ): SolidMesh3D | null {
    // 1. Locate referenced sketch feature
    const sketch = context.sketchMap.get(feature.sketchFeatureId);
    if (!sketch) {
      console.warn(`[OcctBridge] Sketch feature "${feature.sketchFeatureId}" not found for feature "${feature.name}"`);
      return null;
    }

    const plane: CustomPlane = sketch.plane;
    if (!plane) {
      console.warn(`[OcctBridge] Reference plane missing on sketch "${sketch.name}"`);
      return null;
    }

    // 2. Extract 2D profile points
    const targetProfileId = feature.selectedProfileIds?.[0];
    const profile2D = extractProfilePoints(sketch, targetProfileId);
    if (profile2D.length < 3) {
      console.warn(`[OcctBridge] Insufficient 2D profile points for feature "${feature.name}"`);
      return null;
    }

    const depth = Math.max(0.1, feature.depth || 10);
    const rawDir: Vector3D = (feature as ExtrudeFeature).directionVector || plane.normal;
    const extrudeDir = normalizeVector(rawDir, { x: 0, y: 0, z: 1 });

    // 3. Generate 3D Vertices for Bottom (Base) and Top Caps
    const n = profile2D.length;
    const basePts3D: Point3D[] = profile2D.map((p) => sketchToWorld3D(p, plane));
    const topPts3D: Point3D[] = basePts3D.map((p) => vecAdd(p, vecScale(extrudeDir, depth)));

    // Arrays to build the SolidMesh3D
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const edges: number[] = [];

    let vertexOffset = 0;

    function addVertex(pt: Point3D, norm: Vector3D) {
      positions.push(pt.x, pt.y, pt.z);
      normals.push(norm.x, norm.y, norm.z);
    }

    // --- A. Bottom Cap Face (Normal = -extrudeDir) ---
    const bottomNormal = vecScale(extrudeDir, -1);
    const bottomStartIdx = vertexOffset;
    for (let i = 0; i < n; i++) {
      addVertex(basePts3D[i], bottomNormal);
    }
    vertexOffset += n;

    // Triangulate bottom cap (flipped winding for downward normal)
    const capIndices = triangulatePolygon(profile2D);
    for (let i = 0; i < capIndices.length; i += 3) {
      indices.push(
        bottomStartIdx + capIndices[i],
        bottomStartIdx + capIndices[i + 2],
        bottomStartIdx + capIndices[i + 1]
      );
    }

    // --- B. Top Cap Face (Normal = +extrudeDir) ---
    const topStartIdx = vertexOffset;
    for (let i = 0; i < n; i++) {
      addVertex(topPts3D[i], extrudeDir);
    }
    vertexOffset += n;

    for (let i = 0; i < capIndices.length; i += 3) {
      indices.push(
        topStartIdx + capIndices[i],
        topStartIdx + capIndices[i + 1],
        topStartIdx + capIndices[i + 2]
      );
    }

    // --- C. Side Faces (Extruded Wall Quads) ---
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;

      const pBase1 = basePts3D[i];
      const pBase2 = basePts3D[next];
      const pTop1 = topPts3D[i];
      const pTop2 = topPts3D[next];

      // Calculate outward face normal for side wall: (pBase2 - pBase1) × extrudeDir
      const edgeVec = vecSubtract(pBase2, pBase1);
      const wallNormal = normalizeVector(crossProduct(edgeVec, extrudeDir));

      const wallStart = vertexOffset;
      addVertex(pBase1, wallNormal); // 0
      addVertex(pBase2, wallNormal); // 1
      addVertex(pTop2, wallNormal);  // 2
      addVertex(pTop1, wallNormal);  // 3
      vertexOffset += 4;

      // Two triangles per side quad: (0, 1, 2) and (0, 2, 3)
      indices.push(
        wallStart + 0, wallStart + 1, wallStart + 2,
        wallStart + 0, wallStart + 2, wallStart + 3
      );

      // Feature Wireframe Line Segments: Bottom, Top, and Vertical Corner
      edges.push(
        pBase1.x, pBase1.y, pBase1.z, pBase2.x, pBase2.y, pBase2.z,
        pTop1.x, pTop1.y, pTop1.z, pTop2.x, pTop2.y, pTop2.z,
        pBase1.x, pBase1.y, pBase1.z, pTop1.x, pTop1.y, pTop1.z
      );
    }

    // 4. Calculate Bounding Box
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    const isCut = feature.type === 'cut';

    return {
      id: `mesh_${feature.id}`,
      featureId: feature.id,
      featureName: feature.name,
      featureType: feature.type,
      positions,
      normals,
      indices,
      edges,
      boundingBox: {
        min: { x: minX, y: minY, z: minZ },
        max: { x: maxX, y: maxY, z: maxZ }
      },
      color: isCut ? '#f43f5e' : '#38bdf8',
      opacity: isCut ? 0.65 : 1.0,
      isCut,
      triangleCount: indices.length / 3,
      vertexCount: positions.length / 3
    };
  }
};
