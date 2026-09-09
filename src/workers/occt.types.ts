/**
 * @license
 * OCCT WebWorker Message Passing Protocol Types
 *
 * Defines the strongly-typed asynchronous messaging contract between the
 * React main thread UI and the OpenCASCADE.js (WASM) background worker.
 */

import { ParametricFeature, SolidMesh3D, FeatureId } from '../types/cad.ts';

// ============================================================================
// Main Thread -> WebWorker Messages
// ============================================================================

export interface WorkerInitMessage {
  type: 'INIT';
}

export interface WorkerRebuildMessage {
  type: 'REBUILD_MODEL';
  requestId: string;
  featureTree: ParametricFeature[];
  options?: {
    stopOnError?: boolean;
    linearDeflection?: number;
    angularDeflection?: number;
  };
}

export interface WorkerCancelMessage {
  type: 'CANCEL';
  requestId: string;
}

export type MainToWorkerMessage =
  | WorkerInitMessage
  | WorkerRebuildMessage
  | WorkerCancelMessage;

// ============================================================================
// WebWorker -> Main Thread Messages
// ============================================================================

export interface WorkerStatusMessage {
  type: 'STATUS';
  status: 'initializing' | 'ready' | 'error';
  engine: 'OpenCASCADE.js (WASM)' | 'Fallback';
  message?: string;
}

export interface WorkerMeshTransferable {
  id: string;
  featureId: FeatureId;
  featureName: string;
  featureType: 'extrude' | 'cut' | 'revolve' | 'fillet' | 'chamfer';
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  edges?: Float32Array;
  boundingBox: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  color?: string;
  opacity?: number;
  isCut?: boolean;
  triangleCount: number;
  vertexCount: number;
}

export interface WorkerRebuildSuccessMessage {
  type: 'REBUILD_SUCCESS';
  requestId: string;
  meshes: WorkerMeshTransferable[];
  durationMs: number;
  booleanCutExecuted: boolean;
  occtActive: boolean;
  stats: {
    totalTriangles: number;
    totalVertices: number;
    featureCount: number;
  };
}

export interface WorkerRebuildErrorMessage {
  type: 'REBUILD_ERROR';
  requestId: string;
  error: string;
  durationMs: number;
}

export interface WorkerLogMessage {
  type: 'LOG';
  level: 'info' | 'warn' | 'error';
  message: string;
}

export type WorkerToMainMessage =
  | WorkerStatusMessage
  | WorkerRebuildSuccessMessage
  | WorkerRebuildErrorMessage
  | WorkerLogMessage;
