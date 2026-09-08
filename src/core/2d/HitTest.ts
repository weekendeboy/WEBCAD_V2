import { Point2D, CADEntity2D } from '../../types/cad.ts';

/**
 * 計算點 P 到線段 AB 的最短距離與投影點
 * @param p 待測點座標 (世界座標)
 * @param a 線段起點 A
 * @param b 線段終點 B
 */
export function pointToSegmentDistance(
  p: Point2D,
  a: Point2D,
  b: Point2D
): { distance: number; projection: Point2D; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  // 起點與終點重合之退化線段
  if (lenSq < 1e-10) {
    const dist = Math.hypot(p.x - a.x, p.y - a.y);
    return { distance: dist, projection: { x: a.x, y: a.y }, t: 0 };
  }

  // 向量投影純量 t = ((P - A) · (B - A)) / |B - A|^2
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  // 限制 t 在 [0, 1] 範圍內以確保落在線段內
  const clampedT = Math.max(0, Math.min(1, t));

  const projX = a.x + clampedT * dx;
  const projY = a.y + clampedT * dy;
  const dist = Math.hypot(p.x - projX, p.y - projY);

  return {
    distance: dist,
    projection: { x: projX, y: projY },
    t: clampedT
  };
}

/**
 * 計算點 P 到圓周的最短距離 (點到圓周距離 |dist(P, center) - radius|)
 * @param p 待測點座標 (世界座標)
 * @param center 圓心
 * @param radius 半徑
 */
export function pointToCircleDistance(
  p: Point2D,
  center: Point2D,
  radius: number
): { distance: number; closestPoint: Point2D } {
  const distToCenter = Math.hypot(p.x - center.x, p.y - center.y);
  const distance = Math.abs(distToCenter - radius);

  let closestPoint: Point2D;
  if (distToCenter < 1e-10) {
    // 若點與圓心完全重合，任選半徑方向上的點
    closestPoint = { x: center.x + radius, y: center.y };
  } else {
    closestPoint = {
      x: center.x + (radius * (p.x - center.x)) / distToCenter,
      y: center.y + (radius * (p.y - center.y)) / distToCenter
    };
  }

  return { distance, closestPoint };
}

/**
 * 計算點 P 到圓弧的最短距離
 * @param p 待測點
 * @param center 弧心
 * @param radius 半徑
 * @param startAngle 起始弧度
 * @param endAngle 結束弧度
 * @param counterClockwise 是否逆時針
 */
export function pointToArcDistance(
  p: Point2D,
  center: Point2D,
  radius: number,
  startAngle: number,
  endAngle: number,
  counterClockwise: boolean = false
): { distance: number } {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const distToCenter = Math.hypot(dx, dy);
  let angle = Math.atan2(dy, dx);
  if (angle < 0) angle += 2 * Math.PI;

  const norm = (a: number) => {
    let r = a % (2 * Math.PI);
    if (r < 0) r += 2 * Math.PI;
    return r;
  };

  const s = norm(startAngle);
  const e = norm(endAngle);

  let isWithin = false;
  if (!counterClockwise) {
    if (s <= e) {
      isWithin = angle >= s && angle <= e;
    } else {
      isWithin = angle >= s || angle <= e;
    }
  } else {
    if (e <= s) {
      isWithin = angle >= e && angle <= s;
    } else {
      isWithin = angle >= e || angle <= s;
    }
  }

  if (isWithin) {
    return { distance: Math.abs(distToCenter - radius) };
  }

  // 若不在弧線角度內，最短距離為到兩端點的最小距離
  const startPt: Point2D = {
    x: center.x + radius * Math.cos(startAngle),
    y: center.y + radius * Math.sin(startAngle)
  };
  const endPt: Point2D = {
    x: center.x + radius * Math.cos(endAngle),
    y: center.y + radius * Math.sin(endAngle)
  };
  const dStart = Math.hypot(p.x - startPt.x, p.y - startPt.y);
  const dEnd = Math.hypot(p.x - endPt.x, p.y - endPt.y);

  return { distance: Math.min(dStart, dEnd) };
}

/**
 * 數學碰撞模組 (Hit Testing)
 * 計算點到線段的最短距離（點到線段投影），以及點到圓周的距離，
 * 回傳距離世界座標 worldPt 最近且小於等於 threshold 的圖元 entityId。
 *
 * @param worldPt 點擊的世界座標
 * @param entities CAD 幾何圖元陣列
 * @param threshold 碰撞檢測閾值 (世界單位)
 * @returns 命中的 entityId，若無圖元在閾值內則回傳 null
 */
export function hitTest(
  worldPt: Point2D | null | undefined,
  entities: CADEntity2D[],
  threshold: number = 3
): string | null {
  if (!worldPt || !entities || entities.length === 0 || threshold <= 0) {
    return null;
  }

  let closestEntityId: string | null = null;
  let minDistance = threshold;

  for (const entity of entities) {
    if (!entity) continue;

    let dist = Infinity;

    switch (entity.type) {
      case 'line': {
        const res = pointToSegmentDistance(worldPt, entity.start, entity.end);
        dist = res.distance;
        break;
      }

      case 'circle': {
        const res = pointToCircleDistance(worldPt, entity.center, entity.radius);
        dist = res.distance;
        break;
      }

      case 'arc': {
        const res = pointToArcDistance(
          worldPt,
          entity.center,
          entity.radius,
          entity.startAngle,
          entity.endAngle,
          entity.counterClockwise
        );
        dist = res.distance;
        break;
      }

      case 'polyline': {
        const verts = entity.vertices;
        if (verts && verts.length >= 2) {
          for (let i = 0; i < verts.length - 1; i++) {
            const segRes = pointToSegmentDistance(
              worldPt,
              verts[i].point,
              verts[i + 1].point
            );
            if (segRes.distance < dist) {
              dist = segRes.distance;
            }
          }
          if (entity.isClosed && verts.length > 2) {
            const closeRes = pointToSegmentDistance(
              worldPt,
              verts[verts.length - 1].point,
              verts[0].point
            );
            if (closeRes.distance < dist) {
              dist = closeRes.distance;
            }
          }
        }
        break;
      }

      default:
        break;
    }

    if (dist <= minDistance) {
      minDistance = dist;
      closestEntityId = entity.id;
    }
  }

  return closestEntityId;
}
