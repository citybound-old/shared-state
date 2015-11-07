const BUFFER_SIZE = Math.pow(2, 12); // 4kb

export default class RecordBuffer {
	constructor (recordSize) {
		if (Number.isNaN(recordSize)) throw new Error("Invalid record size!");
		if (recordSize > BUFFER_SIZE) throw new Error("Record bigger than max. Buffer size");
		this.recordSize = Math.max(4, recordSize + 1); // additional flag to distinguish between free/alloc.
		this.recordsPerBuffer = Math.max(10, Math.floor(BUFFER_SIZE / this.recordSize));
		this.bufferSize = BUFFER_SIZE;
		this.firstFreeIndex = 0;
		this.buffers = [];
	}

	allocate () {
		let index = this.firstFreeIndex;
		let buffer = this.getBuffer(index);
		let offset = this.getOffset(index);
		let nextIndexInfo = buffer.readUInt32LE(offset);
		this.firstFreeIndex = nextIndexInfo === 0
			? index + 1
			: nextIndexInfo - 1;
		buffer.fill(0, offset, offset + this.recordSize - 2);
		this.getBuffer(index).writeUInt8(1, this.getOffset(index) + this.recordSize - 1); // set alloc.
		return index;
	}

	free (index) {
		this.getBuffer(index).writeUInt32LE(index + 1, this.getOffset(index));
		this.getBuffer(index).writeUInt8(0, this.getOffset(index) + this.recordSize - 1); // set free
	}

	* allocatedIndices () {
		let index = 0;
		for (let buffer of this.buffers) {
			for (let i = 0; i < this.recordsPerBuffer; i++, index++) {
				if (buffer.readUInt8(i * this.recordSize + this.recordSize - 1)) yield index;
			}
		}
	}

	isAllocated(index) {
		if (index < 0 || index > this.buffers.length * this.recordsPerFile) return false;
		let bufferIndex = Math.floor(index / this.recordsPerFile);
		let bufferOffset =  (index % this.recordsPerFile) * this.recordSize;
		return !!this.buffers[bufferIndex].readUInt8(bufferOffset + this.recordSize - 1);
	}

	getBuffer (index) {
		let bufferIndex = Math.floor(index / this.recordsPerBuffer);
		return this.buffers[bufferIndex] || this.addBuffer(index);
	}

	getOffset (index) {
		return (index % this.recordsPerBuffer) * this.recordSize;
	}

	addBuffer (index) {
		let buffer = new Buffer(this.bufferSize);
		buffer.fill(0, 0, this.bufferSize);
		this.buffers.push(buffer);
		return buffer;
	}
}