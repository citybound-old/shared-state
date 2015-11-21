require("babel-core/register");

module.exports = {
	EntityProxy: require('./es6/EntityProxy.js'),
	BinaryTypes: require('./es6/BinaryTypes'),
	SharedMemoryEntityArray: require('./es6/SharedMemoryEntityArray'),
	Heap: require('./es6/Heap'),
	RecordBuffer: require('./es6/RecordBuffer'),
	SharedPersistedRecordBuffer: require('./es6/SharedPersistedRecordBuffer')
}