import BinaryTypes from './BinaryTypes.js';
import metaEval from 'meta-eval';

export function fromSchema (schema, name) {
	schema = schema.map(p => [Object.keys(p)[0], p[Object.keys(p)[0]]]);
	schema.name = schema.name || name;
	validateSchema(schema);

	return createProxyClass(schema);
}

function validateSchema(schema) {
	for (let [property, type] of schema) {
		if (!Buffer.prototype["read" + type]
		&& !type.entity && !type.dynamicPacked && !type.fixedPacked && !type.vector
		&& !type.array && !type.enum && !type.staticDictionary && type !== "Bool")
			throw "Unknown binary type " + JSON.stringify(type);
	}
}

let lastSchemaId = 0;

function createProxyClass(schema) {
	let classContainer = {};

	let fieldOffset = 0;

	let proxyHelpers = schema.map(
		([property, type]) => createProxyHelper(property, type)
	).filter(l => l).join("\n");

	let header = `
exports.theClass = class ${schema.name || "Entity" + lastSchemaId}Proxy {`;

	let sizeInformation = `
	static byteSize = ${byteSize(schema)};`;

	let constructor = `
	constructor(offset, buffer) {
		this._offset = (typeof offset === "undefined") ? -1 : offset;
		this.id = this._offset;
		this._buffer = buffer;
	}
`;

	let members = schema.map(function([property, type]) {
		let fieldAccessorsCode = createAccessors(property, type, fieldOffset);
		let fieldIteratorCode = type.iterates ? createIterator(property, type, type.nextProperty, type.fieldOffset) : "";

		fieldOffset += BinaryTypes.getByteSize(type);
		return fieldAccessorsCode + fieldIteratorCode;
	}).join("\n");

	let footer = `
}`;

	fieldOffset = 0;

	let copyObject = `
	static copyObject(object, offset, buffer, existingProxy) {
		${schema.map(function([property, type]) {
			let writeCode = createWriteCall("buffer", type, "object." + property, "offset", fieldOffset);
			fieldOffset += BinaryTypes.getByteSize(type);
			return writeCode;
		}).join("\n\t\t")}
	}
`;

	let proxyClassCode = proxyHelpers + header + sizeInformation + constructor + members + copyObject + footer;

	console.log(proxyClassCode);

	let {exports: {theClass: proxyClass}} = metaEval(
		proxyClassCode,
		{exports: {}},
		`${schema.name || "Entity" + lastSchemaId}Proxy`,
		`SharedMemory/EntityProxies/${schema.name || "Entity" + lastSchemaId}`,
		"game://citybound/" + "generated/",
		{transpile: true}
	);

	lastSchemaId++;

	return proxyClass;
}

function byteSize(schema) {
	let totalRecordSize = 0;

	for (let [property, type] of schema) {
		let propertySize = BinaryTypes.getByteSize(type);
		totalRecordSize += propertySize;
	}

	return totalRecordSize;
}

function createAccessors(property, type, fieldOffset) {
	return `
	get ${property}() {${createReadCall("return ", "this._buffer", type, "this._offset", fieldOffset, property)}}
	set ${property}(${property}) {${createWriteCall("this._buffer", type, property, "this._offset", fieldOffset)}}`;
}

const VALID_OFFSET = "10E8";

function createReadCall(assignment, bufferVariable, type, offsetVariable, fieldOffset, propertyAlias) {
	if (type.vector) {

		let length = type.vector;
		let itemSize = BinaryTypes.getByteSize(type.of);

		return `
		let vector = new Array(${length});

		for (let i = 0, iOffset = 0; i < ${length}; i++, iOffset += ${itemSize}) {
			${createReadCall("vector[i] = ", bufferVariable, type.of, offsetVariable, fieldOffset + " + iOffset")}
		}

		${assignment}vector;
	`

	} else if (type.entity) {

		let rawIdExpr = createReadCall("let id = ", bufferVariable, "UInt32LE", offsetVariable, fieldOffset);
		return `
		${rawIdExpr} - ${VALID_OFFSET};
		${assignment}(${type.entity}(id))
	`;

	} else if (type.dynamicPacked) {

		let packedIndexExpr = createReadCall("let index = ", bufferVariable, "UInt32LE", offsetVariable, fieldOffset);
		let packedSizeExpr = createReadCall("let size = ", bufferVariable, "UInt32LE", offsetVariable, fieldOffset + 4);
		let bufferExpr = `let buffer = ${type.heap}.getBuffer(index, size)`;
		let offsetExpr = `let offset = ${type.heap}.getOffset(index, size)`;
		let valueExpr = `${type.dynamicPacked}.unpack(buffer, offset, size)`;

		return `
		let result;
		${packedIndexExpr};

		if (index > 0) {
			index -= ${VALID_OFFSET};
			${packedSizeExpr};
			${bufferExpr};
			${offsetExpr};
			result = ${valueExpr};
		} else {
			result = undefined;
		}

		${assignment}result
	`;

	} else if (type.enum) {

		return `
		${createReadCall("let index = ", bufferVariable, "UInt8", offsetVariable, fieldOffset)};
		${assignment}${JSON.stringify(type.enum)}[index]
	`;

	} else if (type.staticDictionary) {

		return `
			let proxyHelper = ${propertyAlias}Helper;
			proxyHelper._buffer = ${bufferVariable};
			proxyHelper._offset = ${offsetVariable} + ${fieldOffset};
			${assignment}proxyHelper;
		`;

		//let helperVars = [];
		//let valueType = type.staticDictionary.values;
		//let valueSize = BinaryTypes.getByteSize(valueType);
		//let keyOffset = 0;
		//
		//for (var key of type.staticDictionary.keys) {
		//	helperVars.push(createReadCall("\t\tvar " + key + " = ", bufferVariable, valueType, offsetVariable, fieldOffset + keyOffset));
		//	keyOffset += valueSize;
		//}
		//
		//let objectLiteral = "{\n" + type.staticDictionary.keys.map(
		//	(key) => "\t\t\t" + key + ": " + key
		//).join(",\n") + "\n\t\t}\n\t";
		//
		//return "\n" + helperVars.join(";\n") + ";\n\n\t\t" + assignment + objectLiteral;

	} else if (type === "Bool") {

		return `${assignment}!!${bufferVariable}.readUInt8(${offsetVariable} + ${fieldOffset}, true)`;

	} else {

		return `${assignment}${bufferVariable}.read${type}(${offsetVariable} + ${fieldOffset}, true)`;

	}
}

function createWriteCall(bufferVariable, type, inputVariable, offsetVariable, fieldOffset) {
	if (type.vector) {

		let length = type.vector;
		let itemSize = BinaryTypes.getByteSize(type.of);

		return `

		for (let i = 0, iOffset = 0; i < ${length}; i++, iOffset += ${itemSize}) {
			${createWriteCall(bufferVariable, type.of, inputVariable + "[i]", offsetVariable, fieldOffset + " + iOffset")}
		}
	`

	} else if (type.entity) {

		return createWriteCall(bufferVariable, "UInt32LE", `(${inputVariable} ? ${inputVariable}.id + ${VALID_OFFSET} : 0)`, offsetVariable, fieldOffset);

	} else if (type.dynamicPacked) {

		let packedIndexExpr = createReadCall("let oldIndex = ", bufferVariable, "UInt32LE", offsetVariable, fieldOffset);
		let packedLengthExpr = createReadCall("let oldSize = ", bufferVariable, "UInt32LE", offsetVariable, fieldOffset + 4);
		return `
		${packedIndexExpr};

		if (oldIndex > 0) {
			${packedLengthExpr};
			${type.heap}.free(oldIndex - ${VALID_OFFSET}, oldSize);
		}

		let packedSize = ${type.dynamicPacked}.packedSize(${inputVariable});

		if (packedSize > 0) {
			let packedIndex = ${type.heap}.allocate(packedSize);
			let packedBuffer = ${type.heap}.getBuffer(packedIndex, packedSize);
			let packedOffset = ${type.heap}.getOffset(packedIndex, packedSize);
			${type.dynamicPacked}.pack(${inputVariable}, packedBuffer, packedOffset);
			${createWriteCall(bufferVariable, "UInt32LE", `packedIndex + ${VALID_OFFSET}`, offsetVariable, fieldOffset)};
			${createWriteCall(bufferVariable, "UInt32LE", "packedSize", offsetVariable, fieldOffset + 4)};
		} else {
			${createWriteCall(bufferVariable, "UInt32LE", "0", offsetVariable, fieldOffset)};
		}
	`;

	} else if (type.enum) {

		return createWriteCall(bufferVariable, "UInt8", `${JSON.stringify(type.enum)}.indexOf(${inputVariable})`, offsetVariable, fieldOffset);

	} else if (type.staticDictionary) {

		let keys = type.staticDictionary.keys;
		let valueSize = BinaryTypes.getByteSize(type.staticDictionary.values);

		let propertyWriteCalls = "";

		for (let i = 0, propertyOffset = 0; i < keys.length; i++, propertyOffset += valueSize) {
			propertyWriteCalls += createWriteCall(
				bufferVariable,
				type.staticDictionary.values,
				inputVariable + "." + keys[i],
				offsetVariable,
				fieldOffset + propertyOffset
			);
			propertyWriteCalls += ";\n";
		}

		return propertyWriteCalls;

	} else if (type === "Bool") {

		return createWriteCall(bufferVariable, "UInt8", `${inputVariable} ? 1 : 0`, offsetVariable, fieldOffset);

	} else {

		return `${bufferVariable}.write${type}(${inputVariable}, ${offsetVariable} + ${fieldOffset}, true)`;

	}
}

function createProxyHelper (property, type) {
	if (type.staticDictionary) {
		var valueType = type.staticDictionary.values;
		var valueSize = BinaryTypes.getByteSize(valueType);

		return `
const ${property}Helper = {
	_buffer: null,
	_offset: 0,
	${type.staticDictionary.keys.map((key, i) => `
	get ${key} () {${createReadCall("return ", "this._buffer", valueType, "this._offset", i * valueSize)}},
	set ${key} (value) {${createWriteCall("this._buffer", valueType, "value", "this._offset", i * valueSize)}}`
	).join(",\n")}
}`
	}
}