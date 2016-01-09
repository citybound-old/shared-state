var sharedState = require('./');
var test = require('tape-catch');

test('Collections of structs that are stored in a binary buffer and that can be shared and persisted via mmap', function(t) {

	t.test('A struct with some simple properties', function (t) {

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

		var ProxyClass;

		t.test('should compile into a ProxyClass', function (t) {
			ProxyClass = sharedState.EntityProxy.fromStruct(struct, 'Simple');
			t.end();
		});

		t.test('which should have a record size of 3 bytes', function (t) {
			t.equal(ProxyClass.byteSize, 3);
			t.end();
		});

		var entity;
		var buffer;

		t.test('given a new buffer, properties should be initialized to zero', function (t) {
			buffer = new Buffer(ProxyClass.byteSize);
			buffer.fill(0);
			entity = new ProxyClass(0, buffer);

			t.equal(entity.number, 0);
			t.equal(entity.flag, false);
			t.equal(entity.color, 'red');

			t.end();
		});

		t.test('properties should be readable and writeable', function (t) {
			entity.number = 42;
			entity.flag = true;
			entity.color = 'blue';

			t.equal(entity.number, 42);
			t.equal(entity.flag, true);
			t.equal(entity.color, 'blue');

			t.end();
		});

		t.test('properties should be writeable as a whole object', function (t) {
			ProxyClass.write({
				number: 13,
				flag: false,
				color: 'green'
			}, 0, buffer);

			t.equal(entity.number, 13);
			t.equal(entity.flag, false);
			t.equal(entity.color, 'green');

			t.end();
		});
	});

	t.test('A struct with a reference to another entity', function (t) {

		global.otherEntityFromId = function (id) {return {id: id};};
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

		var ProxyClass;

		t.test('should compile into a ProxyClass', function (t) {
			ProxyClass = sharedState.EntityProxy.fromStruct(struct, 'Reference');
			t.end();
		});

		var buffer;
		var entity;

		t.test('should return undefined if no entity was set', function (t) {
			buffer = new Buffer(ProxyClass.byteSize);
			buffer.fill(0);
			entity = new ProxyClass(0, buffer);

			t.equal(entity.other, undefined);
			t.end();
		});

		t.test('should save the id of an entity if it is set', function (t) {
			entity.other = {id: 42, dummy: 'bla'};
			t.equal(entity.other.id, 42);
			t.end();
		});

		t.test('should save the id of an entity if it is set as part of a whole object', function (t) {
			ProxyClass.write({
				dummy: 5,
				other: {id: 37}
			}, 0, buffer);
			t.equal(entity.other.id, 37);
			t.end();
		});

		t.test('should return a undefined again after setting the entity to undefined', function (t) {
			entity.other = undefined;
			t.equal(entity.other, undefined);
			t.end();
		});
	});

	t.test('given a packer, entities should support packed properties of dynamic size', function (t) {
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

		t.test('should compile into a ProxyClass', function (t) {
			ProxyClass = sharedState.EntityProxy.fromStruct(struct, 'DynamicPacked');
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

	t.test('should support vector properties', function (t) {

		var struct = {
			type: 'Struct',
			entries: [
				['position', {
					type: 'Vector',
					dimension: 3,
					items: 'Float'
				}],
				['colorCombo', {
					type: 'Vector',
					dimension: 2,
					items: {
						type: 'Enum',
						options: ['red', 'green', 'blue']
					}
				}]
			]
		};

		var ProxyClass;

		t.test('should compile into a ProxyClass', function (t) {
			ProxyClass = sharedState.EntityProxy.fromStruct(struct, 'Vector');
			t.end();
		});

		t.test('which should have a record size of 14 bytes', function (t) {
			t.equal(ProxyClass.byteSize, 14);
			t.end();
		});

		var entity;
		var buffer;

		t.test('given a new buffer, properties should be initialized to zero', function (t) {
			buffer = new Buffer(ProxyClass.byteSize);
			buffer.fill(0);
			entity = new ProxyClass(0, buffer);

			t.deepEqual(entity.position, [0, 0, 0]);
			t.deepEqual(entity.colorCombo, ['red', 'red']);

			t.end();
		});

		t.test('vector properties should be readable and writeable', function (t) {
			entity.position = [0.25, 0.75, -0.25]; // these values should encode exactly as floats
			entity.colorCombo = ['blue', 'red'];

			t.deepEqual(entity.position, [0.25, 0.75, -0.25]);
			t.deepEqual(entity.colorCombo, ['blue', 'red']);

			t.end();
		});
		//
		t.test('vector properties should be writeable as a whole object', function (t) {
			ProxyClass.write({
				position: [0.25, 0.75, -0.25], // these values should encode exactly as floats
				colorCombo: ['blue', 'red']
			}, 0, buffer);

			t.deepEqual(entity.position, [0.25, 0.75, -0.25]);
			t.deepEqual(entity.colorCombo, ['blue', 'red']);

			t.end();
		});

		t.end();
	});

	t.test('should support dictionary-type properties', function (t) {

		t.test('(I) static maps', function (t) {

			var struct = {
				type: 'Struct',
				entries: [
					['age', 'UInt8'],
					['resources', {
						type: 'StaticMap',
						keys: ['money', 'time', 'coffee'],
						values: 'Float'
					}]
				]
			};

			var ProxyClass;

			t.test('Should compile into a ProxyClass', function (t) {
				ProxyClass = sharedState.EntityProxy.fromStruct(struct);
				t.end();
			});

			t.test('Should have a record size of 13 bytes', function (t) {
				t.equal(ProxyClass.byteSize, 13);
				t.end();
			});

			var entity;
			var buffer;

			t.test('given a new buffer, properties should be initialized to zero', function (t) {
				buffer = new Buffer(ProxyClass.byteSize);
				buffer.fill(0);

				entity = new ProxyClass(0, buffer);

				t.equal(entity.resources.money, 0);
				t.equal(entity.resources.time, 0);
				t.equal(entity.resources.coffee, 0);

				t.end();
			});

			t.test('should support completely replacing the dictionary and then reading correct values', function (t) {
				entity.resources = {
					money: 10000,
					coffee: 500,
					time: -7
				};

				t.equal(entity.resources.money, 10000);
				t.equal(entity.resources.coffee, 500);
				t.equal(entity.resources.time, -7);

				t.end();
			});

			t.test('should allow to set individual key/value pairs', function (t) {
				entity.resources.coffee = 1000;

				t.equal(entity.resources.coffee, 1000);
				t.end();
			});

			t.end();

		});

		t.test('(II) dynamic maps', function (t) {

			var struct = {
				type: 'Struct',
				entries: [
					['dummy', 'UInt8'],
					['resources', {
						type: 'DynamicMap',
						keys: ['age', 'freetime', 'stress', 'hunger', 'thirst', 'health', 'edges', 'eyes', 'pylons', 'smell', 'relativePinkness'],
						values: 'Float',
						heap: 'resourcesHeap'
					}]
				]
			};

			global.resourcesHeap = new sharedState.Heap(sharedState.RecordBuffer);

			var ProxyClass;

			t.test('should compile into a proxy class', function (t) {
				ProxyClass = sharedState.EntityProxy.fromStruct(struct);
				t.end();
			});

			var entity;
			var buffer;

			t.test('should return a default value for any possible key after initialization', function (t) {
				buffer = new Buffer(ProxyClass.byteSize);
				buffer.fill(0);
				entity = new ProxyClass(0, buffer);

				t.equal(entity.resources.freetime, 0);
				t.equal(entity.resources.edges, 0);
				t.equal(entity.resources.pylons, 0);
				t.equal(entity.resources.relativePinkness, 0);
				t.end();
			});

			t.test('should support writing and reading to individual keys', function (t) {
				entity.resources.hunger = 1000;
				entity.resources.eyes = 3;
				entity.resources.relativePinkness = -35.25;

				t.equal(entity.resources.hunger, 1000);
				t.equal(entity.resources.eyes, 3);
				t.equal(entity.resources.relativePinkness, -35.25);
				t.end();
			});

		});

	});


});