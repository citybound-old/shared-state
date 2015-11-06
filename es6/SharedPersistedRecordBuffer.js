import RecordBuffer from './RecordBuffer.js';
import fs from 'fs';
import mmapio from 'mmap-io'

export default class SharedPersistedRecordBuffer extends RecordBuffer {
	constructor (recordSize, fileName) {
		super(recordSize);
		this.fileName = fileName;
	}

	addBuffer (index) {
		let indexedFileName = this.fileName + "_" + this.recordSize + "B_" + this.buffers.length;

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

		this.buffers.push(newBuffer);
		return newBuffer;
	}

	ensurePersisted () {
		for (let buffer of this.buffers)
			mmapio.sync(buffer, 0, this.fileSize, true);
	}
}

export function withFileName (fileName) {
	return function (recordSize) {
		return new SharedPersistedRecordBuffer(recordSize, fileName);
	}
}