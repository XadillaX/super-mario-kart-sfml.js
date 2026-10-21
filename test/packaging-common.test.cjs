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

test('launcher resolves its payload beside the relocated executable, not cwd', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smk launcher '));
    try {
        const app = path.join(root, 'relocated game', 'app');
        fs.mkdirSync(path.join(app, 'dist'), { recursive: true });
        fs.writeFileSync(path.join(app, 'dist/main.js'),
            'exports.main = async () => { globalThis.__smkBootstrapRan = true; };\n');
        const sandbox = {
            require,
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
        assert.equal(globalThis.__smkBootstrapRan, true);
        assert.equal(sandbox.process.exitCode, undefined);
    } finally {
        delete globalThis.__smkBootstrapRan;
        fs.rmSync(root, { recursive: true, force: true });
    }
});
