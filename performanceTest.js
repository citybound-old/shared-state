var sharedState = require('./');

var opsPerSecond = function opsPerSecond (diff, N) {
	var s = diff[0] + (diff[1] / 1000000000);
	return "" + (N/s).toFixed(0) + " ops/s = " + (N/(s * 60)).toFixed(0) + " ops/frame (" + s.toFixed(5) + "s for " + N +" iterations)";
};

(function simple () {
	const N = 1000000;
	const TRIES = 20;

	var struct = {
		type: 'Struct',
		entries: [
			['number', 'UInt8'],
			['flag', 'Bool'],
			['color', {
				type: 'Enum',
				options: ['red', 'green', 'blue']
			}]
		]
	};

	var ProxyClass = sharedState.EntityProxy.fromStruct(struct, 'Test');

	var testPerformance = function () {
		var buffer = new Buffer(N * ProxyClass.byteSize);
		buffer.fill(0);
		var entity = new ProxyClass(0, buffer);

		var fakeResult = 1;
		var lastColor;

		for (var i = 0; i < N; i++) {
			entity._offset = i * ProxyClass.byteSize;
			entity.id = entity._offset;

			entity.number = i % 255;
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

			entity.number = i % 255;
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

	const other = {id: 0};
	global.otherEntityFromId = function (id) {other.id = id; return other;};
	global.otherEntityToId = function (entity) {return entity.id};

	var struct = {
		type: 'Struct',
		entries: [
			['dummy', 'UInt8'],
			['other', {
				type: 'Reference',
				toId: 'otherEntityToId',
				fromId: 'otherEntityFromId'
			}]
		]
	};

	var ProxyClass = sharedState.EntityProxy.fromStruct(struct, 'Test');

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
	global.packer = {
		byteSize: function (arr) {return arr.length},
		pack: function (arr, offset, buffer) {
			for (var i = 0; i < arr.length; i++) {
				buffer.writeUInt8(arr[i], offset);
				offset++;
			}
		},
		unpack: function (offset, buffer, byteSize) {
			var result = new Array(byteSize);

			for (var i = 0; i < byteSize; i++) {
				result[i] = buffer.readUInt8(offset + i);
			}

			return result;
		}
	};

	var struct = {
		type: 'Struct',
		entries: [
			['dummy', 'UInt8'],
			['intList', {
				type: 'DynamicPacked',
				packer: 'packer',
				heap: 'intListHeap'
			}]
		]
	};

	var ProxyClass = sharedState.EntityProxy.fromStruct(struct, 'Test');

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