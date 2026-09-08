import React from 'react';
import {
  ParametricFeature,
  SketchFeature,
  ExtrudeFeature,
  CutFeature,
  FeatureStatus
} from '../types/cad.ts';
import {
  GitFork,
  Box,
  Scissors,
  Pencil,
  Eye,
  EyeOff,
  AlertTriangle,
  CheckCircle,
  Clock,
  Layers
} from 'lucide-react';

interface FeatureTreeViewerProps {
  features: ParametricFeature[];
  selectedFeatureId: string | null;
  onSelectFeature: (id: string) => void;
  onToggleSuppress: (id: string) => void;
}

export const FeatureTreeViewer: React.FC<FeatureTreeViewerProps> = ({
  features,
  selectedFeatureId,
  onSelectFeature,
  onToggleSuppress
}) => {
  const getFeatureIcon = (type: string) => {
    switch (type) {
      case 'sketch':
        return <Pencil className="w-4 h-4 text-sky-400" />;
      case 'extrude':
        return <Box className="w-4 h-4 text-emerald-400" />;
      case 'cut':
        return <Scissors className="w-4 h-4 text-rose-400" />;
      default:
        return <Layers className="w-4 h-4 text-slate-400" />;
    }
  };

  const getStatusBadge = (status: FeatureStatus) => {
    switch (status) {
      case 'clean':
        return (
          <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-1.5 py-0.5 rounded">
            <CheckCircle className="w-3 h-3" /> Clean
          </span>
        );
      case 'warning':
      case 'dirty':
        return (
          <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-950/60 border border-amber-800/80 px-1.5 py-0.5 rounded">
            <AlertTriangle className="w-3 h-3" /> Rebuild
          </span>
        );
      case 'error':
        return (
          <span className="flex items-center gap-1 text-[10px] text-rose-400 bg-rose-950/60 border border-rose-800/80 px-1.5 py-0.5 rounded">
            Error
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-4 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitFork className="w-4 h-4 text-indigo-400" />
          <h3 className="font-semibold text-sm text-slate-100">
            FeatureManager Tree (DAG)
          </h3>
        </div>
        <span className="text-[11px] font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
          {features.length} Nodes
        </span>
      </div>

      {/* Feature Nodes List */}
      <div className="p-3 space-y-2 flex-1 overflow-y-auto">
        {features.map((feature, idx) => {
          const isSelected = feature.id === selectedFeatureId;
          const isSketch = feature.type === 'sketch';
          const isExtrude = feature.type === 'extrude';
          const isCut = feature.type === 'cut';

          const sketchFeat = isSketch ? (feature as SketchFeature) : null;
          const extrudeFeat = isExtrude ? (feature as ExtrudeFeature) : null;
          const cutFeat = isCut ? (feature as CutFeature) : null;

          return (
            <div
              key={feature.id}
              id={`feature-item-${feature.id}`}
              onClick={() => onSelectFeature(feature.id)}
              className={`group relative p-3 rounded-lg border transition-all cursor-pointer ${
                isSelected
                  ? 'bg-slate-800/90 border-sky-500 shadow-md ring-1 ring-sky-500/20'
                  : 'bg-slate-950/70 border-slate-800 hover:border-slate-700 hover:bg-slate-800/50'
              } ${feature.suppressed ? 'opacity-50 grayscale' : ''}`}
            >
              {/* Main Node Header */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex items-center justify-center w-7 h-7 rounded bg-slate-800 border border-slate-700">
                    {getFeatureIcon(feature.type)}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-xs text-slate-200">
                        {feature.name}
                      </span>
                      <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                        {feature.type}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      ID: {feature.id}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {getStatusBadge(feature.status)}
                  <button
                    id={`toggle-suppress-${feature.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSuppress(feature.id);
                    }}
                    title={feature.suppressed ? 'Unsuppress' : 'Suppress'}
                    className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    {feature.suppressed ? (
                      <EyeOff className="w-3.5 h-3.5 text-rose-400" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Parametric Payload Summary */}
              <div className="mt-2 pt-2 border-t border-slate-800/80 text-[11px] grid grid-cols-2 gap-1.5 text-slate-400">
                {sketchFeat && (
                  <>
                    <div>
                      Plane:{' '}
                      <span className="text-slate-200 font-mono">
                        {sketchFeat.plane.name}
                      </span>
                    </div>
                    <div>
                      Entities:{' '}
                      <span className="text-sky-400 font-mono">
                        {sketchFeat.entities.length}
                      </span>
                    </div>
                    <div>
                      Constraints:{' '}
                      <span className="text-indigo-400 font-mono">
                        {sketchFeat.constraints.length}
                      </span>
                    </div>
                    <div>
                      Dimensions:{' '}
                      <span className="text-emerald-400 font-mono">
                        {sketchFeat.dimensions.length}
                      </span>
                    </div>
                    <div>
                      Profiles:{' '}
                      <span className="text-amber-400 font-mono font-semibold">
                        {sketchFeat.profiles?.length || 0}
                      </span>
                      {sketchFeat.profiles && sketchFeat.profiles.length > 0 && sketchFeat.profiles[0].area && (
                        <span className="text-[10px] text-slate-500 ml-1">
                          ({sketchFeat.profiles[0].area} mm²)
                        </span>
                      )}
                    </div>
                  </>
                )}

                {extrudeFeat && (
                  <>
                    <div>
                      Depth:{' '}
                      <span className="text-emerald-400 font-mono font-semibold">
                        {extrudeFeat.depth} mm
                      </span>
                    </div>
                    <div>
                      End Condition:{' '}
                      <span className="text-slate-300 font-mono">
                        {extrudeFeat.endCondition}
                      </span>
                    </div>
                    <div>
                      Operation:{' '}
                      <span className="text-purple-400 font-mono">
                        {extrudeFeat.booleanOperation}
                      </span>
                    </div>
                    <div>
                      Draft:{' '}
                      <span className="text-slate-300 font-mono">
                        {extrudeFeat.draftAngle || 0}°
                      </span>
                    </div>
                  </>
                )}

                {cutFeat && (
                  <>
                    <div>
                      Cut Depth:{' '}
                      <span className="text-rose-400 font-mono font-semibold">
                        {cutFeat.depth} mm
                      </span>
                    </div>
                    <div>
                      Condition:{' '}
                      <span className="text-slate-300 font-mono">
                        {cutFeat.endCondition}
                      </span>
                    </div>
                    <div>
                      Sketch Ref:{' '}
                      <span className="text-sky-300 font-mono">
                        {cutFeat.sketchFeatureId}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* DAG Dependency Trace */}
              {feature.dependencies.length > 0 && (
                <div className="mt-2 text-[10px] flex items-center gap-1.5 text-slate-500 font-mono bg-slate-900/90 px-2 py-1 rounded">
                  <span className="text-slate-400">Ancestors (DAG):</span>
                  {feature.dependencies.map((depId) => (
                    <span
                      key={depId}
                      className="px-1.5 py-0.5 rounded bg-slate-800 text-sky-300 border border-slate-700"
                    >
                      ← {depId}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
