export function byteSize (type) {
	// shorthand for primitive types
	const typeName = type.type || type;

	const sizes = {
		Int8: () => 1,
		UInt8: () => 1,
		Int16LE: () => 2,
		Int16BE: () => 2,
		UInt16LE: () => 2,
		UInt16BE: () => 2,
		Int32LE: () => 4,
		Int32BE: () => 4,
		UInt32LE: () => 4,
		UInt32BE: () => 4,
		FloatLE: () => 4,
		FloatBE: () => 4,
		DoubleLE: () => 8,
		DoubleBE: () => 8,
		Bool: () => 1,
		Enum: () => 1,
		Vector: (({dimension, items}) => dimension * byteSize(items)),
		Reference: () => byteSize('UInt32LE'),
		DynamicPacked: () => 2 * byteSize('UInt32LE'),
		StaticMap: (({keys, values}) => keys.length * byteSize(values)),
		DynamicMap: () => 2 * byteSize('UInt32LE'),
		Struct: ({entries}) => entries.reduce((sum, [name, entryType]) => sum + byteSize(entryType), 0)
	};

	if (!sizes[typeName]) throw new Error('Unsupported type ' + JSON.stringify(typeName));

	return sizes[typeName](type);
}

export default function View (type) {
	// shorthand for primitive types
	const typeName = type.type || type;

	const views = {
		Int8: primitiveTypeView,
		UInt8: primitiveTypeView,
		Int16LE: primitiveTypeView,
		Int16BE: primitiveTypeView,
		UInt16LE: primitiveTypeView,
		UInt16BE: primitiveTypeView,
		Int32LE: primitiveTypeView,
		Int32BE: primitiveTypeView,
		UInt32LE: primitiveTypeView,
		UInt32BE: primitiveTypeView,
		FloatLE: primitiveTypeView,
		FloatBE: primitiveTypeView,
		DoubleLE: primitiveTypeView,
		DoubleBE: primitiveTypeView,
		Bool: type => ({
			read: (output, offset, buffer) => [
				...View('Int8').read(
				`${output}!!`, offset, buffer)
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
				...View('UInt32LE').read(
				'const pointer = ', offset, buffer),
				`if (${pointerValid('pointer')}) {`,
				`   const id = ${pointerToIndex('pointer')}`,
				`   ${output}${type.fromId}(id);`,
				`} else {`,
				`   ${output}undefined;`,
				'}'
			],
			write: (input, offset, buffer) => [
				`if (${input}) {`,
				`   const id = ${type.toId}(${input});`,
				...t(View('UInt32LE').write(
					indexToPointer('id'), offset, buffer)),
				`} else {`,
				...t(View('UInt32LE').write(
					invalidPointer(), offset, buffer)),
				`}`
			]
		}),
		DynamicPacked: type => ({
			read: (output, offset, buffer) => [
				...View('UInt32LE').read(
				'const pointer = ', offset, buffer),
				`if (${pointerValid('pointer')}) {`,
				`   const index = ${pointerToIndex('pointer')};`,
				...t(View('UInt32LE').read(
				   'const byteSize = ', offset + ' + 4', buffer)),
				`   const buffer = ${type.heap}.getBuffer(index, byteSize);`,
				`   const offset = ${type.heap}.getOffset(index, byteSize);`,
				`   ${output}${type.packer}.unpack(offset, buffer, byteSize);`,
				`} else {`,
				`	${output}undefined;`,
				`}`
			],
			write: (input, offset, buffer) => [
				...View('UInt32LE').read(
				'const oldPointer = ', offset, buffer),
				`if (${pointerValid('oldPointer')}) {`,
				`   const oldIndex = ${pointerToIndex('oldPointer')};`,
				...t(View('UInt32LE').read(
					'const oldByteSize = ', offset + ' + 4', buffer)),
				`   ${type.heap}.free(oldIndex, oldByteSize)`,
				`}`,

				`const byteSize = ${type.packer}.byteSize(${input});`,

				`if (byteSize) {`,
				`   const index = ${type.heap}.allocate(byteSize);`,
				`   const buffer = ${type.heap}.getBuffer(index, byteSize);`,
				`   const offset = ${type.heap}.getOffset(index, byteSize);`,
				`   ${type.packer}.pack(${input}, offset, buffer);`,
				...t(View('UInt32LE').write(
					indexToPointer('index'), offset, buffer)),
				...t(View('UInt32LE').write(
					'byteSize', offset + ' + 4', buffer)),
				`} else {`,
				...t(View('UInt32LE').write(
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
				...View('UInt32LE').read(
				'const pointer = ', offset, buffer),
				`if (${pointerValid('pointer')}) {`,
				`   const index = ${pointerToIndex('pointer')};`,
				...t(View('UInt32LE').read(
					'const givenPairsByteSize = ', offset + ' + 4', buffer)),
				`   const keyValueByteSize = (1 + ${byteSize(type.values)});`,
				`   const nKeys = givenPairsByteSize / keyValueByteSize;`,
				`   const heapBuffer = ${type.heap}.getBuffer(index, givenPairsByteSize);`,
				`   const heapOffset = ${type.heap}.getOffset(index, givenPairsByteSize);`,
				`   return new ${prefix}MapProxy(heapOffset, heapBuffer, nKeys);`,
				`} else {`,
				`   return new ${prefix}MapProxy(null, null, 0);`,
				`}`
			],
			write: (input, offset, buffer, prefix) => [
				...View('UInt32LE').read(
				'const oldPointer = ', offset, buffer),
				`if (${pointerValid('oldPointer')}) {`,
				`   const oldIndex = ${pointerToIndex('oldPointer')};`,
				...t(View('UInt32LE').read(
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
				...t(View('UInt32LE').write(
						indexToPointer('index'), offset, buffer)),
				...t(View('UInt32LE').write(
						'givenPairsByteSize', offset + ' + 4', buffer)),
				`} else {`,
				...t(View('UInt32LE').write(
					invalidPointer(), offset, buffer)),
				`}`

			],
			defines: (prefix) => [
				`const ${prefix}Keys = ${JSON.stringify(type.keys)}`,
				``,
				`class ${prefix}MapProxy {`,
				`   constructor (offset, buffer, nKeys) {`,
				`      this._offset = offset;`,
				`      this._buffer = buffer;`,
				`      this._nKeys = nKeys;`,
				`   }`,
				...flatten(type.keys.map((key, keyIndex) => [
				`   get ${key} () {`,
				`      const keyValueByteSize = (1 + ${byteSize(type.values)});`,
				`      for (var i = 0, keyOffset = 0; i < this._nKeys; i++, keyOffset += keyValueByteSize) {`,
				...(t(t(t(View('UInt8').read(
						  'const keyIndex = ', 'this._offset + keyOffset', 'this._buffer'))))),
				`         if (keyIndex === ${keyIndex}) {`,
				...(t(t(t(t(View(type.values).read(
						     'return ', 'this._offset + keyOffset + 1', 'this._buffer')))))),
				`         }`,
				`      }`,
				`   }`
				])),
				`}`
			]
		}),
		Struct: type => ({
			read: (output, offset, buffer, prefix) => [
				`${output}new ${prefix}StructProxy(${offset}, ${buffer})`
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
				`      this._buffer = buffer;`,
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

function primitiveTypeView (primitiveType) {
	return {
		read: (output, offset, buffer) => [`${output}${buffer}.read${primitiveType}(${offset})`],
		write: (input, offset, buffer) => [`${buffer}.write${primitiveType}(${input}, ${offset})`]
	}
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