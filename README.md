*This module is part of and developed for [Citybound](http://cityboundsim.com).
At some point in the future it might become generally useful!*

# shared-state

[![experimental](http://badges.github.io/stability-badges/dist/experimental.svg)](http://github.com/badges/stability-badges)

Collections of entities that
- are defined by struct-like schemas that
    - can contain simple and complex data
    - can reference each other
- can be stored compactly in binary buffers
- offer a familiar proxy-object interface to entities in a binary buffer
- can be shared between processes and persisted via memory-mapped files

## Purpose

This will be the central way to represent game state in Citybound -
both in memory and persisted in savegames.
No serialization will be needed, since the format, even for references,
is the same in both cases.

The binary buffer storage ensures maximally compact size of the total state
and makes it possible to share state between processes using primitive binary buffers,
while still offering a familiar high level, object-like interface for the code which uses share-state.

## Usage examples

Using a simple entity stored in a buffer:
```javascript
// Create a simple proxy entity class
import {BinaryProxy} from 'shared-state'

const struct = {
    type: 'Struct',
    entries: [
        ['number', 'UInt8'],
        ['flag', 'Bool'],
        ['color', {
            type: 'Enum',
            options: ['red', 'green', 'blue']
        }]
    ]
};

const SimpleEntity = BinaryProxy.fromStruct(struct);

// Create a buffer for one entity and get an instance of the proxy class as a view on the buffer.

const buffer = new Buffer(SimpleEntity.byteSize);
buffer.fill(0);

const entity = new SimpleEntity(0, buffer);

// Get default values
console.log(entity.number, entity.flag, entity.color);
// => 0, false, "red"

// Change some values
entity.number = 13;
entity.flag = true;
entity.color = "blue";

console.log(entity.number, entity.flag, entity.color);
// => 13, true, "blue"

// Create another view on the same buffer
// (for example in another process, or after reloading the game)
const entity2 = new SimpleEntity(0, buffer);

console.log(entity2.number, entity2.flag, entity2.color);
// => 13, true, "blue"
```

More advanced examples coming soon...

For more examples, also see [test.js](http://github.com/citybound/shared-state/blob/master/test.js).

## Contribution

Goals, wishes and bugs are managed as GitHub Issues - if you want to help, have a look there and submit your work as pull requests.
Your help is highly welcome! :)

## License

MIT, see [LICENSE.md](http://github.com/citybound/shared-state/blob/master/LICENSE.md) for details.
