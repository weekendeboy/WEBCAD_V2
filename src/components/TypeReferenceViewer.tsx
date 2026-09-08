import React, { useState } from 'react';
import { Code2, BookOpen, Check, Copy } from 'lucide-react';

export const TypeReferenceViewer: React.FC = () => {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'2d' | 'constraints' | '3d' | 'plane'>('2d');

  const snippets = {
    '2d': `// 2D Geometric Entities (AutoCAD Style)
export interface BaseEntity2D {
  id: EntityId;
  layer: LayerId;
  color?: string;
  state: EntityState; // 'idle' | 'hovered' | 'selected' | 'construction' | 'locked' | ...
  isConstruction: boolean;
}

export interface LineEntity extends BaseEntity2D {
  type: 'line';
  start: Point2D;
  end: Point2D;
}

export interface ArcEntity extends BaseEntity2D {
  type: 'arc';
  center: Point2D;
  radius: number;
  startAngle: number;
  endAngle: number;
  counterClockwise?: boolean;
}

export interface CircleEntity extends BaseEntity2D {
  type: 'circle';
  center: Point2D;
  radius: number;
}

export interface PolylineVertex {
  point: Point2D;
  bulge?: number; // AutoCAD polyline arc representation tan(included_angle / 4)
}

export interface PolylineEntity extends BaseEntity2D {
  type: 'polyline';
  vertices: PolylineVertex[];
  isClosed: boolean;
}`,
    constraints: `// Geometric Constraints & Dimensions (SolidWorks Sketcher Style)
export type ConstraintType =
  | 'coincident' | 'horizontal' | 'vertical'
  | 'distance'   | 'tangent'    | 'parallel'
  | 'perpendicular' | 'concentric' | 'fixed';

export interface BaseConstraint {
  id: ConstraintId;
  type: ConstraintType;
  entityIds: EntityId[];
}

export interface CoincidentConstraint extends BaseConstraint {
  type: 'coincident';
  pointIndexA?: number;
  pointIndexB?: number;
}

export interface DistanceConstraint extends BaseConstraint {
  type: 'distance';
  distance: number;
}

export interface Dimension {
  id: string;
  type: 'linear_horizontal' | 'linear_vertical' | 'distance' | 'diameter' | 'radius' | 'angle';
  entityIds: EntityId[];
  value: number;
  parameterName?: string;
  textPosition: Point2D;
  isDriving: boolean; // Driving controls geometry; Driven is reference only
  prefix?: string;
  suffix?: string;
}`,
    '3d': `// 3D Parametric Features & DAG (SolidWorks Style)
export interface FeatureNode {
  id: FeatureId;
  name: string;
  type: FeatureType;
  dependencies: FeatureId[]; // Ancestor nodes forming the DAG
  suppressed: boolean;
  status: 'clean' | 'dirty' | 'error' | 'warning';
  createdAt: number;
}

export interface SketchFeature extends FeatureNode {
  type: 'sketch';
  planeId: string;
  plane: CustomPlane;
  entities: CADEntity2D[];
  constraints: Constraint[];
  dimensions: Dimension[];
  profiles: SketchProfile[];
  solverState: 'under_constrained' | 'fully_constrained' | 'over_constrained';
}

export interface ExtrudeFeature extends FeatureNode {
  type: 'extrude';
  sketchFeatureId: FeatureId;
  depth: number;
  endCondition: 'blind' | 'through_all' | 'mid_plane' | ...;
  booleanOperation: 'union' | 'subtract' | 'new_body';
  directionVector?: Vector3D;
}

export interface CutFeature extends FeatureNode {
  type: 'cut';
  sketchFeatureId: FeatureId;
  depth: number;
  endCondition: 'blind' | 'through_all' | ...;
  flipSideToCut?: boolean;
}`,
    plane: `// 3D Coordinate Reference Plane
export interface CustomPlane {
  id: string;
  name: string;
  origin: Point3D;   // (x, y, z) in 3D world space
  normal: Vector3D;  // Normal vector perpendicular to surface (Z_local)
  xAxis: Vector3D;   // Horizontal axis unit vector on plane (X_local)
  yAxis: Vector3D;   // Vertical axis unit vector on plane (Y_local)
  offset?: number;
  isDatum?: boolean;
}`
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(snippets[activeTab]);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
      <div className="px-4 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Code2 className="w-4 h-4 text-sky-400" />
          <h3 className="font-semibold text-sm text-slate-100">
            TypeScript Type Architecture (src/types/cad.ts)
          </h3>
        </div>
        <button
          id="copy-snippet-btn"
          onClick={handleCopy}
          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy Code'}
        </button>
      </div>

      {/* Tabs */}
      <div className="px-3 pt-2 bg-slate-950/80 border-b border-slate-800 flex gap-2">
        <button
          onClick={() => setActiveTab('2d')}
          className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
            activeTab === '2d'
              ? 'border-sky-500 text-sky-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          2D Geometry (Entities)
        </button>
        <button
          onClick={() => setActiveTab('constraints')}
          className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'constraints'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Constraints & Dimensions
        </button>
        <button
          onClick={() => setActiveTab('3d')}
          className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
            activeTab === '3d'
              ? 'border-emerald-500 text-emerald-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          3D Features & DAG
        </button>
        <button
          onClick={() => setActiveTab('plane')}
          className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'plane'
              ? 'border-amber-500 text-amber-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          CustomPlane (4 Vectors)
        </button>
      </div>

      {/* Code Block */}
      <div className="p-4 flex-1 overflow-auto bg-slate-950 font-mono text-xs text-slate-300 leading-relaxed">
        <pre className="whitespace-pre overflow-x-auto">
          <code>{snippets[activeTab]}</code>
        </pre>
      </div>
    </div>
  );
};
