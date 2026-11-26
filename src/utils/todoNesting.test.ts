import { describe, expect, it } from 'vitest';
import { indentedUids, parseItemParents } from './todoNesting';

describe('parseItemParents', () => {
  it('keeps string pairs and drops junk', () => {
    expect(parseItemParents({ a: 'p', b: '', c: 3 })).toEqual({ a: 'p' });
    expect(parseItemParents(undefined)).toEqual({});
    expect(parseItemParents(['x'])).toEqual({});
  });
});

describe('indentedUids', () => {
  it('indents children only when the parent is in the same section', () => {
    const section = [{ uid: 'p' }, { uid: 'a' }, { uid: 'b' }];
    const set = indentedUids(section, { a: 'p', b: 'gone' });
    expect([...set]).toEqual(['a']);
  });
});
