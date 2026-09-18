import test from 'node:test';
import assert from 'node:assert/strict';
import { cases, compare } from '../scripts/parser-parity.js';

const reference = cases.map(([flag, files]) => ({ name: `${flag} ${files.join(' ')}`, status: 0, stdout: 'gauge=25%\n', stderr: '' }));
test('parity gate accepts identical fixture output', () => {
  assert.doesNotThrow(() => compare(reference, structuredClone(reference)));
});
for (const field of ['name', 'status', 'stdout', 'stderr']) {
  test(`parity gate rejects divergent ${field}`, () => {
    const actual = structuredClone(reference);
    actual[0][field] = field === 'status' ? 1 : 'different';
    assert.throws(() => compare(reference, actual), /Parser parity failed/);
  });
}
test('parity gate rejects missing fixture results', () => {
  assert.throws(() => compare(reference.slice(1), reference), /every fixture/);
  assert.throws(() => compare(reference, reference.slice(1)), /every fixture/);
});
