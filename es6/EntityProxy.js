import BinaryView, {byteSize} from './BinaryViews.js';
import metaEval from 'meta-eval';

export function fromStruct (struct, name) {
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

	return proxyClass;
}

