/** Link suggestions: shared identifiers between unconnected nodes, explained by the token. */

import { describe, expect, it } from 'vitest';

import { makeEdge } from '../src/entities/edge.ts';
import { makeNode } from '../src/entities/node.ts';
import { suggestLinks } from '../src/edges/suggestLinks.ts';
import { T0 } from './doc-fixtures.ts';

const node = (id: string, title: string, tags: string[] = [], data = {}) =>
  makeNode({ id, x: 0, y: 0, title, tags, data }, T0);

describe('suggestLinks', () => {
  it('pairs nodes that share a domain and names the evidence', () => {
    const suggestions = suggestLinks(
      [
        node('n1', 'Contact page', [], { url: 'https://acme-corp.io/about' }),
        node('n2', 'Leaked invoice mentions acme-corp.io'),
        node('n3', 'Unrelated note'),
      ],
      [],
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      sourceId: 'n1',
      targetId: 'n2',
      evidence: ['acme-corp.io'],
    });
  });

  it('ranks a pair with more shared identifiers first', () => {
    const suggestions = suggestLinks(
      [
        node('n1', 'Profile @nightowl', ['case-7'], { email: 'sam@acme-corp.io' }),
        node('n2', 'Forum post by @nightowl', ['case-7']),
        node('n3', 'Mirror of acme-corp.io', ['case-7']),
      ],
      [],
    );
    expect(suggestions.map((s) => [s.sourceId, s.targetId])).toEqual([
      ['n1', 'n2'],
      ['n1', 'n3'],
      ['n2', 'n3'],
    ]);
    expect(suggestions[0]?.evidence).toEqual(['@nightowl', 'tag:case-7']);
  });

  it('counts an email once instead of also suggesting its bare domain', () => {
    const [suggestion] = suggestLinks(
      [node('n1', 'sam@acme-corp.io'), node('n2', 'reply from sam@acme-corp.io')],
      [],
    );
    expect(suggestion?.evidence).toEqual(['sam@acme-corp.io']);
  });

  it('never suggests a pair that is already connected, in either direction', () => {
    const nodes = [node('n1', 'acme-corp.io'), node('n2', 'acme-corp.io mirror')];
    const edge = makeEdge({ id: 'e1', from: 'n2', to: 'n1' }, T0);
    expect(suggestLinks(nodes, [edge])).toEqual([]);
  });

  it('ignores archived nodes and tokens shared by a crowd', () => {
    const crowd = Array.from({ length: 8 }, (_, i) => node(`c${String(i)}`, 'seen on shared.io'));
    expect(suggestLinks(crowd, [])).toEqual([]);
    const archived = { ...node('n2', 'acme-corp.io'), status: 'archived' as const };
    expect(suggestLinks([node('n1', 'acme-corp.io'), archived], [])).toEqual([]);
  });
});
