const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { bootstrapSource, validateTarget } = require('../tools/packaging/common.cjs');
const { createGameCodeCache } = require('../tools/packaging/code-cache.cjs');

test('rejects unsupported binaries and unsafe versions before packaging', () => {
    assert.throws(() => validateTarget('linux', 'arm64', '1.0.0'), /Unsupported/);
    assert.throws(() => validateTarget('darwin', 'arm64', '../escape'), /version/);
    assert.doesNotThrow(() => validateTarget('darwin', 'arm64', '1.0.0'));
    assert.doesNotThrow(() => validateTarget('darwin', 'x64', '1.0.0'));
    assert.doesNotThrow(() => validateTarget('win32', 'x64', '1.0.0'));
    assert.doesNotThrow(() => validateTarget('linux', 'x64', '1.0.0'));
});

/** Exercise the actual bootstrap and cache in a fresh V8 process. */
async function verifyLauncher(rejected, smoke = false) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smk launcher '));
    try {
        const app = path.join(root, 'relocated game', 'app');
        fs.mkdirSync(app, { recursive: true });
        const result = path.join(app, 'result.json');
        const source = `
            if (require.main === module) throw new Error('duplicate direct startup');
            exports.main = async () => {
                require('node:fs').writeFileSync(${JSON.stringify(result)}, JSON.stringify({
                    filename: __filename,
                    dirname: __dirname,
                    resolved: require.resolve('node:fs'),
                    count: (globalThis.__smkBootstrapRuns || 0) + 1,
                }));
                globalThis.__smkBootstrapRuns = (globalThis.__smkBootstrapRuns || 0) + 1;
            };
            exports.smokeTest = exports.main;
        `;
        const cache = rejected ? Buffer.from('invalid V8 cache') : createGameCodeCache(source);
        // A fresh process prevents V8's in-memory compilation cache from masking rejection.
        const child = `
            const assert = require('node:assert/strict');
            const vm = require('node:vm');
            const input = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
            let rejected;
            const messages = [];
            const sandbox = {
                Buffer,
                console: {
                    log(...args) { messages.push(args.join(' ')); },
                    error(error) { messages.push(error.message); },
                },
                require(name) {
                    if (name === 'node:sea') return {
                        getAsset(key, encoding) {
                            assert.equal(key, 'game.js');
                            assert.equal(encoding, 'utf8');
                            return input.source;
                        },
                        getRawAsset(key) {
                            assert.equal(key, 'game.cachedData');
                            return Uint8Array.from(Buffer.from(input.cache, 'base64')).buffer;
                        },
                    };
                    if (name === 'node:vm') return {
                        compileFunction(...args) {
                            const result = vm.compileFunction(...args);
                            rejected = result.cachedDataRejected;
                            return result;
                        },
                    };
                    return require(name);
                },
                process: {
                    execPath: input.executable,
                    argv: input.smoke ? ['SuperMarioKart', '--smoke-test'] : ['SuperMarioKart'],
                    chdir(directory) { assert.equal(directory, input.app); },
                },
            };
            vm.runInNewContext(input.bootstrap, sandbox).then(() => {
                console.log(JSON.stringify({
                    rejected, exitCode: sandbox.process.exitCode || 0, messages,
                }));
            }).catch(error => { console.error(error); process.exitCode = 1; });
        `;
        const output = execFileSync(process.execPath, ['-e', child], {
            input: JSON.stringify({
                source, smoke, cache: cache.toString('base64'), bootstrap: bootstrapSource('app'),
                executable: path.join(root, 'relocated game', 'SuperMarioKart'), app,
            }),
            encoding: 'utf8',
            timeout: 30_000,
        });
        const report = JSON.parse(output);
        assert.equal(report.rejected, rejected);
        if (smoke && rejected) {
            assert.equal(report.exitCode, 1);
            assert.match(report.messages.join('\n'), /V8 rejected/);
            assert.equal(fs.existsSync(result), false, 'smoke failure must precede game execution');
            return;
        }
        assert.equal(report.exitCode, 0);
        if (smoke) {
            assert.match(report.messages.join('\n'), /"accepted":true/);
        }
        assert.deepEqual(JSON.parse(fs.readFileSync(result, 'utf8')), {
            filename: path.join(app, 'dist/main.js'),
            dirname: path.join(app, 'dist'),
            resolved: 'node:fs',
            count: 1,
        });
        assert.equal(fs.existsSync(path.join(app, 'dist')), false);
    } finally {
        delete globalThis.__smkBootstrapRuns;
        fs.rmSync(root, { recursive: true, force: true });
    }
}

for (const rejected of [false, true]) {
    test(`launcher runs embedded code once after cache ${rejected ? 'rejection' : 'acceptance'}`,
        () => verifyLauncher(rejected));
    test(`packaged smoke ${rejected ? 'fails on rejected' : 'requires accepted'} code cache`,
        () => verifyLauncher(rejected, true));
}
