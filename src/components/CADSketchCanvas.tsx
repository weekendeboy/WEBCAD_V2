import React, { useState } from 'react';
import {
  CADEntity2D,
  Constraint,
  Dimension,
  EntityState
} from '../types/cad.ts';
import {
  Maximize2,
  ZoomIn,
  ZoomOut,
  Layers,
  Info,
  CheckCircle2,
  Sparkles
} from 'lucide-react';

interface CADSketchCanvasProps {
  entities: CADEntity2D[];
  constraints: Constraint[];
  dimensions: Dimension[];
  planeName: string;
  solverState: 'under_constrained' | 'fully_constrained' | 'over_constrained';
}

export const CADSketchCanvas: React.FC<CADSketchCanvasProps> = ({
  entities,
  constraints,
  dimensions,
  planeName,
  solverState
}) => {
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);
  const [showConstraints, setShowConstraints] = useState(true);
  const [showDimensions, setShowDimensions] = useState(true);
  const [scale, setScale] = useState(2.6);
  const [pan] = useState({ x: 90, y: 70 });

  // Map CAD model space (mm) to SVG canvas coordinates
  const toSvgX = (x: number) => pan.x + x * scale;
  const toSvgY = (y: number) => 380 - (pan.y + y * scale); // CAD Y goes UP, SVG goes DOWN

  const selectedEntity = entities.find((e) => e.id === selectedEntityId);

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-xl overflow-hidden border border-slate-800 text-slate-100 shadow-md">
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
          <button
            id="zoom-in-btn"
            onClick={() => setScale((s) => Math.min(s + 0.3, 5))}
            className="p-1.5 hover:bg-slate-800 rounded text-slate-300"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            id="zoom-out-btn"
            onClick={() => setScale((s) => Math.max(s - 0.3, 1))}
            className="p-1.5 hover:bg-slate-800 rounded text-slate-300"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Graphics Viewport */}
      <div className="relative flex-1 bg-slate-950 min-h-[380px] overflow-hidden select-none">
        <svg
          className="w-full h-full cursor-crosshair"
          viewBox="0 0 620 400"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Subtle Grid Pattern */}
          <defs>
            <pattern
              id="cad-grid"
              width="25"
              height="25"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 25 0 L 0 0 0 25"
                fill="none"
                stroke="#1e293b"
                strokeWidth="0.75"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#cad-grid)" />

          {/* Coordinate Origin Axes (AutoCAD UCS Icon) */}
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
                  onClick={() => setSelectedEntityId(entity.id)}
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
                  onClick={() => setSelectedEntityId(entity.id)}
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
                  onClick={() => setSelectedEntityId(entity.id)}
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
                  onClick={() => setSelectedEntityId(entity.id)}
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
          </div>
        )}
      </div>
    </div>
  );
};
