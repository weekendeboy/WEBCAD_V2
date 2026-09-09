/**
 * @license
 * 3D Spatial Transformation & Reference Plane Utilities
 *
 * 負責將 2D 草圖轉換至 3D 空間，並支援在 3D 實體特徵面上建立草圖。
 *
 * 核心功能：
 * 1. getPlaneMatrix(plane: CustomPlane):
 *    根據 CustomPlane 的 origin, normal, xAxis, yAxis 建立 4x4 轉換矩陣。
 *    預設生成 WebGL / Three.js 標準的 Column-Major（行優先）格式，亦支援 Row-Major 選項。
 * 2. sketchToWorld3D(point2D, plane):
 *    將 2D 草圖 (u, v) 局部座標精確轉換為 3D 全局世界座標 (X, Y, Z)。
 * 3. world3DToSketch(point3D, plane):
 *    將 3D 全局座標正交投影回 2D 草圖局部平面座標 (u, v)。
 *    這對 CAD「在實體表面 (Planar Solid Face) 上選取特徵並建立草圖」不可或缺。
 * 4. 輔助特徵工具：
 *    - projectPointOntoPlane: 計算 3D 點在平面上的垂足座標
 *    - distanceToPlane: 計算 3D 點至平面的有號距離 (Signed Distance)
 *    - createPlaneFromFace: 由 3D 實體面的外法向量與基準點動態生成正交 CustomPlane
 *    - getPlaneInverseMatrix: 取得逆矩陣 (World-to-Local)
 */

import {
  CustomPlane,
  Point2D,
  Point3D,
  Vector2D,
  Vector3D,
  Matrix4x4
} from '../../types/cad.ts';

// ============================================================================
// 1. Fundamental 3D Vector Operations
// ============================================================================

const EPSILON = 1e-9;

/**
 * Calculates Euclidean length of a 3D vector.
 */
export function vecLength(v: Vector3D): number {
  return Math.hypot(v.x, v.y, v.z);
}

/**
 * Normalizes a 3D vector to unit length with safe fallback.
 */
export function normalizeVector(v: Vector3D, fallback: Vector3D = { x: 0, y: 0, z: 1 }): Vector3D {
  const len = vecLength(v);
  if (len < EPSILON) {
    return { ...fallback };
  }
  return {
    x: v.x / len,
    y: v.y / len,
    z: v.z / len
  };
}

/**
 * Vector dot product (內積).
 */
export function dotProduct(a: Vector3D, b: Vector3D): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Vector cross product (外積): a × b (follows Right-Hand Rule).
 */
export function crossProduct(a: Vector3D, b: Vector3D): Vector3D {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

/**
 * Adds two 3D vectors: a + b.
 */
export function vecAdd(a: Vector3D, b: Vector3D): Vector3D {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/**
 * Subtracts two 3D vectors: a - b.
 */
export function vecSubtract(a: Vector3D, b: Vector3D): Vector3D {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/**
 * Scales a 3D vector by scalar s: v * s.
 */
export function vecScale(v: Vector3D, s: number): Vector3D {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

// ============================================================================
// 2. Orthonormal Basis Extraction & Effective Origin
// ============================================================================

export interface OrthonormalBasis {
  origin: Point3D;
  xAxis: Vector3D;
  yAxis: Vector3D;
  normal: Vector3D;
}

/**
 * Extracts and strictly verifies the orthonormal basis vectors for a CustomPlane.
 * Uses Gram-Schmidt orthogonalization to ensure xAxis, yAxis, and normal are
 * mutually perpendicular unit vectors adhering to the right-hand rule.
 */
export function getOrthonormalBasis(
  plane: CustomPlane,
  options?: { applyOffset?: boolean }
): OrthonormalBasis {
  let origin = { ...plane.origin };
  if (options?.applyOffset && plane.offset) {
    origin = {
      x: origin.x + plane.normal.x * plane.offset,
      y: origin.y + plane.normal.y * plane.offset,
      z: origin.z + plane.normal.z * plane.offset
    };
  }

  // 1. Normalize normal vector (Z_local)
  const nz = normalizeVector(plane.normal, { x: 0, y: 0, z: 1 });

  // 2. Normalize and project xAxis to be perpendicular to normal
  let nx = normalizeVector(plane.xAxis, { x: 1, y: 0, z: 0 });
  const xDotN = dotProduct(nx, nz);
  if (Math.abs(xDotN) > EPSILON) {
    // Subtract parallel component: nx = nx - (nx • nz) * nz
    nx = normalizeVector(vecSubtract(nx, vecScale(nz, xDotN)));
  }

  // If xAxis ended up parallel to normal, choose a stable perpendicular vector
  if (vecLength(nx) < EPSILON || Math.abs(dotProduct(nx, nz)) > 0.999) {
    const candidate = Math.abs(nz.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
    nx = normalizeVector(crossProduct(nz, candidate));
  }

  // 3. Compute yAxis = normal × xAxis to guarantee strict right-handed orthonormality
  let ny = crossProduct(nz, nx);
  ny = normalizeVector(ny, { x: 0, y: 1, z: 0 });

  // If plane specifies yAxis in opposite orientation, verify dot alignment
  if (plane.yAxis && dotProduct(ny, plane.yAxis) < -0.5) {
    ny = vecScale(ny, -1);
  }

  return {
    origin,
    xAxis: nx,
    yAxis: ny,
    normal: nz
  };
}

// ============================================================================
// 3. getPlaneMatrix (4x4 Transformation Matrix)
// ============================================================================

export interface MatrixOptions {
  /**
   * Whether to output column-major array (WebGL, OpenGL, Three.js standard).
   * Default: true
   */
  columnMajor?: boolean;
  /**
   * Whether to apply the plane's offset along its normal vector.
   * Default: false
   */
  applyOffset?: boolean;
}

/**
 * 根據 CustomPlane 的 origin, normal, xAxis, yAxis 建立 4x4 轉換矩陣。
 *
 * 在 3D 圖形學中，齊次座標轉換矩陣：
 * M = [
 *   [Xx, Yx, Zx, Tx],
 *   [Xy, Yy, Zy, Ty],
 *   [Xz, Yz, Zz, Tz],
 *   [ 0,  0,  0,  1]
 * ]
 *
 * 預設輸出為 Column-Major (扁平陣列 16 元素):
 * [Xx, Xy, Xz, 0,  Yx, Yy, Yz, 0,  Zx, Zy, Zz, 0,  Tx, Ty, Tz, 1]
 */
export function getPlaneMatrix(
  plane: CustomPlane,
  options?: MatrixOptions
): Matrix4x4 {
  const isColumnMajor = options?.columnMajor !== false;
  const basis = getOrthonormalBasis(plane, { applyOffset: options?.applyOffset });

  const { origin: O, xAxis: X, yAxis: Y, normal: Z } = basis;

  if (isColumnMajor) {
    // Column-major: column 0 = xAxis, column 1 = yAxis, column 2 = normal, column 3 = origin
    return [
      X.x, X.y, X.z, 0,
      Y.x, Y.y, Y.z, 0,
      Z.x, Z.y, Z.z, 0,
      O.x, O.y, O.z, 1
    ];
  } else {
    // Row-major: row 0 = Xx Yx Zx Tx, etc.
    return [
      X.x, Y.x, Z.x, O.x,
      X.y, Y.y, Z.y, O.y,
      X.z, Y.z, Z.z, O.z,
      0,   0,   0,   1
    ];
  }
}

/**
 * 建立 World-to-Local 的逆轉換矩陣 (Inverse 4x4 Transformation Matrix)。
 * 由於旋轉基底為正交陣列，其逆為其轉置 (R^-1 = R^T)，
 * 平移量為 -R^T * Origin。數值精確且無需耗費矩陣求逆運算。
 */
export function getPlaneInverseMatrix(
  plane: CustomPlane,
  options?: MatrixOptions
): Matrix4x4 {
  const isColumnMajor = options?.columnMajor !== false;
  const basis = getOrthonormalBasis(plane, { applyOffset: options?.applyOffset });
  const { origin: O, xAxis: X, yAxis: Y, normal: Z } = basis;

  // Translation in local coordinate system
  const tx = -(O.x * X.x + O.y * X.y + O.z * X.z);
  const ty = -(O.x * Y.x + O.y * Y.y + O.z * Y.z);
  const tz = -(O.x * Z.x + O.y * Z.y + O.z * Z.z);

  if (isColumnMajor) {
    return [
      X.x, Y.x, Z.x, 0,
      X.y, Y.y, Z.y, 0,
      X.z, Y.z, Z.z, 0,
      tx,  ty,  tz,  1
    ];
  } else {
    return [
      X.x, X.y, X.z, tx,
      Y.x, Y.y, Y.z, ty,
      Z.x, Z.y, Z.z, tz,
      0,   0,   0,   1
    ];
  }
}

// ============================================================================
// 4. sketchToWorld3D & world3DToSketch (Core Mapping Utilities)
// ============================================================================

/**
 * 將 2D 草圖座標 (u, v) 轉換為 3D 全局座標 (X, Y, Z)。
 *
 * 向量公式：
 * P_3D = Origin + u * xAxis + v * yAxis
 *
 * @param point2D 2D 草圖上的點 (u, v)
 * @param plane 基準參考平面
 * @param options 可選配置（如是否加入 plane.offset）
 */
export function sketchToWorld3D(
  point2D: Point2D,
  plane: CustomPlane,
  options?: { applyOffset?: boolean }
): Point3D {
  const basis = getOrthonormalBasis(plane, { applyOffset: options?.applyOffset });
  const { origin, xAxis, yAxis } = basis;

  return {
    x: origin.x + point2D.x * xAxis.x + point2D.y * yAxis.x,
    y: origin.y + point2D.x * xAxis.y + point2D.y * yAxis.y,
    z: origin.z + point2D.x * xAxis.z + point2D.y * yAxis.z
  };
}

/**
 * 將 3D 座標投影回 2D 局部草圖座標 (u, v)。
 *
 * 向量投影公式：
 * d = P_3D - Origin
 * u = d • xAxis
 * v = d • yAxis
 *
 * 這對 CAD「在實體特徵面上建立草圖」至關重要。
 *
 * @param point3D 3D 空間中的點 (X, Y, Z)
 * @param plane 基準參考平面
 * @param options 可選配置（如是否加入 plane.offset）
 */
export function world3DToSketch(
  point3D: Point3D,
  plane: CustomPlane,
  options?: { applyOffset?: boolean }
): Point2D {
  const basis = getOrthonormalBasis(plane, { applyOffset: options?.applyOffset });
  const { origin, xAxis, yAxis } = basis;

  const dx = point3D.x - origin.x;
  const dy = point3D.y - origin.y;
  const dz = point3D.z - origin.z;

  const u = dx * xAxis.x + dy * xAxis.y + dz * xAxis.z;
  const v = dx * yAxis.x + dy * yAxis.y + dz * yAxis.z;

  return { x: u, y: v };
}

// ============================================================================
// 5. Plane Projections & Distance Helpers (Solid Face Sketch Support)
// ============================================================================

/**
 * 計算 3D 空間點在平面上的垂足正交投影點 (Point3D)。
 */
export function projectPointOntoPlane(
  point3D: Point3D,
  plane: CustomPlane,
  options?: { applyOffset?: boolean }
): Point3D {
  const basis = getOrthonormalBasis(plane, { applyOffset: options?.applyOffset });
  const { origin, normal } = basis;

  const dx = point3D.x - origin.x;
  const dy = point3D.y - origin.y;
  const dz = point3D.z - origin.z;

  // Signed distance from plane surface
  const dist = dx * normal.x + dy * normal.y + dz * normal.z;

  return {
    x: point3D.x - dist * normal.x,
    y: point3D.y - dist * normal.y,
    z: point3D.z - dist * normal.z
  };
}

/**
 * 計算 3D 點到平面的有號距離 (Signed Distance)。
 * 正值代表沿著法向量指向的外側，負值為內側，0 代表共面。
 */
export function distanceToPlane(
  point3D: Point3D,
  plane: CustomPlane,
  options?: { applyOffset?: boolean }
): number {
  const basis = getOrthonormalBasis(plane, { applyOffset: options?.applyOffset });
  const { origin, normal } = basis;

  const dx = point3D.x - origin.x;
  const dy = point3D.y - origin.y;
  const dz = point3D.z - origin.z;

  return dx * normal.x + dy * normal.y + dz * normal.z;
}

/**
 * 將 2D 向量純方向轉換為 3D 向量 (不含平移 Origin)。
 */
export function sketchVectorToWorld3D(
  vector2D: Vector2D,
  plane: CustomPlane
): Vector3D {
  const basis = getOrthonormalBasis(plane);
  const { xAxis, yAxis } = basis;

  return {
    x: vector2D.x * xAxis.x + vector2D.y * yAxis.x,
    y: vector2D.x * xAxis.y + vector2D.y * yAxis.y,
    z: vector2D.x * xAxis.z + vector2D.y * yAxis.z
  };
}

/**
 * 將 3D 方向向量投影回 2D 草圖方向 (不含平移 Origin)。
 */
export function worldVectorToSketch(
  vector3D: Vector3D,
  plane: CustomPlane
): Vector2D {
  const basis = getOrthonormalBasis(plane);
  const { xAxis, yAxis } = basis;

  return {
    x: dotProduct(vector3D, xAxis),
    y: dotProduct(vector3D, yAxis)
  };
}

// ============================================================================
// 6. Dynamic CustomPlane Construction (Sketch-on-Face Workflow)
// ============================================================================

/**
 * 由 3D 實體模型選取的平面特徵 (Planar Solid Face) 動態建立 CustomPlane。
 * 這直接支援 SolidWorks/Onshape 風格的「選取實體表面 -> 進入草圖模式」。
 *
 * @param faceOrigin 實體面上的一點（通常為面中心或端點）
 * @param faceNormal 實體面的單位外法向量
 * @param preferredXAxis 偏好的局部 X 軸方向（可選）
 * @param id 自訂平面 ID
 * @param name 自訂平面名稱
 */
export function createPlaneFromFace(
  faceOrigin: Point3D,
  faceNormal: Vector3D,
  preferredXAxis?: Vector3D,
  id?: string,
  name?: string
): CustomPlane {
  const normal = normalizeVector(faceNormal, { x: 0, y: 0, z: 1 });

  let xAxis: Vector3D;
  if (preferredXAxis && vecLength(preferredXAxis) > EPSILON) {
    xAxis = normalizeVector(preferredXAxis);
    // Project to be perpendicular to normal
    const d = dotProduct(xAxis, normal);
    xAxis = normalizeVector(vecSubtract(xAxis, vecScale(normal, d)));
  } else {
    // Pick an axis that is not nearly collinear with normal
    const up = Math.abs(normal.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
    xAxis = normalizeVector(crossProduct(up, normal));
  }

  // Ensure right-hand rule: yAxis = normal × xAxis
  const yAxis = normalizeVector(crossProduct(normal, xAxis));

  const planeId = id || `plane_face_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const planeName = name || `Face Plane (${planeId.slice(-6)})`;

  return {
    id: planeId,
    name: planeName,
    origin: { ...faceOrigin },
    normal,
    xAxis,
    yAxis,
    isDatum: false
  };
}

/**
 * 由 3D 空間中三個不共線點建立 CustomPlane (p1=origin, p2 定義 X 軸, p3 定義 Y 軸方向)。
 */
export function createPlaneFrom3Points(
  p1: Point3D,
  p2: Point3D,
  p3: Point3D,
  id?: string,
  name?: string
): CustomPlane {
  const v12 = vecSubtract(p2, p1);
  const v13 = vecSubtract(p3, p1);

  const xAxis = normalizeVector(v12);
  const rawNormal = crossProduct(v12, v13);
  const normal = normalizeVector(rawNormal, { x: 0, y: 0, z: 1 });
  const yAxis = normalizeVector(crossProduct(normal, xAxis));

  const planeId = id || `plane_3pt_${Date.now()}`;
  const planeName = name || '3-Point Reference Plane';

  return {
    id: planeId,
    name: planeName,
    origin: { ...p1 },
    normal,
    xAxis,
    yAxis,
    isDatum: false
  };
}

/**
 * 矩陣乘法向量運算：以 4x4 矩陣變換 3D 點。
 */
export function transformPointWithMatrix(
  point: Point3D,
  matrix: Matrix4x4,
  columnMajor: boolean = true
): Point3D {
  if (columnMajor) {
    const x = matrix[0] * point.x + matrix[4] * point.y + matrix[8] * point.z + matrix[12];
    const y = matrix[1] * point.x + matrix[5] * point.y + matrix[9] * point.z + matrix[13];
    const z = matrix[2] * point.x + matrix[6] * point.y + matrix[10] * point.z + matrix[14];
    const w = matrix[3] * point.x + matrix[7] * point.y + matrix[11] * point.z + matrix[15];
    const invW = Math.abs(w) > EPSILON ? 1 / w : 1;
    return { x: x * invW, y: y * invW, z: z * invW };
  } else {
    const x = matrix[0] * point.x + matrix[1] * point.y + matrix[2] * point.z + matrix[3];
    const y = matrix[4] * point.x + matrix[5] * point.y + matrix[6] * point.z + matrix[7];
    const z = matrix[8] * point.x + matrix[9] * point.y + matrix[10] * point.z + matrix[11];
    const w = matrix[12] * point.x + matrix[13] * point.y + matrix[14] * point.z + matrix[15];
    const invW = Math.abs(w) > EPSILON ? 1 / w : 1;
    return { x: x * invW, y: y * invW, z: z * invW };
  }
}

// Re-export SolidWorks-style Sketch-on-Face Core Mathematics Library
export * from '../math/SketchOnFaceMath.ts';
