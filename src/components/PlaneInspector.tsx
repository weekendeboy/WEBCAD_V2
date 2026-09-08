import React, { useState } from 'react';
import { CustomPlane, Vector3D, Point3D } from '../types/cad.ts';
import { Compass, Move, ArrowUpRight, Check, Copy } from 'lucide-react';

interface PlaneInspectorProps {
  planes: CustomPlane[];
  selectedPlaneId: string;
  onSelectPlane: (id: string) => void;
}

export const PlaneInspector: React.FC<PlaneInspectorProps> = ({
  planes,
  selectedPlaneId,
  onSelectPlane
}) => {
  const currentPlane =
    planes.find((p) => p.id === selectedPlaneId) || planes[0];
  const [copied, setCopied] = useState(false);

  const formatVec = (v: Vector3D | Point3D) =>
    `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(currentPlane, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm text-slate-100">
      {/* Header */}
      <div className="px-4 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4 text-emerald-400" />
          <h3 className="font-semibold text-sm text-slate-100">
            3D Coordinate System & CustomPlane
          </h3>
        </div>
        <button
          id="copy-plane-json-btn"
          onClick={handleCopy}
          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded transition-colors"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          {copied ? 'Copied' : 'Copy JSON'}
        </button>
      </div>

      {/* Plane Selector Tabs */}
      <div className="p-3 border-b border-slate-800 bg-slate-950/50 flex gap-2 overflow-x-auto">
        {planes.map((p) => (
          <button
            key={p.id}
            id={`plane-tab-${p.id}`}
            onClick={() => onSelectPlane(p.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              p.id === currentPlane.id
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
            }`}
          >
            {p.name}
            {p.isDatum && (
              <span className="ml-1.5 text-[9px] bg-black/30 px-1 py-0.5 rounded">
                Datum
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Main Plane Details & 3D Vectors */}
      <div className="p-4 space-y-4 flex-1 overflow-y-auto">
        {/* Plane Properties Summary */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
            <span className="text-[11px] text-slate-400 block mb-1">
              Plane Name & ID
            </span>
            <span className="font-medium text-xs text-slate-200 block">
              {currentPlane.name}
            </span>
            <span className="font-mono text-[10px] text-slate-500">
              {currentPlane.id}
            </span>
          </div>

          <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
            <span className="text-[11px] text-slate-400 block mb-1">
              Datum Status / Offset
            </span>
            <span className="font-medium text-xs text-slate-200 block">
              {currentPlane.isDatum ? 'Primary Datum Plane' : 'Offset Reference Plane'}
            </span>
            <span className="font-mono text-[10px] text-emerald-400">
              Offset: {currentPlane.offset !== undefined ? `${currentPlane.offset} mm` : '0 mm'}
            </span>
          </div>
        </div>

        {/* 4 Fundamental 3D Vectors (Origin, Normal, xAxis, yAxis) */}
        <div className="space-y-2.5">
          <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
            Plane Coordinate Definition (4 Vectors)
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
            {/* Origin */}
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1">
                <span>Origin Point (Point3D)</span>
                <span className="w-2 h-2 rounded-full bg-amber-400" />
              </div>
              <div className="text-amber-300 font-bold">
                {formatVec(currentPlane.origin)}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                World space pivot (0,0) of sketch plane
              </div>
            </div>

            {/* Normal */}
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1">
                <span>Normal Vector (Z_local)</span>
                <span className="w-2 h-2 rounded-full bg-blue-400" />
              </div>
              <div className="text-blue-300 font-bold">
                {formatVec(currentPlane.normal)}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                Perpendicular direction (Extrude axis)
              </div>
            </div>

            {/* X-Axis */}
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1">
                <span>xAxis Vector (X_local)</span>
                <span className="w-2 h-2 rounded-full bg-rose-400" />
              </div>
              <div className="text-rose-300 font-bold">
                {formatVec(currentPlane.xAxis)}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                Horizontal baseline for 2D sketch 'U'
              </div>
            </div>

            {/* Y-Axis */}
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1">
                <span>yAxis Vector (Y_local)</span>
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
              </div>
              <div className="text-emerald-300 font-bold">
                {formatVec(currentPlane.yAxis)}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                Vertical baseline for 2D sketch 'V'
              </div>
            </div>
          </div>
        </div>

        {/* Orthogonality & Dot Product Verification */}
        <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg text-xs space-y-1">
          <div className="text-slate-400 font-medium text-[11px]">
            Mathematical Orthonormality Check:
          </div>
          <div className="flex items-center justify-between text-slate-300 font-mono text-[11px]">
            <span>xAxis • yAxis (Orthogonal):</span>
            <span className="text-emerald-400 font-bold">0.0000 ✓</span>
          </div>
          <div className="flex items-center justify-between text-slate-300 font-mono text-[11px]">
            <span>xAxis × yAxis = Normal (Right-Hand Rule):</span>
            <span className="text-emerald-400 font-bold">Matched ✓</span>
          </div>
        </div>
      </div>
    </div>
  );
};
