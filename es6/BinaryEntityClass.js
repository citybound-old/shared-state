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
	let className = (schema.name || "Entity" + lastSchemaId) + "Proxy";

	let fieldOffset = 0;

	let proxyHelpers = schema.map(
		([property, type]) => createProxyHelper(property, type)
	).filter(l => l).join("\n");

	let header = `
exports.theClass = class ${className} {`;

	let sizeInformation = `
	static byteSize = ${byteSize(schema)};`;

	let enumConstants = "\n" + schema.map(function ([property, type]) {
		return createPropertyConstants(property, type);
	}).filter(constant => constant).join("\n");

	let constructor = `
	constructor(offset, buffer) {
		this._offset = (typeof offset === "undefined") ? -1 : offset;
		this.id = this._offset;
		this._buffer = buffer;
	}
`;

	let members = schema.map(function([property, type]) {
		let fieldAccessorsCode = createAccessors(property, type, fieldOffset, className);
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
			let writeCode = createWriteCall("buffer", type, "object." + property, "offset", fieldOffset, property, className);
			fieldOffset += BinaryTypes.getByteSize(type);
			return writeCode;
		}).join("\n\t\t")}
	}
`;

	let proxyClassCode = proxyHelpers + header + sizeInformation + enumConstants + constructor + members + copyObject + footer;

	console.log(proxyClassCode);

	let {exports: {theClass: proxyClass}} = metaEval(
		proxyClassCode,
		{exports: {}},
		`${className}`,
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

function createPropertyConstants(property, type) {
	if (type.vector) {
		return createPropertyConstants(property, type.of);
	} else if (type.enum) {
		return `	static ${property}Values = ${JSON.stringify(type.enum)}`;
	}
}

function createAccessors(property, type, fieldOffset, className) {
	return `
	get ${property}() {${createReadCall("return ", "this._buffer", type, "this._offset", fieldOffset, property, className)}}
	set ${property}(${property}) {${createWriteCall("this._buffer", type, property, "this._offset", fieldOffset, property, className)}}`;
}

const VALID_OFFSET = "10E8";

function createReadCall(assignment, bufferVariable, type, offsetVariable, fieldOffset, propertyAlias, className) {
	if (type.vector) {

		let length = type.vector;
		let itemSize = BinaryTypes.getByteSize(type.of);

		return `
		let vector = new Array(${length});

		for (let i = 0, iOffset = 0; i < ${length}; i++, iOffset += ${itemSize}) {
			${createReadCall("vector[i] = ", bufferVariable, type.of, offsetVariable, fieldOffset + " + iOffset", propertyAlias, className)}
		}

		${assignment}vector;
	`

	} else if (type.entity) {

		let rawIdExpr = createReadCall("let id = ", bufferVariable, "UInt32LE", offsetVariable, fieldOffset, propertyAlias, className);
		return `
		${rawIdExpr} - ${VALID_OFFSET};
		${assignment}(${type.entity}(id))
	`;

	} else if (type.dynamicPacked) {

		let packedIndexExpr = createReadCall("let index = ", bufferVariable, "UInt32LE", offsetVariable, fieldOffset, propertyAlias, className);
		let packedSizeExpr = createReadCall("let size = ", bufferVariable, "UInt32LE", offsetVariable, fieldOffset + 4, propertyAlias, className);
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
		${createReadCall("let index = ", bufferVariable, "UInt8", offsetVariable, fieldOffset, propertyAlias, className)};
		${assignment}${className}.${propertyAlias}Values[index]
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

function createWriteCall(bufferVariable, type, variableToBeWritten, offsetVariable, fieldOffset, propertyAlias, className) {
	if (type.vector) {

		let length = type.vector;
		let itemSize = BinaryTypes.getByteSize(type.of);

		return `

		for (let i = 0, iOffset = 0; i < ${length}; i++, iOffset += ${itemSize}) {
			${createWriteCall(bufferVariable, type.of, variableToBeWritten + "[i]", offsetVariable, fieldOffset + " + iOffset", propertyAlias, className)}
		}
	`

	} else if (type.entity) {

		return createWriteCall(bufferVariable, "UInt32LE", `(${variableToBeWritten} ? ${variableToBeWritten}.id + ${VALID_OFFSET} : 0)`, offsetVariable, fieldOffset, propertyAlias, className);

	} else if (type.dynamicPacked) {

		let packedIndexExpr = createReadCall("let oldIndex = ", bufferVariable, "UInt32LE", offsetVariable, fieldOffset, propertyAlias, className);
		let packedLengthExpr = createReadCall("let oldSize = ", bufferVariable, "UInt32LE", offsetVariable, fieldOffset + 4, propertyAlias, className);
		return `
		${packedIndexExpr};

		if (oldIndex > 0) {
			${packedLengthExpr};
			${type.heap}.free(oldIndex - ${VALID_OFFSET}, oldSize);
		}

		let packedSize = ${type.dynamicPacked}.packedSize(${variableToBeWritten});

		if (packedSize > 0) {
			let packedIndex = ${type.heap}.allocate(packedSize);
			let packedBuffer = ${type.heap}.getBuffer(packedIndex, packedSize);
			let packedOffset = ${type.heap}.getOffset(packedIndex, packedSize);
			${type.dynamicPacked}.pack(${variableToBeWritten}, packedBuffer, packedOffset);
			${createWriteCall(bufferVariable, "UInt32LE", `packedIndex + ${VALID_OFFSET}`, offsetVariable, fieldOffset, propertyAlias, className)};
			${createWriteCall(bufferVariable, "UInt32LE", "packedSize", offsetVariable, fieldOffset + 4, propertyAlias, className)};
		} else {
			${createWriteCall(bufferVariable, "UInt32LE", "0", offsetVariable, fieldOffset, propertyAlias, className)};
		}
	`;

	} else if (type.enum) {

		return createWriteCall(bufferVariable, "UInt8", `${className}.${propertyAlias}Values.indexOf(${variableToBeWritten})`, offsetVariable, fieldOffset, propertyAlias, className);

	} else if (type.staticDictionary) {

		let keys = type.staticDictionary.keys;
		let valueSize = BinaryTypes.getByteSize(type.staticDictionary.values);

		let propertyWriteCalls = "";

		for (let i = 0, propertyOffset = 0; i < keys.length; i++, propertyOffset += valueSize) {
			propertyWriteCalls += createWriteCall(
				bufferVariable,
				type.staticDictionary.values,
				variableToBeWritten + "." + keys[i],
				offsetVariable,
				fieldOffset + propertyOffset,
				propertyAlias,
				className
			);
			propertyWriteCalls += ";\n";
		}

		return propertyWriteCalls;

	} else if (type === "Bool") {

		return createWriteCall(bufferVariable, "UInt8", `${variableToBeWritten} ? 1 : 0`, offsetVariable, fieldOffset, propertyAlias, className);

	} else {

		return `${bufferVariable}.write${type}(${variableToBeWritten}, ${offsetVariable} + ${fieldOffset}, true)`;

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
