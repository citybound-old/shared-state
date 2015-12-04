import BinaryView, {byteSize} from './BinaryViews';
import {fromStruct as entityProxyFromStruct} from './EntityProxy';
const BUFFER_SIZE = Math.pow(2, 12); // 4kb

export default class EntityCollection {
	constructor (structType, name, additionalPrototypeProperties) {
		this.structType = {
			type: 'Struct',
			entries: [['id', 'UInt32LE'], ...structType.entries]
		};

		this.EntityProxyClass = entityProxyFromStruct(this.structType, name + "Cursor", additionalPrototypeProperties);
		this.cursors = [];
		this.iteratingCursor = this.cursor();

		this.structSize = byteSize(this.structType);
		this.structsPerBuffer = Math.max(10, Math.floor(BUFFER_SIZE / this.structSize));

		this.firstFreeBuffer = undefined;
		this.firstFreeBufferIndex = 0;
		this.firstFreeOffset = 0;
		this.nextBufferNeeded = true;
		this.existingNextBuffer = undefined; // allows for a hysteresis: keep one buffer ready after deallocating

		this.buffers = [];
		this.idsToOffsets = [];
		this.idsToBuffers = [];
		this.freeIds = [];
	}

	cursor () {
		const cursor = new this.EntityProxyClass();
		this.cursors.push(cursor);
		if (this.cursors.length > 1000) throw "cursor leak!";
		return cursor;
	}

	load (id, cursor) {
		cursor._buffer = this.idsToBuffers[id];
		cursor._offset = this.idsToOffsets[id];
	}

	allocate () {
		const id = this.freeIds.length > 0
			? this.freeIds.pop()
			: this.idsToOffsets.length;

		if (this.nextBufferNeeded) {
			const buffer = this.existingNextBuffer || new Buffer(BUFFER_SIZE);

			this.idsToOffsets[id] = 0;
			this.idsToBuffers[id] = buffer;
			this.firstFreeOffset = this.structSize;
			this.firstFreeBuffer = buffer;
			this.firstFreeBufferIndex += 1;

			buffer.writeUInt32LE(id, 0);
			buffer.fill(0, 4, this.structSize);

			if (this.existingNextBuffer) this.existingNextBuffer = undefined;
			else this.buffers.push(buffer);

			this.nextBufferNeeded = false;
		} else {
			this.idsToOffsets[id] = this.firstFreeOffset;
			this.idsToBuffers[id] = this.firstFreeBuffer;

			this.firstFreeBuffer.writeUInt32LE(id, this.firstFreeOffset);
			this.firstFreeBuffer.fill(0, 4 + this.firstFreeOffset, 4 + this.firstFreeOffset + this.structSize);
			this.firstFreeOffset += this.structSize;

			if (this.firstFreeOffset === this.structsPerBuffer * this.structSize) {
				this.nextBufferNeeded = true;
			}
		}

		return id;
	}

	free (idToFree) {
		const freedEntityOffset = this.idsToOffsets[idToFree];
		const freedEntityBuffer = this.idsToBuffers[idToFree];
		const lastEntityOffset = this.firstFreeOffset - this.structSize;
		const lastEntityBuffer = this.firstFreeBuffer;

		lastEntityBuffer.copy(
			freedEntityBuffer,
			freedEntityOffset,
			lastEntityOffset,
			lastEntityOffset + this.structSize
		);

		const lastEntityId = lastEntityBuffer.readUInt32LE(lastEntityOffset);
		this.idsToOffsets[lastEntityId] = freedEntityOffset;
		this.idsToBuffers[lastEntityId] = freedEntityBuffer;

		if (this.firstFreeOffset > 0) {
			this.firstFreeOffset -= this.structSize;
		} else {
			this.firstFreeOffset = (this.structsPerBuffer - 1) * this.structSize;
			this.firstFreeBuffer = this.buffers[this.firstFreeBufferIndex - 1];
			this.firstFreeBufferIndex -= 1;

			if (this.existingNextBuffer) {
				// we emptied even the buffer before this.existingNextBuffer
				// so we can get rid of that and still have 1 buffer leeway
				this.buffers.pop();
				this.existingNextBuffer = undefined;
			}
		}

		for (let c = 0; c < this.cursors.length; c++) {
			const cursor = this.cursors[c];
			const cursorBuffer = cursor._buffer;
			const cursorOffset = cursor._offset;
			if (cursorBuffer === freedEntityBuffer && cursorOffset === freedEntityOffset) {
				// this cursor is now invalid
				cursor._buffer = undefined;
				cursor._offset = 666;
			} else if (cursorBuffer === lastEntityBuffer && cursorOffset === lastEntityOffset) {
				// point cursor to the new location of the last entity
				cursor._buffer = freedEntityBuffer;
				cursor._offset = freedEntityOffset;
			}
		}

		this.idsToBuffers[idToFree] = undefined;
		this.freeIds.push(idToFree);
	}

	iterate (iteratingFunction) {
		let cursor = this.iteratingCursor;
		for (let b = 0; b <= this.firstFreeBufferIndex; b++) {
			let buffer = this.buffers[b];
			let endOffset = b === this.firstFreeBufferIndex
				? this.firstFreeOffset
				: this.structSize * this.structsPerBuffer;

			cursor._buffer = buffer;

			for (let offset = 0; offset < endOffset; offset += this.structSize) {
				cursor._offset = offset;
				iteratingFunction(cursor);
			}
		}
	}
}