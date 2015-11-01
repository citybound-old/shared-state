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
			t.equal(ProxyClass.binarySize, 3);
			t.end();
		});

		var entity;
		var buffer;

		t.test('given a new buffer, properties should be initialized to "zero"', function (t) {
			buffer = new Buffer(ProxyClass.binarySize);
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

		t.test('properties should writeable as a whole object', function (t) {
			ProxyClass.copyObject({
				number: 13,
				flag: false,
				color: "green"
			}, buffer, 0);

			t.equal(entity.number, 13);
			t.equal(entity.flag, false);
			t.equal(entity.color, "green");

			t.end();
		});
	});

	t.test('A schema with a reference to another entity', function (t) {

		global.otherEntityGetter = (id) => id;

		var schema = [
			{dummy: "UInt8"},
			{other: {entity: "otherEntityGetter"}}
		];

		var ProxyClass;

		t.test('should compile into a ProxyClass', function (t) {
			ProxyClass = sharedState.BinaryEntityClass.fromSchema(schema, 'Test');
			t.end();
		});


	});
});