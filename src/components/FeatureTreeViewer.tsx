/**
 * @license
 * CAD FeatureManager Design Tree Viewer (DAG)
 * SolidWorks-style Rollback Bar (退回棒) + Feature Parameter Editing
 *
 * 核心升級：
 * 1. SolidWorks 風格的「退回棒 (Rollback Bar)」：
 *    - 於特徵節點之間渲染藍色退回橫線（具備發光效果與拖曳手柄）。
 *    - 支援滑鼠點擊切換、拖放 (Drag & Drop) 或按鈕步進移動。
 *    - 當退回棒移動至某特徵上方或下方時，透過 Zustand 觸發 rollbackToIndex，
 *      將該位置之後的所有特徵狀態設為 suppressed = true，實現精準的模型歷史回滾。
 * 2. 每個特徵節點提供專屬的「編輯特徵 (Edit Feature)」按鈕：
 *    - 點擊後開啟右側 PropertyManager 參數檢查面板（可直接調整深度 Depth、終止條件等）。
 * 3. 清楚區分「已退回 (Rolled Back)」與「活動 (Active)」特徵的視覺層級。
 */

import React, { useState } from 'react';
import {
  ParametricFeature,
  SketchFeature,
  ExtrudeFeature,
  CutFeature,
  FeatureStatus
} from '../types/cad.ts';
import {
  useCadStore,
  useEditingFeatureId
} from '../contexts/CadContext.tsx';
import {
  GitFork,
  Box,
  Scissors,
  Pencil,
  Eye,
  EyeOff,
  AlertTriangle,
  CheckCircle,
  Layers,
  Sliders,
  GripHorizontal,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  FastForward
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
  const editingFeatureId = useEditingFeatureId();
  const setEditingFeatureId = useCadStore((s) => s.setEditingFeatureId);
  const rollbackToIndex = useCadStore((s) => s.rollbackToIndex);

  // State for drag & drop
  const [isDraggingBar, setIsDraggingBar] = useState(false);
  const [dragOverSlotIndex, setDragOverSlotIndex] = useState<number | null>(null);

  /**
   * 計算當前退回棒所在的索引位置 (slot index):
   * slotIndex = -1 代表退回到最頂部（所有特徵皆被抑制）；
   * slotIndex = k 代表退回棒在第 k 個特徵之後 (index <= k 未抑制，index > k 已抑制)；
   * slotIndex = features.length - 1 代表全部未退回（位於最底部）。
   */
  let currentRollbackIndex = -1;
  for (let i = features.length - 1; i >= 0; i--) {
    if (!features[i].suppressed) {
      currentRollbackIndex = i;
      break;
    }
  }

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

  /**
   * 處理退回棒的拖曳開始事件
   */
  const handleDragStart = (e: React.DragEvent) => {
    setIsDraggingBar(true);
    e.dataTransfer.setData('text/plain', 'rollback-bar');
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setIsDraggingBar(false);
    setDragOverSlotIndex(null);
  };

  const handleDropOnSlot = (slotIndex: number) => {
    setIsDraggingBar(false);
    setDragOverSlotIndex(null);
    rollbackToIndex(slotIndex);
  };

  /**
   * 渲染退回橫線或插入插槽 (Rollback Bar / Drop Slot)
   * @param slotIndex: -1 (頂部), 0 (第0特徵後), 1, ..., features.length - 1 (最底部)
   */
  const renderRollbackSlot = (slotIndex: number) => {
    const isCurrentPosition = currentRollbackIndex === slotIndex;
    const isDragOver = dragOverSlotIndex === slotIndex;

    if (isCurrentPosition) {
      // Active SolidWorks Rollback Bar (發光藍色實心橫條 + 拖曳手柄)
      return (
        <div
          key={`rollback-bar-active-${slotIndex}`}
          id="active-rollback-bar"
          draggable
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          className="group relative my-2 px-1 py-1 cursor-ns-resize z-10"
          title="SolidWorks 風格退回棒：可拖曳或點擊其他節點插槽回滾歷史"
        >
          <div className="h-2.5 rounded-full bg-gradient-to-r from-sky-500 via-blue-400 to-sky-500 shadow-[0_0_12px_rgba(56,189,248,0.75)] flex items-center justify-between px-2 text-[10px] text-white font-mono select-none">
            <div className="flex items-center gap-1">
              <GripHorizontal className="w-3.5 h-3.5 text-sky-100" />
              <span className="font-bold tracking-wider uppercase text-[9px]">
                Rollback Bar (退回棒)
              </span>
            </div>

            <div className="flex items-center gap-1 text-[9px] text-sky-100">
              {slotIndex >= 0 ? (
                <span>After {features[slotIndex]?.name}</span>
              ) : (
                <span>At Top (All Rolled Back)</span>
              )}
            </div>
          </div>
        </div>
      );
    }

    // Droppable / Clickable Slot between feature nodes
    return (
      <div
        key={`rollback-slot-${slotIndex}`}
        onClick={() => rollbackToIndex(slotIndex)}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOverSlotIndex(slotIndex);
        }}
        onDragLeave={() => {
          if (dragOverSlotIndex === slotIndex) {
            setDragOverSlotIndex(null);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          handleDropOnSlot(slotIndex);
        }}
        className={`group relative h-3 my-0.5 rounded flex items-center justify-center cursor-pointer transition-all ${
          isDragOver
            ? 'bg-sky-500/30 border border-sky-400 border-dashed h-6'
            : isDraggingBar
            ? 'bg-slate-800/40 hover:bg-sky-500/20 border border-dashed border-slate-700/60'
            : 'hover:bg-slate-800/40'
        }`}
        title={
          slotIndex === -1
            ? '點擊將退回棒移至最頂部（退回所有特徵）'
            : `點擊將退回棒移動至 ${features[slotIndex]?.name} 之後`
        }
      >
        <div
          className={`h-0.5 w-full rounded transition-all ${
            isDragOver
              ? 'bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)]'
              : 'bg-transparent group-hover:bg-sky-500/60 group-hover:h-1'
          }`}
        />
        <span className="absolute text-[9px] font-mono text-sky-300 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-950/90 px-1.5 rounded border border-sky-500/40 pointer-events-none">
          {slotIndex === -1
            ? 'Roll to Top (退回全部)'
            : `Roll to here (退回至此)`}
        </span>
      </div>
    );
  };

  const isModelRolledBack = currentRollbackIndex < features.length - 1;

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
      {/* Header with Quick Rollback Controls */}
      <div className="px-4 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitFork className="w-4 h-4 text-indigo-400" />
          <h3 className="font-semibold text-sm text-slate-100">
            FeatureManager (DAG)
          </h3>
        </div>

        <div className="flex items-center gap-2">
          {/* Quick Roll to End Action */}
          {isModelRolledBack ? (
            <button
              id="rollback-to-end-btn"
              onClick={() => rollbackToIndex(features.length - 1)}
              className="flex items-center gap-1 text-[10px] font-medium text-amber-400 bg-amber-950/60 hover:bg-amber-900/60 border border-amber-700/80 px-2 py-0.5 rounded transition-colors"
              title="解除歷史回滾，恢復所有特徵"
            >
              <FastForward className="w-3 h-3" />
              Roll to End
            </button>
          ) : (
            <span className="text-[11px] font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
              {features.length} Nodes
            </span>
          )}
        </div>
      </div>

      {/* Feature Nodes List with Rollback Slots */}
      <div className="p-3 flex-1 overflow-y-auto">
        {/* Top Slot (Before first feature) */}
        {renderRollbackSlot(-1)}

        {features.map((feature, idx) => {
          const isSelected = feature.id === selectedFeatureId;
          const isEditing = feature.id === editingFeatureId;
          const isRolledBack = idx > currentRollbackIndex;
          const isSketch = feature.type === 'sketch';
          const isExtrude = feature.type === 'extrude';
          const isCut = feature.type === 'cut';

          const sketchFeat = isSketch ? (feature as SketchFeature) : null;
          const extrudeFeat = isExtrude ? (feature as ExtrudeFeature) : null;
          const cutFeat = isCut ? (feature as CutFeature) : null;

          return (
            <React.Fragment key={feature.id}>
              {/* Feature Node Card */}
              <div
                id={`feature-item-${feature.id}`}
                onClick={() => onSelectFeature(feature.id)}
                className={`group relative p-3 rounded-lg border transition-all cursor-pointer ${
                  isEditing
                    ? 'bg-sky-950/30 border-sky-400 shadow-md ring-1 ring-sky-400/40'
                    : isSelected
                    ? 'bg-slate-800/90 border-sky-500 shadow-md ring-1 ring-sky-500/20'
                    : 'bg-slate-950/70 border-slate-800 hover:border-slate-700 hover:bg-slate-800/50'
                } ${
                  isRolledBack
                    ? 'opacity-40 grayscale border-dashed border-slate-800 bg-slate-950/40'
                    : feature.suppressed
                    ? 'opacity-50 grayscale'
                    : ''
                }`}
              >
                {/* Rollback status banner indicator */}
                {isRolledBack && (
                  <div className="absolute -top-2 right-3 px-1.5 py-0.2 rounded bg-slate-800 border border-slate-700 text-[9px] font-mono text-slate-400">
                    Rolled Back (已退回)
                  </div>
                )}

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

                  {/* Actions: Edit Feature + Suppress Toggle */}
                  <div className="flex items-center gap-1.5">
                    {/* 編輯特徵按鈕 (Edit Feature) */}
                    <button
                      id={`edit-feature-btn-${feature.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectFeature(feature.id);
                        setEditingFeatureId(feature.id);
                      }}
                      className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition-colors ${
                        isEditing
                          ? 'bg-sky-600 text-white border-sky-400 shadow-sm'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border-slate-700 hover:border-sky-500'
                      }`}
                      title="編輯特徵參數 (在右側面板開啟修改)"
                    >
                      <Sliders className="w-3 h-3 text-sky-400" />
                      <span>編輯特徵</span>
                    </button>

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
                        Profiles:{' '}
                        <span className="text-amber-400 font-mono font-semibold">
                          {sketchFeat.profiles?.length || 0}
                        </span>
                      </div>
                    </>
                  )}

                  {extrudeFeat && (
                    <>
                      <div>
                        Depth:{' '}
                        <span className="text-emerald-400 font-mono font-bold">
                          {extrudeFeat.depth} mm
                        </span>
                      </div>
                      <div>
                        Condition:{' '}
                        <span className="text-slate-300 font-mono">
                          {extrudeFeat.endCondition}
                        </span>
                      </div>
                    </>
                  )}

                  {cutFeat && (
                    <>
                      <div>
                        Cut Depth:{' '}
                        <span className="text-rose-400 font-mono font-bold">
                          {cutFeat.depth} mm
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

              {/* Slot after this feature */}
              {renderRollbackSlot(idx)}
            </React.Fragment>
          );
        })}
      </div>

      {/* Footer / Instructions */}
      <div className="px-3 py-2 bg-slate-950 border-t border-slate-800 text-[10px] text-slate-500 flex items-center justify-between">
        <span className="flex items-center gap-1">
          <GripHorizontal className="w-3 h-3 text-sky-400" />
          拖曳藍色退回棒以回滾歷史
        </span>
        <span className="font-mono text-slate-400">
          Bar: {currentRollbackIndex >= 0 ? `idx ${currentRollbackIndex}` : 'Top'}
        </span>
      </div>
    </div>
  );
};
