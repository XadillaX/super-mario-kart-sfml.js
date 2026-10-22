'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const common = require('../tools/packaging/common.cjs');

for (const [platform, addon, library] of [
    ['win32', 'sfmljs.dll', null],
    ['darwin', '../Frameworks/sfmljs.node', '../Frameworks/libsfml-system.3.1.dylib'],
    ['linux', 'native/build/Release/sfml.node', 'native/third_party/sfml/lib/libsfml-system.so.3.1'],
]) {
    test(`${platform} places native files in the runtime layout without copying JavaScript`, async t => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smk native layout '));
        t.after(() => fs.rm(directory, { recursive: true, force: true }));
        const source = path.join(directory, 'node_modules/sfml.js');
        const app = path.join(directory, 'Contents/Resources');
        await fs.mkdir(path.join(source, 'build/Release'), { recursive: true });
        await fs.writeFile(path.join(source, 'build/Release/sfml.node'), 'native binding');
        await fs.writeFile(path.join(source, 'build/Release/unrelated.js'), 'do not ship');
        if (library) {
            const libraries = path.join(source, 'third_party/sfml/lib');
            await fs.mkdir(libraries, { recursive: true });
            await fs.writeFile(path.join(libraries, path.basename(library)), 'SFML library');
            await fs.writeFile(path.join(libraries, 'libsfml-network.so.3.1'), 'unused');
            if (platform === 'darwin') {
                await fs.symlink('libsfml-system.3.1.dylib', path.join(libraries, 'libsfml-system.dylib'));
            }
        }

        assert.equal(typeof common.prepareNative, 'function', 'Native layout assembler is missing');
        await common.prepareNative(directory, app, platform);
        assert.equal(await fs.readFile(path.resolve(app, addon), 'utf8'), 'native binding');
        if (library) {
            assert.equal(await fs.readFile(path.resolve(app, library), 'utf8'), 'SFML library');
        }
        if (platform === 'darwin') {
            assert.equal(await fs.readlink(path.resolve(app, '../Frameworks/libsfml-system.dylib')),
                'libsfml-system.3.1.dylib');
        }
        const files = await fs.readdir(path.join(directory, 'Contents'), { recursive: true });
        assert.equal(files.some(file => /unrelated|network|\.js$/.test(file)), false);
        if (platform !== 'linux') {
            assert.equal(files.some(file => /(?:^|[/\\])(?:native|app)(?:[/\\]|$)/.test(file)), false);
        }
    });
}

test('Windows loads the renamed binding once and does not cache failed native loads', {
    skip: process.platform !== 'win32',
}, async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smk renamed addon '));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const native = path.resolve(__dirname, '../node_modules/sfml.js');
    const addon = path.join(directory, 'sfmljs.dll');
    const bundleFilename = path.join(directory, 'dist/main.js');
    await fs.writeFile(addon, 'not a DLL');
    for (const component of ['graphics', 'audio', 'window', 'system']) {
        const name = `sfml-${component}-3.dll`;
        await fs.copyFile(path.join(native, 'third_party/sfml/bin', name), path.join(directory, name));
    }
    // A child exits before cleanup so Windows releases its mapped DLL file handles.
    const { execFileSync } = require('node:child_process');
    execFileSync(process.execPath, ['-e', `
        const assert = require('node:assert/strict');
        const { loadNative } = require(${JSON.stringify(require.resolve('../tools/packaging/native-loader.cjs'))});
        const filename = ${JSON.stringify(bundleFilename)};
        assert.throws(() => loadNative(filename));
        require('node:fs').copyFileSync(
            ${JSON.stringify(path.join(native, 'build/Release/sfml.node'))},
            ${JSON.stringify(addon)}
        );
        const binding = loadNative(filename);
        assert.equal(typeof binding.createRenderWindow, 'function');
        assert.equal(loadNative(filename), binding);
    `], { timeout: 30_000, stdio: 'pipe' });
});
