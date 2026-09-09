/**
 * @license
 * SolidWorks-style "Sketch on Face" Core Mathematics Library
 *
 * 核心數學庫功能：
 * 1. LocalCoordinateSystem (LCS) 局部座標系建構：
 *    - 為任意草圖 (Sketch) 建立獨立的 2D 局部座標系 (u, v)
 *    - 支援「任意斜面 (Arbitrary Inclined Face)」法向量，使用無奇異點的正交基底演算法 (Gram-Schmidt / Singularity-Free Orthonormal Basis)
 *    - 確保 X_local (u), Y_local (v), Z_local (normal) 嚴格正交且符合右手定則 (Right-Hand Rule)
 *
 * 2. 4x4 變換矩陣 (Affine Transformation Matrix)：
 *    - 構建 Local-to-World 變換矩陣 M (4x4 Column-Major，相容 WebGL / Three.js)
 *    - 構建 World-to-Local 逆變換矩陣 M^-1 (精確轉置運算，無數值求逆誤差)
 *    - 精確將 2D 草圖座標 (u, v) 映射至 3D 空間全局座標 (X, Y, Z)
 *    - 精確將 3D 全局座標正交投影回 2D 草圖局部座標 (u, v)
 *
 * 3. Raycaster 射線求交與投影：
 *    - 與 @react-three/fiber Raycaster 結合，支援點選 3D 實體表面
 *    - 計算攝影機射線與任意斜面之交點與 2D (u, v) 座標
 *    - 支援在 3D 視圖中直接在任意斜面上繪製 2D 幾何實體 (Line, Circle, Arc, Polyline)
 */

import {
  Point2D,
  Point3D,
  Vector2D,
  Vector3D,
  CustomPlane,
  CADEntity2D,
  LineEntity,
  CircleEntity,
  ArcEntity,
  PolylineEntity,
  Matrix4x4
} from '../../types/cad.ts';

const EPSILON = 1e-9;

// ============================================================================
// 1. Fundamental 3D Vector Math
// ============================================================================

export function vecLength(v: Vector3D): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function normalizeVector(v: Vector3D, fallback: Vector3D = { x: 0, y: 0, z: 1 }): Vector3D {
  const len = vecLength(v);
  if (len < EPSILON) return { ...fallback };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function dotProduct(a: Vector3D, b: Vector3D): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function crossProduct(a: Vector3D, b: Vector3D): Vector3D {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

export function vecAdd(a: Vector3D, b: Vector3D): Vector3D {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vecSubtract(a: Vector3D, b: Vector3D): Vector3D {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vecScale(v: Vector3D, s: number): Vector3D {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

// ============================================================================
// 2. LocalCoordinateSystem & 4x4 Transformation Matrices
// ============================================================================

export interface LocalCoordinateSystem {
  origin: Point3D;              // O: 3D origin in global space
  xAxis: Vector3D;               // u: Local X unit vector (Right in sketch)
  yAxis: Vector3D;               // v: Local Y unit vector (Up in sketch)
  normal: Vector3D;              // n: Local Z unit vector (Outward normal)
  matrixLocalToWorld: Matrix4x4; // 4x4 Column-Major Matrix M
  matrixWorldToLocal: Matrix4x4; // 4x4 Column-Major Inverse Matrix M^-1
  slopeAngleDegrees: number;     // Slope angle (0° = horizontal, 90° = vertical, other = inclined)
  planeEquation: { a: number; b: number; c: number; d: number }; // ax + by + cz + d = 0
}

/**
 * 建立 4x4 仿射變換矩陣 (Local Space -> Global Space)。
 *
 * 齊次座標形式：
 * M = [
 *   [ Xx, Yx, Zx, Ox ],
 *   [ Xy, Yy, Zy, Oy ],
 *   [ Xz, Yz, Zz, Oz ],
 *   [  0,  0,  0,  1 ]
 * ]
 *
 * WebGL / Three.js 預設使用 Column-Major (扁平陣列 16 元素)：
 * index:
 *  0: Xx,  1: Xy,  2: Xz,  3: 0
 *  4: Yx,  5: Yy,  6: Yz,  7: 0
 *  8: Zx,  9: Zy, 10: Zz, 11: 0
 * 12: Ox, 13: Oy, 14: Oz, 15: 1
 */
export function build4x4Matrix(
  origin: Point3D,
  xAxis: Vector3D,
  yAxis: Vector3D,
  normal: Vector3D,
  columnMajor: boolean = true
): Matrix4x4 {
  if (columnMajor) {
    return [
      xAxis.x, xAxis.y, xAxis.z, 0,
      yAxis.x, yAxis.y, yAxis.z, 0,
      normal.x, normal.y, normal.z, 0,
      origin.x, origin.y, origin.z, 1
    ];
  } else {
    return [
      xAxis.x, yAxis.x, normal.x, origin.x,
      xAxis.y, yAxis.y, normal.y, origin.y,
      xAxis.z, yAxis.z, normal.z, origin.z,
      0, 0, 0, 1
    ];
  }
}

/**
 * 建立 4x4 逆變換矩陣 (Global Space -> Local Space)。
 * 由於旋轉基底 [xAxis, yAxis, normal] 為正交陣列，其逆為其轉置 (R^-1 = R^T)，
 * 平移向量為 -R^T * Origin：
 * tx = -O • X
 * ty = -O • Y
 * tz = -O • Z
 * 數值精確無求逆誤差。
 */
export function build4x4InverseMatrix(
  origin: Point3D,
  xAxis: Vector3D,
  yAxis: Vector3D,
  normal: Vector3D,
  columnMajor: boolean = true
): Matrix4x4 {
  const tx = -(origin.x * xAxis.x + origin.y * xAxis.y + origin.z * xAxis.z);
  const ty = -(origin.x * yAxis.x + origin.y * yAxis.y + origin.z * yAxis.z);
  const tz = -(origin.x * normal.x + origin.y * normal.y + origin.z * normal.z);

  if (columnMajor) {
    return [
      xAxis.x, yAxis.x, normal.x, 0,
      xAxis.y, yAxis.y, normal.y, 0,
      xAxis.z, yAxis.z, normal.z, 0,
      tx, ty, tz, 1
    ];
  } else {
    return [
      xAxis.x, xAxis.y, xAxis.z, tx,
      yAxis.x, yAxis.y, yAxis.z, ty,
      normal.x, normal.y, normal.z, tz,
      0, 0, 0, 1
    ];
  }
}

/**
 * 計算面相對於水平面 (XZ 地面) 的傾角 (Slope Angle in Degrees)。
 * 0° = 水平面 (Top/Bottom, 法向為 Y 軸)
 * 90° = 垂直面 (Vertical Wall, 法向在 XZ 平面上)
 * 其它角度 (如 45°, 30°, 60°) = 任意斜面 (Inclined Face)
 */
export function computeSlopeAngle(normal: Vector3D): number {
  const norm = normalizeVector(normal);
  // normal dot (0, 1, 0)
  const cosTheta = Math.min(1.0, Math.max(-1.0, Math.abs(norm.y)));
  // Slope angle measured from horizontal plane:
  // if normal.y = 1, face is horizontal (slope = 0°)
  // if normal.y = 0, face is vertical (slope = 90°)
  const angleRad = Math.acos(cosTheta);
  return Math.round((angleRad * (180 / Math.PI)) * 10) / 10;
}

/**
 * 為任意斜面法向量建構無奇異點 (Singularity-Free) 的穩定正交基底 (LocalCoordinateSystem)。
 *
 * SolidWorks / CAD 空間幾何對齊慣例：
 * 1. 對於一般斜面或立面，局部 X 軸盡可能保持水平 (Parallel to XZ ground plane)，
 *    這樣使用者進入草圖時，X 軸自然朝右、Y 軸自然朝上。
 * 2. 當法向量幾乎垂直於地面 (Normal ≈ ±Y)，則切換以 +X 為基準，避免叉積接近零的奇異點。
 * 3. 嚴格確保 xAxis, yAxis, normal 互為單位向量且符合右手定則 normal = xAxis × yAxis。
 *
 * @param origin 斜面上的點 (如射線點擊點或面幾何重心)
 * @param normal 斜面的外法向量
 * @param preferredXAxis 使用者偏好的 X 軸方向（可選）
 */
export function createLocalCoordinateSystem(
  origin: Point3D,
  normal: Vector3D,
  preferredXAxis?: Vector3D
): LocalCoordinateSystem {
  const nz = normalizeVector(normal, { x: 0, y: 1, z: 0 });

  let nx: Vector3D;

  if (preferredXAxis && vecLength(preferredXAxis) > EPSILON) {
    // 投影偏好 X 軸到平面上
    const dot = dotProduct(preferredXAxis, nz);
    const projected = vecSubtract(preferredXAxis, vecScale(nz, dot));
    if (vecLength(projected) > EPSILON) {
      nx = normalizeVector(projected);
    } else {
      nx = chooseStableHorizontalAxis(nz);
    }
  } else {
    nx = chooseStableHorizontalAxis(nz);
  }

  // Y_local = Normal × X_local (保證右手定則且嚴格正交)
  const ny = normalizeVector(crossProduct(nz, nx));

  // 4x4 變換矩陣與逆矩陣
  const matrixLocalToWorld = build4x4Matrix(origin, nx, ny, nz, true);
  const matrixWorldToLocal = build4x4InverseMatrix(origin, nx, ny, nz, true);

  // 平面方程式: ax + by + cz + d = 0, 其中 d = -(O • n)
  const d = -(origin.x * nz.x + origin.y * nz.y + origin.z * nz.z);
  const slopeAngleDegrees = computeSlopeAngle(nz);

  return {
    origin: { ...origin },
    xAxis: nx,
    yAxis: ny,
    normal: nz,
    matrixLocalToWorld,
    matrixWorldToLocal,
    slopeAngleDegrees,
    planeEquation: { a: nz.x, b: nz.y, c: nz.z, d }
  };
}

/**
 * 輔助函數：為任意法向量挑選最穩定的水平基準軸 (Horizontal Axis on Plane)
 */
function chooseStableHorizontalAxis(nz: Vector3D): Vector3D {
  // 檢查是否與世界 Y 軸 (0, 1, 0) 接近共線
  const upVector = { x: 0, y: 1, z: 0 };
  const dotUp = Math.abs(dotProduct(nz, upVector));

  if (dotUp < 0.985) {
    // 非水平面 (包含任意斜面與立面)：
    // 水平軸 = World_Up × Normal
    const rawX = crossProduct(upVector, nz);
    return normalizeVector(rawX, { x: 1, y: 0, z: 0 });
  } else {
    // 接近頂面或底面 (Top/Bottom, normal ≈ ±Y)：
    // 選擇世界 X 軸為水平基準
    const ref = { x: 0, y: 0, z: nz.y > 0 ? -1 : 1 };
    const rawX = crossProduct(ref, nz);
    return normalizeVector(rawX, { x: 1, y: 0, z: 0 });
  }
}

// ============================================================================
// 3. Coordinate Transformation Algorithms (2D Local <-> 3D World)
// ============================================================================

/**
 * 將 2D 草圖局部座標 (u, v) 精確轉換為 3D 全局世界座標 (X, Y, Z)。
 *
 * 數學矩陣公式：
 * [ X ]   [ Xx  Yx  Zx  Ox ] [ u ]   [ Ox + u*Xx + v*Yx ]
 * [ Y ] = [ Xy  Yy  Zy  Oy ] [ v ] = [ Oy + u*Xy + v*Yy ]
 * [ Z ]   [ Xz  Yz  Zz  Oz ] [ 0 ]   [ Oz + u*Xz + v*Yz ]
 * [ 1 ]   [  0   0   0   1 ] [ 1 ]   [        1         ]
 */
export function sketchToWorld(
  point2D: Point2D,
  lcsOrPlane: LocalCoordinateSystem | CustomPlane
): Point3D {
  const origin = lcsOrPlane.origin;
  const xAxis = lcsOrPlane.xAxis;
  const yAxis = lcsOrPlane.yAxis;

  return {
    x: origin.x + point2D.x * xAxis.x + point2D.y * yAxis.x,
    y: origin.y + point2D.x * xAxis.y + point2D.y * yAxis.y,
    z: origin.z + point2D.x * xAxis.z + point2D.y * yAxis.z
  };
}

/**
 * 批次將 2D 草圖點陣列轉換為 3D 全局點陣列
 */
export function batchSketchToWorld(
  points2D: Point2D[],
  lcsOrPlane: LocalCoordinateSystem | CustomPlane
): Point3D[] {
  return points2D.map((p) => sketchToWorld(p, lcsOrPlane));
}

/**
 * 將 3D 全局世界座標 (X, Y, Z) 正交投影回 2D 草圖局部座標 (u, v)。
 *
 * 數學逆矩陣公式：
 * d = P_3D - Origin
 * u = d • X_local
 * v = d • Y_local
 * (若需法向距離: w = d • Normal)
 */
export function worldToSketch(
  point3D: Point3D,
  lcsOrPlane: LocalCoordinateSystem | CustomPlane
): Point2D {
  const origin = lcsOrPlane.origin;
  const xAxis = lcsOrPlane.xAxis;
  const yAxis = lcsOrPlane.yAxis;

  const dx = point3D.x - origin.x;
  const dy = point3D.y - origin.y;
  const dz = point3D.z - origin.z;

  const u = dx * xAxis.x + dy * xAxis.y + dz * xAxis.z;
  const v = dx * yAxis.x + dy * yAxis.y + dz * yAxis.z;

  return { x: u, y: v };
}

/**
 * 計算 3D 空間點至草圖平面的有號距離 (Signed Distance from Plane)
 */
export function distanceToSketchPlane(
  point3D: Point3D,
  lcsOrPlane: LocalCoordinateSystem | CustomPlane
): number {
  const origin = lcsOrPlane.origin;
  const normal = lcsOrPlane.normal;

  const dx = point3D.x - origin.x;
  const dy = point3D.y - origin.y;
  const dz = point3D.z - origin.z;

  return dx * normal.x + dy * normal.y + dz * normal.z;
}

/**
 * 將 3D 空間點正交投影至草圖平面的 3D 垂足位置
 */
export function projectPointTo3DPlane(
  point3D: Point3D,
  lcsOrPlane: LocalCoordinateSystem | CustomPlane
): Point3D {
  const dist = distanceToSketchPlane(point3D, lcsOrPlane);
  const normal = lcsOrPlane.normal;
  return {
    x: point3D.x - dist * normal.x,
    y: point3D.y - dist * normal.y,
    z: point3D.z - dist * normal.z
  };
}

// ============================================================================
// 4. Raycaster & Solid Face Intersection Utilities
// ============================================================================

export interface RayPlaneIntersectionResult {
  hitPoint3D: Point3D;     // 3D 全局空間交點
  sketchPoint2D: Point2D;   // 2D 局部草圖 (u, v) 座標
  distance: number;         // 射線原點至交點距離
}

/**
 * 計算 3D 空間射線 (Ray) 與草圖平面的精確交點，並直接換算為 2D 局部座標 (u, v)。
 *
 * 射線方程式：P(t) = RayOrigin + t * RayDirection (t >= 0)
 * 平面方程式：(P - Origin) • Normal = 0
 *
 * t = ( (Origin - RayOrigin) • Normal ) / ( RayDirection • Normal )
 */
export function intersectRayWithPlane(
  rayOrigin: Point3D,
  rayDirection: Vector3D,
  lcsOrPlane: LocalCoordinateSystem | CustomPlane
): RayPlaneIntersectionResult | null {
  const dir = normalizeVector(rayDirection);
  const normal = lcsOrPlane.normal;
  const origin = lcsOrPlane.origin;

  const denom = dotProduct(dir, normal);
  // 若射線與平面接近平行 (denom ≈ 0)，無交點
  if (Math.abs(denom) < 1e-7) {
    return null;
  }

  const p0MinusR0 = vecSubtract(origin, rayOrigin);
  const t = dotProduct(p0MinusR0, normal) / denom;

  // 若交點在射線後方 (t < 0)，無前向交點
  if (t < 0) {
    return null;
  }

  const hitPoint3D: Point3D = {
    x: rayOrigin.x + t * dir.x,
    y: rayOrigin.y + t * dir.y,
    z: rayOrigin.z + t * dir.z
  };

  const sketchPoint2D = worldToSketch(hitPoint3D, lcsOrPlane);

  return {
    hitPoint3D,
    sketchPoint2D,
    distance: t
  };
}

// ============================================================================
// 5. SolidWorks "Sketch on Face" Plane Construction
// ============================================================================

/**
 * 依據點選之實體面 (Raycast Face) 資料動態建立 CustomPlane
 *
 * @param faceOrigin 點選點或面重心
 * @param faceNormal 面的 3D 世界外法向量
 * @param name 自訂平面名稱 (如 "Face Plane - 45° Slope")
 */
export function createCustomPlaneFromFace(
  faceOrigin: Point3D,
  faceNormal: Vector3D,
  name?: string
): CustomPlane {
  const lcs = createLocalCoordinateSystem(faceOrigin, faceNormal);

  const planeId = `plane_face_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const defaultName = name || (
    lcs.slopeAngleDegrees === 0
      ? 'Horizontal Face Plane'
      : lcs.slopeAngleDegrees === 90
      ? 'Vertical Face Plane'
      : `Inclined Face Plane (${lcs.slopeAngleDegrees}°)`
  );

  return {
    id: planeId,
    name: defaultName,
    origin: lcs.origin,
    normal: lcs.normal,
    xAxis: lcs.xAxis,
    yAxis: lcs.yAxis,
    isDatum: false
  };
}

// ============================================================================
// 6. 2D CAD Entity -> 3D Render Wireframe Discretization
// ============================================================================

/**
 * 將 2D 草圖幾何圖元 (Line, Circle, Arc, Polyline) 透過 4x4 矩陣離散化為 3D 空間折線，
 * 供 Three.js 直接在 3D 任意斜面上精確渲染草圖線條！
 */
export function entity2DTo3DWire(
  entity: CADEntity2D,
  lcsOrPlane: LocalCoordinateSystem | CustomPlane
): Point3D[] {
  switch (entity.type) {
    case 'line': {
      const line = entity as LineEntity;
      return [
        sketchToWorld(line.start, lcsOrPlane),
        sketchToWorld(line.end, lcsOrPlane)
      ];
    }
    case 'circle': {
      const circle = entity as CircleEntity;
      const pts: Point3D[] = [];
      const segments = 48;
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        const p2: Point2D = {
          x: circle.center.x + circle.radius * Math.cos(theta),
          y: circle.center.y + circle.radius * Math.sin(theta)
        };
        pts.push(sketchToWorld(p2, lcsOrPlane));
      }
      return pts;
    }
    case 'arc': {
      const arc = entity as ArcEntity;
      const pts: Point3D[] = [];
      const segments = 32;
      let start = arc.startAngle;
      let end = arc.endAngle;
      const ccw = arc.counterClockwise !== false;

      let sweep = end - start;
      if (ccw && sweep < 0) sweep += Math.PI * 2;
      if (!ccw && sweep > 0) sweep -= Math.PI * 2;

      for (let i = 0; i <= segments; i++) {
        const theta = start + (i / segments) * sweep;
        const p2: Point2D = {
          x: arc.center.x + arc.radius * Math.cos(theta),
          y: arc.center.y + arc.radius * Math.sin(theta)
        };
        pts.push(sketchToWorld(p2, lcsOrPlane));
      }
      return pts;
    }
    case 'polyline': {
      const poly = entity as PolylineEntity;
      const pts = poly.vertices.map((v) => sketchToWorld(v.point, lcsOrPlane));
      if (poly.isClosed && pts.length > 0) {
        pts.push({ ...pts[0] });
      }
      return pts;
    }
    default:
      return [];
  }
}

/**
 * 依據射線點擊的法向量與採樣點，在網格幾何體中尋找所有共面三角形並計算面重心 (Face Centroid)。
 * 若無共面三角形或網格資訊不足，則平滑回退至點擊點本身。
 */
export function calculateFaceCentroid(
  positions: Float32Array | number[],
  indices: Uint32Array | number[] | undefined,
  targetNormal: Vector3D,
  hitPoint: Point3D
): Point3D {
  if (!positions || positions.length === 0) return { ...hitPoint };

  const normTarget = normalizeVector(targetNormal);
  const targetD = -(hitPoint.x * normTarget.x + hitPoint.y * normTarget.y + hitPoint.z * normTarget.z);

  const matchedVertices: Point3D[] = [];
  const vertexCount = positions.length / 3;

  // 檢查所有頂點是否落在同一平面上
  for (let i = 0; i < vertexCount; i++) {
    const vx = positions[i * 3];
    const vy = positions[i * 3 + 1];
    const vz = positions[i * 3 + 2];

    const distToPlane = Math.abs(vx * normTarget.x + vy * normTarget.y + vz * normTarget.z + targetD);
    if (distToPlane < 0.25) {
      matchedVertices.push({ x: vx, y: vy, z: vz });
    }
  }

  if (matchedVertices.length >= 3) {
    let sumX = 0, sumY = 0, sumZ = 0;
    for (const v of matchedVertices) {
      sumX += v.x;
      sumY += v.y;
      sumZ += v.z;
    }
    return {
      x: Math.round((sumX / matchedVertices.length) * 100) / 100,
      y: Math.round((sumY / matchedVertices.length) * 100) / 100,
      z: Math.round((sumZ / matchedVertices.length) * 100) / 100
    };
  }

  return { ...hitPoint };
}
