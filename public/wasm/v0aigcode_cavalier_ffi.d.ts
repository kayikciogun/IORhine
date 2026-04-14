/* tslint:disable */
/* eslint-disable */
export function on_load(): void;
export function plineParallelOffset(pline: any, offset: number, handle_self_intersects: boolean): any;
export function plineFindIntersects(pline1: any, pline2: any): Array<any>;
export function plineArcsToApproxLines(pline: any, error_distance: number): any;
export function multiPlineParallelOffset(plines: any, offset: number): any;
export class Polyline {
  free(): void;
  constructor(vertex_data: Float64Array, is_closed: boolean);
  add(x: number, y: number, bulge: number): void;
  clear(): void;
  cycleVertexes(count: number): void;
  vertexData(): Float64Array;
  area(): number;
  pathLength(): number;
  scale(scale_factor: number): void;
  translate(x_offset: number, y_offset: number): void;
  windingNumber(x: number, y: number): number;
  boolean(other: Polyline, operation: number): any;
  closestPoint(x: number, y: number): any;
  createApproxSpatialIndex(): StaticAABB2DIndex;
  createSpatialIndex(): StaticAABB2DIndex;
  extents(): Float64Array;
  invertDirection(): void;
  parallelOffset(offset: number, handle_self_intersects: boolean): Array<any>;
  rawOffset(offset: number): Polyline;
  rawOffsetSegs(offset: number): Array<any>;
  selfIntersects(): Array<any>;
  arcsToApproxLines(error_distance: number): Polyline;
  arcsToApproxLinesData(error_distance: number): Float64Array;
  testProperties(): any;
  logToConsole(): void;
  readonly length: number;
  isClosed: boolean;
}
export class StaticAABB2DIndex {
  free(): void;
  constructor(aabb_data: Float64Array, node_size: number);
  query(min_x: number, min_y: number, max_x: number, max_y: number): Uint32Array;
  levelBounds(): Uint32Array;
  allBoxes(): Float64Array;
  neighbors(x: number, y: number, max_results: number, max_distance: number): Uint32Array;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly plineParallelOffset: (a: any, b: number, c: number) => any;
  readonly plineFindIntersects: (a: any, b: any) => any;
  readonly plineArcsToApproxLines: (a: any, b: number) => any;
  readonly multiPlineParallelOffset: (a: any, b: number) => any;
  readonly __wbg_staticaabb2dindex_free: (a: number, b: number) => void;
  readonly staticaabb2dindex_new: (a: number, b: number, c: number) => number;
  readonly staticaabb2dindex_query: (a: number, b: number, c: number, d: number, e: number) => [number, number];
  readonly staticaabb2dindex_levelBounds: (a: number) => any;
  readonly staticaabb2dindex_allBoxes: (a: number) => any;
  readonly staticaabb2dindex_neighbors: (a: number, b: number, c: number, d: number, e: number) => [number, number];
  readonly __wbg_polyline_free: (a: number, b: number) => void;
  readonly polyline_new: (a: number, b: number, c: number) => number;
  readonly polyline_add: (a: number, b: number, c: number, d: number) => void;
  readonly polyline_clear: (a: number) => void;
  readonly polyline_length: (a: number) => number;
  readonly polyline_cycleVertexes: (a: number, b: number) => void;
  readonly polyline_vertexData: (a: number) => [number, number];
  readonly polyline_is_closed: (a: number) => number;
  readonly polyline_set_is_closed: (a: number, b: number) => void;
  readonly polyline_area: (a: number) => number;
  readonly polyline_pathLength: (a: number) => number;
  readonly polyline_scale: (a: number, b: number) => void;
  readonly polyline_translate: (a: number, b: number, c: number) => void;
  readonly polyline_windingNumber: (a: number, b: number, c: number) => number;
  readonly polyline_boolean: (a: number, b: number, c: number) => any;
  readonly polyline_closestPoint: (a: number, b: number, c: number) => any;
  readonly polyline_createApproxSpatialIndex: (a: number) => number;
  readonly polyline_createSpatialIndex: (a: number) => number;
  readonly polyline_extents: (a: number) => [number, number];
  readonly polyline_invertDirection: (a: number) => void;
  readonly polyline_parallelOffset: (a: number, b: number, c: number) => any;
  readonly polyline_rawOffset: (a: number, b: number) => number;
  readonly polyline_rawOffsetSegs: (a: number, b: number) => any;
  readonly polyline_selfIntersects: (a: number) => any;
  readonly polyline_arcsToApproxLines: (a: number, b: number) => number;
  readonly polyline_arcsToApproxLinesData: (a: number, b: number) => [number, number];
  readonly polyline_testProperties: (a: number) => any;
  readonly polyline_logToConsole: (a: number) => void;
  readonly on_load: () => void;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_export_2: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
