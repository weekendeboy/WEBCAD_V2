import {
  CADDocument,
  CustomPlane,
  SketchFeature,
  ExtrudeFeature,
  CutFeature,
  LineEntity,
  CircleEntity,
  ArcEntity,
  PolylineEntity,
  HorizontalConstraint,
  VerticalConstraint,
  CoincidentConstraint,
  TangentConstraint,
  DistanceConstraint,
  Dimension
} from '../types/cad.ts';

// 1. Reference Planes
export const datumFrontPlane: CustomPlane = {
  id: 'plane_datum_xy',
  name: 'Front Plane (XY)',
  origin: { x: 0, y: 0, z: 0 },
  normal: { x: 0, y: 0, z: 1 },
  xAxis: { x: 1, y: 0, z: 0 },
  yAxis: { x: 0, y: 1, z: 0 },
  isDatum: true
};

export const datumTopPlane: CustomPlane = {
  id: 'plane_datum_xz',
  name: 'Top Plane (XZ)',
  origin: { x: 0, y: 0, z: 0 },
  normal: { x: 0, y: 1, z: 0 },
  xAxis: { x: 1, y: 0, z: 0 },
  yAxis: { x: 0, y: 0, z: -1 },
  isDatum: true
};

export const customAngledPlane: CustomPlane = {
  id: 'plane_custom_angled',
  name: 'Auxiliary Chamfer Plane',
  origin: { x: 60, y: 40, z: 20 },
  normal: { x: 0.7071, y: 0.7071, z: 0 },
  xAxis: { x: -0.7071, y: 0.7071, z: 0 },
  yAxis: { x: 0, y: 0, z: 1 },
  offset: 15,
  isDatum: false
};

// 2. Sketch 1 Entities (Base Plate Outline)
const lineBottom: LineEntity = {
  id: 'ent_line_bottom',
  type: 'line',
  layer: 'layer_outline',
  color: '#2563eb',
  state: 'fully_constrained',
  isConstruction: false,
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 }
};

const lineRight: LineEntity = {
  id: 'ent_line_right',
  type: 'line',
  layer: 'layer_outline',
  color: '#2563eb',
  state: 'fully_constrained',
  isConstruction: false,
  start: { x: 100, y: 0 },
  end: { x: 100, y: 50 }
};

// 45° Inclined Chamfer Line -> forms arbitrary slanted face in 3D
const lineChamfer: LineEntity = {
  id: 'ent_line_chamfer',
  type: 'line',
  layer: 'layer_outline',
  color: '#2563eb',
  state: 'fully_constrained',
  isConstruction: false,
  start: { x: 100, y: 50 },
  end: { x: 70, y: 80 }
};

const lineTop: LineEntity = {
  id: 'ent_line_top',
  type: 'line',
  layer: 'layer_outline',
  color: '#2563eb',
  state: 'fully_constrained',
  isConstruction: false,
  start: { x: 70, y: 80 },
  end: { x: 0, y: 80 }
};

const lineLeft: LineEntity = {
  id: 'ent_line_left',
  type: 'line',
  layer: 'layer_outline',
  color: '#2563eb',
  state: 'fully_constrained',
  isConstruction: false,
  start: { x: 0, y: 80 },
  end: { x: 0, y: 0 }
};

// Polyline for inner bracket rib
const polylineRib: PolylineEntity = {
  id: 'ent_polyline_rib',
  type: 'polyline',
  layer: 'layer_construction',
  color: '#9333ea',
  state: 'idle',
  isConstruction: true,
  isClosed: false,
  vertices: [
    { point: { x: 20, y: 20 }, bulge: 0 },
    { point: { x: 40, y: 20 }, bulge: 0.414 }, // Tangent arc bulge
    { point: { x: 60, y: 40 }, bulge: 0 },
    { point: { x: 60, y: 60 }, bulge: 0 }
  ]
};

// 3. Constraints for Sketch 1
const constraintsSketch1 = [
  {
    id: 'c_horiz_bottom',
    type: 'horizontal' as const,
    name: 'Horizontal1',
    entityIds: ['ent_line_bottom']
  } as HorizontalConstraint,
  {
    id: 'c_vert_left',
    type: 'vertical' as const,
    name: 'Vertical1',
    entityIds: ['ent_line_left']
  } as VerticalConstraint,
  {
    id: 'c_coincident_corner',
    type: 'coincident' as const,
    name: 'Coincident_Origin',
    entityIds: ['ent_line_bottom', 'ent_line_left']
  } as CoincidentConstraint,
  {
    id: 'c_tangent_arc_line',
    type: 'tangent' as const,
    name: 'Tangent_Arc_Top',
    entityIds: ['ent_arc_corner', 'ent_line_top']
  } as TangentConstraint,
  {
    id: 'c_dist_length',
    type: 'distance' as const,
    name: 'Length_100mm',
    distance: 100,
    entityIds: ['ent_line_bottom']
  } as DistanceConstraint
];

// 4. Dimensions for Sketch 1
const dimensionsSketch1: Dimension[] = [
  {
    id: 'dim_base_width',
    type: 'linear_horizontal',
    entityIds: ['ent_line_bottom'],
    value: 100.0,
    parameterName: 'D1@Sketch1',
    textPosition: { x: 50, y: -12 },
    isDriving: true,
    suffix: 'mm',
    tolerance: { upper: 0.05, lower: -0.05, type: 'symmetric' }
  },
  {
    id: 'dim_base_height',
    type: 'linear_vertical',
    entityIds: ['ent_line_left'],
    value: 80.0,
    parameterName: 'D2@Sketch1',
    textPosition: { x: -14, y: 40 },
    isDriving: true,
    suffix: 'mm'
  },
  {
    id: 'dim_arc_radius',
    type: 'radius',
    entityIds: ['ent_arc_corner'],
    value: 20.0,
    parameterName: 'R1@Sketch1',
    textPosition: { x: 90, y: 72 },
    isDriving: true,
    prefix: 'R',
    suffix: 'mm'
  }
];

// Sketch 1 Feature
export const sketchFeature1: SketchFeature = {
  id: 'feat_sketch_1',
  name: 'Sketch1 (Base Profile)',
  type: 'sketch',
  dependencies: [],
  suppressed: false,
  status: 'clean',
  createdAt: 1715000000000,
  planeId: datumFrontPlane.id,
  plane: datumFrontPlane,
  entities: [lineBottom, lineRight, lineChamfer, lineTop, lineLeft, polylineRib],
  constraints: constraintsSketch1,
  dimensions: dimensionsSketch1,
  profiles: [
    {
      id: 'profile_outer_1',
      contourEntityIds: [
        'ent_line_bottom',
        'ent_line_right',
        'ent_line_chamfer',
        'ent_line_top',
        'ent_line_left'
      ],
      area: 7550.00
    }
  ],
  solverState: 'fully_constrained'
};

// Extrude 1 Feature (Depends on Sketch 1)
export const extrudeFeature1: ExtrudeFeature = {
  id: 'feat_extrude_1',
  name: 'Boss-Extrude1',
  type: 'extrude',
  dependencies: ['feat_sketch_1'],
  suppressed: false,
  status: 'clean',
  createdAt: 1715000010000,
  sketchFeatureId: 'feat_sketch_1',
  selectedProfileIds: ['profile_outer_1'],
  depth: 30.0,
  endCondition: 'blind',
  draftAngle: 0,
  booleanOperation: 'new_body',
  directionVector: { x: 0, y: 0, z: 1 }
};

// Sketch 2 Entities (Mounting Bore Hole)
const circleHole: CircleEntity = {
  id: 'ent_circle_bore',
  type: 'circle',
  layer: 'layer_outline',
  color: '#ef4444',
  state: 'fully_constrained',
  isConstruction: false,
  center: { x: 40, y: 40 },
  radius: 12.5
};

export const sketchFeature2: SketchFeature = {
  id: 'feat_sketch_2',
  name: 'Sketch2 (Bore Hole)',
  type: 'sketch',
  dependencies: ['feat_extrude_1'],
  suppressed: false,
  status: 'clean',
  createdAt: 1715000020000,
  planeId: datumFrontPlane.id,
  plane: datumFrontPlane,
  entities: [circleHole],
  constraints: [
    {
      id: 'c_dist_center_x',
      type: 'distance',
      name: 'Hole_Position_X',
      distance: 40,
      entityIds: ['ent_circle_bore']
    } as DistanceConstraint
  ],
  dimensions: [
    {
      id: 'dim_hole_dia',
      type: 'diameter',
      entityIds: ['ent_circle_bore'],
      value: 25.0,
      parameterName: 'D1@Sketch2',
      textPosition: { x: 40, y: 60 },
      isDriving: true,
      prefix: 'Ø',
      suffix: 'mm'
    }
  ],
  profiles: [
    {
      id: 'profile_hole_1',
      contourEntityIds: ['ent_circle_bore'],
      isIsland: true,
      area: 490.87
    }
  ],
  solverState: 'fully_constrained'
};

// Cut Extrude 1 Feature (Depends on Sketch 2 and Extrude 1)
export const cutFeature1: CutFeature = {
  id: 'feat_cut_1',
  name: 'Cut-Extrude1',
  type: 'cut',
  dependencies: ['feat_sketch_2', 'feat_extrude_1'],
  suppressed: false,
  status: 'clean',
  createdAt: 1715000030000,
  sketchFeatureId: 'feat_sketch_2',
  selectedProfileIds: ['profile_hole_1'],
  depth: 30.0,
  endCondition: 'through_all',
  flipSideToCut: false
};

export const sampleCADDocument: CADDocument = {
  id: 'doc_cad_sample_01',
  title: 'Mounting_Bracket_Parametric.cad',
  version: '1.0.0',
  units: 'mm',
  layers: {
    layer_outline: {
      id: 'layer_outline',
      name: '0 - Visible Geometry',
      color: '#2563eb',
      visible: true,
      locked: false,
      lineType: 'continuous',
      lineWidth: 0.5
    },
    layer_construction: {
      id: 'layer_construction',
      name: 'Defpoints - Construction',
      color: '#9333ea',
      visible: true,
      locked: false,
      lineType: 'dashed',
      lineWidth: 0.25
    },
    layer_dimensions: {
      id: 'layer_dimensions',
      name: 'Dimensions & Annotations',
      color: '#059669',
      visible: true,
      locked: false,
      lineType: 'continuous',
      lineWidth: 0.18
    }
  },
  planes: {
    [datumFrontPlane.id]: datumFrontPlane,
    [datumTopPlane.id]: datumTopPlane,
    [customAngledPlane.id]: customAngledPlane
  },
  featureTree: [sketchFeature1, extrudeFeature1, sketchFeature2, cutFeature1],
  activeFeatureId: 'feat_cut_1',
  activeSketchId: 'feat_sketch_1'
};
