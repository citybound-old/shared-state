export default class SharedMemoryEntityArray {
	constructor(filename, EntityClass) {
		this.EntityClass = EntityClass;
		this.recordBuffer = new SharedMemoryRecordBuffer(filename, EntityClass.binarySize + 1, true);
	}

	find(index, existingObject) {
		existingObject = existingObject || new this.EntityClass();
		existingObject.id = index;
		existingObject._buffer = this.recordBuffer.getFileBuffer(index);
		existingObject._offset = this.recordBuffer.getFileOffset(index);
	}

	create(existingObject) {
		let index = this.recordBuffer.allocate();
		return this.find(index, existingObject);
	}

	* values() {
		let loopProxy = new this.EntityClass();
		for (let index of this.recordBuffer.allocatedIndices()) {
			yield this.find(index, loopProxy);
		}
	}

	contains(object) {
		if (object.id === undefined) return false;
		else return this.recordBuffer.isAllocated(object.id);
	}

	add(object) {
		let index = this.recordBuffer.allocate();
		this.EntityClass.copyObject(
			object,
			this.recordBuffer.getFileBuffer(index),
			this.recordBuffer.getFileOffset(index)
		);
	}
}