'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('release build removes dead exports, folds dynamic imports, and emits only main.js', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smk bundle test '));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const source = path.join(directory, 'source');
    const outputDirectory = path.join(directory, 'dist');
    await fs.mkdir(source);
    await fs.mkdir(outputDirectory);
    await fs.writeFile(path.join(outputDirectory, 'stale.js.map'), 'old development output');
    await fs.writeFile(path.join(source, 'values.ts'), `
        export const used = 9;
        export function unused() { return 'UNREACHABLE_RELEASE_MARKER'; }
    `);
    await fs.writeFile(path.join(source, 'lazy.ts'), 'export const multiplier = 3;');
    const entryPoint = path.join(source, 'main.ts');
    await fs.writeFile(entryPoint, `
        import { used } from './values';
        export async function result() {
            return used * (await import('./lazy.js')).multiplier;
        }
    `);

    const script = path.join(__dirname, '../tools/build-release.cjs');
    assert.ok(await fs.stat(script).catch(() => false), 'Missing release bundler');
    const { buildRelease } = require(script);
    await buildRelease({ entryPoint, outputDirectory });
    assert.deepEqual(await fs.readdir(outputDirectory), ['main.js']);
    const code = await fs.readFile(path.join(outputDirectory, 'main.js'), 'utf8');
    assert.doesNotMatch(code, /UNREACHABLE_RELEASE_MARKER/);
    await fs.rm(source, { recursive: true });
    assert.equal(await require(path.join(outputDirectory, 'main.js')).result(), 27);
});

test('directly running the real release entry starts exactly one game', async t => {
    const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'smk entry test '));
    t.after(() => fs.rm(outputDirectory, { recursive: true, force: true }));
    await require('../tools/build-release.cjs').buildRelease({ outputDirectory });
    const root = path.resolve(__dirname, '..');
    // Stop at the native window boundary, before opening windows or writing settings.
    // The real bundle, startup guards, and Game constructor still execute.
    const script = `
        const fs = require('node:fs');
        const Module = require('node:module');
        const sf = require('sfml.js');
        let windows = 0;
        const stop = new Error('stop before native window');
        Object.defineProperty(sf, 'RenderWindow', {
            value: class { constructor() { windows++; throw stop; } },
        });
        console.error = error => { if (error !== stop) throw error; };
        const entry = new Module(${JSON.stringify(path.join(root, 'dist/main.js'))});
        entry.paths = Module._nodeModulePaths(${JSON.stringify(root)});
        process.mainModule = entry;
        entry._compile(
            fs.readFileSync(${JSON.stringify(path.join(outputDirectory, 'main.js'))}, 'utf8'),
            entry.id,
        );
        setImmediate(() => {
            process.exitCode = 0;
            console.log(JSON.stringify({ windows }));
        });
    `;
    const result = execFileSync(process.execPath, ['-e', script], {
        cwd: root, encoding: 'utf8', timeout: 30_000,
    });
    assert.deepEqual(JSON.parse(result), { windows: 1 });
});
