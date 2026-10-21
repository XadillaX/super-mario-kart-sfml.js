const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { bootstrapSource, validateTarget } = require('../tools/packaging/common.cjs');

test('rejects unsupported binaries and unsafe versions before packaging', () => {
    assert.throws(() => validateTarget('linux', 'arm64', '1.0.0'), /Unsupported/);
    assert.throws(() => validateTarget('darwin', 'arm64', '../escape'), /version/);
    assert.doesNotThrow(() => validateTarget('darwin', 'arm64', '1.0.0'));
    assert.doesNotThrow(() => validateTarget('darwin', 'x64', '1.0.0'));
    assert.doesNotThrow(() => validateTarget('win32', 'x64', '1.0.0'));
    assert.doesNotThrow(() => validateTarget('linux', 'x64', '1.0.0'));
});

test('launcher runs embedded code once with virtual paths and no external JS file', async () => {
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
        `;
        const sandbox = {
            require(name) {
                if (name === 'node:sea') {
                    return { getAsset(key, encoding) {
                        assert.equal(key, 'game.js');
                        assert.equal(encoding, 'utf8');
                        return source;
                    } };
                }
                return require(name);
            },
            console,
            process: {
                execPath: path.join(root, 'relocated game', 'SuperMarioKart'),
                argv: ['SuperMarioKart'],
                chdir(directory) {
                    assert.equal(directory, app);
                },
            },
        };
        await vm.runInNewContext(bootstrapSource('app'), sandbox);
        assert.deepEqual(JSON.parse(fs.readFileSync(result, 'utf8')), {
            filename: path.join(app, 'dist/main.js'),
            dirname: path.join(app, 'dist'),
            resolved: 'node:fs',
            count: 1,
        });
        assert.equal(fs.existsSync(path.join(app, 'dist')), false);
        assert.equal(sandbox.process.exitCode, undefined);
    } finally {
        delete globalThis.__smkBootstrapRuns;
        fs.rmSync(root, { recursive: true, force: true });
    }
});
