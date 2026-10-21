'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

const workflowPath = path.join(__dirname, '../.github/workflows/release.yml');
const targets = {
    'macos-x64': ['zip', 'dmg'],
    'macos-arm64': ['zip', 'dmg'],
    'windows-x64': ['zip', 'exe'],
    'linux-x64': ['AppImage', 'deb'],
};

/** Execute the marked JavaScript itself, without reimplementing YAML or Actions. */
async function workflowScript(name) {
    const source = (await fs.readFile(workflowPath, 'utf8')).replace(/\r\n/g, '\n');
    const start = `// BEGIN ${name}\n`;
    const end = `// END ${name}`;
    const offset = source.indexOf(start);
    assert.notEqual(offset, -1, `Missing ${name} script`);
    const endOffset = source.indexOf(end, offset);
    assert.notEqual(endOffset, -1, `Missing end of ${name} script`);
    return new AsyncFunction('require', 'process', 'context', 'github', 'core',
        source.slice(offset + start.length, endOffset));
}

/** Only the GitHub API boundary is replaced; file validation and hashes are real. */
async function releaseFixture(t, options = {}) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smk release test '));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const artifacts = path.join(directory, 'release-artifacts');
    const version = options.version || '1.2.3';
    for (const [target, extensions] of Object.entries(targets)) {
        const targetDirectory = path.join(artifacts, `super-mario-kart-${target}`);
        await fs.mkdir(targetDirectory, { recursive: true });
        for (const extension of extensions) {
            await fs.writeFile(path.join(targetDirectory,
                `SuperMarioKart-${version}-${target}.${extension}`), 'abc');
        }
    }
    const calls = [];
    const releases = options.releases || [];
    const github = {
        paginate: async () => releases,
        rest: {
            repos: {
                listReleases() {},
                async createRelease(parameters) {
                    calls.push(['create', parameters]);
                    return { data: { id: 42, draft: true, assets: [] } };
                },
                async deleteReleaseAsset(parameters) {
                    calls.push(['delete', parameters]);
                },
                async uploadReleaseAsset(parameters) {
                    calls.push(['upload', parameters]);
                    if (options.failUpload) throw new Error('upload failed');
                    return { data: { id: calls.length } };
                },
                async updateRelease(parameters) {
                    calls.push(['publish', parameters]);
                },
            },
        },
    };
    return {
        directory,
        artifacts,
        calls,
        async run(ref = 'refs/tags/v1.2.3', eventName = 'push') {
            const script = await workflowScript('publish-release');
            return script(require, { env: { RUNNER_TEMP: directory } }, {
                ref, eventName, sha: 'a'.repeat(40),
                repo: { owner: 'example', repo: 'kart' },
            }, github, { info() {} });
        },
    };
}

test('publishes all eight packages and exact SHA256SUMS only after draft uploads', async t => {
    const f = await releaseFixture(t);
    await f.run();
    assert.equal(f.calls[0][0], 'create');
    assert.equal(f.calls[0][1].draft, true);
    assert.equal(f.calls[0][1].tag_name, 'v1.2.3');
    const uploads = f.calls.filter(([kind]) => kind === 'upload').map(([, value]) => value);
    assert.equal(uploads.length, 9);
    const checksumAsset = uploads.find(asset => asset.name === 'SHA256SUMS');
    const names = uploads.filter(asset => asset.name !== 'SHA256SUMS')
        .map(asset => asset.name).sort();
    const digest = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    assert.equal(checksumAsset.data.toString(),
        names.map(name => `${digest}  ${name}\n`).join(''));
    assert.equal(f.calls.at(-1)[0], 'publish');
    assert.equal(f.calls.at(-1)[1].draft, false);
    assert.equal(f.calls.at(-1)[1].prerelease, false);
});

test('incomplete platform output cannot create a draft or publish', async t => {
    const f = await releaseFixture(t);
    await fs.rm(path.join(f.artifacts,
        'super-mario-kart-macos-arm64/SuperMarioKart-1.2.3-macos-arm64.dmg'));
    await assert.rejects(f.run(), /macos-arm64|artifact|package/i);
    assert.deepEqual(f.calls, []);
});

test('missing matrix artifact cannot create a draft or publish', async t => {
    const f = await releaseFixture(t);
    await fs.rm(path.join(f.artifacts, 'super-mario-kart-linux-x64'), { recursive: true });
    await assert.rejects(f.run(), /linux-x64|artifact|platform/i);
    assert.deepEqual(f.calls, []);
});

test('unexpected loose CI files are rejected instead of attached to a release', async t => {
    const f = await releaseFixture(t);
    await fs.writeFile(path.join(f.artifacts, 'super-mario-kart-windows-x64/opengl32.dll'), 'Mesa');
    await assert.rejects(f.run(), /artifact|package|unexpected/i);
    assert.deepEqual(f.calls, []);
});

test('duplicate asset names across platforms are rejected', async t => {
    const f = await releaseFixture(t);
    await fs.rename(path.join(f.artifacts,
        'super-mario-kart-macos-arm64/SuperMarioKart-1.2.3-macos-arm64.zip'),
    path.join(f.artifacts,
        'super-mario-kart-macos-arm64/SuperMarioKart-1.2.3-macos-x64.zip'));
    await assert.rejects(f.run(), /duplicate|artifact|target/i);
    assert.deepEqual(f.calls, []);
});

test('empty package files are rejected', async t => {
    const f = await releaseFixture(t);
    await fs.truncate(path.join(f.artifacts,
        'super-mario-kart-linux-x64/SuperMarioKart-1.2.3-linux-x64.deb'));
    await assert.rejects(f.run(), /empty|package|artifact/i);
    assert.deepEqual(f.calls, []);
});

test('branches and pull requests never call release APIs', async t => {
    const f = await releaseFixture(t);
    await assert.rejects(f.run('refs/heads/master', 'workflow_dispatch'), /tag|release/i);
    await assert.rejects(f.run('refs/tags/v1.2.3', 'pull_request'), /event|release/i);
    assert.deepEqual(f.calls, []);
});

test('manual dispatch on a version tag can publish', async t => {
    const f = await releaseFixture(t);
    await f.run('refs/tags/v1.2.3', 'workflow_dispatch');
    assert.equal(f.calls.at(-1)[0], 'publish');
});

test('failed upload never makes a partial release public', async t => {
    const f = await releaseFixture(t, { failUpload: true });
    await assert.rejects(f.run(), /upload failed/);
    assert.equal(f.calls[0][1].draft, true);
    assert.equal(f.calls.some(([kind]) => kind === 'publish'), false);
});

test('an existing published release cannot be overwritten by rerunning CI', async t => {
    const f = await releaseFixture(t, {
        releases: [{ id: 42, tag_name: 'v1.2.3', draft: false, assets: [] }],
    });
    await assert.rejects(f.run(), /already|published/i);
    assert.deepEqual(f.calls, []);
});

test('a failed draft can resume without publishing duplicate assets', async t => {
    const f = await releaseFixture(t, {
        releases: [{
            id: 42, tag_name: 'v1.2.3', draft: true,
            assets: [{ id: 91, name: 'SuperMarioKart-1.2.3-macos-x64.zip' }],
        }],
    });
    await f.run();
    assert.equal(f.calls.some(([kind]) => kind === 'create'), false);
    assert.deepEqual(f.calls[0], ['delete', { owner: 'example', repo: 'kart', asset_id: 91 }]);
    assert.equal(f.calls.filter(([kind]) => kind === 'upload').length, 9);
    assert.equal(f.calls.at(-1)[0], 'publish');
});

test('packages from a different version cannot be published under the current tag', async t => {
    const f = await releaseFixture(t, { version: '1.2.2' });
    await assert.rejects(f.run(), /version|artifact|target/i);
    assert.deepEqual(f.calls, []);
});

test('prerelease tags cannot replace the latest stable release', async t => {
    const f = await releaseFixture(t, { version: '1.2.3-rc.1' });
    await f.run('refs/tags/v1.2.3-rc.1');
    assert.equal(f.calls.at(-1)[1].prerelease, true);
    assert.equal(f.calls.at(-1)[1].make_latest, 'false');
});

test('drafts with unrelated assets are left untouched', async t => {
    const f = await releaseFixture(t, {
        releases: [{
            id: 42, tag_name: 'v1.2.3', draft: true,
            assets: [{ id: 91, name: 'unrelated.zip' }],
        }],
    });
    await assert.rejects(f.run(), /unexpected|replace/i);
    assert.deepEqual(f.calls, []);
});

test('accepts lowercase release names with platform installer and portable suffixes', async t => {
    const f = await releaseFixture(t);
    const replacements = {
        'SuperMarioKart-1.2.3-macos-x64.zip': 'super-mario-kart-1.2.3-macos-x64.zip',
        'SuperMarioKart-1.2.3-macos-x64.dmg': 'super-mario-kart-1.2.3-macos-x64.dmg',
        'SuperMarioKart-1.2.3-macos-arm64.zip': 'super-mario-kart-1.2.3-macos-arm64.zip',
        'SuperMarioKart-1.2.3-macos-arm64.dmg': 'super-mario-kart-1.2.3-macos-arm64.dmg',
        'SuperMarioKart-1.2.3-windows-x64.zip': 'super-mario-kart-1.2.3-windows-x64-portable.zip',
        'SuperMarioKart-1.2.3-windows-x64.exe': 'super-mario-kart-1.2.3-windows-x64-Setup.exe',
        'SuperMarioKart-1.2.3-linux-x64.AppImage': 'super-mario-kart-1.2.3-linux-x64.AppImage',
        'SuperMarioKart-1.2.3-linux-x64.deb': 'super-mario-kart-1.2.3-linux-x64.deb',
    };
    for (const target of Object.keys(targets)) {
        const directory = path.join(f.artifacts, `super-mario-kart-${target}`);
        for (const file of await fs.readdir(directory)) {
            if (replacements[file]) {
                await fs.rename(path.join(directory, file), path.join(directory, replacements[file]));
            }
        }
    }
    await f.run();
    assert.equal(f.calls.filter(([kind]) => kind === 'upload').length, 9);
});
