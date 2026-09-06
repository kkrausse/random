// Guest-only qualification of the pinned official registry (no model invocation).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Effect, Exit, Cause } from 'effect';
import { LayerNode } from '@opencode-ai/util/effect/layer-node';
import { AppNodeBuilder } from '@opencode-ai/core/effect/app-node-builder';
import { Instance } from '@opencode-ai/core/instance';
import { Location } from '@opencode-ai/core/location';
import { Config } from '@opencode-ai/core/config';
import { InstructionDiscovery } from '@opencode-ai/core/instruction-discovery';
import { Database } from '@opencode-ai/core/database/database';
import { sqliteLayer } from '@opencode-ai/core/database/sqlite.node';
import { Session } from '@opencode-ai/core/session';
import { SessionMessage } from '@opencode-ai/core/session/message';
import { Plugin } from '@opencode-ai/core/plugin';
import { Agent } from '@opencode-ai/core/agent';
import { Tool } from '@opencode-ai/core/tool';

export async function qualifyTools(directory) {
  assert(path.isAbsolute(directory), 'qualification directory must be absolute');
  fs.mkdirSync(directory, { recursive: true });
  // Fixture setup alone uses fs; all observations and the repair use official tools.
  fs.writeFileSync(path.join(directory, 'sum.cjs'), 'module.exports = (a, b) => a - b;\n');
  fs.writeFileSync(path.join(directory, 'sum.test.cjs'), "require('node:assert/strict').equal(require('./sum.cjs')(2,3),5);console.log('fixture test passed');\n");
  const location = Location.Ref.make({ directory });
  const layer = AppNodeBuilder.build(LayerNode.group([Instance.graph, Session.node]), [
      Location.node.replace(Location.boundNode(location, { discovery: false })),
      Config.node.replace(Config.configured({
        project: false,
        global: false,
      })),
      InstructionDiscovery.node.replace(InstructionDiscovery.configured({ project: false, global: false })),
      Database.node.replace(Database.configuredClient(sqliteLayer({ filename: ':memory:' }))),
    ]);
  console.log('checkpoint: registry graph starting', directory);
  return Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    yield* Plugin.awaitActivation;
    console.log('checkpoint: registry plugins activated');
    const agents = yield* Agent.Service;
    const selection = yield* agents.select();
    assert(selection.info, 'official default agent missing');
    const agent = selection.id;
    // These are real permission rules consumed by Permission.assert inside each tool.
    // Deny all other operations so a permission mismatch fails instead of hanging.
    const rules = [
      { action: '*', resource: '*', effect: 'deny' },
      { action: 'read', resource: 'sum.cjs', effect: 'allow' },
      { action: 'edit', resource: 'sum.cjs', effect: 'allow' },
      { action: 'shell', resource: 'node sum.test.cjs', effect: 'allow' },
      { action: 'glob', resource: '*.cjs', effect: 'allow' },
      { action: 'glob', resource: 'missing-qualification-*.cjs', effect: 'allow' },
      { action: 'grep', resource: 'a + b', effect: 'allow' },
      { action: 'grep', resource: 'absent_qualification_marker', effect: 'allow' },
      { action: 'grep', resource: '[', effect: 'allow' },
    ];
    yield* agents.transform(editor => editor.update(agent, info => { info.permissions = rules; }));
    const sessions = yield* Session.Service;
    const session = yield* sessions.create({ location, agent, title: 'Browser official tool qualification' });
    assert.equal((yield* sessions.get(session.id)).id, session.id);
    console.log('checkpoint: registry real session', session.id);
    const tools = yield* Tool.Service;
    // Use the pinned registry's original direct-tool presentation and handlers.
    const snapshot = yield* tools.snapshot(rules);
    const definitions = new Map(snapshot.definitions.map(definition => [definition.name, definition]));
    for (const name of ['read', 'edit', 'shell', 'glob', 'grep']) assert(definitions.has(name), `missing definition: ${name}`);
    console.log('checkpoint: registry definitions', [...definitions.keys()].join(','));
    let calls = 0;
    const messageID = SessionMessage.ID.create();
    const invoke = (name, input) => snapshot.execute({
      sessionID: session.id, agent, messageID, definitions,
      call: { id: `qualification-${++calls}`, name, input },
    });
    const text = result => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
    const original = yield* invoke('read', { path: 'sum.cjs' });
    assert(text(original).includes('a - b'), 'read must see the broken original');
    console.log('checkpoint: registry read original passed');
    const before = yield* invoke('shell', { command: 'node sum.test.cjs', workdir: directory, timeout: 30000 });
    assert.equal(typeof before.output?.exit, 'number');
    assert.notEqual(before.output.exit, 0, 'broken fixture must fail');
    assert.match(before.output.output, /AssertionError|ERR_ASSERTION/, 'failure must be the fixture assertion');
    console.log('checkpoint: registry shell before edit failed as expected', before.output.exit);
    const edited = yield* invoke('edit', { path: 'sum.cjs', oldString: 'a - b', newString: 'a + b' });
    assert.equal(edited.output?.replacements, 1);
    const repaired = yield* invoke('read', { path: 'sum.cjs' });
    assert(text(repaired).includes('a + b'));
    assert(!text(repaired).includes('a - b'));
    console.log('checkpoint: registry edit and readback passed');
    const after = yield* invoke('shell', { command: 'node sum.test.cjs', workdir: directory, timeout: 30000 });
    assert.equal(after.output?.exit, 0);
    assert(after.output.output.includes('fixture test passed'));
    console.log('checkpoint: registry shell after edit passed');
    const found = yield* invoke('glob', { pattern: '*.cjs' });
    assert.deepEqual(found.output.map(entry => entry.path).sort(), ['sum.cjs', 'sum.test.cjs']);
    const absentFiles = yield* invoke('glob', { pattern: 'missing-qualification-*.cjs' });
    assert.deepEqual(absentFiles.output, []);
    console.log('checkpoint: registry glob positive and negative passed');
    const matches = yield* invoke('grep', { pattern: 'a + b', literal: true, include: 'sum.cjs' });
    assert.equal(matches.output.length, 1);
    assert.equal(matches.output[0].entry.path, 'sum.cjs');
    assert.equal(matches.output[0].line, 1);
    assert(matches.output[0].text.includes('a + b'));
    const absentMatches = yield* invoke('grep', { pattern: 'absent_qualification_marker', include: '*.cjs' });
    assert.deepEqual(absentMatches.output, []);
    console.log('checkpoint: registry grep positive and negative passed');
    const invalid = yield* Effect.exit(invoke('grep', { pattern: '[', include: '*.cjs' }));
    assert(Exit.isFailure(invalid), 'invalid regex must fail');
    const invalidMessage = Cause.pretty(invalid.cause);
    assert.match(invalidMessage, /Invalid regex pattern/i);
    console.log('checkpoint: registry grep invalid regex passed', invalidMessage);
    console.log('checkpoint: registry tools passed', JSON.stringify({ sessionID: session.id, calls }));
    return { sessionID: session.id, calls, tools: ['read', 'edit', 'shell', 'glob', 'grep'] };
  }).pipe(Effect.provide(layer))));
}
