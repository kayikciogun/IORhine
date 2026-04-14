let wasm;

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_export_2.set(idx, obj);
    return idx;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

const cachedTextDecoder = (typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }) : { decode: () => { throw Error('TextDecoder not available') } } );

if (typeof TextDecoder !== 'undefined') { cachedTextDecoder.decode(); };

let cachedUint8ArrayMemory0 = null;

function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

const cachedTextEncoder = (typeof TextEncoder !== 'undefined' ? new TextEncoder('utf-8') : { encode: () => { throw Error('TextEncoder not available') } } );

const encodeString = (typeof cachedTextEncoder.encodeInto === 'function'
    ? function (arg, view) {
    return cachedTextEncoder.encodeInto(arg, view);
}
    : function (arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
        read: arg.length,
        written: buf.length
    };
});

function passStringToWasm0(arg, malloc, realloc) {

    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }

    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = encodeString(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedDataViewMemory0 = null;

function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

export function on_load() {
    wasm.on_load();
}

/**
 * @param {any} pline
 * @param {number} offset
 * @param {boolean} handle_self_intersects
 * @returns {any}
 */
export function plineParallelOffset(pline, offset, handle_self_intersects) {
    const ret = wasm.plineParallelOffset(pline, offset, handle_self_intersects);
    return ret;
}

/**
 * @param {any} pline1
 * @param {any} pline2
 * @returns {Array<any>}
 */
export function plineFindIntersects(pline1, pline2) {
    const ret = wasm.plineFindIntersects(pline1, pline2);
    return ret;
}

/**
 * @param {any} pline
 * @param {number} error_distance
 * @returns {any}
 */
export function plineArcsToApproxLines(pline, error_distance) {
    const ret = wasm.plineArcsToApproxLines(pline, error_distance);
    return ret;
}

/**
 * @param {any} plines
 * @param {number} offset
 * @returns {any}
 */
export function multiPlineParallelOffset(plines, offset) {
    const ret = wasm.multiPlineParallelOffset(plines, offset);
    return ret;
}

let cachedFloat64ArrayMemory0 = null;

function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachedUint32ArrayMemory0 = null;

function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

const PolylineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_polyline_free(ptr >>> 0, 1));

export class Polyline {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Polyline.prototype);
        obj.__wbg_ptr = ptr;
        PolylineFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PolylineFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_polyline_free(ptr, 0);
    }
    /**
     * @param {Float64Array} vertex_data
     * @param {boolean} is_closed
     */
    constructor(vertex_data, is_closed) {
        const ptr0 = passArrayF64ToWasm0(vertex_data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.polyline_new(ptr0, len0, is_closed);
        this.__wbg_ptr = ret >>> 0;
        PolylineFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} bulge
     */
    add(x, y, bulge) {
        wasm.polyline_add(this.__wbg_ptr, x, y, bulge);
    }
    clear() {
        wasm.polyline_clear(this.__wbg_ptr);
    }
    /**
     * @returns {number}
     */
    get length() {
        const ret = wasm.polyline_length(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} count
     */
    cycleVertexes(count) {
        wasm.polyline_cycleVertexes(this.__wbg_ptr, count);
    }
    /**
     * @returns {Float64Array}
     */
    vertexData() {
        const ret = wasm.polyline_vertexData(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {boolean}
     */
    get isClosed() {
        const ret = wasm.polyline_is_closed(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {boolean} is_closed
     */
    set isClosed(is_closed) {
        wasm.polyline_set_is_closed(this.__wbg_ptr, is_closed);
    }
    /**
     * @returns {number}
     */
    area() {
        const ret = wasm.polyline_area(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    pathLength() {
        const ret = wasm.polyline_pathLength(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} scale_factor
     */
    scale(scale_factor) {
        wasm.polyline_scale(this.__wbg_ptr, scale_factor);
    }
    /**
     * @param {number} x_offset
     * @param {number} y_offset
     */
    translate(x_offset, y_offset) {
        wasm.polyline_translate(this.__wbg_ptr, x_offset, y_offset);
    }
    /**
     * @param {number} x
     * @param {number} y
     * @returns {number}
     */
    windingNumber(x, y) {
        const ret = wasm.polyline_windingNumber(this.__wbg_ptr, x, y);
        return ret;
    }
    /**
     * @param {Polyline} other
     * @param {number} operation
     * @returns {any}
     */
    boolean(other, operation) {
        _assertClass(other, Polyline);
        const ret = wasm.polyline_boolean(this.__wbg_ptr, other.__wbg_ptr, operation);
        return ret;
    }
    /**
     * @param {number} x
     * @param {number} y
     * @returns {any}
     */
    closestPoint(x, y) {
        const ret = wasm.polyline_closestPoint(this.__wbg_ptr, x, y);
        return ret;
    }
    /**
     * @returns {StaticAABB2DIndex}
     */
    createApproxSpatialIndex() {
        const ret = wasm.polyline_createApproxSpatialIndex(this.__wbg_ptr);
        return StaticAABB2DIndex.__wrap(ret);
    }
    /**
     * @returns {StaticAABB2DIndex}
     */
    createSpatialIndex() {
        const ret = wasm.polyline_createSpatialIndex(this.__wbg_ptr);
        return StaticAABB2DIndex.__wrap(ret);
    }
    /**
     * @returns {Float64Array}
     */
    extents() {
        const ret = wasm.polyline_extents(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    invertDirection() {
        wasm.polyline_invertDirection(this.__wbg_ptr);
    }
    /**
     * @param {number} offset
     * @param {boolean} handle_self_intersects
     * @returns {Array<any>}
     */
    parallelOffset(offset, handle_self_intersects) {
        const ret = wasm.polyline_parallelOffset(this.__wbg_ptr, offset, handle_self_intersects);
        return ret;
    }
    /**
     * @param {number} offset
     * @returns {Polyline}
     */
    rawOffset(offset) {
        const ret = wasm.polyline_rawOffset(this.__wbg_ptr, offset);
        return Polyline.__wrap(ret);
    }
    /**
     * @param {number} offset
     * @returns {Array<any>}
     */
    rawOffsetSegs(offset) {
        const ret = wasm.polyline_rawOffsetSegs(this.__wbg_ptr, offset);
        return ret;
    }
    /**
     * @returns {Array<any>}
     */
    selfIntersects() {
        const ret = wasm.polyline_selfIntersects(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} error_distance
     * @returns {Polyline}
     */
    arcsToApproxLines(error_distance) {
        const ret = wasm.polyline_arcsToApproxLines(this.__wbg_ptr, error_distance);
        return Polyline.__wrap(ret);
    }
    /**
     * @param {number} error_distance
     * @returns {Float64Array}
     */
    arcsToApproxLinesData(error_distance) {
        const ret = wasm.polyline_arcsToApproxLinesData(this.__wbg_ptr, error_distance);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {any}
     */
    testProperties() {
        const ret = wasm.polyline_testProperties(this.__wbg_ptr);
        return ret;
    }
    logToConsole() {
        wasm.polyline_logToConsole(this.__wbg_ptr);
    }
}

const StaticAABB2DIndexFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_staticaabb2dindex_free(ptr >>> 0, 1));

export class StaticAABB2DIndex {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(StaticAABB2DIndex.prototype);
        obj.__wbg_ptr = ptr;
        StaticAABB2DIndexFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        StaticAABB2DIndexFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_staticaabb2dindex_free(ptr, 0);
    }
    /**
     * @param {Float64Array} aabb_data
     * @param {number} node_size
     */
    constructor(aabb_data, node_size) {
        const ptr0 = passArrayF64ToWasm0(aabb_data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.staticaabb2dindex_new(ptr0, len0, node_size);
        this.__wbg_ptr = ret >>> 0;
        StaticAABB2DIndexFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} min_x
     * @param {number} min_y
     * @param {number} max_x
     * @param {number} max_y
     * @returns {Uint32Array}
     */
    query(min_x, min_y, max_x, max_y) {
        const ret = wasm.staticaabb2dindex_query(this.__wbg_ptr, min_x, min_y, max_x, max_y);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Uint32Array}
     */
    levelBounds() {
        const ret = wasm.staticaabb2dindex_levelBounds(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float64Array}
     */
    allBoxes() {
        const ret = wasm.staticaabb2dindex_allBoxes(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} max_results
     * @param {number} max_distance
     * @returns {Uint32Array}
     */
    neighbors(x, y, max_results, max_distance) {
        const ret = wasm.staticaabb2dindex_neighbors(this.__wbg_ptr, x, y, max_results, max_distance);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);

            } catch (e) {
                if (module.headers.get('Content-Type') != 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);

    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };

        } else {
            return instance;
        }
    }
}

function __wbg_get_imports() {
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbg_buffer_a215fd0f9dbb5414 = function(arg0) {
        const ret = arg0.buffer;
        return ret;
    };
    imports.wbg.__wbg_call_aa20ca83b389253c = function() { return handleError(function (arg0, arg1) {
        const ret = arg0.call(arg1);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_done_b00ac79b7cf688ec = function(arg0) {
        const ret = arg0.done;
        return ret;
    };
    imports.wbg.__wbg_error_7534b8e9a36f1ab4 = function(arg0, arg1) {
        let deferred0_0;
        let deferred0_1;
        try {
            deferred0_0 = arg0;
            deferred0_1 = arg1;
            console.error(getStringFromWasm0(arg0, arg1));
        } finally {
            wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
        }
    };
    imports.wbg.__wbg_get_142c69a0a38ca3a9 = function(arg0, arg1) {
        const ret = arg0[arg1 >>> 0];
        return ret;
    };
    imports.wbg.__wbg_get_9528546d1b415178 = function() { return handleError(function (arg0, arg1) {
        const ret = Reflect.get(arg0, arg1);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_getwithrefkey_6550b2c093d2eb18 = function(arg0, arg1) {
        const ret = arg0[arg1];
        return ret;
    };
    imports.wbg.__wbg_instanceof_ArrayBuffer_b19b33ccadb20395 = function(arg0) {
        let result;
        try {
            result = arg0 instanceof ArrayBuffer;
        } catch (_) {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_instanceof_Uint8Array_ee46a70987a1d66b = function(arg0) {
        let result;
        try {
            result = arg0 instanceof Uint8Array;
        } catch (_) {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_isArray_643b5b2b3afb0871 = function(arg0) {
        const ret = Array.isArray(arg0);
        return ret;
    };
    imports.wbg.__wbg_iterator_c397425a538e3b86 = function() {
        const ret = Symbol.iterator;
        return ret;
    };
    imports.wbg.__wbg_length_1799fd5bf657c257 = function(arg0) {
        const ret = arg0.length;
        return ret;
    };
    imports.wbg.__wbg_length_621925723fc28f40 = function(arg0) {
        const ret = arg0.length;
        return ret;
    };
    imports.wbg.__wbg_log_716e84252e3c6d92 = function(arg0, arg1) {
        console.log(getStringFromWasm0(arg0, arg1));
    };
    imports.wbg.__wbg_new_8a6f238a6ece86ea = function() {
        const ret = new Error();
        return ret;
    };
    imports.wbg.__wbg_new_9163745409122fa8 = function() {
        const ret = new Array();
        return ret;
    };
    imports.wbg.__wbg_new_b6f51e9f591d0d1d = function(arg0) {
        const ret = new Uint8Array(arg0);
        return ret;
    };
    imports.wbg.__wbg_new_d684b6b3189ca362 = function() {
        const ret = new Object();
        return ret;
    };
    imports.wbg.__wbg_newwithlength_287e1a3d420829ac = function(arg0) {
        const ret = new Uint32Array(arg0 >>> 0);
        return ret;
    };
    imports.wbg.__wbg_newwithlength_2ce9afb41dc8218e = function(arg0) {
        const ret = new Float64Array(arg0 >>> 0);
        return ret;
    };
    imports.wbg.__wbg_next_6a72514087dd23f8 = function(arg0) {
        const ret = arg0.next;
        return ret;
    };
    imports.wbg.__wbg_next_96ab50690a8f6cca = function() { return handleError(function (arg0) {
        const ret = arg0.next();
        return ret;
    }, arguments) };
    imports.wbg.__wbg_polyline_new = function(arg0) {
        const ret = Polyline.__wrap(arg0);
        return ret;
    };
    imports.wbg.__wbg_push_c85aa987f2dea82a = function(arg0, arg1) {
        const ret = arg0.push(arg1);
        return ret;
    };
    imports.wbg.__wbg_set_3807d5f0bfc24aa7 = function(arg0, arg1, arg2) {
        arg0[arg1] = arg2;
    };
    imports.wbg.__wbg_set_61aa9ab41a0fb137 = function(arg0, arg1, arg2) {
        arg0[arg1 >>> 0] = arg2;
    };
    imports.wbg.__wbg_set_8ff0ade6353b5cc0 = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = Reflect.set(arg0, arg1, arg2);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_set_911a2f3ee8dd23b5 = function(arg0, arg1, arg2) {
        arg0.set(arg1, arg2 >>> 0);
    };
    imports.wbg.__wbg_setindex_2a07a6bbaafee460 = function(arg0, arg1, arg2) {
        arg0[arg1 >>> 0] = arg2 >>> 0;
    };
    imports.wbg.__wbg_setindex_783d8a67f4a8e87a = function(arg0, arg1, arg2) {
        arg0[arg1 >>> 0] = arg2;
    };
    imports.wbg.__wbg_stack_0ed75d68575b0f3c = function(arg0, arg1) {
        const ret = arg1.stack;
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbg_value_5af0abb3b2b9f90b = function(arg0) {
        const ret = arg0.value;
        return ret;
    };
    imports.wbg.__wbindgen_boolean_get = function(arg0) {
        const v = arg0;
        const ret = typeof(v) === 'boolean' ? (v ? 1 : 0) : 2;
        return ret;
    };
    imports.wbg.__wbindgen_debug_string = function(arg0, arg1) {
        const ret = debugString(arg1);
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbindgen_error_new = function(arg0, arg1) {
        const ret = new Error(getStringFromWasm0(arg0, arg1));
        return ret;
    };
    imports.wbg.__wbindgen_in = function(arg0, arg1) {
        const ret = arg0 in arg1;
        return ret;
    };
    imports.wbg.__wbindgen_init_externref_table = function() {
        const table = wasm.__wbindgen_export_2;
        const offset = table.grow(4);
        table.set(0, undefined);
        table.set(offset + 0, undefined);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
        ;
    };
    imports.wbg.__wbindgen_is_function = function(arg0) {
        const ret = typeof(arg0) === 'function';
        return ret;
    };
    imports.wbg.__wbindgen_is_object = function(arg0) {
        const val = arg0;
        const ret = typeof(val) === 'object' && val !== null;
        return ret;
    };
    imports.wbg.__wbindgen_is_undefined = function(arg0) {
        const ret = arg0 === undefined;
        return ret;
    };
    imports.wbg.__wbindgen_jsval_loose_eq = function(arg0, arg1) {
        const ret = arg0 == arg1;
        return ret;
    };
    imports.wbg.__wbindgen_memory = function() {
        const ret = wasm.memory;
        return ret;
    };
    imports.wbg.__wbindgen_number_get = function(arg0, arg1) {
        const obj = arg1;
        const ret = typeof(obj) === 'number' ? obj : undefined;
        getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
    };
    imports.wbg.__wbindgen_number_new = function(arg0) {
        const ret = arg0;
        return ret;
    };
    imports.wbg.__wbindgen_string_get = function(arg0, arg1) {
        const obj = arg1;
        const ret = typeof(obj) === 'string' ? obj : undefined;
        var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbindgen_string_new = function(arg0, arg1) {
        const ret = getStringFromWasm0(arg0, arg1);
        return ret;
    };
    imports.wbg.__wbindgen_throw = function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
    };

    return imports;
}

function __wbg_init_memory(imports, memory) {

}

function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    __wbg_init.__wbindgen_wasm_module = module;
    cachedDataViewMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;


    wasm.__wbindgen_start();
    return wasm;
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (typeof module !== 'undefined') {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();

    __wbg_init_memory(imports);

    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }

    const instance = new WebAssembly.Instance(module, imports);

    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (typeof module_or_path !== 'undefined') {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (typeof module_or_path === 'undefined') {
        module_or_path = new URL('v0aigcode_cavalier_ffi_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    __wbg_init_memory(imports);

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync };
export default __wbg_init;
