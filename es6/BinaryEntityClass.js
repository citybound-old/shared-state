import BinaryTypes from './BinaryTypes.js';
import metaEval from 'meta-eval';

export function fromSchema (schema, name) {
	schema = schema.map(p => [Object.keys(p)[0], p[Object.keys(p)[0]]]);
	schema.name = schema.name || name;
	validateSchema(schema);

	let code = proxyClassCode(schema);
	console.log(code);

	let {exports: {theClass: proxyClass}} = metaEval(
		code,
		{exports: {}},
		`${schema.name}Proxy`,
		`SharedMemory/EntityProxies/${schema.name}`,
		"game://citybound/generated/",
		{transpile: true}
	);

	return proxyClass;
}

function validateSchema(schema) {
	for (let [property, type] of schema) {
		if (!Buffer.prototype["read" + type]
		&& !type.entity && !type.dynamicPacked && !type.fixedPacked && !type.vector
		&& !type.array && !type.enum && !type.staticMap && type !== "Bool")
			throw "Unknown binary type " + JSON.stringify(type);
	}
}

function proxyClassCode (schema) {
	return `
exports.theClass = class ${schema.name}Proxy {

	static byteSize = ${byteSize(schema)};

	constructor (offset, buffer) {
		this._offset = (typeof offset === "undefined") ? -1 : offset;
		this.id = this._offset;
		this._buffer = buffer;
	}

	${schema.map(([property, type]) =>`
	get ${property} () {
		${read("return ", "this._buffer", type, "this._offset", fieldOffset(schema, property), property)}
	}
	set ${property} (${property}) {
		${write("this._buffer", type, property, "this._offset", fieldOffset(schema, property), property)}
	}`
	).join("\n\n")}

	static copyObject(object, offset, buffer, existingProxy) {
		${schema.map(([property, type]) =>
			write("buffer", type, "object." + property, "offset", fieldOffset(schema, property), property)
		).join("\n\t\t")}
	}
}

${schema.map(([property, type]) =>
	proxyHelper(property, type)
).filter(helper => helper).join("\n\n")}
`;
}

function fieldOffset (schema, property) {
	let offset = 0;
	for (let [currentProperty, type] of schema) {
		if (currentProperty === property) return offset;
		else offset += BinaryTypes.getByteSize(type);
	}
}

function byteSize(schema) {
	let totalRecordSize = 0;

	for (let [property, type] of schema) {
		let propertySize = BinaryTypes.getByteSize(type);
		totalRecordSize += propertySize;
	}

	return totalRecordSize;
}

const VALID_OFFSET = "10E8";

function read(assignment, buffer, type, offset, fieldOffset, propertyAlias) {
	if (type.vector) {

		let length = type.vector;
		let itemSize = BinaryTypes.getByteSize(type.of);

		return `
		let vector = new Array(${length});

		for (let i = 0, iOffset = 0; i < ${length}; i++, iOffset += ${itemSize}) {
			${read("vector[i] = ", buffer, type.of, offset, fieldOffset + " + iOffset", propertyAlias + "Item")}
		}

		${assignment}vector;
	`

	} else if (type.entity) {

		let rawIdExpr = read("let id = ", buffer, "UInt32LE", offset, fieldOffset);
		return `
		${rawIdExpr} - ${VALID_OFFSET};
		${assignment}(${type.entity}(id))
	`;

	} else if (type.dynamicPacked) {

		return `
		let result;
		${read("let index = ", buffer, "UInt32LE", offset, fieldOffset)};

		if (index > 0) {
			index -= ${VALID_OFFSET};
			${read("let size = ", buffer, "UInt32LE", offset, fieldOffset + 4)};
			let buffer = ${type.heap}.getBuffer(index, size);
			let offset = ${type.heap}.getOffset(index, size);
			result = ${type.dynamicPacked}.unpack(buffer, offset, size);
		} else {
			result = undefined;
		}

		${assignment}result
	`;

	} else if (type.enum) {

		return `
		${read("let index = ", buffer, "UInt8", offset, fieldOffset)};
		${assignment}${propertyAlias}EnumValues[index]
	`;

	} else if (type.staticMap) {

		return `
			let proxyHelper = ${propertyAlias}Helper;
			proxyHelper._buffer = ${buffer};
			proxyHelper._offset = ${offset} + ${fieldOffset};
			${assignment}proxyHelper;
		`;

	} else if (type === "Bool") {

		return `${assignment}!!${buffer}.readUInt8(${offset} + ${fieldOffset}, true)`;

	} else {

		return `${assignment}${buffer}.read${type}(${offset} + ${fieldOffset}, true)`;

	}
}

function write(buffer, type, input, offset, fieldOffset, propertyAlias) {
	if (type.vector) {

		let length = type.vector;
		let itemSize = BinaryTypes.getByteSize(type.of);

		return `

		for (let i = 0, iOffset = 0; i < ${length}; i++, iOffset += ${itemSize}) {
			${write(buffer, type.of, input + "[i]", offset, fieldOffset + " + iOffset", propertyAlias + "Item")}
		}
	`

	} else if (type.entity) {

		return write(buffer, "UInt32LE", `(${input} ? ${input}.id + ${VALID_OFFSET} : 0)`, offset, fieldOffset, propertyAlias);

	} else if (type.dynamicPacked) {

		return `
		${read("let oldIndex = ", buffer, "UInt32LE", offset, fieldOffset)};

		if (oldIndex > 0) {
			${read("let oldSize = ", buffer, "UInt32LE", offset, fieldOffset + 4)};
			${type.heap}.free(oldIndex - ${VALID_OFFSET}, oldSize);
		}

		let packedSize = ${type.dynamicPacked}.packedSize(${input});

		if (packedSize > 0) {
			let packedIndex = ${type.heap}.allocate(packedSize);
			let packedBuffer = ${type.heap}.getBuffer(packedIndex, packedSize);
			let packedOffset = ${type.heap}.getOffset(packedIndex, packedSize);
			${type.dynamicPacked}.pack(${input}, packedBuffer, packedOffset);
			${write(buffer, "UInt32LE", `packedIndex + ${VALID_OFFSET}`, offset, fieldOffset, propertyAlias)};
			${write(buffer, "UInt32LE", "packedSize", offset, fieldOffset + 4, propertyAlias)};
		} else {
			${write(buffer, "UInt32LE", "0", offset, fieldOffset, propertyAlias)};
		}
	`;

	} else if (type.enum) {

		return write(buffer, "UInt8", `${propertyAlias}EnumValues.indexOf(${input})`, offset, fieldOffset, propertyAlias);

	} else if (type.staticMap) {

		let keys = type.staticMap.keys;
		let valueSize = BinaryTypes.getByteSize(type.staticMap.values);

		let propertyWriteCalls = "";

		for (let i = 0, propertyOffset = 0; i < keys.length; i++, propertyOffset += valueSize) {
			propertyWriteCalls += write(
				buffer,
				type.staticMap.values,
				input + "." + keys[i],
				offset,
				fieldOffset + propertyOffset,
				propertyAlias + "Value"
			);
			propertyWriteCalls += ";\n\t\t";
		}

		return propertyWriteCalls;

	} else if (type === "Bool") {

		return write(buffer, "UInt8", `${input} ? 1 : 0`, offset, fieldOffset, propertyAlias);

	} else {

		return `${buffer}.write${type}(${input}, ${offset} + ${fieldOffset}, true)`;

	}
}

function proxyHelper (property, type) {
	if (type.vector) {
		return proxyHelper(property + "Item", type.of);
	} else if (type.staticMap) {
		var valueType = type.staticMap.values;
		var valueSize = BinaryTypes.getByteSize(valueType);

		return `
const ${property}Helper = {
	_buffer: null,
	_offset: 0,
	${type.staticMap.keys.map((key, i) => `
	get ${key} () {${read("return ", "this._buffer", valueType, "this._offset", i * valueSize)}},
	set ${key} (value) {${write("this._buffer", valueType, "value", "this._offset", i * valueSize, property)}}`
	).join(",\n")}
};`
	} else if (type.enum) {
		return `const ${property}EnumValues = ${JSON.stringify(type.enum)};`;
	}
}