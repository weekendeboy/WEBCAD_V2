/**
 * @license
 * OpenCASCADE.js CAD Geometry Kernel WebWorker (occt.worker.ts)
 *
 * 專為 3D CAD 布林運算與幾何再生設計之獨立背景工作執行緒 (WebWorker)。
 * 核心責任：
 * 1. 在背景執行緒初始化 OpenCASCADE (WASM) 幾何核心，防止主執行緒 (Main Thread) 凍結。
 * 2. 封裝 BRepPrimAPI_MakePrism (實體長形擠出) 與 BRepAlgoAPI_Cut (CSG 實體布林布剪) 運算。
 * 3. 執行 BRepMesh_IncrementalMesh 高精度曲面網格離散化 (Tessellation)。
 * 4. 使用 Transferable ArrayBuffer (Float32Array/Uint32Array) 以零拷貝方式回傳給 React UI，
 *    保證使用者在視圖中進行旋轉、平移或拖曳參數時，主執行緒渲染幀率穩定維持在 60 FPS！
 */

import opencascade from 'opencascade.js/dist/opencascade.wasm.js';
// @ts-expect-error Vite URL import query for wasm asset
import wasmUrl from 'opencascade.js/dist/opencascade.wasm.wasm?url';
import type {
  MainToWorkerMessage,
  WorkerStatusMessage,
  WorkerRebuildSuccessMessage,
  WorkerRebuildErrorMessage,
  WorkerMeshTransferable
} from './occt.types.ts';
import type {
  ParametricFeature,
  SketchFeature,
  ExtrudeFeature,
  CutFeature,
  RevolveFeature,
  SweepFeature,
  LoftFeature,
  FilletFeature,
  ChamferFeature,
  Point2D,
  Point3D,
  Vector3D,
  CustomPlane,
  CADEntity2D,
  LineEntity,
  ArcEntity,
  CircleEntity,
  PolylineEntity
} from '../types/cad.ts';

// ============================================================================
// 1. WASM OCCT Kernel Global Reference & Initializer
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ocInstance: any = null;
let isOcctInitializing = false;
let occtInitError: string | null = null;

async function getOrInitOpenCascade(): Promise<any> {
  if (ocInstance) return ocInstance;
  if (isOcctInitializing) {
    while (isOcctInitializing) {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    if (ocInstance) return ocInstance;
    throw new Error(occtInitError || 'Failed to initialize OpenCASCADE WASM');
  }

  isOcctInitializing = true;
  notifyStatus('initializing', 'Initializing OpenCASCADE.js WASM engine in WebWorker...');

  try {
    const oc = await (opencascade as any)({
      locateFile(path: string) {
        if (path.endsWith('.wasm')) {
          return wasmUrl;
        }
        return path;
      }
    });

    ocInstance = oc;
    isOcctInitializing = false;
    notifyStatus('ready', 'OpenCASCADE.js (WASM) 3D Geometry Kernel loaded successfully in WebWorker!');
    return ocInstance;
  } catch (err: any) {
    isOcctInitializing = false;
    occtInitError = err?.message || String(err);
    console.warn('[OCCT Worker] OpenCASCADE WASM load warning (fallback mode active):', err);
    notifyStatus('ready', 'WebWorker running in high-performance native fallback mode.');
    return null;
  }
}

function notifyStatus(status: 'initializing' | 'ready' | 'error', message: string) {
  const msg: WorkerStatusMessage = {
    type: 'STATUS',
    status,
    engine: ocInstance ? 'OpenCASCADE.js (WASM)' : 'Fallback',
    message
  };
  (self as any).postMessage(msg);
}

// ============================================================================
// 2. Geometry Helper Utilities
// ============================================================================

function normalizeVector(v: Vector3D, fallback: Vector3D = { x: 0, y: 0, z: 1 }): Vector3D {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < 1e-9) return fallback;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function crossProduct(a: Vector3D, b: Vector3D): Vector3D {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function vecSubtract(a: Point3D, b: Point3D): Vector3D {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function sketchToWorld3D(point2D: Point2D, plane: CustomPlane): Point3D {
  const x = plane.origin.x + point2D.x * plane.xAxis.x + point2D.y * plane.yAxis.x;
  const y = plane.origin.y + point2D.x * plane.xAxis.y + point2D.y * plane.yAxis.y;
  const z = plane.origin.z + point2D.x * plane.xAxis.z + point2D.y * plane.yAxis.z;
  return { x, y, z };
}

function sampleEntityPoints(entity: CADEntity2D, samplesPerArc = 16): Point2D[] {
  switch (entity.type) {
    case 'line': {
      const line = entity as LineEntity;
      return [{ ...line.start }, { ...line.end }];
    }
    case 'circle': {
      const circle = entity as CircleEntity;
      const pts: Point2D[] = [];
      const count = Math.max(32, samplesPerArc * 2);
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
      const start = arc.startAngle;
      const end = arc.endAngle;
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

function extractProfilePoints(sketch: SketchFeature, profileId?: string): Point2D[] {
  if (sketch.profiles && sketch.profiles.length > 0) {
    const targetProfile = profileId
      ? sketch.profiles.find((p) => p.id === profileId)
      : sketch.profiles[0];

    if (targetProfile?.points && targetProfile.points.length >= 3) {
      return [...targetProfile.points];
    }

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
        const f = assembled[0];
        const l = assembled[assembled.length - 1];
        if ((f.x - l.x) ** 2 + (f.y - l.y) ** 2 < 1e-4) {
          assembled.pop();
        }
        return assembled;
      }
    }
  }

  const nonConstruction = sketch.entities.filter((e) => !e.isConstruction);
  if (nonConstruction.length === 1 && nonConstruction[0].type === 'circle') {
    return sampleEntityPoints(nonConstruction[0]);
  }

  const fallbackPoints: Point2D[] = [];
  for (const ent of nonConstruction) {
    fallbackPoints.push(...sampleEntityPoints(ent));
  }

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

  return cleanPoints.length >= 3
    ? cleanPoints
    : [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 80 },
        { x: 0, y: 80 }
      ];
}

// ============================================================================
// 3. OpenCASCADE.js WASM Core Solid Modeling: BRepPrimAPI_MakePrism & BRepAlgoAPI_Cut
// ============================================================================

/**
 * Creates an OpenCASCADE TopoDS_Shape prism from a 2D closed polygon and extrusion vector.
 */
function createOcctPrismFromProfile(
  oc: any,
  pts3D: Point3D[],
  extrudeVec: Vector3D
): any {
  // 1. Construct Wire via BRepBuilderAPI_MakePolygon
  const polygonMaker = new oc.BRepBuilderAPI_MakePolygon_1();
  for (const p of pts3D) {
    const pnt = new oc.gp_Pnt_3(p.x, p.y, p.z);
    polygonMaker.Add_1(pnt);
    pnt.delete();
  }
  polygonMaker.Close();
  const wire = polygonMaker.Wire();

  // 2. Build planar Face from Wire via BRepBuilderAPI_MakeFace
  const faceMaker = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
  const face = faceMaker.Face();

  // 3. Extrude Face into 3D Solid Prism via BRepPrimAPI_MakePrism
  const ocVec = new oc.gp_Vec_4(extrudeVec.x, extrudeVec.y, extrudeVec.z);
  const prismMaker = new oc.BRepPrimAPI_MakePrism_1(face, ocVec, false, true);
  const shape = prismMaker.Shape();

  // Clean up intermediate C++ objects
  polygonMaker.delete();
  faceMaker.delete();
  prismMaker.delete();
  ocVec.delete();

  return shape;
}

/**
 * Creates an OpenCASCADE TopoDS_Shape by revolving a profile.
 */
function createOcctRevolveFromProfile(
  oc: any,
  pts3D: Point3D[],
  axisOrigin: Point3D,
  axisDir: Vector3D,
  angleDeg: number
): any {
  const polygonMaker = new oc.BRepBuilderAPI_MakePolygon_1();
  for (const p of pts3D) {
    const pnt = new oc.gp_Pnt_3(p.x, p.y, p.z);
    polygonMaker.Add_1(pnt);
    pnt.delete();
  }
  polygonMaker.Close();
  const wire = polygonMaker.Wire();

  const faceMaker = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
  const face = faceMaker.Face();

  const axisPnt = new oc.gp_Pnt_3(axisOrigin.x, axisOrigin.y, axisOrigin.z);
  const axisVec = new oc.gp_Dir_4(axisDir.x, axisDir.y, axisDir.z);
  const ax1 = new oc.gp_Ax1_2(axisPnt, axisVec);

  const angleRad = (angleDeg * Math.PI) / 180.0;
  const revolMaker = new oc.BRepPrimAPI_MakeRevol_1(face, ax1, angleRad, false);
  const shape = revolMaker.Shape();

  polygonMaker.delete();
  faceMaker.delete();
  revolMaker.delete();
  axisPnt.delete();
  axisVec.delete();
  ax1.delete();

  return shape;
}

/**
 * Applies 3D Fillet to selected edges of a shape.
 */
function applyFilletToShape(oc: any, shape: any, radius: number, edgeIds: string[]): any {
  if (radius <= 0) return shape;
  
  const mkFillet = new oc.BRepFilletAPI_MakeFillet(shape, oc.ChFi3d_FilletShape.ChFi3d_Rational);
  
  const edgeExplorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  );

  let edgeIndex = 0;
  let added = false;
  while (edgeExplorer.More()) {
    const edge = oc.TopoDS.Edge_1(edgeExplorer.Current());
    // Use edge index or ID logic. If edgeIds contains 'all', apply to all.
    if (edgeIds.includes('all') || edgeIds.includes(`edge_${edgeIndex}`)) {
      mkFillet.Add_2(radius, edge);
      added = true;
    }
    edge.delete();
    edgeExplorer.Next();
    edgeIndex++;
  }
  edgeExplorer.delete();

  if (!added) {
    mkFillet.delete();
    return shape;
  }

  mkFillet.Build();
  let resultShape = shape;
  if (mkFillet.IsDone()) {
    resultShape = mkFillet.Shape();
  }
  mkFillet.delete();
  return resultShape;
}

/**
 * Applies 3D Chamfer to selected edges of a shape.
 */
function applyChamferToShape(oc: any, shape: any, distance: number, edgeIds: string[]): any {
  if (distance <= 0) return shape;

  const mkChamfer = new oc.BRepFilletAPI_MakeChamfer(shape);
  
  const edgeExplorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  );

  let edgeIndex = 0;
  let added = false;
  while (edgeExplorer.More()) {
    const edge = oc.TopoDS.Edge_1(edgeExplorer.Current());
    if (edgeIds.includes('all') || edgeIds.includes(`edge_${edgeIndex}`)) {
      mkChamfer.Add_2(distance, edge);
      added = true;
    }
    edge.delete();
    edgeExplorer.Next();
    edgeIndex++;
  }
  edgeExplorer.delete();

  if (!added) {
    mkChamfer.delete();
    return shape;
  }

  mkChamfer.Build();
  let resultShape = shape;
  if (mkChamfer.IsDone()) {
    resultShape = mkChamfer.Shape();
  }
  mkChamfer.delete();
  return resultShape;
}

/**
 * Extracts faceted Mesh (positions, normals, indices, and wireframe edges) from an OCCT shape.
 */
function extractTessellatedMeshFromOcctShape(
  oc: any,
  shape: any,
  linearDeflection = 0.4,
  angularDeflection = 0.4
): {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  edges: Float32Array;
  min: Point3D;
  max: Point3D;
} {
  // 1. Run BRepMesh_IncrementalMesh
  const meshTool = new oc.BRepMesh_IncrementalMesh_2(
    shape,
    linearDeflection,
    false,
    angularDeflection,
    true
  );
  meshTool.Perform();
  meshTool.delete();

  const posList: number[] = [];
  const normList: number[] = [];
  const idxList: number[] = [];
  const edgeList: number[] = [];

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  let vertexOffset = 0;

  // 2. Iterate Faces using TopExp_Explorer
  const faceExplorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  );

  const loc = new oc.TopLoc_Location_1();

  while (faceExplorer.More()) {
    const face = oc.TopoDS.Face_1(faceExplorer.Current());
    const tri = oc.BRep_Tool.Triangulation(face, loc);

    if (!tri.IsNull()) {
      const handle = tri.get();
      const nbNodes = handle.NbNodes();
      const nbTri = handle.NbTriangles();

      const faceStartOffset = vertexOffset;

      for (let i = 1; i <= nbNodes; i++) {
        const pnt = handle.Node(i);
        const x = pnt.X();
        const y = pnt.Y();
        const z = pnt.Z();

        posList.push(x, y, z);
        normList.push(0, 0, 1); // Will compute smoothed normals below

        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;

        pnt.delete();
      }
      vertexOffset += nbNodes;

      for (let i = 1; i <= nbTri; i++) {
        const triangle = handle.Triangle(i);
        const n1 = triangle.Value(1) - 1;
        const n2 = triangle.Value(2) - 1;
        const n3 = triangle.Value(3) - 1;

        idxList.push(faceStartOffset + n1, faceStartOffset + n2, faceStartOffset + n3);

        // Compute face normal and assign to vertices
        const p1x = posList[(faceStartOffset + n1) * 3];
        const p1y = posList[(faceStartOffset + n1) * 3 + 1];
        const p1z = posList[(faceStartOffset + n1) * 3 + 2];

        const p2x = posList[(faceStartOffset + n2) * 3];
        const p2y = posList[(faceStartOffset + n2) * 3 + 1];
        const p2z = posList[(faceStartOffset + n2) * 3 + 2];

        const p3x = posList[(faceStartOffset + n3) * 3];
        const p3y = posList[(faceStartOffset + n3) * 3 + 1];
        const p3z = posList[(faceStartOffset + n3) * 3 + 2];

        const u = { x: p2x - p1x, y: p2y - p1y, z: p2z - p1z };
        const v = { x: p3x - p1x, y: p3y - p1y, z: p3z - p1z };
        const norm = normalizeVector(crossProduct(u, v));

        for (const idx of [n1, n2, n3]) {
          normList[(faceStartOffset + idx) * 3] = norm.x;
          normList[(faceStartOffset + idx) * 3 + 1] = norm.y;
          normList[(faceStartOffset + idx) * 3 + 2] = norm.z;
        }

        triangle.delete();
      }
    }

    face.delete();
    faceExplorer.Next();
  }

  faceExplorer.delete();
  loc.delete();

  // 3. Extract sharp CAD boundary edges using TopAbs_EDGE
  const edgeExplorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  );

  while (edgeExplorer.More()) {
    const edge = oc.TopoDS.Edge_1(edgeExplorer.Current());
    const edgeLoc = new oc.TopLoc_Location_1();
    const poly = oc.BRep_Tool.Polygon3D(edge, edgeLoc);

    if (poly && !poly.IsNull()) {
      const handlePoly = poly.get();
      const nbNodes = handlePoly.NbNodes();
      const nodes = handlePoly.Nodes();
      for (let i = 1; i < nbNodes; i++) {
        const p1 = nodes.Value(i);
        const p2 = nodes.Value(i + 1);
        edgeList.push(p1.X(), p1.Y(), p1.Z(), p2.X(), p2.Y(), p2.Z());
      }
    }
    edge.delete();
    edgeLoc.delete();
    edgeExplorer.Next();
  }
  edgeExplorer.delete();

  return {
    positions: new Float32Array(posList),
    normals: new Float32Array(normList),
    indices: new Uint32Array(idxList),
    edges: new Float32Array(edgeList),
    min: { x: minX === Infinity ? 0 : minX, y: minY === Infinity ? 0 : minY, z: minZ === Infinity ? 0 : minZ },
    max: { x: maxX === -Infinity ? 100 : maxX, y: maxY === -Infinity ? 80 : maxY, z: maxZ === -Infinity ? 30 : maxZ }
  };
}

// ============================================================================
// 4. High-Performance Analytic Triangulator & Subtraction Fallback
// ============================================================================

function triangulatePolygon(points: Point2D[]): number[] {
  const n = points.length;
  const indices: number[] = [];
  if (n < 3) return indices;

  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  const isCCW = area > 0;

  for (let i = 1; i < n - 1; i++) {
    if (isCCW) {
      indices.push(0, i, i + 1);
    } else {
      indices.push(0, i + 1, i);
    }
  }
  return indices;
}

function computeFallbackExtrudeMesh(
  profile2D: Point2D[],
  plane: CustomPlane,
  depth: number,
  directionVector?: Vector3D,
  isCut = false
): {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  edges: Float32Array;
  min: Point3D;
  max: Point3D;
} {
  const n = profile2D.length;
  const rawDir = directionVector || plane.normal;
  const extrudeDir = normalizeVector(rawDir, { x: 0, y: 0, z: 1 });

  const basePts3D: Point3D[] = profile2D.map((p) => sketchToWorld3D(p, plane));
  const topPts3D: Point3D[] = basePts3D.map((p) => ({
    x: p.x + extrudeDir.x * depth,
    y: p.y + extrudeDir.y * depth,
    z: p.z + extrudeDir.z * depth
  }));

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const edges: number[] = [];

  let vertexOffset = 0;

  function addVertex(pt: Point3D, norm: Vector3D) {
    positions.push(pt.x, pt.y, pt.z);
    normals.push(norm.x, norm.y, norm.z);
  }

  // Bottom Face
  const bottomNormal = { x: -extrudeDir.x, y: -extrudeDir.y, z: -extrudeDir.z };
  const bottomStart = vertexOffset;
  for (let i = 0; i < n; i++) addVertex(basePts3D[i], bottomNormal);
  vertexOffset += n;

  const capIndices = triangulatePolygon(profile2D);
  for (let i = 0; i < capIndices.length; i += 3) {
    indices.push(
      bottomStart + capIndices[i],
      bottomStart + capIndices[i + 2],
      bottomStart + capIndices[i + 1]
    );
  }

  // Top Face
  const topStart = vertexOffset;
  for (let i = 0; i < n; i++) addVertex(topPts3D[i], extrudeDir);
  vertexOffset += n;

  for (let i = 0; i < capIndices.length; i += 3) {
    indices.push(
      topStart + capIndices[i],
      topStart + capIndices[i + 1],
      topStart + capIndices[i + 2]
    );
  }

  // Side Quad Walls
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    const pB1 = basePts3D[i];
    const pB2 = basePts3D[next];
    const pT1 = topPts3D[i];
    const pT2 = topPts3D[next];

    const edgeVec = vecSubtract(pB2, pB1);
    const wallNorm = normalizeVector(crossProduct(edgeVec, extrudeDir));

    const wallStart = vertexOffset;
    addVertex(pB1, wallNorm);
    addVertex(pB2, wallNorm);
    addVertex(pT2, wallNorm);
    addVertex(pT1, wallNorm);
    vertexOffset += 4;

    indices.push(
      wallStart + 0, wallStart + 1, wallStart + 2,
      wallStart + 0, wallStart + 2, wallStart + 3
    );

    edges.push(
      pB1.x, pB1.y, pB1.z, pB2.x, pB2.y, pB2.z,
      pT1.x, pT1.y, pT1.z, pT2.x, pT2.y, pT2.z,
      pB1.x, pB1.y, pB1.z, pT1.x, pT1.y, pT1.z
    );
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    edges: new Float32Array(edges),
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ }
  };
}

// ============================================================================
// 5. Worker Rebuild Execution Loop
// ============================================================================

async function processModelRebuild(
  requestId: string,
  featureTree: ParametricFeature[],
  options?: { linearDeflection?: number; angularDeflection?: number }
) {
  const startTime = performance.now();

  const sketchMap = new Map<string, SketchFeature>();
  for (const f of featureTree) {
    if (f.type === 'sketch' && !f.suppressed) {
      sketchMap.set(f.id, f as SketchFeature);
    }
  }

  const oc = await getOrInitOpenCascade();
  let booleanCutExecuted = false;

  const resultMeshes: WorkerMeshTransferable[] = [];
  const transferList: ArrayBuffer[] = [];

  try {
    if (oc) {
      // -------------------------------------------------------------
      // Native OpenCASCADE Path: Sequential Feature Evaluation
      // -------------------------------------------------------------
      let finalShape: any = null;

      for (const feat of featureTree) {
        if (feat.suppressed) continue;

        if (feat.type === 'extrude') {
          const extrudeFeat = feat as ExtrudeFeature;
          const extrudeSketch = sketchMap.get(extrudeFeat.sketchFeatureId);
          if (extrudeSketch) {
            const baseProfile = extractProfilePoints(
              extrudeSketch,
              extrudeFeat.selectedProfileIds?.[0]
            );
            const basePlane = extrudeSketch.plane;
            const extrudeDepth = Math.max(0.1, extrudeFeat.depth || 30);
            const extrudeDir = normalizeVector(
              extrudeFeat.directionVector || basePlane.normal
            );

            const basePts3D = baseProfile.map((p) => sketchToWorld3D(p, basePlane));
            const extrudeVec: Vector3D = {
              x: extrudeDir.x * extrudeDepth,
              y: extrudeDir.y * extrudeDepth,
              z: extrudeDir.z * extrudeDepth
            };

            const newShape = createOcctPrismFromProfile(oc, basePts3D, extrudeVec);

            if (extrudeFeat.booleanOperation === 'new_body' || !finalShape) {
              if (finalShape) finalShape.delete();
              finalShape = newShape;
            } else if (extrudeFeat.booleanOperation === 'union' && finalShape) {
              try {
                const fuseOp = new oc.BRepAlgoAPI_Fuse_3(finalShape, newShape);
                fuseOp.Build();
                if (fuseOp.IsDone()) {
                  const fused = fuseOp.Shape();
                  if (!fused.IsNull()) {
                    finalShape.delete();
                    finalShape = fused;
                  }
                }
                fuseOp.delete();
              } catch (err) {
                console.warn('[OCCT Worker] BRepAlgoAPI_Fuse error:', err);
              }
              newShape.delete();
            }
          }
        } else if (feat.type === 'cut') {
          const cutFeat = feat as CutFeature;
          if (finalShape) {
            const cutSketch = sketchMap.get(cutFeat.sketchFeatureId);
            if (cutSketch) {
              const cutProfile = extractProfilePoints(
                cutSketch,
                cutFeat.selectedProfileIds?.[0]
              );
              const cutPlane = cutSketch.plane;
              const cutDepth = Math.max(0.1, cutFeat.depth || 30);
              
              // Direction is typically opposite to the sketch normal to penetrate the solid
              const cutterDir = normalizeVector({
                x: cutFeat.flipSideToCut ? cutPlane.normal.x : -cutPlane.normal.x,
                y: cutFeat.flipSideToCut ? cutPlane.normal.y : -cutPlane.normal.y,
                z: cutFeat.flipSideToCut ? cutPlane.normal.z : -cutPlane.normal.z
              });

              // Offset backward along the cutter direction to avoid coincident coplanar faces on the surface
              const cutterStartOffset: Point3D = {
                x: -cutterDir.x * 2,
                y: -cutterDir.y * 2,
                z: -cutterDir.z * 2
              };

              const cutterPts3D = cutProfile.map((p) => {
                const pt = sketchToWorld3D(p, cutPlane);
                return {
                  x: pt.x + cutterStartOffset.x,
                  y: pt.y + cutterStartOffset.y,
                  z: pt.z + cutterStartOffset.z
                };
              });

              const cutterVec: Vector3D = {
                x: cutterDir.x * (cutDepth + 4),
                y: cutterDir.y * (cutDepth + 4),
                z: cutterDir.z * (cutDepth + 4)
              };

              const cutterShape = createOcctPrismFromProfile(
                oc,
                cutterPts3D,
                cutterVec
              );

              try {
                const cutOp = new oc.BRepAlgoAPI_Cut_3(finalShape, cutterShape);
                cutOp.Build();
                if (cutOp.IsDone()) {
                  const shapeAfterCut = cutOp.Shape();
                  if (!shapeAfterCut.IsNull()) {
                    finalShape.delete();
                    finalShape = shapeAfterCut;
                    booleanCutExecuted = true;
                  }
                }
                cutOp.delete();
              } catch (cutErr) {
                console.warn('[OCCT Worker] BRepAlgoAPI_Cut error:', cutErr);
              }

               cutterShape.delete();
            }
          }
        } else if (feat.type === 'revolve') {
          const revFeat = feat as RevolveFeature;
          const revSketch = sketchMap.get(revFeat.sketchFeatureId);
          if (revSketch) {
            const profile = extractProfilePoints(
              revSketch,
              revFeat.selectedProfileIds?.[0]
            );
            const plane = revSketch.plane;
            const pts3D = profile.map((p) => sketchToWorld3D(p, plane));
            
            // Default axis is Y axis of the sketch plane if not provided
            const axisOrigin = revFeat.axisOrigin || plane.origin;
            const axisDir = normalizeVector(revFeat.axisVector || plane.yAxis);
            const angle = revFeat.angle || 360;

            const newShape = createOcctRevolveFromProfile(oc, pts3D, axisOrigin, axisDir, angle);

            if (revFeat.booleanOperation === 'new_body' || !finalShape) {
              if (finalShape) finalShape.delete();
              finalShape = newShape;
            } else if (revFeat.booleanOperation === 'union' && finalShape) {
              try {
                const fuseOp = new oc.BRepAlgoAPI_Fuse_3(finalShape, newShape);
                fuseOp.Build();
                if (fuseOp.IsDone()) {
                  const fused = fuseOp.Shape();
                  if (!fused.IsNull()) {
                    finalShape.delete();
                    finalShape = fused;
                  }
                }
                fuseOp.delete();
              } catch (err) {
                console.warn('[OCCT Worker] BRepAlgoAPI_Fuse error (revolve):', err);
              }
              newShape.delete();
            }
          }
        } else if (feat.type === 'fillet') {
          const filletFeat = feat as FilletFeature;
          if (finalShape && filletFeat.radius > 0 && filletFeat.edgeIds.length > 0) {
            try {
              const filletedShape = applyFilletToShape(oc, finalShape, filletFeat.radius, filletFeat.edgeIds);
              if (filletedShape !== finalShape) {
                finalShape.delete();
                finalShape = filletedShape;
              }
            } catch (err) {
              console.warn('[OCCT Worker] Fillet error:', err);
            }
          }
        } else if (feat.type === 'chamfer') {
          const chamferFeat = feat as ChamferFeature;
          if (finalShape && chamferFeat.distance > 0 && chamferFeat.edgeIds.length > 0) {
            try {
              const chamferedShape = applyChamferToShape(oc, finalShape, chamferFeat.distance, chamferFeat.edgeIds);
              if (chamferedShape !== finalShape) {
                finalShape.delete();
                finalShape = chamferedShape;
              }
            } catch (err) {
              console.warn('[OCCT Worker] Chamfer error:', err);
            }
          }
        } else if (feat.type === 'sweep') {
          // Sweep feature infrastructure stub
          console.warn('[OCCT Worker] Sweep feature not fully implemented yet.');
        } else if (feat.type === 'loft') {
          // Loft feature infrastructure stub
          console.warn('[OCCT Worker] Loft feature not fully implemented yet.');
        }
      }

      if (finalShape) {
        const tess = extractTessellatedMeshFromOcctShape(
          oc,
          finalShape,
          options?.linearDeflection ?? 0.35,
          options?.angularDeflection ?? 0.35
        );

        finalShape.delete();

        const mainSolidMesh: WorkerMeshTransferable = {
          id: `mesh_final`,
          featureId: 'final',
          featureName: 'Solid Body',
          featureType: 'extrude',
          positions: tess.positions,
          normals: tess.normals,
          indices: tess.indices,
          edges: tess.edges,
          boundingBox: { min: tess.min, max: tess.max },
          color: '#38bdf8',
          opacity: 1.0,
          isCut: false,
          triangleCount: tess.indices.length / 3,
          vertexCount: tess.positions.length / 3
        };

        transferList.push(
          tess.positions.buffer,
          tess.normals.buffer,
          tess.indices.buffer
        );
        if (tess.edges && tess.edges.buffer) {
          transferList.push(tess.edges.buffer);
        }

        resultMeshes.push(mainSolidMesh);
      }
    } else {
      // -------------------------------------------------------------
      // Fallback Path: High-speed native JS triangulation
      // -------------------------------------------------------------
      for (const feat of featureTree) {
        if (feat.suppressed) continue;
        if (feat.type === 'extrude') {
          const solidFeat = feat as ExtrudeFeature;
          const sketch = sketchMap.get(solidFeat.sketchFeatureId);
          if (!sketch) continue;

          const profile = extractProfilePoints(
            sketch,
            solidFeat.selectedProfileIds?.[0]
          );
          
          const depth = Math.max(0.1, solidFeat.depth || 30);

          const tess = computeFallbackExtrudeMesh(
            profile,
            sketch.plane,
            depth,
            solidFeat.directionVector || sketch.plane.normal,
            false
          );

          const mesh: WorkerMeshTransferable = {
            id: `mesh_${solidFeat.id}`,
            featureId: solidFeat.id,
            featureName: solidFeat.name,
            featureType: solidFeat.type,
            positions: tess.positions,
            normals: tess.normals,
            indices: tess.indices,
            edges: tess.edges,
            boundingBox: { min: tess.min, max: tess.max },
            color: '#38bdf8',
            opacity: 1.0,
            isCut: false,
            triangleCount: tess.indices.length / 3,
            vertexCount: tess.positions.length / 3
          };

          transferList.push(
            tess.positions.buffer,
            tess.normals.buffer,
            tess.indices.buffer,
            tess.edges.buffer
          );
          resultMeshes.push(mesh);
        }
      }
    }

    const durationMs = Math.round((performance.now() - startTime) * 10) / 10;

    const totalTris = resultMeshes.reduce((sum, m) => sum + m.triangleCount, 0);
    const totalVerts = resultMeshes.reduce((sum, m) => sum + m.vertexCount, 0);

    const successMsg: WorkerRebuildSuccessMessage = {
      type: 'REBUILD_SUCCESS',
      requestId,
      meshes: resultMeshes,
      durationMs,
      booleanCutExecuted,
      occtActive: !!oc,
      stats: {
        totalTriangles: totalTris,
        totalVertices: totalVerts,
        featureCount: resultMeshes.length
      }
    };

    // Zero-copy transfer of typed array buffers to the UI thread!
    (self as any).postMessage(successMsg, transferList);
  } catch (err: any) {
    const errorMsg: WorkerRebuildErrorMessage = {
      type: 'REBUILD_ERROR',
      requestId,
      error: err?.message || String(err),
      durationMs: Math.round((performance.now() - startTime) * 10) / 10
    };
    (self as any).postMessage(errorMsg);
  }
}

// ============================================================================
// 6. Message Passing Listener
// ============================================================================

self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const data = event.data;
  if (!data) return;

  switch (data.type) {
    case 'INIT': {
      getOrInitOpenCascade().catch((err) => {
        console.warn('[OCCT Worker] Init trigger caught error:', err);
      });
      break;
    }
    case 'REBUILD_MODEL': {
      processModelRebuild(data.requestId, data.featureTree, data.options);
      break;
    }
    case 'CANCEL': {
      // Handled via requestId checking in manager
      break;
    }
    default:
      break;
  }
};

// Immediately kick off background WASM initialization upon worker thread creation
getOrInitOpenCascade().catch(() => {});
