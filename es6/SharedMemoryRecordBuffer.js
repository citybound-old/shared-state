const BUFFER_SIZE = Math.pow(2, 12); // 4kb

// Free list should become a linked list stored in the payload
// first free -> [next] -> [next] -> ...
// And variant for different-size coherent arrays (using seglists)

export default class SharedMemoryRecordBuffer {
	constructor (filename, recordSize) {
		if (Number.isNaN(recordSize)) throw "Invalid record size!";
		this.filename = "state/" + filename;
		this.recordSize = Math.max(4, recordSize + 1); // additional flag to distinguish between free/alloc.
		this.recordsPerFile = Math.max(10, Math.floor(BUFFER_SIZE / this.recordSize));
		this.fileSize = this.recordsPerFile * this.recordSize;
		this.newFileBuffer = new Buffer(this.fileSize);
		this.newFileBuffer.fill(0);
		this.firstFreeIndex = 0;
		this.files = [];
	}

	allocate() {
		let index = this.firstFreeIndex;
		let fileBuffer = this.getFileBuffer(index);
		let fileOffset = this.getFileOffset(index);
		let nextIndexInfo = fileBuffer.readUInt32LE(fileOffset);
		this.firstFreeIndex = nextIndexInfo === 0
			? index + 1
			: nextIndexInfo - 1;
		fileBuffer.fill(0, fileOffset, fileOffset + this.recordSize - 2);
		this.getFileBuffer(index).writeUInt8(this.getFileOffset(index) + this.recordSize - 1, 1); // set alloc.
		return index;
	}

	free(index) {
		this.getFileBuffer(index).writeUInt32LE(this.getFileOffset(index), index + 1);
		this.getFileBuffer(index).writeUInt8(this.getFileOffset(index) + this.recordSize - 1, 0); // set free
	}

	* allocatedIndices() {
		let index = 0;
		for (let file of this.files) {
			for (let i = 0; i < this.recordsPerFile; i++, index++) {
				if (file.readUInt8(i * this.recordSize + this.recordSize - 1)) yield index;
			}
		}
	}

	isAllocated(index) {
		if (index < 0 || index > this.files.length * this.recordsPerFile) return false;
		let fileIndex = Math.floor(index / this.recordsPerFile);
		let fileOffset =  (index % this.recordsPerFile) * this.recordSize;
		return !!this.files[fileIndex].readUInt8(fileOffset + this.recordSize - 1);
	}

	getFileBuffer(index) {
		let fileIndex = Math.floor(index / this.recordsPerFile);
		return this.files[fileIndex] || this.addFile(index);
	}

	getFileOffset(index) {
		return (index % this.recordsPerFile) * this.recordSize;
	}

	addFile(index) {
		let indexedFileName = this.filename + "_" + this.files.length;

		let fd;
		try {
			fs.statSync(indexedFileName).isFile();
			fd = fs.openSync(indexedFileName, "r+");
			console.log(indexedFileName, "existing file");
		} catch (err) {
			fd = fs.openSync(indexedFileName, "w+");
			console.log(indexedFileName, "new file");
			console.log("written", fs.writeSync(fd, this.newFileBuffer, 0, this.fileSize));
		}


		let newBuffer = mmapio.map(
			this.fileSize,
			mmapio.PROT_WRITE,
			mmapio.MAP_SHARED,
			fd,
			0,
			mmapio.MADV_SEQUENTIAL
		);

		this.files.push(newBuffer);
		return newBuffer;
	}

	sync() {
		for (let file of this.files) mmapio.sync(file, true);
		fs.writeFileSync(this.filename + "_free", new Buffer([this.firstFreeIndex]));
	}
}