import BufferValue from "../src/buffer-value";
import { FPrimitiveArray, FPrimitiveArrayLazy } from "../src/unreal/un-array";

function assert(value: unknown, message: string): asserts value {
    if (!value) throw new Error(message);
}

function load(type: any, view: DataView, lazy = false) {
    let cursor = view.byteOffset;
    const array = lazy ? new FPrimitiveArrayLazy(type) : new FPrimitiveArray(type);
    array.load({
        read: (kind: string) => kind === "int32" && lazy ? cursor + view.byteLength : view.byteLength / type.bytes,
        tell: () => cursor,
        readPrimitive: (offset: number, length: number) => {
            assert(offset === view.byteOffset && length === view.byteLength, "Package view must preserve its exact range");
            return view;
        },
        seek: (length: number) => { cursor += length; }
    } as any);
    return array;
}

export function runPrimitiveArrayChecks() {
    const types = [BufferValue.uint8, BufferValue.int8, BufferValue.uint16, BufferValue.int16,
        BufferValue.uint32, BufferValue.int32, BufferValue.float, BufferValue.uint64, BufferValue.int64];

    for (const type of types) {
        const TypedArray = type.dtype;
        const values: any[] = type.name.includes("64") ? [1n, 7n]
            : type.name === "float" ? [1.25, 2.5] : [1, 7];

        for (const offset of [TypedArray.BYTES_PER_ELEMENT, 1]) {
            for (const lazy of [false, true]) {
                const source = new ArrayBuffer(offset + 2 * type.bytes + 5);
                new Uint8Array(source).fill(0xcc);
                new Uint8Array(source, offset, 2 * type.bytes).set(new Uint8Array(new TypedArray(values).buffer));
                const result = load(type, new DataView(source, offset, 2 * type.bytes), lazy).getTypedArray() as any;
                const aligned = offset % TypedArray.BYTES_PER_ELEMENT === 0;

                assert(result.length === 2 && result[0] === values[0] && result[1] === values[1], `${type.name}: values must survive decoding`);
                assert((result.buffer === source) === aligned, `${type.name}: aligned data should share storage and unaligned data should copy`);
                assert(result.byteOffset === (aligned ? offset : 0), `${type.name}: wrong typed-array offset`);
                assert(result.byteLength === 2 * type.bytes, `${type.name}: copied bytes outside package view`);

                const original = result[0];
                new Uint8Array(source)[offset] ^= 1;
                assert(aligned ? result[0] !== original : result[0] === original, `${type.name}: wrong copy/share behavior`);
            }
        }

        for (const lazy of [false, true]) {
            const empty = new (lazy ? FPrimitiveArrayLazy : FPrimitiveArray)(type);
            let cursor = 0;
            empty.load({ read: () => 0, tell: () => cursor, seek: () => undefined } as any);
            assert((empty as any).array === null, `${type.name}: optimized empty arrays should retain null storage`);
            assert(empty.getTypedArray().length === 0, `${type.name}: null empty storage should return an empty typed array`);

            const emptyView = load(type, new DataView(new ArrayBuffer(5), 1, 0), lazy).getTypedArray() as any;
            assert(emptyView.length === 0, `${type.name}: empty unaligned DataView should remain empty`);
        }
    }

    const failure = new Error("Unrelated typed-array construction failure");
    class BrokenArray extends Uint16Array {
        constructor(...args: any[]) {
            super(...args as [any]);
            throw failure;
        }
    }
    for (const offset of [0, 1]) {
        let caught: unknown;
        try {
            load({ ...BufferValue.uint16, dtype: BrokenArray }, new DataView(new ArrayBuffer(5), offset, 2)).getTypedArray();
        } catch (error) {
            caught = error;
        }
        assert(caught === failure, "Unrelated constructor errors must propagate unchanged");
    }

    return "Primitive array alignment checks passed";
}

try {
    (globalThis as any).primitiveArrayResult = { passed: true, message: runPrimitiveArrayChecks() };
} catch (error) {
    const failure = error as Error;
    (globalThis as any).primitiveArrayResult = { passed: false, error: `${failure.name}: ${failure.message}\n${failure.stack || ""}` };
}
