export function byteSize (type) {
	// shorthand for primitive types
	const typeName = type.type || type;

	const sizes = {
		Int8: () => 1,
		UInt8: () => 1,
		Int16: () => 2,
		UInt16: () => 2,
		Int32: () => 4,
		UInt32: () => 4,
		Float: () => 4,
		Double: () => 8,
		Bool: () => 1,
		Enum: () => 1,
		Vector: (({dimension, items}) => dimension * byteSize(items)),
		Reference: () => byteSize('UInt32'),
		CollectionReference: () => byteSize('UInt32'),
		DynamicPacked: () => 2 * byteSize('UInt32'),
		StaticMap: (({keys, values}) => keys.length * byteSize(values)),
		DynamicMap: () => 2 * byteSize('UInt32'),
		Struct: ({entries}) => entries.reduce((sum, [name, entryType]) => sum + byteSize(entryType), 0)
	};

	if (!sizes[typeName]) throw new Error('Unsupported type ' + JSON.stringify(typeName));

	return sizes[typeName](type);
}

export default function View (type) {
	// shorthand for primitive types
	const typeName = type.type || type;

	const views = {
		Int8: primitiveNumberView,
		UInt8: primitiveNumberView,
		Int16: multibytePrimitiveNumberView,
		UInt16: multibytePrimitiveNumberView,
		Int32: multibytePrimitiveNumberView,
		UInt32: multibytePrimitiveNumberView,
		Float: multibytePrimitiveNumberView,
		Double: multibytePrimitiveNumberView,
		Bool: type => ({
			read: (output, offset, buffer) => [
				...View('Int8').read(
				`${output}!!`, offset, buffer)
			],
			default: (output) => [
				`${output}false`
			],
			write: (input, offset, buffer) => [
				...View('Int8').write(
				`${input} ? 1 : 0`, offset, buffer)
			]
		}),
		Enum: type => ({
			read: (output, offset, buffer, prefix) => [
				...View('Int8').read(
				'const index = ', offset, buffer),
				`${output}${prefix}EnumOptions[index]`
			],
			default: (output, prefix) => [`${output}${prefix}EnumOptions[0]`],
			write: (input, offset, buffer, prefix) => [
				`const index = ${prefix}EnumOptions.indexOf(${input});`,
				...View('Int8').write('index', offset, buffer)
			],
			defines: (prefix) => [
				`const ${prefix}EnumOptions = ${JSON.stringify(type.options)}`
			]
		}),
		Vector: type => ({
			read: (output, offset, buffer, prefix) => [
				`const vector = new Array(${type.dimension})`,
				`for (let i = 0, itemOffset = 0; i < ${type.dimension}; i++, itemOffset += ${byteSize(type.items)}) {`,
				...t(View(type.items).read(
					'vector[i] = ', `${offset} + itemOffset`, buffer, prefix + 'Item')),
				`}`,
				`${output}vector`
			],
			default: (prefix) => [
				`const vector = new Array(${type.dimension})`,
				`for (let i = 0, itemOffset = 0; i < ${type.dimension}; i++, itemOffset += ${byteSize(type.items)}) {`,
				...t(View(type.items).default(
				    'vector[i] = ', prefix)),
				`}`,
				`${output}vector`
			],
			write: (input, offset, buffer, prefix) => [
				`for (let i = 0, itemOffset = 0; i < ${type.dimension}; i++, itemOffset += ${byteSize(type.items)}) {`,
				...t(View(type.items).write(
					input + '[i]', `${offset} + itemOffset`, buffer, prefix + 'Item')),
				`}`
			],
			defines: (prefix) => View(type.items).defines && flatten(View(type.items).defines(prefix + 'Item'))
		}),
		Reference: type => ({
			read: (output, offset, buffer) => [
				...View('UInt32').read(
				'const pointer = ', offset, buffer),
				`if (${pointerValid('pointer')}) {`,
				`   const id = ${pointerToIndex('pointer')}`,
				`   ${output}${type.fromId}(id);`,
				`} else {`,
				`   ${output}undefined;`,
				'}'
			],
			default: (output, prefix) => [
				`${output}undefined`
			],
			write: (input, offset, buffer) => [
				`if (${input}) {`,
				`   const id = ${type.toId || `(entity => entity.id)`}(${input});`,
				...t(View('UInt32').write(
					indexToPointer('id'), offset, buffer)),
				`} else {`,
				...t(View('UInt32').write(
					invalidPointer(), offset, buffer)),
				`}`
			]
		}),
		CollectionReference: type => ({
			read: (output, offset, buffer, prefix) => [
				...View('UInt32').read(
						'const pointer = ', offset, buffer),
				`if (${pointerValid('pointer')}) {`,
				`   const id = ${pointerToIndex('pointer')}`,
				`   if (!this.${prefix}Cursor) {`,
				`       this.${prefix}Cursor = ${type.collection}.cursor();`,
				`   }`,
				`   ${type.collection}.load(id, this.${prefix}Cursor);`,
				`   ${output}this.${prefix}Cursor;`,
				`} else {`,
				`   ${output}undefined;`,
				'}'
			],
			default: (output, prefix) => [
				`${output}undefined`
			],
			write: (input, offset, buffer) => [
				`if (${input}) {`,
				`   if (typeof ${input} === 'number') {`,
				...t(t(View('UInt32').write(
						indexToPointer(input), offset, buffer))),
				`   } else {`,
				...t(t(View('UInt32').write(
						indexToPointer(`${input}.id`), offset, buffer))),
				`   }`,
				`} else {`,
				...t(View('UInt32').write(
						invalidPointer(), offset, buffer)),
				`}`
			]
		}),
		DynamicPacked: type => ({
			read: (output, offset, buffer) => [
				...View('UInt32').read(
				'const pointer = ', offset, buffer),
				`if (${pointerValid('pointer')}) {`,
				`   const index = ${pointerToIndex('pointer')};`,
				...t(View('UInt32').read(
				   'const byteSize = ', offset + ' + 4', buffer)),
				`   const buffer = ${type.heap}.getBuffer(index, byteSize);`,
				`   const offset = ${type.heap}.getOffset(index, byteSize);`,
				`   ${output}${type.packer}.unpack(offset, buffer, byteSize);`,
				`} else {`,
				`	${output}undefined;`,
				`}`
			],
			default: (output, prefix) => [
				`${output}undefined`
			],
			write: (input, offset, buffer) => [
				...View('UInt32').read(
				'const oldPointer = ', offset, buffer),
				`if (${pointerValid('oldPointer')}) {`,
				`   const oldIndex = ${pointerToIndex('oldPointer')};`,
				...t(View('UInt32').read(
					'const oldByteSize = ', offset + ' + 4', buffer)),
				`   ${type.heap}.free(oldIndex, oldByteSize)`,
				`}`,

				`const byteSize = ${type.packer}.byteSize(${input});`,

				`if (byteSize) {`,
				`   const index = ${type.heap}.allocate(byteSize);`,
				`   const buffer = ${type.heap}.getBuffer(index, byteSize);`,
				`   const offset = ${type.heap}.getOffset(index, byteSize);`,
				`   ${type.packer}.pack(${input}, offset, buffer);`,
				...t(View('UInt32').write(
					indexToPointer('index'), offset, buffer)),
				...t(View('UInt32').write(
					'byteSize', offset + ' + 4', buffer)),
				`} else {`,
				...t(View('UInt32').write(
					invalidPointer(), offset, buffer)),
				`}`
			]
		}),
		StaticMap: type => View({
			type: 'Struct',
			entries: type.keys.map(key =>
				[key, type.values]
			)
		}),
		DynamicMap: type => ({
			read: (output, offset, buffer, prefix) => [
				...View('UInt32').read(
				'const pointer = ', offset, buffer),
				`if (${pointerValid('pointer')}) {`,
				`   const index = ${pointerToIndex('pointer')};`,
				...t(View('UInt32').read(
					'const givenPairsByteSize = ', offset + ' + 4', buffer)),
				`   const keyValueByteSize = (1 + ${byteSize(type.values)});`,
				`   const nKeys = givenPairsByteSize / keyValueByteSize;`,
				`   const heapBuffer = ${type.heap}.getBuffer(index, givenPairsByteSize);`,
				`   const heapOffset = ${type.heap}.getOffset(index, givenPairsByteSize);`,
				`   return new ${prefix}MapProxy(${offset}, ${buffer}, heapOffset, heapBuffer, nKeys);`,
				`} else {`,
				`   return new ${prefix}MapProxy(${offset}, ${buffer}, null, null, 0);`,
				`}`
			],
			default: (output, prefix) => [
				`${output}{} /* TODO: maybe invent something better */`
			],
			write: (input, offset, buffer, prefix) => [
				...View('UInt32').read(
				'const oldPointer = ', offset, buffer),
				`if (${pointerValid('oldPointer')}) {`,
				`   const oldIndex = ${pointerToIndex('oldPointer')};`,
				...t(View('UInt32').read(
					'const oldByteSize = ', offset + ' + 4', buffer)),
				`   ${type.heap}.free(oldIndex, oldByteSize)`,
				`}`,
				``,
				`const givenKeys = Object.keys(${input});`,
				`const keyValueByteSize = (1 + ${byteSize(type.values)});`,
				`const givenPairsByteSize = givenKeys.length * keyValueByteSize;`,
				``,
				`if (givenPairsByteSize) {`,
				`   const index = ${type.heap}.allocate(givenPairsByteSize);`,
				`   const heapBuffer = ${type.heap}.getBuffer(index, givenPairsByteSize);`,
				`   const heapOffset = ${type.heap}.getOffset(index, givenPairsByteSize);`,
				`   `,
				`   for(let i = 0, keyOffset = 0; i < givenKeys.length; i++, keyOffset += keyValueByteSize) {`,
				`       const keyIndex = ${prefix}Keys.indexOf(givenKeys[i]);`,
				...t(t(View('UInt8').write(
						'keyIndex', `heapOffset + keyOffset`, 'heapBuffer'))),
				`       const valueAtKey = ${input}[givenKeys[i]];`,
				...t(t(View(type.values).write(
						'valueAtKey', `heapOffset + keyOffset + 1`, 'heapBuffer'))),
				`   }`,
				`   `,
				...t(View('UInt32').write(
						indexToPointer('index'), offset, buffer)),
				...t(View('UInt32').write(
						'givenPairsByteSize', offset + ' + 4', buffer)),
				`} else {`,
				...t(View('UInt32').write(
					invalidPointer(), offset, buffer)),
				`}`

			],
			defines: (prefix) => [
				`const ${prefix}Keys = ${JSON.stringify(type.keys)}`,
				``,
				`class ${prefix}MapProxy {`,
				`   constructor (offset, buffer, heapOffset, heapBuffer, nKeys, addKey) {`,
				`      this._offset = offset;`,
				`      this._buffer = buffer;`,
				`      this._heapOffset = heapOffset;`,
				`      this._heapBuffer = heapBuffer;`,
				`      this._nKeys = nKeys;`,
				`      this._addKey = addKey;`,
				`   }`,
				...flatten(type.keys.map((key, keyIndex) => [
				`   get ${key} () {`,
				`      const keyValueByteSize = (1 + ${byteSize(type.values)});`,
				`      for (var i = 0, keyOffset = 0; i < this._nKeys; i++, keyOffset += keyValueByteSize) {`,
				...(t(t(t(View('UInt8').read(
						  'const keyIndex = ', 'this._heapOffset + keyOffset', 'this._heapBuffer'))))),
				`         if (keyIndex === ${keyIndex} /* ${key} */) {`,
				...(t(t(t(t(View(type.values).read(
						     'return ', 'this._heapOffset + keyOffset + 1', 'this._heapBuffer')))))),
				`         }`,
				`      }`,
				...t(t(View(type.values).default(
						'return ', prefix))),
				`   }`,
				`   `,
				`   set ${key} (value) {`,
				`      const keyValueByteSize = (1 + ${byteSize(type.values)});`,
				`      if (this._nKeys > 0) {`,
				`         for (var i = 0, keyOffset = 0; i < this._nKeys; i++, keyOffset += keyValueByteSize) {`,
				...(t(t(t(t((View('UInt8').read(
						     'const keyIndex = ', 'this._heapOffset + keyOffset', 'this._heapBuffer'))))))),
				`            if (keyIndex === ${keyIndex} /* ${key} */) {`,
				...(t(t(t(t(t((View(type.values).write(
							    'value', 'this._heapOffset + keyOffset + 1', 'this._heapBuffer')))))))),
				`               return;`,
				`            }`,
				`         }`,
				`      }`,
				`      // this key is not allocated yet`,
				`      // allocate larger buffer in heap, copy old values`,
				`      const oldGivenPairsByteSize = this._nKeys * keyValueByteSize;`,
				`      const newGivenPairsByteSize = (this._nKeys + 1) * keyValueByteSize;`,
				`      const newIndex = ${type.heap}.allocate(newGivenPairsByteSize);`,
				`      const newHeapBuffer = ${type.heap}.getBuffer(newIndex, newGivenPairsByteSize);`,
				`      const newHeapOffset = ${type.heap}.getOffset(newIndex, newGivenPairsByteSize);`,
				`      if (this._nKeys > 0) {`,
				`         this._heapBuffer.copy(newHeapBuffer, newHeapOffset, this._heapOffset, oldGivenPairsByteSize);`,
				`      }`,
				`      // add new value`,
				...t(t(View('UInt8').write(
						`${keyIndex} /* ${key} */`, `newHeapOffset + oldGivenPairsByteSize`, 'newHeapBuffer'))),
				...t(t(View(type.values).write(
						'value', `newHeapOffset + oldGivenPairsByteSize + 1`, 'newHeapBuffer'))),
				`      `,
				`      if (this._nKeys > 0) {`,
				`         // free old heap buffer`,
				...t(t(t(View('UInt32').read(
						  'const oldPointer = ', 'this._offset', 'this._buffer')))),
				`         const oldIndex = ${pointerToIndex('oldPointer')};`,
				`         ${type.heap}.free(oldIndex, oldGivenPairsByteSize);`,
				`      }`,
				`      // point map (& Proxy) to new heap buffer`,
				...t(t(View('UInt32').write(
						indexToPointer('newIndex'), 'this._offset', 'this._buffer'))),
				...t(t(View('UInt32').write(
						'newGivenPairsByteSize', 'this._offset + 4', 'this._buffer'))),
				`      this._heapBuffer = newHeapBuffer;`,
				`      this._heapOffset = newHeapOffset;`,
				`      this._nKeys += 1;`,
				`   }`
				])),
				`}`
			]
		}),
		Struct: type => ({
			read: (output, offset, buffer, prefix) => [
				`${output}new ${prefix}StructProxy(${offset}, ${buffer})`
			],
			default: (output, prefix) => [
				`${output}{} /* TODO: maybe invent something better */`
			],
			write: (input, offset, buffer, prefix) =>
				flatten(mapWithIncreasingOffset(type.entries, ([name, entryType], entryOffset) => [
					`{`,
						...t(View(entryType).write(
						input + '.' + name, offset + ' + ' + entryOffset, buffer, prefix + '_' + name)),
					`}`],

					([name, entryType], entryOffset) => entryOffset + byteSize(entryType)
				)),
			defines: (prefix) => [
				`class ${prefix}StructProxy {`,
				`   constructor(offset, buffer) {`,
				`      this._offset = offset;`,
				`      if (buffer) {`,
				`         this._buffer = buffer;`,
				`      } else {`,
				`         this._offset = 0;`,
				`         this._buffer = new Buffer(${byteSize(type)});`,
				`         this._buffer.fill(0)`,
				`      }`,
				`   }`,
				`   `,
				`   static byteSize = ${byteSize(type)};`,
				`   `,
				`   static write (object, offset, buffer) {`,
				...t(t(View(type).write('object', 'offset', 'buffer', prefix))),
				`   }`,
				`   `,
				...flatten(mapWithIncreasingOffset(type.entries, ([name, entryType], entryOffset) => [

				`   get ${name} () {`,
				...t(t(View(entryType).read(
					'return ', `this._offset + ${entryOffset}`, 'this._buffer', prefix + '_' + name))),

				`   }`,

				`   set ${name} (value) {`,
				...t(t(View(entryType).write(
					'value', `this._offset + ${entryOffset}`, 'this._buffer', prefix + '_' + name))),

				`   }`],
					([name, entryType], entryOffset) => entryOffset + byteSize(entryType)
				)),
				`}`,
				...flatten(type.entries.map(([name, entryType]) =>
					View(entryType).defines && View(entryType).defines(prefix + '_' + name)
				).filter(defines => defines))
			]
		})
	};

	if (!views[typeName]) throw new Error('Unsupported type ' + JSON.stringify(typeName));

	return views[typeName](type);
}

function primitiveNumberView (primitiveType) {
	return {
		read: (output, offset, buffer) => [`${output}${buffer}.read${primitiveType}(${offset})`],
		default: (output) => [`${output}0`],
		write: (input, offset, buffer) => [`${buffer}.write${primitiveType}(${input}, ${offset})`]
	}
}

function multibytePrimitiveNumberView (primitiveType) {
	return primitiveNumberView(primitiveType + "LE");
}

function t (lines) {
	return lines.map(line => '   ' + line);
}

function flatten (array) {
	return array.reduce((result, subarray) => result.concat(subarray), []);
}

const POINTER_VALID_OFFSET = 10E8;

function pointerValid (pointer) {
	return `${pointer} > 0`;
}

function pointerToIndex (pointer) {
	return `${pointer} - ${POINTER_VALID_OFFSET}`;
}

function indexToPointer (index) {
	return `${index} + ${POINTER_VALID_OFFSET}`;
}

function invalidPointer () {
	return `0`;
}

function mapWithIncreasingOffset (items, itemFunction, offsetFunction, initialOffset = 0) {
	let offset = initialOffset;
	const result = new Array(items.length);

	for (let i = 0; i < items.length; i++) {
		result[i] = itemFunction(items[i], offset);
		offset = offsetFunction(items[i], offset);
	}

	return result;
}