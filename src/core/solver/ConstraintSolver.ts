import {
  Point2D,
  CADEntity2D,
  LineEntity,
  CircleEntity,
  ArcEntity,
  PolylineEntity,
  Constraint,
  ConstraintType,
  EntityState
} from '../../types/cad.ts';

/**
 * WebAssembly 版本的開源約束引擎核心 (如 SolveSpace 的邏輯) 介面設計。
 * 用於聯立求解非線性方程組 (Non-linear Equation Systems)。
 */
export interface WasmSolverAdapter {
  isLoaded: boolean;
  solve: (entities: CADEntity2D[], constraints: Constraint[]) => SolveEntitiesResult;
}

export const WasmConstraintEngine: WasmSolverAdapter = {
  isLoaded: false,
  solve: () => {
    throw new Error('WebAssembly Solver is not currently loaded. Fallback to iterative solver.');
  }
};

/**
 * 求解器支援之定義狀態
 */
export type DefinedState = 'UnderDefined' | 'FullyDefined' | 'OverDefined';

/**
 * 迭代求解參數設定
 */
export const MAX_SOLVER_ITERATIONS = 50;
export const SOLVER_TOLERANCE = 1e-4;

/**
 * 幾何約束求解結果介面
 * 同時繼承 CADEntity2D[] 陣列，方便直接傳給 Zustand set({ entities })，
 * 亦可解構取得 { entities, maxDisp, converged, iterations }。
 */
export interface SolveEntitiesResult extends Array<CADEntity2D> {
  converged: boolean;
  iterations: number;
  maxDisp: number;
  entities: CADEntity2D[];
}

/**
 * 草圖自由度分析結果
 */
export interface SketchAnalysisResult {
  /** 整個草圖剩餘之總自由度 (Degrees of Freedom) */
  dof: number;
  /** 草圖狀態 (大駝峰表示法) */
  state: DefinedState;
  /** 草圖狀態 (標準 CAD 狀態標籤) */
  status: 'under_constrained' | 'fully_constrained' | 'over_constrained';
  /** 各圖元之剩餘自由度對照表 */
  entityDof: Record<string, number>;
  /** 各圖元之約束定義狀態對照表 */
  entityStates: Record<string, DefinedState>;
  /** 標記更新後之全新圖元陣列 (純函數回傳) */
  entities: CADEntity2D[];
}

/**
 * 深拷貝圖元陣列 (確保 Pure Function 絕不污染原陣列)
 */
function cloneEntities(entities: CADEntity2D[]): CADEntity2D[] {
  return entities.map((ent) => {
    if (ent.type === 'line') {
      return {
        ...ent,
        start: { x: ent.start.x, y: ent.start.y },
        end: { x: ent.end.x, y: ent.end.y },
        metadata: ent.metadata ? { ...ent.metadata } : undefined
      } as LineEntity;
    }
    if (ent.type === 'circle') {
      return {
        ...ent,
        center: { x: ent.center.x, y: ent.center.y },
        metadata: ent.metadata ? { ...ent.metadata } : undefined
      } as CircleEntity;
    }
    if (ent.type === 'arc') {
      return {
        ...ent,
        center: { x: ent.center.x, y: ent.center.y },
        metadata: ent.metadata ? { ...ent.metadata } : undefined
      } as ArcEntity;
    }
    if (ent.type === 'polyline') {
      return {
        ...ent,
        vertices: ent.vertices.map((v) => ({
          ...v,
          point: { x: v.point.x, y: v.point.y }
        })),
        metadata: ent.metadata ? { ...ent.metadata } : undefined
      } as PolylineEntity;
    }
    return JSON.parse(JSON.stringify(ent));
  });
}

/**
 * 判斷座標點或圖元是否被鎖定（固定點 Fixed Point）
 */
function checkPointFixed(
  pt: Point2D,
  entityId: string,
  fixedPoints?: Point2D[] | string[] | Set<string>,
  fixedEntityIds?: Set<string>
): boolean {
  if (fixedEntityIds && fixedEntityIds.has(entityId)) {
    return true;
  }

  if (!fixedPoints) {
    return false;
  }

  if (fixedPoints instanceof Set) {
    if (fixedPoints.has(entityId) || fixedPoints.has(`${pt.x},${pt.y}`)) {
      return true;
    }
  } else if (Array.isArray(fixedPoints)) {
    for (const item of fixedPoints) {
      if (typeof item === 'string') {
        if (item === entityId || item === `${pt.x},${pt.y}`) {
          return true;
        }
      } else if (typeof item === 'object' && item !== null && 'x' in item && 'y' in item) {
        if (Math.hypot(pt.x - item.x, pt.y - item.y) < 1e-4) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * 取得圖元之指定關鍵點座標引用
 */
function getEntityPoint(entity: CADEntity2D, pointIndex: number = 0): Point2D | null {
  if (entity.type === 'line') {
    return pointIndex === 0 ? entity.start : entity.end;
  }
  if (entity.type === 'circle' || entity.type === 'arc') {
    return entity.center;
  }
  if (entity.type === 'polyline' && entity.vertices.length > 0) {
    const idx = Math.max(0, Math.min(pointIndex, entity.vertices.length - 1));
    return entity.vertices[idx].point;
  }
  return null;
}

/**
 * 求解器核心函式：solveConstraints
 * 採用代數位置投影鬆弛法 (Position-Based Relaxation / Gauss-Seidel 迭代)
 *
 * @param entities 原始草圖圖元陣列
 * @param constraints 草圖幾何約束集合
 * @param fixedPoints 鎖定固定點座標或圖元識別碼（不可推移）
 * @returns 全新推移後之圖元陣列，附帶 iterations, maxDisp, converged 等求解診斷資訊
 */
export function solveConstraints(
  entities: CADEntity2D[],
  constraints: Constraint[],
  fixedPoints?: Point2D[] | string[] | Set<string>
): SolveEntitiesResult {
  // 1. 純函數保證：深拷貝全新圖元，絕不變異原始資料
  const newEntities = cloneEntities(entities);
  const entityMap = new Map<string, CADEntity2D>();
  for (const ent of newEntities) {
    entityMap.set(ent.id, ent);
  }

  // 2. 收集固定約束 (Fixed Constraints) 與固定圖元 ID
  const fixedEntityIds = new Set<string>();
  const activeConstraints = constraints.filter((c) => !c.isSuppressed);

  for (const c of activeConstraints) {
    if (c.type === 'fixed') {
      for (const id of c.entityIds) {
        fixedEntityIds.add(id);
      }
    }
  }

  const isFixed = (pt: Point2D, entityId: string) =>
    checkPointFixed(pt, entityId, fixedPoints, fixedEntityIds);

  let overallMaxDisp = 0;
  let iterations = 0;
  let converged = false;

  // 3. 迭代代數求解 (最多 50 次)
  for (let iter = 0; iter < MAX_SOLVER_ITERATIONS; iter++) {
    iterations = iter + 1;
    let iterMaxDisp = 0;

    for (const constraint of activeConstraints) {
      const type = constraint.type as ConstraintType;
      const ids = constraint.entityIds;

      // -------------------------------------------------------------
      // (A) 水平約束 (Horizontal Constraint): y1 = y2
      // -------------------------------------------------------------
      if (type === 'horizontal') {
        if (ids.length === 1) {
          const ent = entityMap.get(ids[0]);
          if (ent && ent.type === 'line') {
            const p1 = ent.start;
            const p2 = ent.end;
            const fix1 = isFixed(p1, ent.id);
            const fix2 = isFixed(p2, ent.id);

            if (fix1 && fix2) {
              // 兩端皆固定，不可移動
              continue;
            } else if (fix1 && !fix2) {
              const disp = Math.abs(p2.y - p1.y);
              p2.y = p1.y;
              if (disp > iterMaxDisp) iterMaxDisp = disp;
            } else if (!fix1 && fix2) {
              const disp = Math.abs(p1.y - p2.y);
              p1.y = p2.y;
              if (disp > iterMaxDisp) iterMaxDisp = disp;
            } else {
              const avgY = (p1.y + p2.y) / 2;
              const disp1 = Math.abs(p1.y - avgY);
              const disp2 = Math.abs(p2.y - avgY);
              p1.y = avgY;
              p2.y = avgY;
              const disp = Math.max(disp1, disp2);
              if (disp > iterMaxDisp) iterMaxDisp = disp;
            }
          }
        } else if (ids.length >= 2) {
          const entA = entityMap.get(ids[0]);
          const entB = entityMap.get(ids[1]);
          if (entA && entB) {
            const ptA = getEntityPoint(entA, (constraint as any).pointIndexA ?? 0);
            const ptB = getEntityPoint(entB, (constraint as any).pointIndexB ?? 0);
            if (ptA && ptB) {
              const fixA = isFixed(ptA, entA.id);
              const fixB = isFixed(ptB, entB.id);
              if (fixA && !fixB) {
                const disp = Math.abs(ptB.y - ptA.y);
                ptB.y = ptA.y;
                if (disp > iterMaxDisp) iterMaxDisp = disp;
              } else if (!fixA && fixB) {
                const disp = Math.abs(ptA.y - ptB.y);
                ptA.y = ptB.y;
                if (disp > iterMaxDisp) iterMaxDisp = disp;
              } else if (!fixA && !fixB) {
                const avgY = (ptA.y + ptB.y) / 2;
                const disp = Math.max(Math.abs(ptA.y - avgY), Math.abs(ptB.y - avgY));
                ptA.y = avgY;
                ptB.y = avgY;
                if (disp > iterMaxDisp) iterMaxDisp = disp;
              }
            }
          }
        }
      }

      // -------------------------------------------------------------
      // (B) 垂直約束 (Vertical Constraint): x1 = x2
      // -------------------------------------------------------------
      else if (type === 'vertical') {
        if (ids.length === 1) {
          const ent = entityMap.get(ids[0]);
          if (ent && ent.type === 'line') {
            const p1 = ent.start;
            const p2 = ent.end;
            const fix1 = isFixed(p1, ent.id);
            const fix2 = isFixed(p2, ent.id);

            if (fix1 && fix2) {
              continue;
            } else if (fix1 && !fix2) {
              const disp = Math.abs(p2.x - p1.x);
              p2.x = p1.x;
              if (disp > iterMaxDisp) iterMaxDisp = disp;
            } else if (!fix1 && fix2) {
              const disp = Math.abs(p1.x - p2.x);
              p1.x = p2.x;
              if (disp > iterMaxDisp) iterMaxDisp = disp;
            } else {
              const avgX = (p1.x + p2.x) / 2;
              const disp1 = Math.abs(p1.x - avgX);
              const disp2 = Math.abs(p2.x - avgX);
              p1.x = avgX;
              p2.x = avgX;
              const disp = Math.max(disp1, disp2);
              if (disp > iterMaxDisp) iterMaxDisp = disp;
            }
          }
        } else if (ids.length >= 2) {
          const entA = entityMap.get(ids[0]);
          const entB = entityMap.get(ids[1]);
          if (entA && entB) {
            const ptA = getEntityPoint(entA, (constraint as any).pointIndexA ?? 0);
            const ptB = getEntityPoint(entB, (constraint as any).pointIndexB ?? 0);
            if (ptA && ptB) {
              const fixA = isFixed(ptA, entA.id);
              const fixB = isFixed(ptB, entB.id);
              if (fixA && !fixB) {
                const disp = Math.abs(ptB.x - ptA.x);
                ptB.x = ptA.x;
                if (disp > iterMaxDisp) iterMaxDisp = disp;
              } else if (!fixA && fixB) {
                const disp = Math.abs(ptA.x - ptB.x);
                ptA.x = ptB.x;
                if (disp > iterMaxDisp) iterMaxDisp = disp;
              } else if (!fixA && !fixB) {
                const avgX = (ptA.x + ptB.x) / 2;
                const disp = Math.max(Math.abs(ptA.x - avgX), Math.abs(ptB.x - avgX));
                ptA.x = avgX;
                ptB.x = avgX;
                if (disp > iterMaxDisp) iterMaxDisp = disp;
              }
            }
          }
        }
      }

      // -------------------------------------------------------------
      // (C) 重合約束 (Coincident Constraint): P_A = P_B
      // -------------------------------------------------------------
      else if (type === 'coincident') {
        if (ids.length >= 2) {
          const entA = entityMap.get(ids[0]);
          const entB = entityMap.get(ids[1]);

          if (entA && entB) {
            // 決定對應之兩端點
            let ptA: Point2D | null = null;
            let ptB: Point2D | null = null;

            const idxA = (constraint as any).pointIndexA;
            const idxB = (constraint as any).pointIndexB;

            if (idxA !== undefined && idxB !== undefined) {
              ptA = getEntityPoint(entA, idxA);
              ptB = getEntityPoint(entB, idxB);
            } else {
              // 若未指定端點索引，自動尋找兩圖元間當前歐式距離最近的一組端點
              const ptsA: Point2D[] =
                entA.type === 'line'
                  ? [entA.start, entA.end]
                  : entA.type === 'circle' || entA.type === 'arc'
                  ? [entA.center]
                  : [];
              const ptsB: Point2D[] =
                entB.type === 'line'
                  ? [entB.start, entB.end]
                  : entB.type === 'circle' || entB.type === 'arc'
                  ? [entB.center]
                  : [];

              let minDist = Infinity;
              for (const pa of ptsA) {
                for (const pb of ptsB) {
                  const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
                  if (d < minDist) {
                    minDist = d;
                    ptA = pa;
                    ptB = pb;
                  }
                }
              }
            }

            if (ptA && ptB) {
              const fixA = isFixed(ptA, entA.id);
              const fixB = isFixed(ptB, entB.id);

              if (fixA && fixB) {
                continue;
              } else if (fixA && !fixB) {
                const disp = Math.hypot(ptB.x - ptA.x, ptB.y - ptA.y);
                ptB.x = ptA.x;
                ptB.y = ptA.y;
                if (disp > iterMaxDisp) iterMaxDisp = disp;
              } else if (!fixA && fixB) {
                const disp = Math.hypot(ptA.x - ptB.x, ptA.y - ptB.y);
                ptA.x = ptB.x;
                ptA.y = ptB.y;
                if (disp > iterMaxDisp) iterMaxDisp = disp;
              } else {
                const midX = (ptA.x + ptB.x) / 2;
                const midY = (ptA.y + ptB.y) / 2;
                const dispA = Math.hypot(ptA.x - midX, ptA.y - midY);
                const dispB = Math.hypot(ptB.x - midX, ptB.y - midY);
                ptA.x = midX;
                ptA.y = midY;
                ptB.x = midX;
                ptB.y = midY;
                const disp = Math.max(dispA, dispB);
                if (disp > iterMaxDisp) iterMaxDisp = disp;
              }
            }
          }
        }
      }

      // -------------------------------------------------------------
      // (D) 長度 (Length) / 距離 (Distance) 約束: |P2 - P1| = L
      // -------------------------------------------------------------
      else if (type === 'length' || type === 'distance') {
        const targetLen =
          (constraint as any).length ?? (constraint as any).distance ?? 0;

        if (targetLen > 0) {
          if (ids.length === 1) {
            const ent = entityMap.get(ids[0]);
            if (ent && ent.type === 'line') {
              const p1 = ent.start;
              const p2 = ent.end;
              const fix1 = isFixed(p1, ent.id);
              const fix2 = isFixed(p2, ent.id);

              if (fix1 && fix2) {
                continue;
              }

              let dx = p2.x - p1.x;
              let dy = p2.y - p1.y;
              let curLen = Math.hypot(dx, dy);

              if (curLen < 1e-7) {
                dx = 1;
                dy = 0;
                curLen = 1;
              }

              const ux = dx / curLen;
              const uy = dy / curLen;
              const delta = curLen - targetLen;

              if (fix1 && !fix2) {
                const newX = p1.x + ux * targetLen;
                const newY = p1.y + uy * targetLen;
                const disp = Math.hypot(newX - p2.x, newY - p2.y);
                p2.x = newX;
                p2.y = newY;
                if (disp > iterMaxDisp) iterMaxDisp = disp;
              } else if (!fix1 && fix2) {
                const newX = p2.x - ux * targetLen;
                const newY = p2.y - uy * targetLen;
                const disp = Math.hypot(newX - p1.x, newY - p1.y);
                p1.x = newX;
                p1.y = newY;
                if (disp > iterMaxDisp) iterMaxDisp = disp;
              } else {
                const shift = delta / 2;
                const newP1X = p1.x + ux * shift;
                const newP1Y = p1.y + uy * shift;
                const newP2X = p2.x - ux * shift;
                const newP2Y = p2.y - uy * shift;

                const disp = Math.max(
                  Math.hypot(newP1X - p1.x, newP1Y - p1.y),
                  Math.hypot(newP2X - p2.x, newP2Y - p2.y)
                );
                p1.x = newP1X;
                p1.y = newP1Y;
                p2.x = newP2X;
                p2.y = newP2Y;
                if (disp > iterMaxDisp) iterMaxDisp = disp;
              }
            } else if (ent && (ent.type === 'circle' || ent.type === 'arc')) {
              // 圓形/圓弧半徑約束
              const disp = Math.abs(ent.radius - targetLen);
              ent.radius = targetLen;
              if (disp > iterMaxDisp) iterMaxDisp = disp;
            }
          } else if (ids.length >= 2) {
            // 兩圖元關鍵點間距離約束
            const entA = entityMap.get(ids[0]);
            const entB = entityMap.get(ids[1]);
            if (entA && entB) {
              const ptA = getEntityPoint(entA, (constraint as any).pointIndexA ?? 0);
              const ptB = getEntityPoint(entB, (constraint as any).pointIndexB ?? 0);
              if (ptA && ptB) {
                const fixA = isFixed(ptA, entA.id);
                const fixB = isFixed(ptB, entB.id);

                if (!fixA || !fixB) {
                  let dx = ptB.x - ptA.x;
                  let dy = ptB.y - ptA.y;
                  let curLen = Math.hypot(dx, dy);
                  if (curLen < 1e-7) {
                    dx = 1;
                    dy = 0;
                    curLen = 1;
                  }
                  const ux = dx / curLen;
                  const uy = dy / curLen;
                  const delta = curLen - targetLen;

                  if (fixA && !fixB) {
                    const newX = ptA.x + ux * targetLen;
                    const newY = ptA.y + uy * targetLen;
                    const disp = Math.hypot(newX - ptB.x, newY - ptB.y);
                    ptB.x = newX;
                    ptB.y = newY;
                    if (disp > iterMaxDisp) iterMaxDisp = disp;
                  } else if (!fixA && fixB) {
                    const newX = ptB.x - ux * targetLen;
                    const newY = ptB.y - uy * targetLen;
                    const disp = Math.hypot(newX - ptA.x, newY - ptA.y);
                    ptA.x = newX;
                    ptA.y = newY;
                    if (disp > iterMaxDisp) iterMaxDisp = disp;
                  } else {
                    const shift = delta / 2;
                    const newAX = ptA.x + ux * shift;
                    const newAY = ptA.y + uy * shift;
                    const newBX = ptB.x - ux * shift;
                    const newBY = ptB.y - uy * shift;
                    const disp = Math.max(
                      Math.hypot(newAX - ptA.x, newAY - ptA.y),
                      Math.hypot(newBX - ptB.x, newBY - ptB.y)
                    );
                    ptA.x = newAX;
                    ptA.y = newAY;
                    ptB.x = newBX;
                    ptB.y = newBY;
                    if (disp > iterMaxDisp) iterMaxDisp = disp;
                  }
                }
              }
            }
          }
        }
      }

      // -------------------------------------------------------------
      // (E) 同心約束 (Concentric Constraint)
      // -------------------------------------------------------------
      else if (type === 'concentric' && ids.length >= 2) {
        const entA = entityMap.get(ids[0]);
        const entB = entityMap.get(ids[1]);
        if (
          entA &&
          entB &&
          (entA.type === 'circle' || entA.type === 'arc') &&
          (entB.type === 'circle' || entB.type === 'arc')
        ) {
          const fixA = isFixed(entA.center, entA.id);
          const fixB = isFixed(entB.center, entB.id);
          if (fixA && !fixB) {
            const disp = Math.hypot(entB.center.x - entA.center.x, entB.center.y - entA.center.y);
            entB.center.x = entA.center.x;
            entB.center.y = entA.center.y;
            if (disp > iterMaxDisp) iterMaxDisp = disp;
          } else if (!fixA && fixB) {
            const disp = Math.hypot(entA.center.x - entB.center.x, entA.center.y - entB.center.y);
            entA.center.x = entB.center.x;
            entA.center.y = entB.center.y;
            if (disp > iterMaxDisp) iterMaxDisp = disp;
          } else if (!fixA && !fixB) {
            const avgX = (entA.center.x + entB.center.x) / 2;
            const avgY = (entA.center.y + entB.center.y) / 2;
            const disp = Math.hypot(entA.center.x - avgX, entA.center.y - avgY);
            entA.center.x = avgX;
            entA.center.y = avgY;
            entB.center.x = avgX;
            entB.center.y = avgY;
            if (disp > iterMaxDisp) iterMaxDisp = disp;
          }
        }
      }

      // -------------------------------------------------------------
      // (F) 等長約束 (Equal Length Constraint)
      // -------------------------------------------------------------
      else if (type === 'equal_length' && ids.length >= 2) {
        const entA = entityMap.get(ids[0]);
        const entB = entityMap.get(ids[1]);
        if (entA && entB && entA.type === 'line' && entB.type === 'line') {
          const lenA = Math.hypot(entA.end.x - entA.start.x, entA.end.y - entA.start.y);
          const lenB = Math.hypot(entB.end.x - entB.start.x, entB.end.y - entB.start.y);
          const targetLen = (lenA + lenB) / 2;

          // 對兩線分別施加 targetLen
          for (const line of [entA, entB]) {
            const curLen = Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);
            if (curLen > 1e-6) {
              const uX = (line.end.x - line.start.x) / curLen;
              const uY = (line.end.y - line.start.y) / curLen;
              const d = curLen - targetLen;
              const fixS = isFixed(line.start, line.id);
              const fixE = isFixed(line.end, line.id);

              if (fixS && !fixE) {
                line.end.x = line.start.x + uX * targetLen;
                line.end.y = line.start.y + uY * targetLen;
              } else if (!fixS && fixE) {
                line.start.x = line.end.x - uX * targetLen;
                line.start.y = line.end.y - uY * targetLen;
              } else if (!fixS && !fixE) {
                line.start.x += uX * (d / 2);
                line.start.y += uY * (d / 2);
                line.end.x -= uX * (d / 2);
                line.end.y -= uY * (d / 2);
              }
            }
          }
        }
      }

      // -------------------------------------------------------------
      // (G) 共線約束 (Collinear Constraint)
      // -------------------------------------------------------------
      else if (type === 'collinear' && ids.length >= 2) {
        const entA = entityMap.get(ids[0]);
        const entB = entityMap.get(ids[1]);
        if (entA && entB && entA.type === 'line' && entB.type === 'line') {
          const p1 = entA.start;
          const p2 = entA.end;
          
          let dx = p2.x - p1.x;
          let dy = p2.y - p1.y;
          const len = Math.hypot(dx, dy);
          if (len > 1e-7) {
            dx /= len;
            dy /= len;
            
            for (const pt of [entB.start, entB.end]) {
              const fix = isFixed(pt, entB.id);
              if (!fix) {
                const vx = pt.x - p1.x;
                const vy = pt.y - p1.y;
                const t = vx * dx + vy * dy;
                const px = p1.x + t * dx;
                const py = p1.y + t * dy;
                
                const disp = Math.hypot(pt.x - px, pt.y - py);
                pt.x = px;
                pt.y = py;
                if (disp > iterMaxDisp) iterMaxDisp = disp;
              }
            }
          }
        }
      }

      // -------------------------------------------------------------
      // (H) 對稱約束 (Symmetric Constraint)
      // -------------------------------------------------------------
      else if (type === 'symmetric' && ids.length >= 3) {
        const entA = entityMap.get(ids[0]);
        const entB = entityMap.get(ids[1]);
        const axisEnt = entityMap.get(ids[2]); // The symmetry axis
        if (entA && entB && axisEnt && axisEnt.type === 'line') {
           const ptA = getEntityPoint(entA, (constraint as any).pointIndexA ?? 0);
           const ptB = getEntityPoint(entB, (constraint as any).pointIndexB ?? 0);
           
           if (ptA && ptB) {
             const ax1 = axisEnt.start;
             const ax2 = axisEnt.end;
             let dx = ax2.x - ax1.x;
             let dy = ax2.y - ax1.y;
             const len = Math.hypot(dx, dy);
             if (len > 1e-7) {
               dx /= len;
               dy /= len;
               
               const fixA = isFixed(ptA, entA.id);
               const fixB = isFixed(ptB, entB.id);
               
               if (!fixA || !fixB) {
                 const vxA = ptA.x - ax1.x;
                 const vyA = ptA.y - ax1.y;
                 const tA = vxA * dx + vyA * dy;
                 const pxA = ax1.x + tA * dx;
                 const pyA = ax1.y + tA * dy;
                 
                 const expectedBx = pxA - (ptA.x - pxA);
                 const expectedBy = pyA - (ptA.y - pyA);
                 
                 if (fixA && !fixB) {
                   const disp = Math.hypot(ptB.x - expectedBx, ptB.y - expectedBy);
                   ptB.x = expectedBx;
                   ptB.y = expectedBy;
                   if (disp > iterMaxDisp) iterMaxDisp = disp;
                 } else if (!fixA && fixB) {
                   const vxB = ptB.x - ax1.x;
                   const vyB = ptB.y - ax1.y;
                   const tB = vxB * dx + vyB * dy;
                   const pxB = ax1.x + tB * dx;
                   const pyB = ax1.y + tB * dy;
                   
                   const expectedAx = pxB - (ptB.x - pxB);
                   const expectedAy = pyB - (ptB.y - pyB);
                   const disp = Math.hypot(ptA.x - expectedAx, ptA.y - expectedAy);
                   ptA.x = expectedAx;
                   ptA.y = expectedAy;
                   if (disp > iterMaxDisp) iterMaxDisp = disp;
                 } else {
                   const vxB = ptB.x - ax1.x;
                   const vyB = ptB.y - ax1.y;
                   const tB = vxB * dx + vyB * dy;
                   const pxB = ax1.x + tB * dx;
                   const pyB = ax1.y + tB * dy;
                   
                   const expectedAx = pxB - (ptB.x - pxB);
                   const expectedAy = pyB - (ptB.y - pyB);
                   
                   const disp1 = Math.hypot(ptA.x - expectedAx, ptA.y - expectedAy) / 2;
                   const disp2 = Math.hypot(ptB.x - expectedBx, ptB.y - expectedBy) / 2;
                   
                   ptA.x += (expectedAx - ptA.x) / 2;
                   ptA.y += (expectedAy - ptA.y) / 2;
                   ptB.x += (expectedBx - ptB.x) / 2;
                   ptB.y += (expectedBy - ptB.y) / 2;
                   
                   const disp = Math.max(disp1, disp2);
                   if (disp > iterMaxDisp) iterMaxDisp = disp;
                 }
               }
             }
           }
        }
      }

      // -------------------------------------------------------------
      // (I) 相切約束 (Tangent Constraint)
      // -------------------------------------------------------------
      else if (type === 'tangent' && ids.length >= 2) {
        const entA = entityMap.get(ids[0]);
        const entB = entityMap.get(ids[1]);
        if (entA && entB) {
          // Line & Circle
          let lineEnt: LineEntity | null = null;
          let circleEnt: CircleEntity | ArcEntity | null = null;
          if (entA.type === 'line' && (entB.type === 'circle' || entB.type === 'arc')) {
            lineEnt = entA as LineEntity;
            circleEnt = entB as CircleEntity | ArcEntity;
          } else if (entB.type === 'line' && (entA.type === 'circle' || entA.type === 'arc')) {
            lineEnt = entB as LineEntity;
            circleEnt = entA as CircleEntity | ArcEntity;
          }
          
          if (lineEnt && circleEnt) {
             const p1 = lineEnt.start;
             const p2 = lineEnt.end;
             const c = circleEnt.center;
             const r = circleEnt.radius;
             
             let dx = p2.x - p1.x;
             let dy = p2.y - p1.y;
             const len = Math.hypot(dx, dy);
             if (len > 1e-7) {
               dx /= len;
               dy /= len;
               const nx = -dy;
               const ny = dx;
               
               const vx = c.x - p1.x;
               const vy = c.y - p1.y;
               const dist = vx * nx + vy * ny;
               
               const error = Math.abs(dist) - r;
               const fixC = isFixed(c, circleEnt.id);
               
               if (!fixC && Math.abs(error) > 1e-5) {
                 const sign = dist >= 0 ? 1 : -1;
                 c.x -= nx * sign * error;
                 c.y -= ny * sign * error;
                 if (Math.abs(error) > iterMaxDisp) iterMaxDisp = Math.abs(error);
               }
             }
          }
          // Circle & Circle
          else if ((entA.type === 'circle' || entA.type === 'arc') && (entB.type === 'circle' || entB.type === 'arc')) {
            const c1 = entA.center;
            const c2 = entB.center;
            const r1 = entA.radius;
            const r2 = (entB as CircleEntity | ArcEntity).radius;
            
            const targetDist = r1 + r2; 
            let dx = c2.x - c1.x;
            let dy = c2.y - c1.y;
            let curLen = Math.hypot(dx, dy);
            
            if (curLen < 1e-7) { dx = 1; dy = 0; curLen = 1; }
            const ux = dx / curLen;
            const uy = dy / curLen;
            const delta = curLen - targetDist;
            
            const fix1 = isFixed(c1, entA.id);
            const fix2 = isFixed(c2, entB.id);
            
            if (!fix1 && fix2) {
              c1.x += ux * delta;
              c1.y += uy * delta;
              if (Math.abs(delta) > iterMaxDisp) iterMaxDisp = Math.abs(delta);
            } else if (fix1 && !fix2) {
              c2.x -= ux * delta;
              c2.y -= uy * delta;
              if (Math.abs(delta) > iterMaxDisp) iterMaxDisp = Math.abs(delta);
            } else if (!fix1 && !fix2) {
              c1.x += ux * (delta / 2);
              c1.y += uy * (delta / 2);
              c2.x -= ux * (delta / 2);
              c2.y -= uy * (delta / 2);
              if (Math.abs(delta) > iterMaxDisp) iterMaxDisp = Math.abs(delta);
            }
          }
        }
      }
    }

    // 紀錄最大推移量
    overallMaxDisp = Math.max(overallMaxDisp, iterMaxDisp);

    // 檢查收斂條件
    if (iterMaxDisp < SOLVER_TOLERANCE) {
      converged = true;
      break;
    }
  }

  // 4. 包裝並回傳純函數結果 (同時相容陣列與物件解構)
  const result = Object.assign(newEntities, {
    converged,
    iterations,
    maxDisp: overallMaxDisp,
    entities: newEntities
  }) as SolveEntitiesResult;

  return result;
}

/**
 * 計算圖元初始自由度 (Degrees of Freedom)
 * - 線段 (Line): 4 DOF (start.x, start.y, end.x, end.y)
 * - 圓形 (Circle): 3 DOF (center.x, center.y, radius)
 * - 圓弧 (Arc): 5 DOF (center.x, center.y, radius, startAngle, endAngle)
 * - 折線 (Polyline): 2 * 頂點數 DOF
 */
export function getInitialEntityDof(entity: CADEntity2D): number {
  switch (entity.type) {
    case 'line':
      return 4;
    case 'circle':
      return 3;
    case 'arc':
      return 5;
    case 'polyline':
      return Math.max(2, entity.vertices.length * 2);
    default:
      return 2;
  }
}

/**
 * 取得各約束類型所消除之自由度數量
 */
export function getConstraintDofReduction(type: ConstraintType): number {
  switch (type) {
    case 'fixed':
      return 4; // 鎖定圖元通常消除全部自由度
    case 'horizontal':
      return 1; // y1 = y2
    case 'vertical':
      return 1; // x1 = x2
    case 'length':
    case 'distance':
      return 1; // 距離/長度等式
    case 'coincident':
      return 2; // (x1 = x2, y1 = y2)
    case 'parallel':
    case 'perpendicular':
    case 'tangent':
      return 1;
    case 'collinear':
      return 2; // 共線消除角度與平移
    case 'concentric':
      return 2; // (cx1 = cx2, cy1 = cy2)
    case 'symmetric':
      return 2; // 對稱通常消除兩個座標自由度
    case 'equal_length':
    case 'equal_radius':
      return 1;
    case 'midpoint':
      return 2;
    default:
      return 1;
  }
}

/**
 * 自由度分析函式：analyzeSketchState
 * 根據草圖中的圖元與幾何約束數量計算總體與各圖元之 DOF，
 * 並標記圖元狀態為 UnderDefined (欠定義)、FullyDefined (完全定義) 或 OverDefined (過度定義)。
 *
 * @param entities 草圖中的圖元陣列
 * @param constraints 草圖中的約束集合
 * @returns 完整的草圖分析診斷物件，包含標記後的全新 entities 陣列
 */
export function analyzeSketchState(
  entities: CADEntity2D[],
  constraints: Constraint[]
): SketchAnalysisResult {
  // 純函數深拷貝圖元
  const clonedEntities = cloneEntities(entities);
  const activeConstraints = constraints.filter((c) => !c.isSuppressed);

  const entityDof: Record<string, number> = {};
  const entityStates: Record<string, DefinedState> = {};

  // 1. 初始化各圖元之固有自由度
  for (const ent of clonedEntities) {
    entityDof[ent.id] = getInitialEntityDof(ent);
  }

  // 2. 累計並扣減約束所消耗之自由度
  for (const constraint of activeConstraints) {
    const reduction = getConstraintDofReduction(constraint.type);
    const ids = constraint.entityIds;

    if (ids.length === 1) {
      const entId = ids[0];
      if (entityDof[entId] !== undefined) {
        entityDof[entId] -= reduction;
      }
    } else if (ids.length >= 2) {
      // 多圖元共享約束：平均分配消除之自由度至各參與圖元
      const share = reduction / ids.length;
      for (const entId of ids) {
        if (entityDof[entId] !== undefined) {
          entityDof[entId] -= share;
        }
      }
    }
  }

  // 3. 判定各圖元之定義狀態並打上標籤
  for (const ent of clonedEntities) {
    const rawDof = entityDof[ent.id] ?? 0;
    // 容許極小浮點數誤差判定
    const roundedDof = Math.abs(rawDof) < 1e-4 ? 0 : rawDof;
    entityDof[ent.id] = Math.round(roundedDof * 10) / 10;

    let entState: DefinedState;
    if (roundedDof > 0) {
      entState = 'UnderDefined';
    } else if (roundedDof === 0) {
      entState = 'FullyDefined';
    } else {
      entState = 'OverDefined';
    }

    entityStates[ent.id] = entState;
    // 同步更新圖元物件內部狀態 (兼具大駝峰與標準格式相容性)
    ent.state = entState as EntityState;

    if (!ent.metadata) {
      ent.metadata = {};
    }
    ent.metadata.dof = entityDof[ent.id];
    ent.metadata.definedState = entState;
  }

  // 4. 計算整個草圖總體自由度與總狀態
  const totalDof = Object.values(entityDof).reduce((sum, val) => sum + val, 0);
  const roundedTotalDof = Math.abs(totalDof) < 1e-4 ? 0 : Math.round(totalDof * 10) / 10;

  let sketchState: DefinedState;
  let sketchStatus: 'under_constrained' | 'fully_constrained' | 'over_constrained';

  if (roundedTotalDof > 0) {
    sketchState = 'UnderDefined';
    sketchStatus = 'under_constrained';
  } else if (roundedTotalDof === 0) {
    sketchState = 'FullyDefined';
    sketchStatus = 'fully_constrained';
  } else {
    sketchState = 'OverDefined';
    sketchStatus = 'over_constrained';
  }

  return {
    dof: roundedTotalDof,
    state: sketchState,
    status: sketchStatus,
    entityDof,
    entityStates,
    entities: clonedEntities
  };
}
