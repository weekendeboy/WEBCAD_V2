/**
 * @license
 * OCCT WebWorker Message Passing Client & Orchestrator
 *
 * 封裝 WebWorker 之建立、生命週期監聽與非同步訊息傳遞 (Message Passing)。
 * 提供請求識別碼 (requestId) 追蹤、過期計算取消、Transferable ArrayBuffer 解構
 * 以及即時運算效能 (Duration Ms / OCCT WASM 狀態) 回傳。
 */

import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  WorkerRebuildSuccessMessage,
  WorkerStatusMessage
} from './occt.types.ts';
import type { ParametricFeature, SolidMesh3D } from '../types/cad.ts';

export interface WorkerKernelMetrics {
  durationMs: number;
  booleanCutExecuted: boolean;
  occtActive: boolean;
  totalTriangles: number;
  totalVertices: number;
  lastUpdated: number;
}

export interface WorkerStatusInfo {
  status: 'initializing' | 'ready' | 'error';
  engine: 'OpenCASCADE.js (WASM)' | 'Fallback';
  message?: string;
}

type StatusListener = (info: WorkerStatusInfo) => void;
type MetricsListener = (metrics: WorkerKernelMetrics) => void;

export class OcctWorkerClient {
  private static instance: OcctWorkerClient | null = null;

  private worker: Worker | null = null;
  private requestIdCounter = 0;
  private pendingRequestId: string | null = null;
  private pendingResolver: ((meshes: SolidMesh3D[]) => void) | null = null;
  private pendingRejecter: ((err: Error) => void) | null = null;

  private statusInfo: WorkerStatusInfo = {
    status: 'initializing',
    engine: 'OpenCASCADE.js (WASM)',
    message: 'Spawning OCCT background WebWorker...'
  };

  private lastMetrics: WorkerKernelMetrics = {
    durationMs: 0,
    booleanCutExecuted: false,
    occtActive: false,
    totalTriangles: 0,
    totalVertices: 0,
    lastUpdated: Date.now()
  };

  private statusListeners = new Set<StatusListener>();
  private metricsListeners = new Set<MetricsListener>();

  private constructor() {
    this.initWorker();
  }

  public static getInstance(): OcctWorkerClient {
    if (!OcctWorkerClient.instance) {
      OcctWorkerClient.instance = new OcctWorkerClient();
    }
    return OcctWorkerClient.instance;
  }

  private initWorker() {
    try {
      // Create Worker using standard modern Vite module worker URL
      this.worker = new Worker(
        new URL('./occt.worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = this.handleWorkerMessage.bind(this);
      this.worker.onerror = (err) => {
        console.error('[OcctWorkerClient] Worker runtime error:', err);
        this.updateStatus({
          status: 'error',
          engine: 'Fallback',
          message: 'WebWorker error. Switched to main-thread safe fallback.'
        });
      };

      // Trigger initialization
      const initMsg: MainToWorkerMessage = { type: 'INIT' };
      this.worker.postMessage(initMsg);
    } catch (err) {
      console.warn('[OcctWorkerClient] Failed to spawn Worker, using fallback mode:', err);
      this.updateStatus({
        status: 'ready',
        engine: 'Fallback',
        message: 'Worker spawn bypassed, using client fallback.'
      });
    }
  }

  private handleWorkerMessage(event: MessageEvent<WorkerToMainMessage>) {
    const data = event.data;
    if (!data) return;

    switch (data.type) {
      case 'STATUS': {
        this.updateStatus({
          status: data.status,
          engine: data.engine,
          message: data.message
        });
        break;
      }

      case 'REBUILD_SUCCESS': {
        this.handleRebuildSuccess(data);
        break;
      }

      case 'REBUILD_ERROR': {
        if (data.requestId === this.pendingRequestId) {
          if (this.pendingRejecter) {
            this.pendingRejecter(new Error(data.error));
          }
          this.pendingRequestId = null;
          this.pendingResolver = null;
          this.pendingRejecter = null;
        }
        break;
      }

      case 'LOG': {
        if (data.level === 'error') {
          console.error(`[OCCT Worker] ${data.message}`);
        } else if (data.level === 'warn') {
          console.warn(`[OCCT Worker] ${data.message}`);
        }
        break;
      }

      default:
        break;
    }
  }

  private handleRebuildSuccess(msg: WorkerRebuildSuccessMessage) {
    // Only accept if it matches our active inflight request
    if (msg.requestId !== this.pendingRequestId) {
      return;
    }

    // Convert WorkerMeshTransferable to SolidMesh3D
    const meshes: SolidMesh3D[] = msg.meshes.map((m) => ({
      id: m.id,
      featureId: m.featureId,
      featureName: m.featureName,
      featureType: m.featureType,
      positions: m.positions,
      normals: m.normals,
      indices: m.indices,
      edges: m.edges,
      boundingBox: m.boundingBox,
      color: m.color,
      opacity: m.opacity,
      isCut: m.isCut,
      triangleCount: m.triangleCount,
      vertexCount: m.vertexCount
    }));

    // Update Kernel Metrics
    this.lastMetrics = {
      durationMs: msg.durationMs,
      booleanCutExecuted: msg.booleanCutExecuted,
      occtActive: msg.occtActive,
      totalTriangles: msg.stats.totalTriangles,
      totalVertices: msg.stats.totalVertices,
      lastUpdated: Date.now()
    };
    this.notifyMetrics();

    if (this.pendingResolver) {
      this.pendingResolver(meshes);
    }

    this.pendingRequestId = null;
    this.pendingResolver = null;
    this.pendingRejecter = null;
  }

  private updateStatus(info: WorkerStatusInfo) {
    this.statusInfo = info;
    for (const listener of this.statusListeners) {
      try {
        listener(info);
      } catch (err) {
        console.error('[OcctWorkerClient] Status listener error:', err);
      }
    }
  }

  private notifyMetrics() {
    for (const listener of this.metricsListeners) {
      try {
        listener(this.lastMetrics);
      } catch (err) {
        console.error('[OcctWorkerClient] Metrics listener error:', err);
      }
    }
  }

  /**
   * 非同步發送特徵樹至 WebWorker 進行 3D 布林運算與幾何網格再生。
   * 自動淘汰過時 (Obsolete) 請求，防止多個高頻滑鼠事件積壓。
   */
  public rebuildModelAsync(
    featureTree: ParametricFeature[],
    options?: { stopOnError?: boolean; linearDeflection?: number; angularDeflection?: number }
  ): Promise<SolidMesh3D[]> {
    if (!this.worker) {
      return Promise.reject(new Error('Worker is not initialized'));
    }

    this.requestIdCounter += 1;
    const reqId = `req_${this.requestIdCounter}_${Date.now()}`;
    this.pendingRequestId = reqId;

    return new Promise<SolidMesh3D[]>((resolve, reject) => {
      this.pendingResolver = resolve;
      this.pendingRejecter = reject;

      const msg: MainToWorkerMessage = {
        type: 'REBUILD_MODEL',
        requestId: reqId,
        featureTree,
        options
      };

      this.worker?.postMessage(msg);
    });
  }

  public getStatus(): WorkerStatusInfo {
    return { ...this.statusInfo };
  }

  public getMetrics(): WorkerKernelMetrics {
    return { ...this.lastMetrics };
  }

  public subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.statusInfo);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public subscribeMetrics(listener: MetricsListener): () => void {
    this.metricsListeners.add(listener);
    listener(this.lastMetrics);
    return () => {
      this.metricsListeners.delete(listener);
    };
  }

  public terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.statusListeners.clear();
    this.metricsListeners.clear();
  }
}
