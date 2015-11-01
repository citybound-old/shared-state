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
		&& !type.entity && !type.dynamicPacked && !type.fixedPacked && !type.vector && !type.array && !type.enum && type !== "Bool")
			throw "Unknown binary type " + JSON.stringify(type);
	}
}

let lastSchemaId = 0;

function createProxyClass(schema) {
	let classContainer = {};

	let fieldOffset = 0;

	let header = `
exports.theClass = class ${schema.name || "Entity" + lastSchemaId}Proxy {`;

	let sizeInformation = `
	static binarySize = ${binarySize(schema)};`;

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
	static copyObject(object, buffer, offset, existingProxy) {
		${schema.map(function([property, type]) {
			let writeCode = createWriteCall("buffer", type, "object." + property, "offset", fieldOffset);
			fieldOffset += BinaryTypes.getByteSize(type);
			return writeCode;
		}).join("\n\t\t")}
	}
`;

	let proxyClassCode = header + sizeInformation + constructor + members + copyObject + footer;

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

function binarySize(schema) {
	let totalRecordSize = 0;

	for (let [property, type] of schema) {
		let propertySize = BinaryTypes.getByteSize(type);
		totalRecordSize += propertySize;
	}

	return totalRecordSize;
}

function createAccessors(property, type, fieldOffset) {
	return `
	get ${property}() {return ${createReadCall("this._buffer", type, "this._offset", fieldOffset)};}
	set ${property}(${property}) {${createWriteCall("this._buffer", type, property, "this._offset", fieldOffset)};}`;
}

const VALID_OFFSET = "10E8";

function createReadCall(bufferVariable, type, offsetVariable, fieldOffset) {
	if (type.entity) {
		let entityIdExpression = createReadCall(bufferVariable, "UInt32LE", offsetVariable, fieldOffset);
		return `(${type.entity}(${entityIdExpression} - ${VALID_OFFSET}))`;
	} else if (type.dynamicPacked) {
		let packedIndexExpression = createReadCall(bufferVariable, "UInt32LE", offsetVariable, fieldOffset);
		let packedLengthExpression = createReadCall(bufferVariable, "UInt32LE", offsetVariable, fieldOffset + 4);
		return `${type.dynamicPacked}.unpack(${type.heap}, ${packedIndexExpression} - ${VALID_OFFSET}, ${packedLengthExpression})`
	} else if (type.enum) {
		let indexExpression = createReadCall(bufferVariable, "UInt8", offsetVariable, fieldOffset);
		return `${JSON.stringify(type.enum)}[${indexExpression}]`;
	} else if (type === "Bool") {
		return `!!${bufferVariable}.readUInt8(${offsetVariable} + ${fieldOffset}, true)`;
	} else {
		return `${bufferVariable}.read${type}(${offsetVariable} + ${fieldOffset}, true)`;
	}
}

function createWriteCall(bufferVariable, type, variableToBeWritten, offsetVariable, fieldOffset) {
	if (type.entity) {
		return createWriteCall(bufferVariable, "UInt32LE", `(${variableToBeWritten} ? ${variableToBeWritten}.id + ${VALID_OFFSET} : 0)`, offsetVariable, fieldOffset);
	} else if (type.dynamicPacked) {
		let packedIndexExpression = createReadCall(bufferVariable, "UInt32LE", offsetVariable, fieldOffset);
		let packedLengthExpression = createReadCall(bufferVariable, "UInt32LE", offsetVariable, fieldOffset + 4);
		return `

		if (${packedIndexExpression} > 0) {
			${type.heap}.free(${packedIndexExpression} - ${VALID_OFFSET}, ${packedLengthExpression});
		}

		let packedSize = ${type.dynamicPacked}.packedSize(${variableToBeWritten});

		if (packedSize > 0) {
			let packedIndex = ${type.heap}.allocate(packedSize);
			let packedBuffer = ${type.heap}.getFileBuffer(packedIndex, packedSize);
			let packedOffset = ${type.heap}.getFileOffset(packedIndex, packedSize);
			${type.dynamicPacked}.pack(${variableToBeWritten}, packedBuffer, packedOffset);
			${createWriteCall(bufferVariable, "UInt32LE", `packedIndex + ${VALID_OFFSET}`, offsetVariable, fieldOffset)};
			${createWriteCall(bufferVariable, "UInt32LE", "packedSize", offsetVariable, fieldOffset + 4)};
		} else {
			${createWriteCall(bufferVariable, "UInt32LE", "0", offsetVariable, fieldOffset)};
		}
	`;
	} else if (type.enum) {
		return createWriteCall(bufferVariable, "UInt8", `${JSON.stringify(type.enum)}.indexOf(${variableToBeWritten})`, offsetVariable, fieldOffset);
	} else if (type === "Bool") {
		return createWriteCall(bufferVariable, "UInt8", `${variableToBeWritten} ? 1 : 0`, offsetVariable, fieldOffset);
	} else {
		return `${bufferVariable}.write${type}(${variableToBeWritten}, ${offsetVariable} + ${fieldOffset}, true)`;
	}
}