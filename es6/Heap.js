export default class Heap {
	constructor (RecordBufferClass) {
		this.RecordBufferClass = RecordBufferClass;
		this.recordBuffers = [];
	}

	allocate (size) {
		let sizeLog2 = Math.floor(Math.log2(size));
		let roundSize = Math.pow(sizeLog2, 2);

		if (!this.recordBuffers[sizeLog2]) {
			this.recordBuffers[sizeLog2] = new this.RecordBufferClass(roundSize);
		}

		return this.recordBuffers[sizeLog2].allocate();
	}

	free (index, size) {
		let sizeLog2 = Math.floor(Math.log2(size));
		this.recordBuffers[sizeLog2].free(index);
	}

	getBuffer (index, size) {
		let sizeLog2 = Math.floor(Math.log2(size));
		return this.recordBuffers[sizeLog2].getBuffer(index);
	}

	getOffset (index, size) {
		let sizeLog2 = Math.floor(Math.log2(size));
		return this.recordBuffers[sizeLog2].getOffset(index);
	}
}