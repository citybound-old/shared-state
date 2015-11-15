let BinaryTypes = {
	getByteSize (typeString) {
		// TODO: MAKE THIS STATIC!
		if (typeString.entity) return 4;
		if (typeString.enum) return 1;
		if (typeString.dynamicPacked) return 8;
		if (typeString.vector) return typeString.vector * BinaryTypes.getByteSize(typeString.of);
		if (typeString.staticDictionary) {
			let nKeys = typeString.staticDictionary.keys.length;
			let valueType = typeString.staticDictionary.values;
			return nKeys * BinaryTypes.getByteSize(valueType);
		}
		if (typeString === "Bool") return 1;
		if (typeString === "FloatLE" || typeString === "FloatBE") return 4;
		if (typeString === "DoubleLE" || typeString === "DoubleBE") return 8;
		else return parseInt(typeString.replace(/\D/g, ""), 10) / 8;
	}
};

export default BinaryTypes;