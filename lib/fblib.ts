const int32 = new Int32Array(2);
const float32 = new Float32Array(int32.buffer);
const float64 = new Float64Array(int32.buffer);
const isLittleEndian = new Uint16Array(new Uint8Array([1, 0]).buffer)[0] === 1;

const SIZEOF_SHORT = 2;
const SIZEOF_INT = 4;
const FILE_IDENTIFIER_LENGTH = 4;
const SIZE_PREFIX_LENGTH = 4;

const __proxy = typeof Proxy;

export interface Table {
    __bb: ByteBuffer;
}

export class ByteBuffer {
    private _bytes: Uint8Array;
    private _position: number;

    private _strLookup = new Map<string, string>();
    offsetLookup = new Map<number, any>();

    constructor(bytes: Uint8Array) {
        this._bytes = bytes;
        this._position = 0;
    }

    static allocate(byteSize: number): ByteBuffer {
        return new ByteBuffer(new Uint8Array(byteSize));
    }

    growByteBuffer() {
        let oldBufSize = this.capacity();

        // Ensure we don't grow beyond what fits in an int.
        if (oldBufSize & 0xC0000000) {
            throw new Error('FlatBuffers: cannot grow buffer beyond 2 gigabytes.');
        }

        let newBufSize = oldBufSize << 1;
        let nbb = new Uint8Array(newBufSize);
        this._position = newBufSize - oldBufSize;
        nbb.set(this._bytes, this._position);

        this._bytes = nbb;
    }

    copyLookup(bb: ByteBuffer) {
        this._strLookup = bb._strLookup;
    }

    clear() {
        this._position = 0;
    }

    bytes(): Uint8Array {
        return this._bytes;
    }

    position(): number {
        return this._position;
    }

    setPosition(position: number) {
        this._position = position;
    }

    capacity(): number {
        return this._bytes.length;
    }

    readInt8(offset: number): number {
        return (this.readUint8(offset) << 24) >> 24;
    }

    readUint8(offset: number): number {
        return this._bytes[offset];
    }

    readInt16(offset: number): number {
        return (this.readUint16(offset) << 16) >> 16;
    }

    readUint16(offset: number): number {
        return this._bytes[offset] | (this._bytes[offset + 1] << 8);
    }

    readInt32(offset: number): number {
        return this._bytes[offset] | (this._bytes[offset + 1] << 8) | (this._bytes[offset + 2] << 16) | (this._bytes[offset + 3] << 24);
    }

    readUint32(offset: number): number {
        return this.readInt32(offset) >>> 0;
    }

    readInt64(offset: number): number {
        return (this.readInt32(offset) >>> 0) + this.readInt32(offset + 4) * 0x100000000;
    }

    readInt64AsLong(offset: number): Long {
        return new Long(this.readInt32(offset), this.readInt32(offset + 4));
    }

    readUint64(offset: number): number {
        return (this.readUint32(offset) >>> 0) + this.readUint32(offset + 4) * 0x100000000;
    }

    readUint64AsLong(offset: number): Long {
        return new Long(this.readUint32(offset), this.readUint32(offset + 4));
    }

    readFloat32(offset: number): number {
        int32[0] = this.readInt32(offset);
        return float32[0];
    }

    readFloat64(offset: number): number {
        int32[isLittleEndian ? 0 : 1] = this.readInt32(offset);
        int32[isLittleEndian ? 1 : 0] = this.readInt32(offset + 4);
        return float64[0];
    }


    writeInt8(offset: number, value: number) {
        this._bytes[offset] = value;
    }

    writeInt16(offset: number, value: number) {
        this._bytes[offset] = value;
        this._bytes[offset + 1] = value >> 8;
    }

    writeInt32(offset: number, value: number) {
        this._bytes[offset] = value;
        this._bytes[offset + 1] = value >> 8;
        this._bytes[offset + 2] = value >> 16;
        this._bytes[offset + 3] = value >> 24;
    }

    writeInt64AsLong(offset: number, value: Long) {
        this.writeInt32(offset, value.low);
        this.writeInt32(offset + 4, value.high);
    }

    writeUInt64AsLong = this.writeInt64AsLong;

    writeLong(offset: number, value: Long) {
        this.writeInt32(offset, value.low);
        this.writeInt32(offset + 4, value.high);
    }

    writeFloat32(offset: number, value: number) {
        float32[0] = value;
        this.writeInt32(offset, int32[0]);
    }

    writeFloat64(offset: number, value: number) {
        float64[0] = value;
        this.writeInt32(offset, int32[isLittleEndian ? 0 : 1]);
        this.writeInt32(offset + 4, int32[isLittleEndian ? 1 : 0]);
    }


    getBufferIdentifier(): string {
        if (this._bytes.length < this._position + SIZEOF_INT + FILE_IDENTIFIER_LENGTH) {
            throw new Error('FlatBuffers: ByteBuffer is too short to contain an identifier.');
        }

        let result = '';
        for (let i = 0; i < FILE_IDENTIFIER_LENGTH; i++) {
            result += String.fromCharCode(this.readInt8(this._position + SIZEOF_INT + i));
        }

        return result;
    }

    /**
     * Look up a field in the vtable, return an offset into the object, or 0 if the
     * field is not present.
     */
    __offset(bb_pos: number, vtable_offset: number): number {
        let vtable = bb_pos - this.readInt32(bb_pos);
        return vtable_offset < this.readInt16(vtable) ? this.readInt16(vtable + vtable_offset) : 0;
    }

    /**
     * Initialize any Table-derived type to point to the union at the given offset.
     */
    __union<T>(t: (__bb: ByteBuffer, __pos: number) => T, offset: number): T {
        return t(this, offset + this.readInt32(offset));
    }

    __string(offset: number): string {
        offset += this.readInt32(offset);

        let t;
        if ((t = this.offsetLookup.get(offset))) {
            return t;
        }

        let length = this.readInt32(offset);
        if (length > this._bytes.length) {
            return 'WTF';
        }

        let result = '';
        let i = 0;

        let o = offset + SIZEOF_INT;

        while (i < length) {
            let codePoint;

            // Decode UTF-8
            let a = this.readUint8(o + i++);
            if (a < 0xC0) {
                codePoint = a;
            } else {
                let b = this.readUint8(o + i++);
                if (a < 0xE0) {
                    codePoint =
                        ((a & 0x1F) << 6) |
                        (b & 0x3F);
                } else {
                    let c = this.readUint8(o + i++);
                    if (a < 0xF0) {
                        codePoint =
                            ((a & 0x0F) << 12) |
                            ((b & 0x3F) << 6) |
                            (c & 0x3F);
                    } else {
                        let d = this.readUint8(o + i++);
                        codePoint =
                            ((a & 0x07) << 18) |
                            ((b & 0x3F) << 12) |
                            ((c & 0x3F) << 6) |
                            (d & 0x3F);
                    }
                }
            }

            // Encode UTF-16
            if (codePoint < 0x10000) {
                result += String.fromCharCode(codePoint);
            } else {
                codePoint -= 0x10000;
                result += String.fromCharCode(
                    (codePoint >> 10) + 0xD800,
                    (codePoint & ((1 << 10) - 1)) + 0xDC00);
            }
        }

        if ((t = this._strLookup.get(result))) {
            return t;
        }

        this._strLookup.set(result, result);
        this.offsetLookup.set(offset, result);

        return result;
    }

    /**
     * Retrieve the relative offset stored at "offset"
     */
    __indirect(offset: number): number {
        return offset + this.readInt32(offset);
    }

    /**
     * Get the start of data of a vector whose offset is stored at "offset" in this object.
     */
    __vector(offset: number): number {
        return offset + this.readInt32(offset) + SIZEOF_INT; // data starts after the length
    }

    /**
     * Get the length of a vector whose offset is stored at "offset" in this object.
     */
    __vector_len(offset: number): number {
        return this.readInt32(offset + this.readInt32(offset));
    }

    __has_identifier(ident: string): boolean {
        if (ident.length !== FILE_IDENTIFIER_LENGTH) {
            throw new Error('FlatBuffers: file identifier must be length ' +
                FILE_IDENTIFIER_LENGTH);
        }

        for (let i = 0; i < FILE_IDENTIFIER_LENGTH; i++) {
            if (ident.charCodeAt(i) !== this.readInt8(this._position + SIZEOF_INT + i)) {
                return false;
            }
        }

        return true;
    }
}

export class Builder {
    private bb: ByteBuffer;
    private space: number;

    private minAlign: number = 1;

    private forcedDefaults: boolean = false;

    private vTables: number[] = [];
    private vTable: number[] | null = null;
    private vTableInUse: number = 0;

    private vectorNumElm: number = 0;

    private objectStart: number = 0;
    private currentObject: object | null = null;

    private isNested: boolean = false;

    private strLookup = new Map<string, number>();
    offsetLookup = new Map<object, number>();
    private objectRegistry = new Map<object | null | undefined, { pos: number, offset: number }[]>();

    constructor(initialSize: number = 1024) {
        this.space = initialSize;
        this.bb = ByteBuffer.allocate(initialSize);
    }

    clear() {
        this.bb.clear();
        this.space = this.bb.capacity();

        this.minAlign = 1;

        this.forcedDefaults = false;

        this.vTables = [];
        this.vTable = null;
        this.vTableInUse = 0;

        this.vectorNumElm = 0;

        this.objectStart = 0;

        this.isNested = false;

        this.strLookup.clear();
        this.offsetLookup.clear();
    }

    private prep(size: number, additionalBytes: number) {
        if (size > this.minAlign) {
            this.minAlign = size;
        }

        let alignSize = ((~(this.offset() + additionalBytes)) + 1) & (size - 1);

        while (this.space < alignSize + size + additionalBytes) {
            let oldBufferSize = this.bb.capacity();
            this.bb.growByteBuffer();
            this.space += this.bb.capacity() - oldBufferSize;
        }

        this.pad(alignSize);
    }

    private pad(byteSize: number) {
        for (let i = 0; i < byteSize; i++) {
            this.bb.writeInt8(--this.space, 0);
        }
    }

    private slot(voffset: number) {
        if (!this.vTable) {
            throw Error('vTable is null');
        }

        this.vTable[voffset] = this.offset();
    }

    private offset() {
        return this.bb.capacity() - this.space;
    }

    private nested(obj: number) {
        if (obj !== this.offset()) {
            throw new Error('FlatBuffers: struct must be serialized inline.');
        }
    }

    private notNested() {
        if (this.isNested) {
            throw new Error('FlatBuffers: object serialization must not be nested.');
        }
    }

    private writeInt8(value: number) {
        this.bb.writeInt8(this.space -= 1, value);
    }

    private writeInt16(value: number) {
        this.bb.writeInt16(this.space -= 2, value);
    }

    private writeInt32(value: number) {
        this.bb.writeInt32(this.space -= 4, value);
    }

    private writeInt64(value: number) {
        this.bb.writeInt64AsLong(this.space -= 8, Long.createFromNumber(value)); //TODO
    }

    private writeLong(value: Long) {
        this.bb.writeLong(this.space -= 8, value);
    }

    private writeFloat32(value: number) {
        this.bb.writeFloat32(this.space -= 4, value);
    }

    private writeFloat64(value: number) {
        this.bb.writeFloat64(this.space -= 8, value);
    }

    addInt8(value: number) {
        this.prep(1, 0);
        this.writeInt8(value);
    }

    addUint8 = this.addInt8;

    addInt16(value: number) {
        this.prep(2, 0);
        this.writeInt16(value);
    }

    addUint16 = this.addInt16;

    addInt32(value: number) {
        this.prep(4, 0);
        this.writeInt32(value);
    }

    addUint32 = this.addInt32;

    addInt64AsLong(value: Long) {
        this.prep(8, 0);
        this.writeLong(value);
    }

    addUint64AsLong = this.addInt64AsLong;

    addInt64(value: number) {
        this.prep(8, 0);
        this.writeInt64(value);
    }

    addUint64 = this.addInt64;

    addFloat32(value: number) {
        this.prep(4, 0);
        this.writeFloat32(value);
    }

    addFloat64(value: number) {
        this.prep(8, 0);
        this.writeFloat64(value);
    }

    addFieldInt8(voffset: number, value: number, defaultValue?: number) {
        if (this.forcedDefaults || value !== defaultValue) {
            this.addInt8(value);
            this.slot(voffset);
        }
    }

    addFieldUint8 = this.addFieldInt8;

    addFieldInt16(voffset: number, value: number, defaultValue?: number) {
        if (this.forcedDefaults || value !== defaultValue) {
            this.addInt16(value);
            this.slot(voffset);
        }
    }

    addFieldUint16 = this.addFieldInt16;

    addFieldInt32(voffset: number, value: number, defaultValue?: number) {
        if (this.forcedDefaults || value !== defaultValue) {
            this.addInt32(value);
            this.slot(voffset);
        }
    }

    addFieldUint32 = this.addFieldInt32;

    addFieldInt64(voffset: number, value: number, defaultValue?: number) {
        if (this.forcedDefaults || value !== defaultValue) {
            this.addInt64(value);
            this.slot(voffset);
        }
    }

    addFieldUint64 = this.addFieldInt64;

    addFieldInt64AsLong(voffset: number, value: Long, defaultValue?: Long) {
        if (this.forcedDefaults || (defaultValue && !value.equals(defaultValue))) {
            this.addInt64AsLong(value);
            this.slot(voffset);
        }
    }

    addFieldUint64AsLong = this.addFieldInt64AsLong;

    addFieldFloat32(voffset: number, value: number, defaultValue?: number) {
        if (this.forcedDefaults || value !== defaultValue) {
            this.addFloat32(value);
            this.slot(voffset);
        }
    }

    addFieldFloat64(voffset: number, value: number, defaultValue?: number) {
        if (this.forcedDefaults || value !== defaultValue) {
            this.addFloat64(value);
            this.slot(voffset);
        }
    }

    addFieldOffset(voffset: number, value: number, obj: object | null | undefined, defaultValue?: number) {
        if (value === undefined) {
            return;
        }

        if (this.forcedDefaults || value !== defaultValue) {
            this.addOffsetObj(value, obj);
            this.slot(voffset);
        }
    }

    addFieldVector(voffset: number, value: number, defaultValue?: number) {
        if (this.forcedDefaults || value !== defaultValue) {
            this.addOffsetInternal(value);
            this.slot(voffset);
        }
    }

    addFieldStruct(voffset: number, value: number, defaultValue?: number) {
        if (value !== defaultValue) {
            this.nested(value);
            this.slot(voffset);
        }
    }

    addOffsetObj(offset: number, obj: object | null | undefined) {
        if (offset === undefined) {
            return;
        }

        this.prep(SIZEOF_INT, 0); // Ensure alignment is already done.

        let reg;
        if ((reg = this.objectRegistry.get(obj))) {
            reg.push({pos: this.space - 4, offset: this.offset()});
        }

        this.writeInt32(this.offset() - offset + SIZEOF_INT);
    }

    addOffsetString = this.addOffsetInternal;

    addOffsetInternal(offset: number) {
        if (offset === undefined) {
            return;
        }

        this.prep(SIZEOF_INT, 0); // Ensure alignment is already done.
        this.writeInt32(this.offset() - offset + SIZEOF_INT);
    }

    registerObject(obj: object) {
        let offset;
        if ((offset = this.offsetLookup.get(obj))) {
            return offset;
        }

        if (this.objectRegistry.has(obj)) {
            return 1337;
        }

        this.objectRegistry.set(obj, []);

        return 0;
    }

    startObject(numFields: number, obj: object) {
        this.notNested();
        if (!this.vTable) {
            this.vTable = [];
        }

        this.vTableInUse = numFields;
        for (let i = 0; i < numFields; i++) {
            this.vTable[i] = 0; // This will push additional elements as needed
        }

        this.isNested = true;
        this.objectStart = this.offset();
        this.currentObject = obj;
    }

    endObject() {
        if (this.vTable === null || !this.isNested || !this.currentObject) {
            throw new Error('FlatBuffers: endObject called without startObject');
        }

        this.addInt32(0);
        let vTableLoc = this.offset();

        // Trim trailing zeroes.
        let i = this.vTableInUse - 1;
        for (; i >= 0 && this.vTable[i] === 0; i--) {
        }
        let trimmedSize = i + 1;

        // Write out the current vtable.
        for (; i >= 0; i--) {
            // Offset relative to the start of the table.
            this.addInt16(this.vTable[i] !== 0 ? vTableLoc - this.vTable[i] : 0);
        }

        let standardFields = 2; // The fields below:
        this.addInt16(vTableLoc - this.objectStart);
        let len = (trimmedSize + standardFields) * SIZEOF_SHORT;
        this.addInt16(len);

        // Search for an existing vtable that matches the current one.
        let existingvTable = 0;
        let vt1 = this.space;
        outerLoop:
            for (i = 0; i < this.vTables.length; i++) {
                let vt2 = this.bb.capacity() - this.vTables[i];
                if (len === this.bb.readInt16(vt2)) {
                    for (let j = SIZEOF_SHORT; j < len; j += SIZEOF_SHORT) {
                        if (this.bb.readInt16(vt1 + j) !== this.bb.readInt16(vt2 + j)) {
                            continue outerLoop;
                        }
                    }
                    existingvTable = this.vTables[i];
                    break;
                }
            }

        if (existingvTable) {
            // Found a match:
            // Remove the current vtable.
            this.space = this.bb.capacity() - vTableLoc;

            // Point table to existing vtable.
            this.bb.writeInt32(this.space, existingvTable - vTableLoc);
        } else {
            // No match:
            // Add the location of the current vtable to the list of vtables.
            this.vTables.push(this.offset());

            // Point table to current vtable.
            this.bb.writeInt32(this.bb.capacity() - vTableLoc, this.offset() - vTableLoc);
        }

        this.isNested = false;
        this.offsetLookup.set(this.currentObject, vTableLoc);

        let fillOffsets;
        if ((fillOffsets = this.objectRegistry.get(this.currentObject)) && fillOffsets.length) {
            fillOffsets.forEach((o) => {
                this.bb.writeInt32(o.pos, o.offset - vTableLoc + SIZEOF_INT);
            });

            this.objectRegistry.delete(this.currentObject);
        }

        this.currentObject = null;

        return vTableLoc;
    }

    finish(rootTable: number, optFileIdentifier?: string, optSizePrefix?: boolean) {
        let sizePrefix = optSizePrefix ? SIZE_PREFIX_LENGTH : 0;

        if (optFileIdentifier) {
            let fileIdentifier = optFileIdentifier;
            this.prep(this.minAlign, SIZEOF_INT + FILE_IDENTIFIER_LENGTH + sizePrefix);

            if (fileIdentifier.length !== FILE_IDENTIFIER_LENGTH) {
                throw new Error('FlatBuffers: file identifier must be length ' + FILE_IDENTIFIER_LENGTH);
            }

            for (let i = FILE_IDENTIFIER_LENGTH - 1; i >= 0; i--) {
                this.writeInt8(fileIdentifier.charCodeAt(i));
            }
        }

        this.prep(this.minAlign, SIZEOF_INT + sizePrefix);
        this.addOffsetInternal(rootTable);

        if (sizePrefix) {
            this.addInt32(this.bb.capacity() - this.space);
        }

        this.bb.setPosition(this.space);
    }

    finishSizePrefixed(rootTable: number, optFileIdentifier?: string) {
        this.finish(rootTable, optFileIdentifier, true);
    }

    startVector(elmSize: number, numElms: number, alignment: number) {
        this.notNested();
        this.vectorNumElm = numElms;
        this.prep(SIZEOF_INT, elmSize * numElms);
        this.prep(alignment, elmSize * numElms); // Just in case alignment > int.
    }

    endVector() {
        this.writeInt32(this.vectorNumElm);

        return this.offset();
    }

    createString(s: string) {
        let offset;
        if ((offset = this.strLookup.get(s))) {
            return offset;
        }

        let utf8 = [];

        let i = 0;
        while (i < s.length) {
            let codePoint;

            // Decode UTF-16
            let a = s.charCodeAt(i++);
            if (a < 0xD800 || a >= 0xDC00) {
                codePoint = a;
            } else {
                let b = s.charCodeAt(i++);
                codePoint = (a << 10) + b + (0x10000 - (0xD800 << 10) - 0xDC00);
            }

            // Encode UTF-8
            if (codePoint < 0x80) {
                utf8.push(codePoint);
            } else {
                if (codePoint < 0x800) {
                    utf8.push(((codePoint >> 6) & 0x1F) | 0xC0);
                } else {
                    if (codePoint < 0x10000) {
                        utf8.push(((codePoint >> 12) & 0x0F) | 0xE0);
                    } else {
                        utf8.push(
                            ((codePoint >> 18) & 0x07) | 0xF0,
                            ((codePoint >> 12) & 0x3F) | 0x80);
                    }
                    utf8.push(((codePoint >> 6) & 0x3F) | 0x80);
                }
                utf8.push((codePoint & 0x3F) | 0x80);
            }
        }

        this.addInt8(0);
        this.startVector(1, utf8.length, 1);
        this.bb.setPosition(this.space -= utf8.length);

        for (let i = 0, offset = this.space, bytes = this.bb.bytes(); i < utf8.length; i++) {
            bytes[offset++] = utf8[i];
        }

        offset = this.endVector();
        this.strLookup.set(s, offset);

        return offset;
    }

    bytes() {
        return this.bb.bytes().subarray(this.space);
    }
}

export class Long {
    low: number;
    high: number;

    static ZERO = new Long(0, 0);

    constructor(low: number, high: number) {
        this.low = low;
        this.high = high;
    }

    static create(low: number, high: number) {
        if (low === 0 && high === 0) {
            return Long.ZERO;
        }

        return new Long(low, high);
    }

    static createFromNumber(num: number) {
        return new Long(num % 0x100000000, num / 0x100000000);
    }

    toFloat64() {
        return (this.low >>> 0) + this.high * 0x100000000;
    }

    equals(other: Long) {
        return this.low === other.low && this.high === other.high;
    }
}

interface FbParsableItem<T> {
    __fbParsableItem: true;
    offset: number;
    getter: FbGetterFunc<T>;
    bb: ByteBuffer;
}

type FbGetterFunc<T> = (bb: ByteBuffer, offset: number) => T;

export function createProxyArray<T>(bb: ByteBuffer, bbPos: number, length: number, itemBytesSize: number, preDecodeCount: number, fbGetter: FbGetterFunc<T>): T[] {
    const items: (T | FbParsableItem<T>)[] = new Array(length);

    const vectorPos = bb.__vector(bbPos);

    for (let i = 0; i < preDecodeCount && i < length; i++) {
        let offset = vectorPos + (i * itemBytesSize);
        items[i] = fbGetter(bb, offset);
    }

    for (let i = preDecodeCount; i < length; i++) {
        let p: FbParsableItem<T>;

        p = {
            __fbParsableItem: true,
            offset: vectorPos + (i * itemBytesSize),
            getter: fbGetter,
            bb: bb
        };

        items[i] = p;
    }

    return items as T[];
}

const proxyForwardFuncNames = [
    'push',
    'splice',
    'unshift'
];

const proxyForwardFuncNamesReturnProxy = [
    'copyWithin',
    'sort',
    'reverse',
];

function proxyParseOffset<T>(items: (T | FbParsableItem<T>)[], offset: number) {
    if ('__fbParsableItem' in items[offset]) {
        let i = items[offset] as FbParsableItem<T>;
        items[offset] = i.getter(i.bb, i.offset);
    }
}

export function newProxy<T>(items: (T | FbParsableItem<T>)[], preDecodeCount: number): T[] {
    if (items.length <= preDecodeCount) {
        return items as T[];
    }

    return new Proxy(items as T[], {
        // defineProperty: (target, p, attributes) => {
        //     return false;
        // },

        deleteProperty: (target, prop) => {
            return false;
        },

        get: (target, prop: string | symbol | number, receiver) => {
            if (typeof prop === 'symbol') {
                return Reflect.get(target, prop, receiver);
            }

            if (!isNaN(+prop)) {
                proxyParseOffset(target, +prop);
                return target[+prop];
            }

            if (typeof prop === 'string') {
                if (proxyForwardFuncNames.includes(prop)) {
                    const i = target as unknown as { [s: string]: Function };
                    return i[prop].bind(target);

                    // return function() {
                    //     let args = arguments;
                    //     for (let j = 0; j < args.length; j++) {
                    //         if ('__fbItems' in args[j]) {
                    //             args[j] = args[j]['__fbItems'];
                    //         }
                    //     }
                    //
                    //     return i[prop].apply(args);
                    // }
                }

                if (proxyForwardFuncNamesReturnProxy.includes(prop)) {
                    const i = target as unknown as { [s: string]: Function };
                    i[prop].bind(target);

                    debugger;

                    return receiver;
                }

                switch (prop) {
                    case 'pop':
                        return () => {
                            proxyParseOffset(target, target.length - 1);
                            return target.pop();
                        };

                    case 'shift':
                        return () => {
                            proxyParseOffset(target, 0);
                            return target.shift();
                        };

                    case 'slice':
                        return (start?: number, end?: number) => {
                            return newProxy(target.slice(start, end), -1);
                        };

                    case 'concat':
                        return (..._items: ConcatArray<T>[]) => {
                            let __items: ConcatArray<T>[] = [];
                            _items.forEach((v) => {
                                if ('__fbItems' in v) {
                                    __items.push(v['__fbItems']);
                                } else {
                                    __items.push(v);
                                }
                            });

                            return newProxy(target.concat(...__items), -1);
                        };

                    case '__fbItems':
                        return target;
                }
            }

            return Reflect.get(target, prop, receiver);
        },

        has: (target, key) => {
            if (key === '__fbItems') {
                return true;
            }

            return key in target;
        },

        // set: (target, prop, value, receiver) => {
        //     return Reflect.set(target, prop, value, receiver);
        // },

        setPrototypeOf: (target, handler) => {
            return false;
        }
    });
}

export function proxyDecodeAll<T>(items: T[]) {
    for (let i = 0; i < items.length; i++) {
        proxyParseOffset(items, i);
    }
}

// export function uidIndexOf<T>(items: (T | FbParsableItem<T>)[], uid: number) {
//     if (__proxy) {
//         for (let i = 0; i < items.length; i++) {
//             const item = items[i];
//             if ('__fbParsableItem' in item && item.) {
//
//             }
//         }
//     }
// }
