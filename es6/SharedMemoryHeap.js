export default class SharedMemoryHeap {
	constructor (filename) {
		this.filename = filename || "heap";
		this.files = []; // files for records of length 2 ^ index
	}

	allocate(size) {
		let sizeLog2 = Math.floor(Math.log2(size));
		let roundSize = Math.pow(sizeLog2, 2);

		if (!this.files[sizeLog2]) {
			this.files[sizeLog2] = new SharedMemoryRecordBuffer(
				this.filename + "_" + roundSize,
				roundSize
			);
		}

		return this.files[sizeLog2].allocate();
	}

	free(index, size) {
		let sizeLog2 = Math.floor(Math.log2(size));
		this.files[sizeLog2].free(index);
	}

	getFileBuffer(index, size) {
		let sizeLog2 = Math.floor(Math.log2(size));
		return this.files[sizeLog2].getFileBuffer(index);
	}

	getFileOffset(index, size) {
		let sizeLog2 = Math.floor(Math.log2(size));
		return this.files[sizeLog2].getFileOffset(index);
	}

	sync() {
		for (let file of this.files) file && file.sync();
	}
}