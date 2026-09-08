/**
 * @license
 * CAD & Parametric Feature Modeling Core Type Definitions
 * Unifies 2D Drafting (AutoCAD style) with 3D Parametric Feature Trees (SolidWorks style).
 */

// ============================================================================
// 1. Fundamental Geometric Primitives & Vectors
// ============================================================================

export interface Vector2D {
  x: number;
  y: number;
}

export type Point2D = Vector2D;

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export type Point3D = Vector3D;

/**
 * 4x4 Transformation matrix representation (column-major or row-major flat array)
 */
export type Matrix4x4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number
];

// ============================================================================
// 2. Coordinate Systems & Custom Reference Planes
// ============================================================================

/**
 * Custom 3D Sketch & Reference Plane definition.
 * Used to map 2D sketch space (u, v) into 3D world coordinates (x, y, z).
 */
export interface CustomPlane {
  id: string;
  name: string;
  /** Origin point in 3D world space */
  origin: Point3D;
  /** Normal vector perpendicular to the plane surface (Unit vector Z_local) */
  normal: Vector3D;
  /** Primary horizontal reference axis on the plane (Unit vector X_local) */
  xAxis: Vector3D;
  /** Secondary vertical reference axis on the plane (Unit vector Y_local, orthogonal to xAxis and normal) */
  yAxis: Vector3D;
  /** Optional elevation/offset distance from reference parent plane */
  offset?: number;
  /** Whether this is a default datum plane (XY, XZ, YZ) */
  isDatum?: boolean;
}

export type StandardDatumPlane = 'XY_FRONT' | 'XZ_TOP' | 'YZ_RIGHT';

// ============================================================================
// 3. 2D Drafting Geometry & Entities (AutoCAD Style)
// ============================================================================

export type EntityId = string;
export type LayerId = string;

/**
 * Visual and operational state of a CAD entity
 */
export type EntityState =
  | 'idle'
  | 'hovered'
  | 'selected'
  | 'dragging'
  | 'construction' // Auxiliary / reference construction geometry
  | 'locked'
  | 'under_constrained'
  | 'fully_constrained'
  | 'over_constrained'
  | 'UnderDefined'
  | 'FullyDefined'
  | 'OverDefined';

export type LineType = 'continuous' | 'dashed' | 'dotted' | 'centerline' | 'phantom';

export interface Layer {
  id: LayerId;
  name: string;
  color: string; // Hex, rgb, or color string
  visible: boolean;
  locked: boolean;
  lineType: LineType;
  lineWidth: number; // in mm or pt
}

/**
 * Base 2D CAD Entity attributes shared by all geometric elements
 */
export interface BaseEntity2D {
  id: EntityId;
  layer: LayerId;
  color?: string; // If undefined, inherits from layer
  lineWidth?: number; // In pixels or mm; inherits if undefined
  lineType?: LineType;
  state: EntityState;
  isConstruction: boolean; // SolidWorks construction geometry flag
  metadata?: Record<string, unknown>;
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
  /** Start angle in radians (standard counter-clockwise CAD convention) */
  startAngle: number;
  /** End angle in radians */
  endAngle: number;
  /** Whether the arc direction is counter-clockwise */
  counterClockwise?: boolean;
}

export interface CircleEntity extends BaseEntity2D {
  type: 'circle';
  center: Point2D;
  radius: number;
}

export interface PolylineVertex {
  point: Point2D;
  /** Bulge factor (AutoCAD polyline arc representation: tan(included_angle / 4)) */
  bulge?: number;
}

export interface PolylineEntity extends BaseEntity2D {
  type: 'polyline';
  vertices: PolylineVertex[];
  isClosed: boolean;
}

export interface SplineEntity extends BaseEntity2D {
  type: 'spline';
  controlPoints: Point2D[];
  degree: number;
  knots?: number[];
  isClosed?: boolean;
}

/**
 * Discriminated union of all 2D sketch and drafting geometric entities
 */
export type CADEntity2D =
  | LineEntity
  | ArcEntity
  | CircleEntity
  | PolylineEntity
  | SplineEntity;

// ============================================================================
// 4. Geometric Constraints & Dimensions (SolidWorks Sketcher Style)
// ============================================================================

export type ConstraintId = string;

export type ConstraintType =
  | 'coincident'
  | 'horizontal'
  | 'vertical'
  | 'distance'
  | 'length'
  | 'tangent'
  | 'parallel'
  | 'perpendicular'
  | 'concentric'
  | 'midpoint'
  | 'equal_length'
  | 'equal_radius'
  | 'collinear'
  | 'symmetric'
  | 'fixed';

export interface BaseConstraint {
  id: ConstraintId;
  type: ConstraintType;
  name?: string;
  isSuppressed?: boolean;
  /** References to geometric entities participating in this constraint */
  entityIds: EntityId[];
}

export interface CoincidentConstraint extends BaseConstraint {
  type: 'coincident';
  /** Usually binds point-to-point or point-to-curve */
  pointIndexA?: number;
  pointIndexB?: number;
}

export interface HorizontalConstraint extends BaseConstraint {
  type: 'horizontal';
}

export interface VerticalConstraint extends BaseConstraint {
  type: 'vertical';
}

export interface DistanceConstraint extends BaseConstraint {
  type: 'distance';
  /** Target distance value in sketch linear units (e.g. mm) */
  distance: number;
}

export interface LengthConstraint extends BaseConstraint {
  type: 'length';
  /** Target length value in sketch linear units (e.g. mm) */
  length?: number;
  distance?: number;
}

export interface TangentConstraint extends BaseConstraint {
  type: 'tangent';
}

export interface ParallelConstraint extends BaseConstraint {
  type: 'parallel';
}

export interface PerpendicularConstraint extends BaseConstraint {
  type: 'perpendicular';
}

export interface ConcentricConstraint extends BaseConstraint {
  type: 'concentric';
}

export interface FixedConstraint extends BaseConstraint {
  type: 'fixed';
}

export type Constraint =
  | CoincidentConstraint
  | HorizontalConstraint
  | VerticalConstraint
  | DistanceConstraint
  | LengthConstraint
  | TangentConstraint
  | ParallelConstraint
  | PerpendicularConstraint
  | ConcentricConstraint
  | FixedConstraint
  | BaseConstraint;

export type DimensionType =
  | 'linear_horizontal'
  | 'linear_vertical'
  | 'linear_aligned'
  | 'distance'
  | 'diameter'
  | 'radius'
  | 'angle';

export interface Dimension {
  id: string;
  type: DimensionType;
  /** Associated entity IDs being measured */
  entityIds: EntityId[];
  /** Driven value in current model units (e.g. mm or degrees) */
  value: number;
  /** User-customized label or expression (e.g. "D1@Sketch1 = 50mm") */
  parameterName?: string;
  /** Position where the dimension label text & witness lines are placed */
  textPosition: Point2D;
  /** Driven (reference/read-only) vs Driving (controls geometry) */
  isDriving: boolean;
  prefix?: string;
  suffix?: string;
  tolerance?: {
    upper: number;
    lower: number;
    type: 'symmetric' | 'deviation' | 'limits' | 'basic';
  };
}

// ============================================================================
// 5. 3D Parametric Features & DAG (Directed Acyclic Graph)
// ============================================================================

export type FeatureId = string;

export type FeatureType =
  | 'sketch'
  | 'extrude'
  | 'cut'
  | 'revolve'
  | 'fillet'
  | 'chamfer'
  | 'datum_plane';

export type FeatureStatus = 'clean' | 'dirty' | 'error' | 'warning';

/**
 * Base FeatureNode forming the DAG history tree (like SolidWorks FeatureManager).
 */
export interface FeatureNode {
  id: FeatureId;
  name: string;
  type: FeatureType;
  /**
   * Directed Acyclic Graph dependencies:
   * Contains IDs of ancestor features this node depends upon.
   */
  dependencies: FeatureId[];
  /** Whether the feature is suppressed / disabled in the parametric rebuild cycle */
  suppressed: boolean;
  /** Regeneration / computation status of this node */
  status: FeatureStatus;
  /** Optional rebuild error/warning message */
  statusMessage?: string;
  /** Creation timestamp */
  createdAt: number;
  /** Additional custom parametric properties */
  parameters?: Record<string, unknown>;
}

/**
 * 2D Closed Profile extracted from a Sketch for 3D feature operations
 */
export interface SketchProfile {
  id: string;
  contourEntityIds: EntityId[];
  isIsland?: boolean; // Interior void or cutout
  area?: number;
  /** Sampled boundary vertices for visualization and 3D triangulation */
  points?: Point2D[];
}

/**
 * Sketch Feature: Defines a 2D constraint-driven profile placed on a 3D CustomPlane
 */
export interface SketchFeature extends FeatureNode {
  type: 'sketch';
  /** Reference to the datum or custom plane on which this sketch is mapped */
  planeId: string;
  plane: CustomPlane;
  /** 2D Geometric entities contained inside this sketch */
  entities: CADEntity2D[];
  /** Geometric constraints governing the sketch entities */
  constraints: Constraint[];
  /** Parametric dimensions in this sketch */
  dimensions: Dimension[];
  /** Closed profiles calculated by the 2D topology solver */
  profiles: SketchProfile[];
  /** Status of solver degrees of freedom */
  solverState: 'under_constrained' | 'fully_constrained' | 'over_constrained';
}

export type ExtrudeEndCondition =
  | 'blind'
  | 'through_all'
  | 'up_to_next'
  | 'up_to_surface'
  | 'mid_plane';

export type BooleanOperation = 'union' | 'subtract' | 'intersect' | 'new_body';

/**
 * Extrude Feature (Boss/Base): Adds 3D material along a direction vector
 */
export interface ExtrudeFeature extends FeatureNode {
  type: 'extrude';
  /** Target sketch feature supplying the 2D profiles */
  sketchFeatureId: FeatureId;
  /** Profile IDs to extrude (if empty, extrudes all valid profiles in the sketch) */
  selectedProfileIds?: string[];
  /** Primary extrusion depth in mm */
  depth: number;
  /** End termination condition */
  endCondition: ExtrudeEndCondition;
  /** Draft angle in degrees (taper) */
  draftAngle?: number;
  /** Draft outward flag */
  draftOutward?: boolean;
  /** Secondary opposite direction settings */
  direction2?: {
    enabled: boolean;
    depth: number;
    endCondition: ExtrudeEndCondition;
    draftAngle?: number;
  };
  /** Boolean combination method */
  booleanOperation: BooleanOperation;
  /** Extrusion normal vector (defaults to sketch plane normal) */
  directionVector?: Vector3D;
}

/**
 * Cut Feature (Extruded Cut): Removes 3D volume using sketch profiles
 */
export interface CutFeature extends FeatureNode {
  type: 'cut';
  /** Target sketch feature supplying the cutter profile */
  sketchFeatureId: FeatureId;
  /** Profile IDs used for the cut operation */
  selectedProfileIds?: string[];
  /** Cut depth in mm */
  depth: number;
  /** End condition (often 'through_all' or 'blind') */
  endCondition: ExtrudeEndCondition;
  /** Normal or inverted cut side */
  flipSideToCut?: boolean;
  /** Draft angle in degrees */
  draftAngle?: number;
  /** Target solid bodies to cut from (multi-body support) */
  targetBodyIds?: string[];
}

/**
 * Union of all parametric features supported in the model tree
 */
export type ParametricFeature = SketchFeature | ExtrudeFeature | CutFeature | FeatureNode;

// ============================================================================
// 6. Complete CAD Document Model
// ============================================================================

export interface CADDocument {
  id: string;
  title: string;
  version: string;
  layers: Record<LayerId, Layer>;
  planes: Record<string, CustomPlane>;
  /** FeatureManager Tree in sequence order (topological sort of the DAG) */
  featureTree: ParametricFeature[];
  activeFeatureId?: FeatureId;
  activeSketchId?: FeatureId;
  units: 'mm' | 'm' | 'inch' | 'ft';
}

// ============================================================================
// 7. Workbench Tools & View Modes
// ============================================================================

export type CADViewMode = '2D' | '3D';

export type CADTool =
  | 'SELECT'
  | 'LINE'
  | 'CIRCLE'
  | 'ARC'
  | 'RECTANGLE'
  | 'POLYLINE'
  | 'DIMENSION'
  | 'PAN';

