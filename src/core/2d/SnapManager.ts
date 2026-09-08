import { Point2D, CADEntity2D } from '../../types/cad.ts';

export interface SnapResult {
  point: Point2D;
  type: string;
  entityId: string;
}

/**
 * 尋找距離游標最近的物件鎖點 (OSnap)
 * 遍歷傳入的圖元，計算距離游標最近的『端點 (Endpoint)』、『中點 (Midpoint)』或『圓心 (Center)』
 *
 * @param mouseWorldPt 滑鼠游標世界座標 (mm)
 * @param entities 畫布上的 CAD 幾何圖元清單
 * @param scale 螢幕與世界座標縮放比例 (screen px / world unit)
 * @param screenThreshold 螢幕像素距離吸附閾值 (預設 15px)
 * @returns 最近的鎖點資訊或 null
 */
export function findSnapPoint(
  mouseWorldPt: Point2D | null | undefined,
  entities: CADEntity2D[],
  scale: number,
  screenThreshold: number = 15
): SnapResult | null {
  if (!mouseWorldPt || !entities || entities.length === 0 || scale <= 0) {
    return null;
  }

  let bestSnap: SnapResult | null = null;
  let minScreenDist = screenThreshold;

  const checkCandidate = (candPt: Point2D, type: string, entityId: string) => {
    const dx = candPt.x - mouseWorldPt.x;
    const dy = candPt.y - mouseWorldPt.y;
    const worldDist = Math.hypot(dx, dy);
    const screenDist = worldDist * scale;

    if (screenDist <= minScreenDist) {
      minScreenDist = screenDist;
      bestSnap = {
        point: { x: candPt.x, y: candPt.y },
        type,
        entityId
      };
    }
  };

  for (const entity of entities) {
    // 忽略隱藏或無效的幾何圖元
    if (!entity) continue;

    switch (entity.type) {
      case 'line': {
        // 端點 (Endpoint): 起點與終點
        checkCandidate(entity.start, 'endpoint', entity.id);
        checkCandidate(entity.end, 'endpoint', entity.id);

        // 中點 (Midpoint): 線段中點
        const mid: Point2D = {
          x: (entity.start.x + entity.end.x) / 2,
          y: (entity.start.y + entity.end.y) / 2
        };
        checkCandidate(mid, 'midpoint', entity.id);
        break;
      }

      case 'circle': {
        // 圓心 (Center)
        checkCandidate(entity.center, 'center', entity.id);
        break;
      }

      case 'arc': {
        // 圓心 (Center)
        checkCandidate(entity.center, 'center', entity.id);

        // 端點 (Endpoint): 弧線起點與弧線終點
        const startPt: Point2D = {
          x: entity.center.x + entity.radius * Math.cos(entity.startAngle),
          y: entity.center.y + entity.radius * Math.sin(entity.startAngle)
        };
        const endPt: Point2D = {
          x: entity.center.x + entity.radius * Math.cos(entity.endAngle),
          y: entity.center.y + entity.radius * Math.sin(entity.endAngle)
        };
        checkCandidate(startPt, 'endpoint', entity.id);
        checkCandidate(endPt, 'endpoint', entity.id);

        // 中點 (Midpoint): 沿弧線的中間點
        let sAngle = entity.startAngle;
        let eAngle = entity.endAngle;
        if (entity.counterClockwise === false) {
          if (sAngle < eAngle) sAngle += 2 * Math.PI;
          const midAngle = (sAngle + eAngle) / 2;
          const midPt: Point2D = {
            x: entity.center.x + entity.radius * Math.cos(midAngle),
            y: entity.center.y + entity.radius * Math.sin(midAngle)
          };
          checkCandidate(midPt, 'midpoint', entity.id);
        } else {
          if (eAngle < sAngle) eAngle += 2 * Math.PI;
          const midAngle = (sAngle + eAngle) / 2;
          const midPt: Point2D = {
            x: entity.center.x + entity.radius * Math.cos(midAngle),
            y: entity.center.y + entity.radius * Math.sin(midAngle)
          };
          checkCandidate(midPt, 'midpoint', entity.id);
        }
        break;
      }

      case 'polyline': {
        const vertices = entity.vertices;
        if (!vertices || vertices.length === 0) break;

        // 端點 (Endpoint): 所有頂點
        for (let i = 0; i < vertices.length; i++) {
          checkCandidate(vertices[i].point, 'endpoint', entity.id);

          // 中點 (Midpoint): 各相鄰頂點段的中點
          if (i < vertices.length - 1 || entity.isClosed) {
            const nextPt = vertices[(i + 1) % vertices.length].point;
            const midPt: Point2D = {
              x: (vertices[i].point.x + nextPt.x) / 2,
              y: (vertices[i].point.y + nextPt.y) / 2
            };
            checkCandidate(midPt, 'midpoint', entity.id);
          }
        }
        break;
      }

      default:
        break;
    }
  }

  return bestSnap;
}
