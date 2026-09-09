/**
 * @license
 * SolidWorks-style "Sketch on Face" 3D R3F Canvas Overlay
 *
 * 核心功能：
 * 1. 在 3D 空間中渲染被選定/作用中的斜面草圖局部座標系 (Local Coordinate Triad: Red X, Green Y, Blue Normal)。
 * 2. 利用 4x4 仿射變換矩陣 M，在任意斜面上動態渲染 2D 局部草圖網格 (Local Plane Grid)。
 * 3. 即時將 2D 草圖幾何圖元 (Line, Circle, Arc, Polyline) 透過 4x4 矩陣離散並以 3D 線條直接渲染在該斜面上。
 * 4. 支援在 3D 視角中透過 Raycaster 與斜面求交，直接在該任意斜面上繪製幾何圖元 (Line, Circle, Rectangle)！
 */

import React, { useMemo, useRef, useState, useEffect } from 'react';
import * as THREE from 'three';
import { useThree, ThreeEvent } from '@react-three/fiber';
import {
  CustomPlane,
  CADEntity2D,
  Point2D,
  Point3D,
  LineEntity,
  CircleEntity,
  CADTool,
  SketchFeature
} from '../types/cad.ts';
import {
  createLocalCoordinateSystem,
  sketchToWorld,
  worldToSketch,
  intersectRayWithPlane,
  entity2DTo3DWire,
  LocalCoordinateSystem
} from '../core/math/SketchOnFaceMath.ts';
import { useCadStore } from '../contexts/CadContext.tsx';

interface SketchOnFaceOverlayProps {
  activeSketch?: SketchFeature;
  currentTool: CADTool;
  hoveredFaceInfo: {
    point: Point3D;
    normal: Point3D;
    slope: number;
    centroid?: Point3D;
  } | null;
  onPlaneDrawnEntity?: (entity: CADEntity2D) => void;
}

export const SketchOnFaceOverlay: React.FC<SketchOnFaceOverlayProps> = ({
  activeSketch,
  currentTool,
  hoveredFaceInfo,
  onPlaneDrawnEntity
}) => {
  const { camera, raycaster } = useThree();
  const plane = activeSketch?.plane;

  // 1. 構建當前草圖平面的局部座標系 (LCS) 與 4x4 矩陣
  const lcs = useMemo<LocalCoordinateSystem | null>(() => {
    if (!plane) return null;
    return createLocalCoordinateSystem(plane.origin, plane.normal, plane.xAxis);
  }, [plane?.origin.x, plane?.origin.y, plane?.origin.z, plane?.normal.x, plane?.normal.y, plane?.normal.z]);

  // 2. 局部網格幾何體 (Local Grid on Inclined Plane, 4x4 Matrix transformed)
  const gridGeometry = useMemo(() => {
    if (!lcs) return null;
    const size = 120;
    const divisions = 12;
    const step = size / divisions;
    const half = size / 2;

    const positions: number[] = [];

    // 格線 (平行於局部 X 軸 與 Y 軸)
    for (let i = -half; i <= half; i += step) {
      // 橫線 (沿 X 延伸)
      const p1 = sketchToWorld({ x: -half, y: i }, lcs);
      const p2 = sketchToWorld({ x: half, y: i }, lcs);
      positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);

      // 直線 (沿 Y 延伸)
      const q1 = sketchToWorld({ x: i, y: -half }, lcs);
      const q2 = sketchToWorld({ x: i, y: half }, lcs);
      positions.push(q1.x, q1.y, q1.z, q2.x, q2.y, q2.z);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }, [lcs]);

  // 3. 渲染草圖內現有 2D 實體在 3D 空間中的線段
  const sketchEntitiesWires = useMemo(() => {
    if (!lcs || !activeSketch || !activeSketch.entities) return [];

    return activeSketch.entities.map((ent) => {
      const pts3D = entity2DTo3DWire(ent, lcs);
      if (pts3D.length < 2) return null;

      const positions: number[] = [];
      for (let i = 0; i < pts3D.length - 1; i++) {
        positions.push(
          pts3D[i].x, pts3D[i].y, pts3D[i].z,
          pts3D[i + 1].x, pts3D[i + 1].y, pts3D[i + 1].z
        );
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      return { id: ent.id, geo, color: ent.color || '#38bdf8' };
    }).filter(Boolean);
  }, [lcs, activeSketch?.entities]);

  // 4. 3D 空間中在斜面上即時繪圖的狀態 (Direct Drawing on Slanted Face)
  const [drawingStart2D, setDrawingStart2D] = useState<Point2D | null>(null);
  const [currentCursor2D, setCurrentCursor2D] = useState<Point2D | null>(null);

  // 預覽正在繪製中的幾何線段
  const inProgressPreviewGeo = useMemo(() => {
    if (!lcs || !drawingStart2D || !currentCursor2D) return null;

    const positions: number[] = [];

    if (currentTool === 'LINE') {
      const p1 = sketchToWorld(drawingStart2D, lcs);
      const p2 = sketchToWorld(currentCursor2D, lcs);
      positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    } else if (currentTool === 'CIRCLE') {
      const r = Math.hypot(currentCursor2D.x - drawingStart2D.x, currentCursor2D.y - drawingStart2D.y);
      const segments = 36;
      for (let i = 0; i < segments; i++) {
        const theta1 = (i / segments) * Math.PI * 2;
        const theta2 = ((i + 1) / segments) * Math.PI * 2;
        const p1 = sketchToWorld({
          x: drawingStart2D.x + r * Math.cos(theta1),
          y: drawingStart2D.y + r * Math.sin(theta1)
        }, lcs);
        const p2 = sketchToWorld({
          x: drawingStart2D.x + r * Math.cos(theta2),
          y: drawingStart2D.y + r * Math.sin(theta2)
        }, lcs);
        positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      }
    } else if (currentTool === 'RECTANGLE') {
      const x1 = drawingStart2D.x;
      const y1 = drawingStart2D.y;
      const x2 = currentCursor2D.x;
      const y2 = currentCursor2D.y;

      const corners = [
        { x: x1, y: y1 },
        { x: x2, y: y1 },
        { x: x2, y: y2 },
        { x: x1, y: y2 }
      ];

      for (let i = 0; i < 4; i++) {
        const p1 = sketchToWorld(corners[i], lcs);
        const p2 = sketchToWorld(corners[(i + 1) % 4], lcs);
        positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      }
    }

    if (positions.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }, [lcs, drawingStart2D, currentCursor2D, currentTool]);

  // 5. 點擊與拖曳繪圖處理 (與斜面求交)
  const isDrawToolActive = currentTool === 'LINE' || currentTool === 'CIRCLE' || currentTool === 'RECTANGLE';

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!isDrawToolActive || !lcs) return;
    e.stopPropagation();

    // 取得射線與草圖斜面的交點
    const hit = intersectRayWithPlane(
      { x: e.ray.origin.x, y: e.ray.origin.y, z: e.ray.origin.z },
      { x: e.ray.direction.x, y: e.ray.direction.y, z: e.ray.direction.z },
      lcs
    );

    if (hit) {
      setDrawingStart2D(hit.sketchPoint2D);
      setCurrentCursor2D(hit.sketchPoint2D);
    }
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!isDrawToolActive || !lcs) return;

    const hit = intersectRayWithPlane(
      { x: e.ray.origin.x, y: e.ray.origin.y, z: e.ray.origin.z },
      { x: e.ray.direction.x, y: e.ray.direction.y, z: e.ray.direction.z },
      lcs
    );

    if (hit) {
      setCurrentCursor2D(hit.sketchPoint2D);
    }
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (!isDrawToolActive || !lcs || !drawingStart2D || !currentCursor2D) return;
    e.stopPropagation();

    const dx = currentCursor2D.x - drawingStart2D.x;
    const dy = currentCursor2D.y - drawingStart2D.y;
    const dist = Math.hypot(dx, dy);

    // 避免微小誤觸
    if (dist > 1.5) {
      if (currentTool === 'LINE') {
        const newLine: LineEntity = {
          id: `ent_line_face_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'line',
          layer: 'layer_outline',
          color: '#38bdf8',
          state: 'under_constrained',
          isConstruction: false,
          start: { ...drawingStart2D },
          end: { ...currentCursor2D }
        };
        onPlaneDrawnEntity?.(newLine);
      } else if (currentTool === 'CIRCLE') {
        const newCircle: CircleEntity = {
          id: `ent_circle_face_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'circle',
          layer: 'layer_outline',
          color: '#f59e0b',
          state: 'under_constrained',
          isConstruction: false,
          center: { ...drawingStart2D },
          radius: Math.round(dist * 10) / 10
        };
        onPlaneDrawnEntity?.(newCircle);
      } else if (currentTool === 'RECTANGLE') {
        // 建立 4 條線段構成矩形
        const x1 = drawingStart2D.x;
        const y1 = drawingStart2D.y;
        const x2 = currentCursor2D.x;
        const y2 = currentCursor2D.y;

        const pA = { x: x1, y: y1 };
        const pB = { x: x2, y: y1 };
        const pC = { x: x2, y: y2 };
        const pD = { x: x1, y: y2 };

        const lines: LineEntity[] = [
          {
            id: `ent_line_r1_${Date.now()}`,
            type: 'line',
            layer: 'layer_outline',
            color: '#38bdf8',
            state: 'under_constrained',
            isConstruction: false,
            start: pA,
            end: pB
          },
          {
            id: `ent_line_r2_${Date.now()}`,
            type: 'line',
            layer: 'layer_outline',
            color: '#38bdf8',
            state: 'under_constrained',
            isConstruction: false,
            start: pB,
            end: pC
          },
          {
            id: `ent_line_r3_${Date.now()}`,
            type: 'line',
            layer: 'layer_outline',
            color: '#38bdf8',
            state: 'under_constrained',
            isConstruction: false,
            start: pC,
            end: pD
          },
          {
            id: `ent_line_r4_${Date.now()}`,
            type: 'line',
            layer: 'layer_outline',
            color: '#38bdf8',
            state: 'under_constrained',
            isConstruction: false,
            start: pD,
            end: pA
          }
        ];

        for (const l of lines) {
          onPlaneDrawnEntity?.(l);
        }
      }
    }

    setDrawingStart2D(null);
    setCurrentCursor2D(null);
  };

  return (
    <group>
      {/* 1. 當前作用中草圖平面 (Active Sketch Plane) 網格與座標三軸 */}
      {lcs && (
        <group>
          {/* 3D 局部草圖網格 (Local Grid) */}
          {gridGeometry && (
            <lineSegments geometry={gridGeometry}>
              <lineBasicMaterial
                color="#0284c7"
                transparent
                opacity={0.35}
                depthWrite={false}
              />
            </lineSegments>
          )}

          {/* 局部座標三軸向指示 (Red=X, Green=Y, Blue=Normal) */}
          <group position={[lcs.origin.x, lcs.origin.y, lcs.origin.z]}>
            {/* X 軸 (紅色) */}
            <arrowHelper
              args={[
                new THREE.Vector3(lcs.xAxis.x, lcs.xAxis.y, lcs.xAxis.z),
                new THREE.Vector3(0, 0, 0),
                22,
                0xef4444,
                5,
                3
              ]}
            />
            {/* Y 軸 (綠色) */}
            <arrowHelper
              args={[
                new THREE.Vector3(lcs.yAxis.x, lcs.yAxis.y, lcs.yAxis.z),
                new THREE.Vector3(0, 0, 0),
                22,
                0x10b981,
                5,
                3
              ]}
            />
            {/* Z 軸 / Normal (藍色) */}
            <arrowHelper
              args={[
                new THREE.Vector3(lcs.normal.x, lcs.normal.y, lcs.normal.z),
                new THREE.Vector3(0, 0, 0),
                26,
                0x3b82f6,
                6,
                3.5
              ]}
            />
            {/* 原點標記球 */}
            <mesh>
              <sphereGeometry args={[1.5, 16, 16]} />
              <meshBasicMaterial color="#facc15" />
            </mesh>
          </group>

          {/* 渲染草圖內已存在之 2D 圖元 (以 3D 線條投射在斜面上) */}
          {sketchEntitiesWires.map((item) => item && (
            <lineSegments key={item.id} geometry={item.geo}>
              <lineBasicMaterial color={item.color} linewidth={2} />
            </lineSegments>
          ))}

          {/* 繪製中即時動態預覽線段 */}
          {inProgressPreviewGeo && (
            <lineSegments geometry={inProgressPreviewGeo}>
              <lineBasicMaterial color="#f59e0b" linewidth={3} />
            </lineSegments>
          )}

          {/* 隱形大型求交平面 (當繪圖工具啟動時，捕捉射線求交與繪製) */}
          {isDrawToolActive && (
            <mesh
              position={[lcs.origin.x, lcs.origin.y, lcs.origin.z]}
              quaternion={
                new THREE.Quaternion().setFromUnitVectors(
                  new THREE.Vector3(0, 0, 1),
                  new THREE.Vector3(lcs.normal.x, lcs.normal.y, lcs.normal.z)
                )
              }
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              visible={false}
            >
              <planeGeometry args={[1000, 1000]} />
            </mesh>
          )}
        </group>
      )}

      {/* 2. 滑鼠懸停面即時高亮指示器 (Hovered Face Coordinate Triad) */}
      {hoveredFaceInfo && (
        <group position={[hoveredFaceInfo.point.x, hoveredFaceInfo.point.y, hoveredFaceInfo.point.z]}>
          {/* 小原點標記 */}
          <mesh>
            <sphereGeometry args={[1.8, 16, 16]} />
            <meshBasicMaterial color="#38bdf8" />
          </mesh>

          {/* 法向量箭頭指示 (Blue/Cyan) */}
          <arrowHelper
            args={[
              new THREE.Vector3(
                hoveredFaceInfo.normal.x,
                hoveredFaceInfo.normal.y,
                hoveredFaceInfo.normal.z
              ),
              new THREE.Vector3(0, 0, 0),
              24,
              0x06b6d4,
              6,
              3.5
            ]}
          />
        </group>
      )}
    </group>
  );
};
