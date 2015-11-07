var sharedState = require('./');

var opsPerSecond = function opsPerSecond (diff, N) {
	var s = diff[0] + (diff[1] / 1000000000);
	return "" + (N/s).toFixed(0) + " ops/s = " + (N/(s * 60)).toFixed(0) + " ops/frame (" + s.toFixed(5) + "s for " + N +" iterations)";
};

(function simple () {
	const N = 1000000;
	const TRIES = 20;

	var schema = [
		{number: "UInt8"},
		{flag: "Bool"},
		{color: {enum: ["red", "green", "blue"]}}
	];

	var ProxyClass = sharedState.BinaryEntityClass.fromSchema(schema, 'Test');

	var testPerformance = function () {
		var buffer = new Buffer(N * ProxyClass.byteSize);
		buffer.fill(0);
		var entity = new ProxyClass(0, buffer);

		var fakeResult = 1;
		var lastColor;

		for (var i = 0; i < N; i++) {
			entity._offset = i * ProxyClass.byteSize;
			entity.id = entity._offset;

			entity.number = i;
			entity.flag = i % 2 === 0;
			entity.color = "blue";

			fakeResult += entity.number;
			lastColor = entity.color;
		}

		console.log(fakeResult, lastColor);
	};

	var testPerformanceStupidly = function () {
		var buffer = new Buffer(N * ProxyClass.byteSize);
		buffer.fill(0);

		var fakeResult = 1;
		var lastColor;

		for (var i = 0; i < N; i++) {
			var entity = new ProxyClass(i * ProxyClass.byteSize, buffer);

			entity.number = i;
			entity.flag = i % 2 === 0;
			entity.color = "blue";

			fakeResult += entity.number;
			lastColor = entity.color;
		}

		console.log(fakeResult, lastColor);
	};

	console.log("reusing proxy entities");
	for (var i = 0; i < TRIES; i++) {
		var time = process.hrtime();
		testPerformance();
		console.log(opsPerSecond(process.hrtime(time), N));
	}
	console.log("recreating proxy entities");
	for (var i = 0; i < TRIES; i++) {
		var time = process.hrtime();
		testPerformanceStupidly();
		console.log(opsPerSecond(process.hrtime(time), N));
	}

})();

(function referencedEntity () {

	global.otherEntityGetter = function (id) {return {id: id};};

	var schema = [
		{dummy: "UInt8"},
		{other: {entity: "otherEntityGetter"}}
	];

	var ProxyClass = sharedState.BinaryEntityClass.fromSchema(schema, 'Test');

	const N = 1000000;
	const TRIES = 20;

	var testPerformance = function () {
		var buffer = new Buffer(N * ProxyClass.byteSize);
		buffer.fill(0);
		var entity = new ProxyClass(0, buffer);
		var other = {id: 42, dummy: "bla"};

		var lastDummy;

		for (var i = 0; i < N; i++) {
			entity._offset = i * ProxyClass.byteSize;
			entity.id = entity._offset;

			other.id = i;

			entity.dummy = i % 100;
			entity.other = other;

			lastDummy = entity.other.id;
		}

		console.log(lastDummy);
	};

	var testPerformanceStupidly = function () {
		var buffer = new Buffer(N * ProxyClass.byteSize);
		buffer.fill(0);

		var other = {id: 42, dummy: "bla"};
		var lastDummy;

		for (var i = 0; i < N; i++) {
			var entity = new ProxyClass(i * ProxyClass.byteSize, buffer);

			other.id = i;

			entity.dummy = i % 100;
			entity.other = other;

			lastDummy = entity.other.id;
		}

		console.log(lastDummy);
	};

	console.log("reusing proxy entities");
	for (var i = 0; i < TRIES; i++) {
		var time = process.hrtime();
		testPerformance();
		console.log(opsPerSecond(process.hrtime(time), N));
	}
	console.log("recreating proxy entities");
	for (var i = 0; i < TRIES; i++) {
		var time = process.hrtime();
		testPerformanceStupidly();
		console.log(opsPerSecond(process.hrtime(time), N));
	}
})();

(function dynamicArray() {
	global.PackableClass = {
		packedSize: function (arr) {return arr.length},
		pack: function (arr, buffer, offset) {
			for (var i = 0; i < arr.length; i++) {
				buffer.writeUInt8(arr[i], offset);
				offset++;
			}
		},
		unpack: function (buffer, offset, length) {
			var result = new Array(length);

			for (var i = 0; i < length; i++) {
				result[i] = buffer.readUInt8(offset + i);
			}

			return result;
		}
	};

	var schema = [
		{dummy: "UInt8"},
		{intList: {dynamicPacked: "PackableClass", heap: "intListHeap"}}
	];

	var ProxyClass = sharedState.BinaryEntityClass.fromSchema(schema, 'Test');

	global.intListHeap = new sharedState.Heap(sharedState.RecordBuffer);

	const N = 100000;
	const TRIES = 20;

	var testPerformance = function () {
		var buffer = new Buffer(N * ProxyClass.byteSize);
		buffer.fill(0);
		var entity = new ProxyClass(0, buffer);
		var intList = [0, 1, 2, 3, 17];

		for (var i = 0; i < N; i++) {
			entity._offset = i * ProxyClass.byteSize;
			entity.id = entity._offset;

			intList[0] = i % 100;

			entity.intList = intList;
		}
	};

	for (var i = 0; i < TRIES; i++) {
		var time = process.hrtime();
		testPerformance();
		console.log(opsPerSecond(process.hrtime(time), N));
	}
})();