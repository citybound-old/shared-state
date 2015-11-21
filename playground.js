require("babel-core/register");
const EntityProxy = require("./es6/EntityProxy");
const RecordBuffer = require('./es6/RecordBuffer');
const Heap = require('./es6/Heap');

const struct = {
	type: 'Struct',
	entries: [
		['number', 'Int8'],
		['color', {
			type: 'Enum',
			options: ['red', 'green', 'blue']
		}],
		['listOfNumbers', {
			type: 'DynamicPacked',
			packer: 'NumberListPacker',
			heap: 'NumberListHeap'
		}],
		['ratings', {
			type: 'Vector',
			dimension: 3,
			items: {
				type: 'Enum',
				options: ['good', 'medium', 'bad']
			}
		}],
		['birthdays', {
			type: 'Vector',
			dimension: 5,
			items: {
				type: 'Struct',
				entries: [
					['day', 'UInt8'],
					['month', 'UInt8'],
					['year', 'Int16LE']
				]
			}
		}],
		['car', {
			type: 'Reference',
			fromId: 'carFromId',
			toId: 'carToId'
		}],
		['resources', {
			type: 'StaticMap',
			keys: ['time', 'money', 'coffee'],
			values: 'FloatLE'
		}]
	]
};

global.NumberListHeap = new Heap(RecordBuffer);

global.NumberListPacker = {
	byteSize: (arrayOfNumbers) => arrayOfNumbers.length,
	pack: (arrayOfNumbers, offset, buffer) => {
		for (var number of arrayOfNumbers) {
			buffer.writeUInt8(number, offset);
			offset += 1;
		}
	},
	unpack: (offset, buffer, byteSize) => {
		const arrayOfNumbers = new Array(byteSize);
		for (var i = 0; i < byteSize; i++) {
			arrayOfNumbers[i] = buffer.readUInt8(offset + i);
		}
		return arrayOfNumbers;
	}
};

global.carFromId = function (id) {
	return {id: id, otherProp: 'something'};
};
global.carToId = function (car) {
	return car.id;
};


const TestProxy = EntityProxy.fromStruct(struct, "Test");

const buffer = new Buffer(TestProxy.byteSize);
buffer.fill(0);

var testEntity = new TestProxy(0, buffer);

console.log(testEntity.number);
console.log(testEntity.color);
console.log(testEntity.listOfNumbers);
console.log(testEntity.ratings);
console.log(testEntity.birthdays[1].day);