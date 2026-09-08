import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  CADEntity2D,
  Constraint,
  Dimension,
  EntityState,
  LineEntity,
  CircleEntity,
  Point2D
} from '../types/cad.ts';
import {
  useCadStore,
  useCurrentTool,
  useActiveSketchId
} from '../contexts/CadContext.tsx';
import {
  Maximize2,
  ZoomIn,
  ZoomOut,
  Layers,
  Info,
  CheckCircle2,
  Sparkles,
  Trash2,
  Crosshair,
  Move,
  RotateCcw
} from 'lucide-react';

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
  const activeSketchId = useActiveSketchId();
  const targetSketchId = sketchId || activeSketchId || 'feat_sketch_1';

  const addEntity = useCadStore((s) => s.addEntity);
  const deleteEntity = useCadStore((s) => s.deleteEntity);

  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);
  const [showConstraints, setShowConstraints] = useState(true);
  const [showDimensions, setShowDimensions] = useState(true);

  // SVG container reference for exact bounding client rect and DOM wheel event handling
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Internal Pan & Scale states
  // Default CAD view: Pan origin around (120, 100) in SVG screen pixels, scale = 2.6
  const [scale, setScale] = useState<number>(2.6);
  const [pan, setPan] = useState<Point2D>({ x: 120, y: 100 });

  // Mouse pan interaction tracking
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ mouseX: number; mouseY: number; panX: number; panY: number } | null>(null);

  // Mouse cursor world coordinate indicator
  const [cursorWorld, setCursorWorld] = useState<Point2D | null>(null);

  /**
   * --------------------------------------------------------------------------
   * Coordinate Transformation Matrix / Functions
   * --------------------------------------------------------------------------
   * CAD World Coordinates:
   *   X goes RIGHT (+X)
   *   Y goes UP (+Y) (standard Cartesian / CAD convention)
   *
   * SVG Screen Coordinates:
   *   svgX goes RIGHT (+svgX)
   *   svgY goes DOWN (+svgY)
   *
   * Transformation equations:
   *   svgX = pan.x + worldX * scale
   *   svgY = pan.y - worldY * scale
   *
   * Inverse transformation (Screen to World):
   *   worldX = (svgX - pan.x) / scale
   *   worldY = (pan.y - svgY) / scale
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

  // Direct scalar helper functions for SVG template strings
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
   * Mouse Wheel Zoom Centered at Cursor Position:
   *   Given mouse screen position (s_x, s_y):
   *   worldPos = screenToWorld(s_x, s_y)
   *   newScale = clamp(scale * zoomFactor, minScale, maxScale)
   *   To keep worldPos stationary under the cursor:
   *     s_x = newPan.x + worldPos.x * newScale => newPan.x = s_x - worldPos.x * newScale
   *     s_y = newPan.y - worldPos.y * newScale => newPan.y = s_y + worldPos.y * newScale
   * --------------------------------------------------------------------------
   */
  const zoomAtPoint = useCallback(
    (screenPoint: Point2D, zoomFactor: number) => {
      setScale((prevScale) => {
        const nextScale = Math.min(Math.max(prevScale * zoomFactor, 0.4), 15);
        if (Math.abs(nextScale - prevScale) < 0.0001) return prevScale;

        // Calculate world coordinates with current scale and pan
        const worldX = (screenPoint.x - pan.x) / prevScale;
        const worldY = (pan.y - screenPoint.y) / prevScale;

        // Compute new pan so worldX, worldY stay exactly at screenPoint
        const newPanX = screenPoint.x - worldX * nextScale;
        const newPanY = screenPoint.y + worldY * nextScale;

        setPan({ x: newPanX, y: newPanY });
        return nextScale;
      });
    },
    [pan.x, pan.y]
  );

  // Wheel event listener with passive: false to prevent outer page scrolling
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pt = clientToSvgPoint(e.clientX, e.clientY);
      if (!pt) return;

      // Sensitive smooth zoom ratio based on wheel delta
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
   * Mouse Pan Dragging Handlers (Supports Middle Mouse Button OR PAN tool)
   * --------------------------------------------------------------------------
   */
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    // Middle click (button === 1), or Left click when PAN tool is selected, or Space key pressed
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

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const pt = clientToSvgPoint(e.clientX, e.clientY);
    if (!pt) return;

    // Continuously capture and display world coordinate under cursor
    const worldPt = screenToWorld(pt);
    setCursorWorld(worldPt);

    // Active panning update
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
  };

  // Reset View to CAD default center & zoom
  const handleResetView = () => {
    setScale(2.6);
    setPan({ x: 120, y: 100 });
  };

  const selectedEntity = entities.find((e) => e.id === selectedEntityId);

  /**
   * Left-click handling on canvas for tool drafting or selecting
   */
  const handleCanvasClick = (e: React.MouseEvent<SVGSVGElement>) => {
    // Ignore clicks if middle button or if we were panning
    if (e.button === 1 || currentTool === 'PAN') return;

    // If user clicked directly on background
    if (e.target !== e.currentTarget && (e.target as HTMLElement).tagName !== 'rect') {
      return;
    }

    const pt = clientToSvgPoint(e.clientX, e.clientY);
    if (!pt) return;

    const world = screenToWorld(pt);
    const cadX = Math.round(world.x);
    const cadY = Math.round(world.y);

    if (currentTool === 'LINE') {
      const newLine: LineEntity = {
        id: `ent_line_${Date.now().toString().slice(-6)}`,
        type: 'line',
        layer: 'layer_outline',
        color: '#38bdf8',
        state: 'under_constrained',
        isConstruction: false,
        start: { x: cadX, y: cadY },
        end: { x: cadX + 30, y: cadY + 20 }
      };
      addEntity(targetSketchId, newLine);
      setSelectedEntityId(newLine.id);
    } else if (currentTool === 'CIRCLE') {
      const newCircle: CircleEntity = {
        id: `ent_circle_${Date.now().toString().slice(-6)}`,
        type: 'circle',
        layer: 'layer_outline',
        color: '#f59e0b',
        state: 'under_constrained',
        isConstruction: false,
        center: { x: cadX, y: cadY },
        radius: 15
      };
      addEntity(targetSketchId, newCircle);
      setSelectedEntityId(newCircle.id);
    } else if (currentTool === 'SELECT') {
      // Clear selection on background click
      setSelectedEntityId(null);
    }
  };

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full bg-slate-900 rounded-xl overflow-hidden border border-slate-800 text-slate-100 shadow-md"
    >
      {/* Top CAD Canvas Toolbar */}
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
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[11px] text-slate-300 font-mono">
            <Crosshair className="w-3 h-3 text-sky-400" />
            <span>Tool: <strong className="text-sky-300">{currentTool}</strong></span>
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

          {/* Zoom In button (centered at canvas middle) */}
          <button
            id="zoom-in-btn"
            onClick={() => zoomAtPoint({ x: 310, y: 200 }, 1.2)}
            className="p-1.5 hover:bg-slate-800 rounded text-slate-300 transition-colors"
            title="Zoom In (or Scroll Wheel Up)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          {/* Zoom Out button (centered at canvas middle) */}
          <button
            id="zoom-out-btn"
            onClick={() => zoomAtPoint({ x: 310, y: 200 }, 1 / 1.2)}
            className="p-1.5 hover:bg-slate-800 rounded text-slate-300 transition-colors"
            title="Zoom Out (or Scroll Wheel Down)"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          {/* Reset Zoom & Pan button */}
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

      {/* Main Graphics Viewport */}
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
              : 'cursor-crosshair'
          }`}
          viewBox="0 0 620 400"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Dynamic Grid Pattern aligned with Pan & Scale */}
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
          </defs>
          <rect width="100%" height="100%" fill="url(#cad-grid)" />

          {/* Coordinate Origin Axes (AutoCAD UCS Icon: Red X, Green Y, CAD Y goes UP) */}
          <g>
            {/* World X Axis (Red) */}
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

            {/* World Y Axis (Green, points UP in CAD model space) */}
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

          {/* Render 2D Geometry Entities */}
          {entities.map((entity) => {
            const isSelected = entity.id === selectedEntityId;
            const isHovered = entity.id === hoveredEntityId;
            const strokeColor = isSelected
              ? '#38bdf8'
              : isHovered
              ? '#f59e0b'
              : entity.isConstruction
              ? '#a855f7'
              : entity.color || '#3b82f6';
            const strokeWidth = isSelected ? 3.5 : isHovered ? 3 : 2;
            const strokeDasharray = entity.isConstruction ? '6,4' : undefined;

            if (entity.type === 'line') {
              return (
                <g
                  key={entity.id}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedEntityId(entity.id);
                  }}
                  onMouseEnter={() => setHoveredEntityId(entity.id)}
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
                  {/* Endpoint Vertex Handles */}
                  <circle
                    cx={toSvgX(entity.start.x)}
                    cy={toSvgY(entity.start.y)}
                    r="3"
                    fill={strokeColor}
                  />
                  <circle
                    cx={toSvgX(entity.end.x)}
                    cy={toSvgY(entity.end.y)}
                    r="3"
                    fill={strokeColor}
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

              // Counter-clockwise in CAD translates to standard SVG sweep
              const pathD = `M ${pStartX} ${pStartY} A ${rScaled} ${rScaled} 0 0 0 ${pEndX} ${pEndY}`;

              return (
                <g
                  key={entity.id}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedEntityId(entity.id);
                  }}
                  onMouseEnter={() => setHoveredEntityId(entity.id)}
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
                    r="2.5"
                    fill="#f59e0b"
                  />
                </g>
              );
            }

            if (entity.type === 'circle') {
              return (
                <g
                  key={entity.id}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedEntityId(entity.id);
                  }}
                  onMouseEnter={() => setHoveredEntityId(entity.id)}
                  onMouseLeave={() => setHoveredEntityId(null)}
                >
                  <circle
                    cx={toSvgX(entity.center.x)}
                    cy={toSvgY(entity.center.y)}
                    r={entity.radius * scale}
                    fill="rgba(239, 68, 68, 0.08)"
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                  />
                  <circle
                    cx={toSvgX(entity.center.x)}
                    cy={toSvgY(entity.center.y)}
                    r="3"
                    fill="#ef4444"
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
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedEntityId(entity.id);
                  }}
                  onMouseEnter={() => setHoveredEntityId(entity.id)}
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
                      r="2.5"
                      fill={strokeColor}
                    />
                  ))}
                </g>
              );
            }

            return null;
          })}

          {/* Render Dimensions */}
          {showDimensions &&
            dimensions.map((dim) => {
              const tx = toSvgX(dim.textPosition.x);
              const ty = toSvgY(dim.textPosition.y);
              return (
                <g key={dim.id} className="text-[10px] font-mono select-none">
                  {/* Dimension marker leader lines */}
                  {dim.type === 'linear_horizontal' && (
                    <g stroke="#10b981" strokeWidth="1" strokeDasharray="2,2">
                      <line
                        x1={toSvgX(0)}
                        y1={toSvgY(0)}
                        x2={toSvgX(0)}
                        y2={ty}
                      />
                      <line
                        x1={toSvgX(100)}
                        y1={toSvgY(0)}
                        x2={toSvgX(100)}
                        y2={ty}
                      />
                      <line
                        x1={toSvgX(0)}
                        y1={ty}
                        x2={toSvgX(100)}
                        y2={ty}
                        strokeDasharray="none"
                      />
                    </g>
                  )}
                  {dim.type === 'linear_vertical' && (
                    <g stroke="#10b981" strokeWidth="1" strokeDasharray="2,2">
                      <line
                        x1={toSvgX(0)}
                        y1={toSvgY(0)}
                        x2={tx}
                        y2={toSvgY(0)}
                      />
                      <line
                        x1={toSvgX(0)}
                        y1={toSvgY(80)}
                        x2={tx}
                        y2={toSvgY(80)}
                      />
                      <line
                        x1={tx}
                        y1={toSvgY(0)}
                        x2={tx}
                        y2={toSvgY(80)}
                        strokeDasharray="none"
                      />
                    </g>
                  )}
                  <rect
                    x={tx - 24}
                    y={ty - 9}
                    width="48"
                    height="16"
                    rx="3"
                    fill="#022c22"
                    stroke="#059669"
                    strokeWidth="1"
                  />
                  <text
                    x={tx}
                    y={ty + 3}
                    textAnchor="middle"
                    fill="#34d399"
                    fontSize="9.5"
                    fontWeight="bold"
                  >
                    {dim.prefix || ''}
                    {dim.value}
                    {dim.suffix || ''}
                  </text>
                </g>
              );
            })}

          {/* Render Geometric Constraint Badges (SolidWorks Style) */}
          {showConstraints && (
            <g>
              {/* Bottom Horizontal */}
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

              {/* Left Vertical */}
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

              {/* Arc Tangent */}
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
        </svg>

        {/* Real-time World Coordinate Indicator (CAD Status Bar Overlay) */}
        <div className="absolute bottom-3 right-3 bg-slate-900/90 backdrop-blur border border-slate-800 rounded-lg px-3 py-1.5 text-xs shadow-lg flex items-center gap-3 font-mono">
          <div className="flex items-center gap-1 text-slate-400">
            <Crosshair className="w-3.5 h-3.5 text-sky-400" />
            <span>World:</span>
          </div>
          {cursorWorld ? (
            <div className="flex items-center gap-2">
              <span className="text-rose-400 font-semibold">
                X: {cursorWorld.x.toFixed(1)} mm
              </span>
              <span className="text-slate-600">|</span>
              <span className="text-emerald-400 font-semibold">
                Y: {cursorWorld.y.toFixed(1)} mm
              </span>
            </div>
          ) : (
            <span className="text-slate-500 italic">Hover canvas</span>
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

        {/* Selected Entity Float Inspector */}
        {selectedEntity && (
          <div className="absolute bottom-3 left-3 bg-slate-900/90 backdrop-blur border border-slate-700 rounded-lg p-3 text-xs shadow-xl max-w-xs animate-in fade-in">
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
              <span className="font-semibold text-sky-400 uppercase">
                {selectedEntity.type} Entity
              </span>
              <span className="font-mono text-[10px] text-slate-400">
                ID: {selectedEntity.id}
              </span>
            </div>
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
            <div className="mt-2.5 pt-2 border-t border-slate-800 flex justify-end">
              <button
                id="delete-selected-entity-btn"
                onClick={() => {
                  deleteEntity(targetSketchId, selectedEntity.id);
                  setSelectedEntityId(null);
                }}
                className="flex items-center gap-1 px-2 py-1 rounded bg-rose-950/80 text-rose-300 border border-rose-800 hover:bg-rose-900 transition-colors text-[10px]"
                title="Delete this entity from sketch (with undo support)"
              >
                <Trash2 className="w-3 h-3" />
                Delete Entity
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

