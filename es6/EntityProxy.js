import BinaryView, {byteSize} from './BinaryViews.js';
import metaEval from 'meta-eval';

export function fromStruct (struct, name, additionalPrototypeProperties) {
	name = name || "Unnamed" + Math.floor(Math.random() * 10000);

	const view = BinaryView(struct);
	const code = 'exports.theClass = ' + view.defines(name).join('\n');
	console.log(code);

	const {exports: {theClass: proxyClass}} = metaEval(
		code,
		{exports: {}},
		`${name}Proxy`,
		`SharedState/EntityProxies/${name}`,
		"shared-state://entityProxies/",
		{transpile: true}
	);

	if (additionalPrototypeProperties) {
		Object.defineProperties(proxyClass.prototype, Object.keys(additionalPrototypeProperties).reduce((descriptors, key) => {
			descriptors[key] = Object.getOwnPropertyDescriptor(additionalPrototypeProperties, key);
			return descriptors;
		}, {}));
	}

	return proxyClass;
}

