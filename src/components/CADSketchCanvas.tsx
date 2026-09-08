import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  CADEntity2D,
  Constraint,
  Dimension,
  LineEntity,
  CircleEntity,
  Point2D,
  LengthConstraint
} from '../types/cad.ts';
import { findSnapPoint, SnapResult } from '../core/2d/SnapManager.ts';
import { hitTest } from '../core/2d/HitTest.ts';
import { useSketchTopology } from '../core/2d/TopologyEngine.ts';
import {
  useCadStore,
  useCurrentTool,
  useActiveSketchId
} from '../contexts/CadContext.tsx';
import {
  ZoomIn,
  ZoomOut,
  Trash2,
  Crosshair,
  Move,
  RotateCcw,
  Sparkles,
  AlertCircle,
  Ruler
} from 'lucide-react';

/**
 * 計算尺寸線與延伸輔助線之世界幾何座標
 */
function computeDimensionGeometry(p1: Point2D, p2: Point2D, textPt: Point2D) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return null;

  // 線段方向之單位向量 (ux, uy) 與法向量 (nx, ny)
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;

  // 投影計算：文字點相對於線段的垂直位移量 (offset)
  const wx = textPt.x - p1.x;
  const wy = textPt.y - p1.y;
  let offset = wx * nx + wy * ny;
  if (Math.abs(offset) < 6) {
    offset = offset >= 0 ? 14 : -14;
  }

  // 尺寸線端點 (世界座標)
  const d1 = { x: p1.x + offset * nx, y: p1.y + offset * ny };
  const d2 = { x: p2.x + offset * nx, y: p2.y + offset * ny };

  // 尺寸輔助線起點 (稍微避開實體線 1.5mm) 與終點 (稍微突出尺寸線 3.5mm)
  const sign = offset >= 0 ? 1 : -1;
  const a1 = { x: p1.x + sign * 1.5 * nx, y: p1.y + sign * 1.5 * ny };
  const b1 = { x: d1.x + sign * 3.5 * nx, y: d1.y + sign * 3.5 * ny };

  const a2 = { x: p2.x + sign * 1.5 * nx, y: p2.y + sign * 1.5 * ny };
  const b2 = { x: d2.x + sign * 3.5 * nx, y: d2.y + sign * 3.5 * ny };

  // 尺寸文字方塊之幾何中心 (置於尺寸線中央)
  const textCenter = { x: (d1.x + d2.x) / 2, y: (d1.y + d2.y) / 2 };

  return { d1, d2, a1, b1, a2, b2, textCenter };
}

interface CADSketchCanvasProps {
  entities: CADEntity2D[];
  constraints: Constraint[];
  dimensions: Dimension[];
  planeName: string;
  solverState: 'under_constrained' | 'fully_constrained' | 'over_constrained';
  sketchId?: string;
}

export const CADSketchCanvas: React.FC<CADSketchCanvasProps> = ({
  entities,
  constraints,
  dimensions,
  planeName,
  solverState,
  sketchId
}) => {
  const currentTool = useCurrentTool();
  const setTool = useCadStore((s) => s.setTool);
  const activeSketchId = useActiveSketchId();
  const targetSketchId = sketchId || activeSketchId || 'feat_sketch_1';

  // 拓撲分析：防抖自動提取封閉面 (Closed Profiles)
  const profiles = useSketchTopology(targetSketchId);

  const addEntity = useCadStore((s) => s.addEntity);
  const deleteEntity = useCadStore((s) => s.deleteEntity);
  const addConstraint = useCadStore((s) => s.addConstraint);
  const addDimension = useCadStore((s) => s.addDimension);
  const selectedEntityIds = useCadStore((s) => s.selectedEntityIds);
  const setSelectedEntityIds = useCadStore((s) => s.setSelectedEntityIds);

  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);
  const [showConstraints, setShowConstraints] = useState(true);
  const [showDimensions, setShowDimensions] = useState(true);

  // 尺寸標註工具選取狀態 (當 currentTool === 'DIMENSION' 時)
  const [dimensionTargetLine, setDimensionTargetLine] = useState<LineEntity | null>(null);

  // SVG container and element reference
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Internal Pan & Scale states (CAD convention: Y goes UP, SVG goes DOWN)
  const [scale, setScale] = useState<number>(2.6);
  const [pan, setPan] = useState<Point2D>({ x: 120, y: 100 });

  // Mouse pan interaction tracking
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ mouseX: number; mouseY: number; panX: number; panY: number } | null>(null);

  /**
   * ============================================================================
   * 繪圖狀態機 (Drawing State Machine)
   * ============================================================================
   * isDrawing: 是否處於多步驟繪圖進行中 (例如已點選第一點)
   * drawStartPt: 繪圖起點世界座標 (CAD World Point, mm)
   * cursorWorld: 滑鼠游標當前捕捉到的即時世界座標 (CAD World Point, mm)
   */
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [drawStartPt, setDrawStartPt] = useState<Point2D | null>(null);
  const [cursorWorld, setCursorWorld] = useState<Point2D | null>(null);
  const [currentSnap, setCurrentSnap] = useState<SnapResult | null>(null);

  /**
   * --------------------------------------------------------------------------
   * 座標轉換矩陣 / 函數 (Screen <-> World Transformation)
   * --------------------------------------------------------------------------
   * CAD World: X 向右 (+X), Y 向上 (+Y)
   * SVG Screen: svgX 向右 (+svgX), svgY 向下 (+svgY)
   *
   * svgX = pan.x + world.x * scale
   * svgY = pan.y - world.y * scale
   *
   * world.x = (svgX - pan.x) / scale
   * world.y = (pan.y - svgY) / scale
   * --------------------------------------------------------------------------
   */
  const worldToScreen = useCallback(
    (world: Point2D): Point2D => ({
      x: pan.x + world.x * scale,
      y: pan.y - world.y * scale
    }),
    [pan.x, pan.y, scale]
  );

  const screenToWorld = useCallback(
    (screen: Point2D): Point2D => ({
      x: (screen.x - pan.x) / scale,
      y: (pan.y - screen.y) / scale
    }),
    [pan.x, pan.y, scale]
  );

  // Direct scalar helper functions for SVG coordinate mapping
  const toSvgX = (x: number) => pan.x + x * scale;
  const toSvgY = (y: number) => pan.y - y * scale;

  /**
   * Convert client (DOM viewport) mouse coordinates to SVG internal viewBox coordinates (0..620, 0..400)
   */
  const clientToSvgPoint = useCallback((clientX: number, clientY: number): Point2D | null => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * 620,
      y: ((clientY - rect.top) / rect.height) * 400
    };
  }, []);

  /**
   * --------------------------------------------------------------------------
   * 取消防呆機制 (Cancel & Reset Safety Mechanism)
   * --------------------------------------------------------------------------
   * 按下 ESC 鍵即刻中斷繪圖狀態機、清空橡皮筋預覽，並若在繪圖工具下則切換回 SELECT 工具
   */
  const cancelDrawing = useCallback(() => {
    setIsDrawing(false);
    setDrawStartPt(null);
    setCurrentSnap(null);
    setDimensionTargetLine(null);
  }, []);

  // 監聽鍵盤 ESC 事件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (dimensionTargetLine) {
          setDimensionTargetLine(null);
        } else if (isDrawing) {
          cancelDrawing();
        } else if (currentTool !== 'SELECT') {
          setTool('SELECT');
          setSelectedEntityIds([]);
        } else {
          setSelectedEntityIds([]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDrawing, dimensionTargetLine, currentTool, cancelDrawing, setTool, setSelectedEntityIds]);

  // 當切換繪圖工具時，自動重置任何未完成的繪製動作
  useEffect(() => {
    cancelDrawing();
    setDimensionTargetLine(null);
  }, [currentTool, cancelDrawing]);

  /**
   * --------------------------------------------------------------------------
   * 滑鼠滾輪縮放 (Zoom Centered at Cursor)
   * --------------------------------------------------------------------------
   */
  const zoomAtPoint = useCallback(
    (screenPoint: Point2D, zoomFactor: number) => {
      setScale((prevScale) => {
        const nextScale = Math.min(Math.max(prevScale * zoomFactor, 0.4), 15);
        if (Math.abs(nextScale - prevScale) < 0.0001) return prevScale;

        // 計算目前游標所在世界座標
        const worldX = (screenPoint.x - pan.x) / prevScale;
        const worldY = (pan.y - screenPoint.y) / prevScale;

        // 補償平移量，確保游標下方的世界點保持固定
        const newPanX = screenPoint.x - worldX * nextScale;
        const newPanY = screenPoint.y + worldY * nextScale;

        setPan({ x: newPanX, y: newPanY });
        return nextScale;
      });
    },
    [pan.x, pan.y]
  );

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pt = clientToSvgPoint(e.clientX, e.clientY);
      if (!pt) return;

      const zoomFactor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomAtPoint(pt, zoomFactor);
    };

    svgEl.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      svgEl.removeEventListener('wheel', handleWheel);
    };
  }, [clientToSvgPoint, zoomAtPoint]);

  /**
   * --------------------------------------------------------------------------
   * 滑鼠中鍵平移 (Pan) 拖曳處理
   * --------------------------------------------------------------------------
   */
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    const isMiddleClick = e.button === 1;
    const isPanTool = e.button === 0 && currentTool === 'PAN';

    if (isMiddleClick || isPanTool) {
      e.preventDefault();
      const pt = clientToSvgPoint(e.clientX, e.clientY);
      if (!pt) return;

      setIsPanning(true);
      panStartRef.current = {
        mouseX: pt.x,
        mouseY: pt.y,
        panX: pan.x,
        panY: pan.y
      };
    }
  };

  /**
   * --------------------------------------------------------------------------
   * 滑鼠移動事件 (Mouse Move Handler)
   * 即時更新 cursorWorld，支援橡皮筋預覽與平移更新
   * --------------------------------------------------------------------------
   */
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const pt = clientToSvgPoint(e.clientX, e.clientY);
    if (!pt) return;

    // 即時轉換為世界座標
    const rawWorldPt = screenToWorld(pt);

    // 呼叫物件鎖點 (OSnap) 演算法
    const snap = findSnapPoint(rawWorldPt, entities, scale, 15);
    setCurrentSnap(snap);

    // 若找到鎖點，請強制將 cursorWorld 替換為鎖點座標（產生磁吸效應）
    if (snap) {
      setCursorWorld(snap.point);
    } else {
      setCursorWorld(rawWorldPt);
    }

    // 處理中鍵平移
    if (isPanning && panStartRef.current) {
      const deltaX = pt.x - panStartRef.current.mouseX;
      const deltaY = pt.y - panStartRef.current.mouseY;
      setPan({
        x: panStartRef.current.panX + deltaX,
        y: panStartRef.current.panY + deltaY
      });
    }
  };

  const handleMouseUp = (e: React.MouseEvent<SVGSVGElement>) => {
    if (isPanning) {
      setIsPanning(false);
      panStartRef.current = null;
    }
  };

  const handleMouseLeave = () => {
    setIsPanning(false);
    panStartRef.current = null;
    setCursorWorld(null);
    setCurrentSnap(null);
  };

  const handleResetView = () => {
    setScale(2.6);
    setPan({ x: 120, y: 100 });
  };

  /**
   * --------------------------------------------------------------------------
   * 畫布點擊事件：繪圖狀態機轉移與狀態安全提交
   * --------------------------------------------------------------------------
   * 多步驟繪圖邏輯：
   * - 步驟 1 (未在繪圖狀態)：點擊第一下記錄 drawStartPt，進入 isDrawing = true
   * - 步驟 2 (處於 isDrawing 狀態)：點擊第二下計算最終尺寸，呼叫 addEntity 寫入全域狀態，
   *   並徹底重置 isDrawing 與 drawStartPt，避免產生無效圖元或幽靈狀態。
   */
  const handleCanvasClick = (e: React.MouseEvent<SVGSVGElement>) => {
    // 忽略中鍵點擊與平移工具模式
    if (e.button === 1 || currentTool === 'PAN') return;

    const pt = clientToSvgPoint(e.clientX, e.clientY);
    if (!pt) return;

    // 移除對 clickPt 的四捨五入邏輯 (Math.round(...))，直接信任 cursorWorld 帶來的精確鎖點座標
    const clickPt: Point2D = cursorWorld ? { ...cursorWorld } : screenToWorld(pt);

    // 工具邏輯
    if (currentTool === 'LINE') {
      if (!isDrawing || !drawStartPt) {
        // 第一下點擊：設定線段起點
        setDrawStartPt(clickPt);
        setIsDrawing(true);
      } else {
        // 第二下點擊：完成線段幾何定義
        const dx = clickPt.x - drawStartPt.x;
        const dy = clickPt.y - drawStartPt.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // 防呆：兩點距離過小則視為誤觸，不予提交
        if (dist > 0.5) {
          const newLine: LineEntity = {
            id: `ent_line_${Date.now().toString().slice(-6)}`,
            type: 'line',
            layer: 'layer_outline',
            color: '#38bdf8',
            state: 'under_constrained',
            isConstruction: false,
            start: { ...drawStartPt },
            end: { ...clickPt }
          };
          addEntity(targetSketchId, newLine);
          setSelectedEntityIds([newLine.id]);
        }

        // 徹底重置狀態機
        setIsDrawing(false);
        setDrawStartPt(null);
      }
    } else if (currentTool === 'CIRCLE') {
      if (!isDrawing || !drawStartPt) {
        // 第一下點擊：設定圓心
        setDrawStartPt(clickPt);
        setIsDrawing(true);
      } else {
        // 第二下點擊：依據與圓心的距離確定半徑 (移除人為精度四捨五入)
        const dx = clickPt.x - drawStartPt.x;
        const dy = clickPt.y - drawStartPt.y;
        const radius = Math.sqrt(dx * dx + dy * dy);

        // 防呆：半徑需大於最小閾值
        if (radius > 1) {
          const newCircle: CircleEntity = {
            id: `ent_circle_${Date.now().toString().slice(-6)}`,
            type: 'circle',
            layer: 'layer_outline',
            color: '#f59e0b',
            state: 'under_constrained',
            isConstruction: false,
            center: { ...drawStartPt },
            radius
          };
          addEntity(targetSketchId, newCircle);
          setSelectedEntityIds([newCircle.id]);
        }

        // 徹底重置狀態機
        setIsDrawing(false);
        setDrawStartPt(null);
      }
    } else if (currentTool === 'SELECT') {
      // 呼叫數學碰撞檢測 (HitTest)
      // 點擊判定距離閾值：8px 換算為世界單位 (8 / scale)
      const hitThreshold = Math.max(1.5, 8 / scale);
      const hitId = hitTest(clickPt, entities, hitThreshold);
      const isShift = e.shiftKey;

      if (hitId) {
        if (isShift) {
          // 支援按住 Shift 多選 (已選取則反選剔除，未選取則加入)
          if (selectedEntityIds.includes(hitId)) {
            setSelectedEntityIds(selectedEntityIds.filter((id) => id !== hitId));
          } else {
            setSelectedEntityIds([...selectedEntityIds, hitId]);
          }
        } else {
          // 單選模式
          setSelectedEntityIds([hitId]);
        }
      } else {
        // 未命中任何圖元且未按 Shift 鍵時，清空選取
        if (!isShift) {
          setSelectedEntityIds([]);
        }
      }
    } else if (currentTool === 'DIMENSION') {
      // 尺寸標註工具：
      // 階段 1：點擊選取線段
      // 階段 2：在空白處點擊放置尺寸文字，並透過 Zustand 觸發 addConstraint (寫入 length 約束) 與 addDimension
      if (!dimensionTargetLine) {
        const hitThreshold = Math.max(2, 10 / scale);
        const hitId = hitTest(clickPt, entities, hitThreshold);
        if (hitId) {
          const hitEnt = entities.find((ent) => ent.id === hitId);
          if (hitEnt && hitEnt.type === 'line') {
            setDimensionTargetLine(hitEnt as LineEntity);
            setSelectedEntityIds([hitEnt.id]);
          }
        }
      } else {
        const targetLine = dimensionTargetLine;
        const dx = targetLine.end.x - targetLine.start.x;
        const dy = targetLine.end.y - targetLine.start.y;
        const rawLen = Math.hypot(dx, dy);
        const lengthValue = Math.round(rawLen * 10) / 10;

        const dimId = `dim_${Date.now().toString().slice(-6)}`;
        const newDimension: Dimension = {
          id: dimId,
          type: 'linear_aligned',
          entityIds: [targetLine.id],
          value: lengthValue,
          textPosition: { x: clickPt.x, y: clickPt.y },
          isDriving: true,
          suffix: ' mm'
        };

        const constraintId = `c_len_${Date.now().toString().slice(-6)}`;
        const newConstraint: LengthConstraint = {
          id: constraintId,
          type: 'length',
          entityIds: [targetLine.id],
          length: lengthValue,
          isSuppressed: false
        };

        // 放置時，透過 Zustand 觸發 addConstraint (寫入 length 約束) 並將新標註存入狀態
        addConstraint(targetSketchId, newConstraint);
        addDimension(targetSketchId, newDimension);

        // 重置選取的線段，允許使用者繼續標註其他線段
        setDimensionTargetLine(null);
      }
    }
  };

  const selectedEntities = entities.filter((e) => selectedEntityIds.includes(e.id));
  const selectedEntity = selectedEntities[selectedEntities.length - 1];

  // 計算橡皮筋即時統計數據 (供動態徽章與提示使用)
  let rubberBandDist = 0;
  if (isDrawing && drawStartPt && cursorWorld) {
    const dx = cursorWorld.x - drawStartPt.x;
    const dy = cursorWorld.y - drawStartPt.y;
    rubberBandDist = Math.sqrt(dx * dx + dy * dy);
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full bg-slate-900 rounded-xl overflow-hidden border border-slate-800 text-slate-100 shadow-md"
    >
      {/* 頂部 CAD 狀態列 */}
      <div className="px-4 py-2.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 font-mono text-slate-300">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold">{planeName}</span>
            <span className="text-slate-500">|</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                solverState === 'fully_constrained'
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                  : 'bg-amber-950 text-amber-400 border border-amber-800'
              }`}
            >
              {solverState === 'fully_constrained'
                ? '✓ Fully Constrained'
                : '⚠ Under Constrained'}
            </span>

            {/* 拓撲分析封閉面提示徽章 (Topology Closed Profiles) */}
            {profiles && profiles.length > 0 && (
              <span
                id="cad-closed-profiles-badge"
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-sky-950/80 text-sky-400 border border-sky-800"
                title={`Detected ${profiles.length} closed profile(s) for 3D extrusion`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                <span>
                  {profiles.length} Closed Profile{profiles.length > 1 ? 's' : ''}
                </span>
                {profiles[0].area && (
                  <span className="text-sky-300 font-mono text-[10px]">
                    ({profiles[0].area} mm²)
                  </span>
                )}
              </span>
            )}
          </div>

          {/* 繪圖狀態中提示徽章 */}
          {isDrawing && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-700/70 text-amber-300 text-[11px] animate-pulse">
              <Sparkles className="w-3 h-3 text-amber-400" />
              <span>
                {currentTool === 'LINE' ? 'Drawing Line (Click endpoint)' : 'Drawing Circle (Click radius)'}
              </span>
              <span className="text-[10px] text-amber-400/70 ml-1 font-mono">
                [ESC to Cancel]
              </span>
            </div>
          )}

          {/* 尺寸標註狀態提示徽章 */}
          {currentTool === 'DIMENSION' && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-950/80 border border-indigo-700/70 text-indigo-300 text-[11px] animate-pulse">
              <Ruler className="w-3 h-3 text-indigo-400" />
              <span>
                {!dimensionTargetLine
                  ? 'Select a line to dimension'
                  : 'Click to place dimension text'}
              </span>
              <span className="text-[10px] text-indigo-400/70 ml-1 font-mono">
                [ESC to Cancel]
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[11px] text-slate-300 font-mono">
            <Crosshair className="w-3 h-3 text-sky-400" />
            <span>
              Tool: <strong className="text-sky-300">{currentTool}</strong>
            </span>
          </div>

          <button
            id="toggle-constraints-btn"
            onClick={() => setShowConstraints(!showConstraints)}
            className={`px-2.5 py-1 rounded transition-colors ${
              showConstraints
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            Constraints ({constraints.length})
          </button>
          <button
            id="toggle-dimensions-btn"
            onClick={() => setShowDimensions(!showDimensions)}
            className={`px-2.5 py-1 rounded transition-colors ${
              showDimensions
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            Dimensions ({dimensions.length})
          </button>

          <div className="h-4 w-px bg-slate-800 mx-1" />

          {/* Zoom In button */}
          <button
            id="zoom-in-btn"
            onClick={() => zoomAtPoint({ x: 310, y: 200 }, 1.2)}
            className="p-1.5 hover:bg-slate-800 rounded text-slate-300 transition-colors"
            title="Zoom In (Scroll Up)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          {/* Zoom Out button */}
          <button
            id="zoom-out-btn"
            onClick={() => zoomAtPoint({ x: 310, y: 200 }, 1 / 1.2)}
            className="p-1.5 hover:bg-slate-800 rounded text-slate-300 transition-colors"
            title="Zoom Out (Scroll Down)"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          {/* Reset Zoom & Pan */}
          <button
            id="reset-view-btn"
            onClick={handleResetView}
            className="p-1.5 hover:bg-slate-800 rounded text-slate-300 transition-colors"
            title="Reset Pan & Zoom (Fit to Screen)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 主繪圖視埠 */}
      <div className="relative flex-1 bg-slate-950 min-h-[380px] overflow-hidden select-none">
        <svg
          ref={svgRef}
          onClick={handleCanvasClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onContextMenu={(e) => e.preventDefault()}
          className={`w-full h-full ${
            isPanning
              ? 'cursor-grabbing'
              : currentTool === 'PAN'
              ? 'cursor-grab'
              : isDrawing
              ? 'cursor-crosshair'
              : 'cursor-crosshair'
          }`}
          viewBox="0 0 620 400"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* 動態網格 (Aligned with Pan & Scale) */}
          <defs>
            <pattern
              id="cad-grid"
              width={25 * scale}
              height={25 * scale}
              patternUnits="userSpaceOnUse"
              patternTransform={`translate(${pan.x}, ${pan.y})`}
            >
              <path
                d={`M ${25 * scale} 0 L 0 0 0 ${25 * scale}`}
                fill="none"
                stroke="#1e293b"
                strokeWidth="0.75"
              />
            </pattern>

            {/* 尺寸標註專用精確箭頭 (Dimension Arrow Markers) */}
            <marker
              id="dim-arrow-start"
              viewBox="0 0 10 10"
              refX="1"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <polygon points="10,2 1,5 10,8" fill="#10b981" />
            </marker>
            <marker
              id="dim-arrow-end"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <polygon points="1,2 9,5 1,8" fill="#10b981" />
            </marker>

            {/* 尺寸預覽專用琥珀色箭頭 (Dimension Preview Arrow Markers) */}
            <marker
              id="dim-preview-arrow-start"
              viewBox="0 0 10 10"
              refX="1"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <polygon points="10,2 1,5 10,8" fill="#f59e0b" />
            </marker>
            <marker
              id="dim-preview-arrow-end"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <polygon points="1,2 9,5 1,8" fill="#f59e0b" />
            </marker>
          </defs>
          <rect width="100%" height="100%" fill="url(#cad-grid)" />

          {/* 座標原點 UCS 軸 (Red X, Green Y, CAD Y points UP) */}
          <g>
            <line
              x1={toSvgX(0)}
              y1={toSvgY(0)}
              x2={toSvgX(25)}
              y2={toSvgY(0)}
              stroke="#ef4444"
              strokeWidth="2"
            />
            <polygon
              points={`${toSvgX(25)},${toSvgY(0) - 3} ${toSvgX(29)},${toSvgY(0)} ${toSvgX(25)},${toSvgY(0) + 3}`}
              fill="#ef4444"
            />
            <text
              x={toSvgX(32)}
              y={toSvgY(0) + 4}
              fill="#ef4444"
              fontSize="10"
              fontWeight="bold"
            >
              X
            </text>

            <line
              x1={toSvgX(0)}
              y1={toSvgY(0)}
              x2={toSvgX(0)}
              y2={toSvgY(25)}
              stroke="#22c55e"
              strokeWidth="2"
            />
            <polygon
              points={`${toSvgX(0) - 3},${toSvgY(25)} ${toSvgX(0)},${toSvgY(29)} ${toSvgX(0) + 3},${toSvgY(25)}`}
              fill="#22c55e"
            />
            <text
              x={toSvgX(0) - 4}
              y={toSvgY(32)}
              fill="#22c55e"
              fontSize="10"
              fontWeight="bold"
            >
              Y
            </text>

            <circle
              cx={toSvgX(0)}
              cy={toSvgY(0)}
              r="3.5"
              fill="#fbbf24"
              stroke="#0f172a"
              strokeWidth="1.5"
            />
            <text
              x={toSvgX(0) - 18}
              y={toSvgY(0) + 16}
              fill="#94a3b8"
              fontSize="9"
              fontFamily="monospace"
            >
              (0, 0)
            </text>
          </g>

          {/* 渲染拓撲封閉輪廓面 (Shaded Sketch Contours for 3D Extrusion) */}
          <g id="cad-closed-profiles-layer" pointerEvents="none">
            {profiles &&
              profiles.map((prof) => {
                if (!prof.points || prof.points.length < 3) return null;
                const ptsString = prof.points
                  .map((pt) => `${toSvgX(pt.x)},${toSvgY(pt.y)}`)
                  .join(' ');
                return (
                  <polygon
                    key={prof.id}
                    id={`svg-profile-${prof.id}`}
                    points={ptsString}
                    fill={
                      prof.isIsland
                        ? 'rgba(244, 63, 94, 0.08)' // Island/hole tint
                        : 'rgba(56, 189, 248, 0.12)' // Solid body profile tint
                    }
                    stroke={
                      prof.isIsland
                        ? 'rgba(244, 63, 94, 0.35)'
                        : 'rgba(56, 189, 248, 0.4)'
                    }
                    strokeWidth="1.2"
                    strokeDasharray="4,3"
                  />
                );
              })}
          </g>

          {/* 渲染已有幾何圖元 (Render 2D Geometry Entities) */}
          {entities.map((entity) => {
            const isSelected = selectedEntityIds.includes(entity.id);
            const isHovered = entity.id === hoveredEntityId;
            const isDimTarget = currentTool === 'DIMENSION' && dimensionTargetLine?.id === entity.id;
            const isFullyDefined = solverState === 'fully_constrained' || entity.state === 'FullyDefined';

            // 顏色層次：選取高亮藍 > 尺寸目標紫 > 懸停琥珀 > 完全定義純白 > 構造線紫 > 預設欠定義藍
            const strokeColor = isSelected
              ? '#38bdf8'
              : isDimTarget
              ? '#c084fc'
              : isHovered
              ? '#f59e0b'
              : isFullyDefined
              ? '#ffffff'
              : entity.isConstruction
              ? '#a855f7'
              : entity.color || '#38bdf8';

            const pointFill = isSelected
              ? '#38bdf8'
              : isDimTarget
              ? '#c084fc'
              : isHovered
              ? '#f59e0b'
              : isFullyDefined
              ? '#ffffff'
              : strokeColor;

            // 被選取的圖元在 SVG 中以亮藍色 (#38bdf8) 且較粗的線條高亮顯示 (4.5px)
            const strokeWidth = isSelected ? 4.5 : isDimTarget ? 3.5 : isHovered ? 3 : 2.2;
            const strokeDasharray = entity.isConstruction ? '6,4' : undefined;

            if (entity.type === 'line') {
              return (
                <g
                  key={entity.id}
                  className="cursor-pointer"
                  onMouseEnter={() => !isDrawing && setHoveredEntityId(entity.id)}
                  onMouseLeave={() => setHoveredEntityId(null)}
                >
                  <line
                    x1={toSvgX(entity.start.x)}
                    y1={toSvgY(entity.start.y)}
                    x2={toSvgX(entity.end.x)}
                    y2={toSvgY(entity.end.y)}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    strokeDasharray={strokeDasharray}
                  />
                  <circle
                    cx={toSvgX(entity.start.x)}
                    cy={toSvgY(entity.start.y)}
                    r={isSelected ? 4.5 : 3}
                    fill={pointFill}
                  />
                  <circle
                    cx={toSvgX(entity.end.x)}
                    cy={toSvgY(entity.end.y)}
                    r={isSelected ? 4.5 : 3}
                    fill={pointFill}
                  />
                </g>
              );
            }

            if (entity.type === 'arc') {
              const startX =
                entity.center.x + entity.radius * Math.cos(entity.startAngle);
              const startY =
                entity.center.y + entity.radius * Math.sin(entity.startAngle);
              const endX =
                entity.center.x + entity.radius * Math.cos(entity.endAngle);
              const endY =
                entity.center.y + entity.radius * Math.sin(entity.endAngle);

              const pStartX = toSvgX(startX);
              const pStartY = toSvgY(startY);
              const pEndX = toSvgX(endX);
              const pEndY = toSvgY(endY);
              const rScaled = entity.radius * scale;

              const pathD = `M ${pStartX} ${pStartY} A ${rScaled} ${rScaled} 0 0 0 ${pEndX} ${pEndY}`;

              return (
                <g
                  key={entity.id}
                  className="cursor-pointer"
                  onMouseEnter={() => !isDrawing && setHoveredEntityId(entity.id)}
                  onMouseLeave={() => setHoveredEntityId(null)}
                >
                  <path
                    d={pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                  />
                  <circle
                    cx={toSvgX(entity.center.x)}
                    cy={toSvgY(entity.center.y)}
                    r={isSelected ? 3.5 : 2.5}
                    fill={isSelected ? '#38bdf8' : isFullyDefined ? '#ffffff' : '#f59e0b'}
                  />
                </g>
              );
            }

            if (entity.type === 'circle') {
              return (
                <g
                  key={entity.id}
                  className="cursor-pointer"
                  onMouseEnter={() => !isDrawing && setHoveredEntityId(entity.id)}
                  onMouseLeave={() => setHoveredEntityId(null)}
                >
                  <circle
                    cx={toSvgX(entity.center.x)}
                    cy={toSvgY(entity.center.y)}
                    r={entity.radius * scale}
                    fill={
                      isSelected
                        ? 'rgba(56, 189, 248, 0.16)'
                        : isFullyDefined
                        ? 'rgba(255, 255, 255, 0.05)'
                        : 'rgba(239, 68, 68, 0.08)'
                    }
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                  />
                  <circle
                    cx={toSvgX(entity.center.x)}
                    cy={toSvgY(entity.center.y)}
                    r={isSelected ? 4 : 3}
                    fill={isSelected ? '#38bdf8' : isFullyDefined ? '#ffffff' : '#ef4444'}
                  />
                </g>
              );
            }

            if (entity.type === 'polyline') {
              const pointsStr = entity.vertices
                .map((v) => `${toSvgX(v.point.x)},${toSvgY(v.point.y)}`)
                .join(' ');

              return (
                <g
                  key={entity.id}
                  className="cursor-pointer"
                  onMouseEnter={() => !isDrawing && setHoveredEntityId(entity.id)}
                  onMouseLeave={() => setHoveredEntityId(null)}
                >
                  <polyline
                    points={pointsStr}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    strokeDasharray={strokeDasharray}
                  />
                  {entity.vertices.map((v, i) => (
                    <circle
                      key={i}
                      cx={toSvgX(v.point.x)}
                      cy={toSvgY(v.point.y)}
                      r={isSelected ? 3.5 : 2.5}
                      fill={pointFill}
                    />
                  ))}
                </g>
              );
            }

            return null;
          })}

          {/* ====================================================================
              橡皮筋動態預覽 (Rubber-Banding Preview Layer)
              ==================================================================== */}
          {isDrawing && drawStartPt && cursorWorld && (
            <g id="rubber-band-preview-group" pointerEvents="none">
              {/* LINE 工具橡皮筋預覽 */}
              {currentTool === 'LINE' && (
                <>
                  {/* 動態虛線 (琥珀色 #f59e0b) */}
                  <line
                    x1={toSvgX(drawStartPt.x)}
                    y1={toSvgY(drawStartPt.y)}
                    x2={toSvgX(cursorWorld.x)}
                    y2={toSvgY(cursorWorld.y)}
                    stroke="#f59e0b"
                    strokeWidth="2"
                    strokeDasharray="5,5"
                  />
                  {/* 起點錨點 */}
                  <circle
                    cx={toSvgX(drawStartPt.x)}
                    cy={toSvgY(drawStartPt.y)}
                    r="4"
                    fill="#f59e0b"
                    stroke="#1e293b"
                    strokeWidth="1.5"
                  />
                  {/* 游標目前終點錨點 */}
                  <circle
                    cx={toSvgX(cursorWorld.x)}
                    cy={toSvgY(cursorWorld.y)}
                    r="3.5"
                    fill="#fbbf24"
                  />
                  {/* 即時長度與角度標籤 */}
                  <g
                    transform={`translate(${
                      (toSvgX(drawStartPt.x) + toSvgX(cursorWorld.x)) / 2
                    }, ${
                      (toSvgY(drawStartPt.y) + toSvgY(cursorWorld.y)) / 2 - 12
                    })`}
                  >
                    <rect
                      x="-30"
                      y="-9"
                      width="60"
                      height="16"
                      rx="3"
                      fill="#451a03"
                      stroke="#d97706"
                      strokeWidth="1"
                    />
                    <text
                      x="0"
                      y="3"
                      textAnchor="middle"
                      fill="#fef08a"
                      fontSize="9"
                      fontFamily="monospace"
                      fontWeight="bold"
                    >
                      {rubberBandDist.toFixed(1)} mm
                    </text>
                  </g>
                </>
              )}

              {/* CIRCLE 工具橡皮筋預覽 */}
              {currentTool === 'CIRCLE' && (
                <>
                  {/* 動態圓形虛線 (琥珀色 #f59e0b) */}
                  <circle
                    cx={toSvgX(drawStartPt.x)}
                    cy={toSvgY(drawStartPt.y)}
                    r={Math.max(rubberBandDist * scale, 1)}
                    fill="rgba(245, 158, 11, 0.08)"
                    stroke="#f59e0b"
                    strokeWidth="2"
                    strokeDasharray="5,5"
                  />
                  {/* 半徑導引虛線 */}
                  <line
                    x1={toSvgX(drawStartPt.x)}
                    y1={toSvgY(drawStartPt.y)}
                    x2={toSvgX(cursorWorld.x)}
                    y2={toSvgY(cursorWorld.y)}
                    stroke="#d97706"
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />
                  {/* 圓心錨點 */}
                  <circle
                    cx={toSvgX(drawStartPt.x)}
                    cy={toSvgY(drawStartPt.y)}
                    r="4"
                    fill="#ef4444"
                    stroke="#1e293b"
                    strokeWidth="1.5"
                  />
                  {/* 圓周邊界指示點 */}
                  <circle
                    cx={toSvgX(cursorWorld.x)}
                    cy={toSvgY(cursorWorld.y)}
                    r="3.5"
                    fill="#f59e0b"
                  />
                  {/* 半徑標籤 */}
                  <g
                    transform={`translate(${
                      (toSvgX(drawStartPt.x) + toSvgX(cursorWorld.x)) / 2
                    }, ${
                      (toSvgY(drawStartPt.y) + toSvgY(cursorWorld.y)) / 2 - 12
                    })`}
                  >
                    <rect
                      x="-28"
                      y="-9"
                      width="56"
                      height="16"
                      rx="3"
                      fill="#451a03"
                      stroke="#d97706"
                      strokeWidth="1"
                    />
                    <text
                      x="0"
                      y="3"
                      textAnchor="middle"
                      fill="#fef08a"
                      fontSize="9"
                      fontFamily="monospace"
                      fontWeight="bold"
                    >
                      R {rubberBandDist.toFixed(1)}
                    </text>
                  </g>
                </>
              )}
            </g>
          )}

          {/* 渲染標註尺寸 (Dimensions Layer) */}
          {showDimensions && (
            <g id="cad-dimensions-layer" className="select-none font-mono">
              {/* 1. 渲染已有尺寸標註 (Stored Dimensions) */}
              {dimensions.map((dim) => {
                // 尋找關聯圖元 (例如被標註的線段)
                const targetEnt = entities.find((e) => dim.entityIds.includes(e.id));
                let p1: Point2D | null = null;
                let p2: Point2D | null = null;

                if (targetEnt && targetEnt.type === 'line') {
                  p1 = targetEnt.start;
                  p2 = targetEnt.end;
                } else if (dim.type === 'linear_horizontal') {
                  p1 = { x: 0, y: 0 };
                  p2 = { x: 100, y: 0 };
                } else if (dim.type === 'linear_vertical') {
                  p1 = { x: 0, y: 0 };
                  p2 = { x: 0, y: 80 };
                }

                if (!p1 || !p2) {
                  const tx = toSvgX(dim.textPosition.x);
                  const ty = toSvgY(dim.textPosition.y);
                  return (
                    <g key={dim.id}>
                      <rect
                        x={tx - 26}
                        y={ty - 9}
                        width="52"
                        height="18"
                        rx="3"
                        fill="#022c22"
                        stroke="#059669"
                        strokeWidth="1.2"
                      />
                      <text
                        x={tx}
                        y={ty + 3.5}
                        textAnchor="middle"
                        fill="#34d399"
                        fontSize="9.5"
                        fontWeight="bold"
                      >
                        {dim.prefix || ''}{dim.value}{dim.suffix || ' mm'}
                      </text>
                    </g>
                  );
                }

                const geom = computeDimensionGeometry(p1, p2, dim.textPosition);
                if (!geom) return null;

                const sA1x = toSvgX(geom.a1.x);
                const sA1y = toSvgY(geom.a1.y);
                const sB1x = toSvgX(geom.b1.x);
                const sB1y = toSvgY(geom.b1.y);

                const sA2x = toSvgX(geom.a2.x);
                const sA2y = toSvgY(geom.a2.y);
                const sB2x = toSvgX(geom.b2.x);
                const sB2y = toSvgY(geom.b2.y);

                const sD1x = toSvgX(geom.d1.x);
                const sD1y = toSvgY(geom.d1.y);
                const sD2x = toSvgX(geom.d2.x);
                const sD2y = toSvgY(geom.d2.y);

                const sTx = toSvgX(geom.textCenter.x);
                const sTy = toSvgY(geom.textCenter.y);

                return (
                  <g key={dim.id} id={`dim-${dim.id}`} className="transition-opacity">
                    {/* 尺寸輔助線 1 (Witness Line 1) */}
                    <line
                      x1={sA1x}
                      y1={sA1y}
                      x2={sB1x}
                      y2={sB1y}
                      stroke="#10b981"
                      strokeWidth="1"
                      strokeDasharray="3,2"
                      opacity="0.8"
                    />
                    {/* 尺寸輔助線 2 (Witness Line 2) */}
                    <line
                      x1={sA2x}
                      y1={sA2y}
                      x2={sB2x}
                      y2={sB2y}
                      stroke="#10b981"
                      strokeWidth="1"
                      strokeDasharray="3,2"
                      opacity="0.8"
                    />
                    {/* 尺寸線（帶箭頭）(Dimension Line with Arrowheads) */}
                    <line
                      x1={sD1x}
                      y1={sD1y}
                      x2={sD2x}
                      y2={sD2y}
                      stroke="#10b981"
                      strokeWidth="1.2"
                      markerStart="url(#dim-arrow-start)"
                      markerEnd="url(#dim-arrow-end)"
                    />
                    {/* 包含數值的背景方塊文字 (Dimension Text with Box) */}
                    <g transform={`translate(${sTx}, ${sTy})`}>
                      <rect
                        x="-28"
                        y="-9"
                        width="56"
                        height="18"
                        rx="3"
                        fill="#022c22"
                        stroke="#059669"
                        strokeWidth="1.2"
                      />
                      <text
                        x="0"
                        y="3.5"
                        textAnchor="middle"
                        fill="#34d399"
                        fontSize="9.5"
                        fontWeight="bold"
                      >
                        {dim.prefix || ''}{dim.value}{dim.suffix || ' mm'}
                      </text>
                    </g>
                  </g>
                );
              })}

              {/* 2. 即時預覽正在放置的尺寸 (Dimension Placement Preview) */}
              {currentTool === 'DIMENSION' && dimensionTargetLine && cursorWorld && (() => {
                const p1 = dimensionTargetLine.start;
                const p2 = dimensionTargetLine.end;
                const geom = computeDimensionGeometry(p1, p2, cursorWorld);
                if (!geom) return null;

                const rawLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                const previewVal = (Math.round(rawLen * 10) / 10).toFixed(1);

                const sA1x = toSvgX(geom.a1.x);
                const sA1y = toSvgY(geom.a1.y);
                const sB1x = toSvgX(geom.b1.x);
                const sB1y = toSvgY(geom.b1.y);

                const sA2x = toSvgX(geom.a2.x);
                const sA2y = toSvgY(geom.a2.y);
                const sB2x = toSvgX(geom.b2.x);
                const sB2y = toSvgY(geom.b2.y);

                const sD1x = toSvgX(geom.d1.x);
                const sD1y = toSvgY(geom.d1.y);
                const sD2x = toSvgX(geom.d2.x);
                const sD2y = toSvgY(geom.d2.y);

                const sTx = toSvgX(geom.textCenter.x);
                const sTy = toSvgY(geom.textCenter.y);

                return (
                  <g id="dimension-placement-preview" pointerEvents="none">
                    {/* 預覽輔助線 1 */}
                    <line
                      x1={sA1x}
                      y1={sA1y}
                      x2={sB1x}
                      y2={sB1y}
                      stroke="#f59e0b"
                      strokeWidth="1"
                      strokeDasharray="3,2"
                      opacity="0.9"
                    />
                    {/* 預覽輔助線 2 */}
                    <line
                      x1={sA2x}
                      y1={sA2y}
                      x2={sB2x}
                      y2={sB2y}
                      stroke="#f59e0b"
                      strokeWidth="1"
                      strokeDasharray="3,2"
                      opacity="0.9"
                    />
                    {/* 預覽尺寸線（琥珀色箭頭） */}
                    <line
                      x1={sD1x}
                      y1={sD1y}
                      x2={sD2x}
                      y2={sD2y}
                      stroke="#f59e0b"
                      strokeWidth="1.3"
                      markerStart="url(#dim-preview-arrow-start)"
                      markerEnd="url(#dim-preview-arrow-end)"
                    />
                    {/* 包含數值的預覽背景方塊文字 */}
                    <g transform={`translate(${sTx}, ${sTy})`}>
                      <rect
                        x="-30"
                        y="-10"
                        width="60"
                        height="20"
                        rx="4"
                        fill="#451a03"
                        stroke="#d97706"
                        strokeWidth="1.5"
                      />
                      <text
                        x="0"
                        y="3.5"
                        textAnchor="middle"
                        fill="#fef08a"
                        fontSize="9.5"
                        fontWeight="bold"
                      >
                        {previewVal} mm
                      </text>
                    </g>
                  </g>
                );
              })()}
            </g>
          )}

          {/* 渲染幾何約束標記 (Geometric Constraints) */}
          {showConstraints && (
            <g>
              {/* Horizontal */}
              <g transform={`translate(${toSvgX(50)}, ${toSvgY(0) + 12})`}>
                <rect
                  x="-8"
                  y="-7"
                  width="16"
                  height="14"
                  rx="2"
                  fill="#1e1b4b"
                  stroke="#6366f1"
                  strokeWidth="1"
                />
                <text
                  x="0"
                  y="3"
                  textAnchor="middle"
                  fill="#a5b4fc"
                  fontSize="9"
                  fontWeight="bold"
                >
                  —
                </text>
              </g>

              {/* Vertical */}
              <g transform={`translate(${toSvgX(0) - 14}, ${toSvgY(40)})`}>
                <rect
                  x="-7"
                  y="-8"
                  width="14"
                  height="16"
                  rx="2"
                  fill="#1e1b4b"
                  stroke="#6366f1"
                  strokeWidth="1"
                />
                <text
                  x="0"
                  y="4"
                  textAnchor="middle"
                  fill="#a5b4fc"
                  fontSize="9"
                  fontWeight="bold"
                >
                  |
                </text>
              </g>

              {/* Tangent */}
              <g transform={`translate(${toSvgX(80)}, ${toSvgY(80) - 12})`}>
                <circle
                  r="7"
                  fill="#1e1b4b"
                  stroke="#6366f1"
                  strokeWidth="1"
                />
                <text
                  x="0"
                  y="3"
                  textAnchor="middle"
                  fill="#a5b4fc"
                  fontSize="8"
                  fontWeight="bold"
                >
                  tan
                </text>
              </g>

              {/* Origin Coincident */}
              <g transform={`translate(${toSvgX(0) - 10}, ${toSvgY(0) - 10})`}>
                <rect
                  x="-6"
                  y="-6"
                  width="12"
                  height="12"
                  rx="2"
                  fill="#451a03"
                  stroke="#d97706"
                  strokeWidth="1"
                />
                <text
                  x="0"
                  y="3.5"
                  textAnchor="middle"
                  fill="#fcd34d"
                  fontSize="8"
                  fontWeight="bold"
                >
                  ☩
                </text>
              </g>
            </g>
          )}

          {/* ====================================================================
              物件鎖點視覺標記 (AutoCAD OSnap Visual Markers Layer)
              在 SVG 渲染區最後，若 currentSnap 存在，繪製綠色 (#22c55e) 的標記
              - 端點 (Endpoint): 正方形
              - 中點 (Midpoint): 三角形
              - 圓心 (Center): 圓形
              ==================================================================== */}
          {currentSnap && (
            <g id="osnap-marker-layer" pointerEvents="none" className="select-none">
              {(() => {
                const snapSvgX = toSvgX(currentSnap.point.x);
                const snapSvgY = toSvgY(currentSnap.point.y);

                return (
                  <g>
                    {/* 端點 (Endpoint): 綠色正方形 */}
                    {currentSnap.type === 'endpoint' && (
                      <rect
                        id="osnap-endpoint-marker"
                        x={snapSvgX - 5}
                        y={snapSvgY - 5}
                        width={10}
                        height={10}
                        fill="none"
                        stroke="#22c55e"
                        strokeWidth="2"
                      />
                    )}

                    {/* 中點 (Midpoint): 綠色三角形 */}
                    {currentSnap.type === 'midpoint' && (
                      <polygon
                        id="osnap-midpoint-marker"
                        points={`${snapSvgX},${snapSvgY - 6.5} ${snapSvgX - 6},${snapSvgY + 5} ${snapSvgX + 6},${snapSvgY + 5}`}
                        fill="none"
                        stroke="#22c55e"
                        strokeWidth="2"
                      />
                    )}

                    {/* 圓心 (Center): 綠色圓形 */}
                    {currentSnap.type === 'center' && (
                      <circle
                        id="osnap-center-marker"
                        cx={snapSvgX}
                        cy={snapSvgY}
                        r="5.5"
                        fill="none"
                        stroke="#22c55e"
                        strokeWidth="2"
                      />
                    )}

                    {/* AutoCAD 風格鎖點提示標籤 (Snap Tooltip Tag) */}
                    <g transform={`translate(${snapSvgX + 9}, ${snapSvgY - 9})`}>
                      <rect
                        x="-2"
                        y="-8"
                        width={
                          currentSnap.type === 'endpoint'
                            ? 50
                            : currentSnap.type === 'midpoint'
                            ? 46
                            : 42
                        }
                        height="13"
                        rx="2"
                        fill="rgba(2, 44, 34, 0.9)"
                        stroke="#22c55e"
                        strokeWidth="1"
                      />
                      <text
                        x="2"
                        y="2"
                        fill="#22c55e"
                        fontSize="8.5"
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        {currentSnap.type === 'endpoint'
                          ? 'Endpoint'
                          : currentSnap.type === 'midpoint'
                          ? 'Midpoint'
                          : 'Center'}
                      </text>
                    </g>
                  </g>
                );
              })()}
            </g>
          )}
        </svg>

        {/* 即時狀態列浮動指示器 (CAD Status Bar Overlay) */}
        <div className="absolute bottom-3 right-3 bg-slate-900/90 backdrop-blur border border-slate-800 rounded-lg px-3 py-1.5 text-xs shadow-lg flex items-center gap-3 font-mono">
          <div className="flex items-center gap-1 text-slate-400">
            <Crosshair className="w-3.5 h-3.5 text-sky-400" />
            <span>World:</span>
          </div>
          {cursorWorld ? (
            <div className="flex items-center gap-2">
              <span className="text-rose-400 font-semibold">
                X: {cursorWorld.x.toFixed(cursorWorld.x % 1 === 0 ? 0 : 2)} mm
              </span>
              <span className="text-slate-600">|</span>
              <span className="text-emerald-400 font-semibold">
                Y: {cursorWorld.y.toFixed(cursorWorld.y % 1 === 0 ? 0 : 2)} mm
              </span>
            </div>
          ) : (
            <span className="text-slate-500 italic">Hover canvas</span>
          )}
          {currentSnap && (
            <>
              <div className="text-slate-600">|</div>
              <div className="flex items-center gap-1.5 text-emerald-400 font-semibold font-mono text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="uppercase">SNAP: {currentSnap.type}</span>
              </div>
            </>
          )}
          {selectedEntityIds.length > 0 && (
            <>
              <div className="text-slate-600">|</div>
              <div className="flex items-center gap-1.5 text-sky-400 font-semibold font-mono text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                <span>SELECTED: {selectedEntityIds.length}</span>
              </div>
            </>
          )}
          <div className="text-slate-600">|</div>
          <div className="text-slate-300">
            Zoom: <span className="text-amber-400 font-semibold">{Math.round((scale / 2.6) * 100)}%</span>
          </div>
          <div className="text-slate-600 hidden md:block">|</div>
          <div className="text-slate-500 text-[10px] hidden md:flex items-center gap-1">
            <Move className="w-3 h-3 text-slate-400" />
            <span>Mid-click / Drag to Pan • Wheel to Zoom</span>
          </div>
        </div>

        {/* 選取實體浮動檢查面板 (Selected Entity Float Inspector) */}
        {selectedEntities.length > 0 && selectedEntity && !isDrawing && (
          <div className="absolute bottom-3 left-3 bg-slate-900/90 backdrop-blur border border-slate-700 rounded-lg p-3 text-xs shadow-xl max-w-xs animate-in fade-in">
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
              <span className="font-semibold text-sky-400 uppercase">
                {selectedEntities.length > 1
                  ? `${selectedEntities.length} Entities Selected`
                  : `${selectedEntity.type} Entity`}
              </span>
              <span className="font-mono text-[10px] text-slate-400">
                {selectedEntities.length === 1 ? `ID: ${selectedEntity.id}` : 'Shift+Click Multi'}
              </span>
            </div>
            {selectedEntities.length === 1 ? (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 text-[11px] text-slate-300">
                <div>
                  Layer: <span className="text-white font-mono">{selectedEntity.layer}</span>
                </div>
                <div>
                  State: <span className="text-emerald-400">{selectedEntity.state}</span>
                </div>
                <div>
                  Construction:{' '}
                  <span className="text-purple-400">
                    {selectedEntity.isConstruction ? 'Yes' : 'No'}
                  </span>
                </div>
                <div>
                  Color:{' '}
                  <span
                    className="inline-block w-3 h-3 rounded-full align-middle ml-1"
                    style={{ backgroundColor: selectedEntity.color || '#3b82f6' }}
                  />
                </div>
              </div>
            ) : (
              <div className="mt-2 text-[11px] text-slate-300 space-y-1">
                <div className="text-slate-400 text-[10px]">
                  Hold <kbd className="px-1 py-0.5 bg-slate-800 rounded font-mono text-slate-200">Shift</kbd> to add/remove
                </div>
                <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto pt-1">
                  {selectedEntities.map((ent) => (
                    <span
                      key={ent.id}
                      className="px-1.5 py-0.5 rounded bg-sky-950/80 border border-sky-800 text-[10px] text-sky-300 font-mono"
                    >
                      {ent.type}: {ent.id.slice(-6)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-2.5 pt-2 border-t border-slate-800 flex justify-end">
              <button
                id="delete-selected-entity-btn"
                onClick={() => {
                  selectedEntityIds.forEach((id) => deleteEntity(targetSketchId, id));
                  setSelectedEntityIds([]);
                }}
                className="flex items-center gap-1 px-2 py-1 rounded bg-rose-950/80 text-rose-300 border border-rose-800 hover:bg-rose-900 transition-colors text-[10px]"
                title="Delete selected entity(ies) from sketch (with undo support)"
              >
                <Trash2 className="w-3 h-3" />
                {selectedEntityIds.length > 1 ? `Delete Selected (${selectedEntityIds.length})` : 'Delete Entity'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
