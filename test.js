var sharedState = require('./');
var test = require('tape');

test('Binary collections of structs that can be shared and persisted via mmap', function(t) {

	t.test('A schema with some simple properties', function (t) {

		var schema = [
			{number: "UInt8"},
			{flag: "Bool"},
			{color: {enum: ["red", "green", "blue"]}}
		];

		var ProxyClass;

		t.test('should compile into a ProxyClass', function (t) {
			ProxyClass = sharedState.BinaryEntityClass.fromSchema(schema, 'Test');
			t.end();
		});

		t.test('which should have a record size of 3 bytes', function (t) {
			t.equal(ProxyClass.byteSize, 3);
			t.end();
		});

		var entity;
		var buffer;

		t.test('given a new buffer, properties should be initialized to "zero"', function (t) {
			buffer = new Buffer(ProxyClass.byteSize);
			buffer.fill(0);
			entity = new ProxyClass(0, buffer);

			t.equal(entity.number, 0);
			t.equal(entity.flag, false);
			t.equal(entity.color, "red");

			t.end();
		});

		t.test('properties should be readable and writeable', function (t) {
			entity.number = 42;
			entity.flag = true;
			entity.color = "blue";

			t.equal(entity.number, 42);
			t.equal(entity.flag, true);
			t.equal(entity.color, "blue");

			t.end();
		});

		t.test('properties should be writeable as a whole object', function (t) {
			ProxyClass.copyObject({
				number: 13,
				flag: false,
				color: "green"
			}, 0, buffer);

			t.equal(entity.number, 13);
			t.equal(entity.flag, false);
			t.equal(entity.color, "green");

			t.end();
		});
	});

	t.test('A schema with a reference to another entity', function (t) {

		global.otherEntityGetter = function (id) {return {id: id};};

		var schema = [
			{dummy: "UInt8"},
			{other: {entity: "otherEntityGetter"}}
		];

		var ProxyClass;

		t.test('should compile into a ProxyClass', function (t) {
			ProxyClass = sharedState.BinaryEntityClass.fromSchema(schema, 'Test');
			t.end();
		});

		var buffer;
		var entity;

		t.test('should call the finder function with a negative id if no entity was set', function (t) {
			buffer = new Buffer(ProxyClass.byteSize);
			buffer.fill(0);
			entity = new ProxyClass(0, buffer);

			t.assert(entity.other.id < 0, "should be negative");
			t.end();
		});

		t.test('should save the id of an entity if it is set', function (t) {
			entity.other = {id: 42, dummy: "bla"};
			t.equal(entity.other.id, 42);
			t.end();
		});

		t.test('should save the id of an entity if it is set as part of a whole object', function (t) {
			ProxyClass.copyObject({
				dummy: 5,
				other: {id: 37}
			}, 0, buffer);
			t.equal(entity.other.id, 37);
			t.end();
		});

		t.test('should return a negative number again after setting the entity to undefined', function (t) {
			entity.other = undefined;
			t.assert(entity.other.id < 0, "should be negative");
			t.end();
		});
	});

	t.test("given a heap and a packable class, entities should support packed properties of dynamic size", function (t) {
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

		t.test('should compile into a ProxyClass', function (t) {
			ProxyClass = sharedState.BinaryEntityClass.fromSchema(schema, 'Test');
			t.end();
		});

		var buffer;
		var entity;
		global.intListHeap = new sharedState.Heap(sharedState.RecordBuffer);

		t.test('should pack and unpack properly given a heap', function (t) {
			buffer = new Buffer(ProxyClass.byteSize);
			buffer.fill(0);
			entity = new ProxyClass(0, buffer);
			entity.intList = [0, 1, 2, 3, 17];

			t.deepEqual(entity.intList, [0, 1, 2, 3, 17]);
			t.end();
		});
	});
});