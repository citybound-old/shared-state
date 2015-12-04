require("babel-core/register");
const EntityCollection = require("./es6/EntityCollection");
const View = require("./es6/BinaryViews");
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
		['next', {
			type: 'CollectionReference',
			collection: 'stuffCollection'
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

global.stuffCollection = new EntityCollection(struct, 'TestCollection', {
	testProperty: 5,
	testFunction () {
		console.log("additional prop yaay!!");
		console.log("some binary data in me:", this.color);
	}
});
const first = stuffCollection.cursor();

stuffCollection.allocate();
stuffCollection.allocate();
stuffCollection.allocate();

const id = stuffCollection.allocate();
stuffCollection.load(id, first);

console.log(first.id);
console.log(first.number);
console.log(first.color);
console.log(first.listOfNumbers);
console.log(first.testProperty);
first.testFunction();

const nextId = stuffCollection.allocate();
first.next = nextId;

console.log(first.next.color);

//const next = stuffCollection.cursor();
//const nextId = stuffCollection.allocate();
//stuffCollection.get(nextId, next);
//
//next.number = 11;
//console.log(next.number);
//
//first.next = next;
//
//console.log(first.next.number);
//
//first.next.number = 6;
//console.log(first.next.number);
//
//console.log(global.stuffCollection.cursors.length);
//
//console.log(first.id);
//
//stuffCollection.allocate();
//stuffCollection.allocate();
//stuffCollection.allocate();
//stuffCollection.allocate();
//stuffCollection.allocate();
////stuffCollection.free(next.id);
//stuffCollection.allocate();
//stuffCollection.allocate();
//stuffCollection.allocate();
////stuffCollection.free(first.id);
//stuffCollection.allocate();
//
//console.log("----");
//
//stuffCollection.iterate(cursor =>
//	console.log(cursor.id)
//);