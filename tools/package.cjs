'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseArgs } = require('node:util');
const common = require('./packaging/common.cjs');

/** Package the current architecture using the same Node ABI used by npm ci. */
async function main() {
    const root = path.resolve(__dirname, '..');
    const metadata = require(path.join(root, 'package.json'));
    common.validateTarget(process.platform, process.arch, metadata.version);
    if (process.version !== 'v22.22.2') {
        throw new Error('Release packaging requires Node.js 22.22.2; run npm ci with that version first.');
    }
    const { values } = parseArgs({
        options: { out: { type: 'string', default: 'release' } },
        strict: true,
    });
    const output = path.resolve(root, values.out);
    await fs.access(path.join(root, 'dist/main.js'));
    await fs.access(path.join(root, 'node_modules/sfml.js/build/Release/sfml.node'));
    await fs.mkdir(output, { recursive: true });
    const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'smk package '));
    try {
        const platform = { darwin: 'macos', win32: 'windows', linux: 'linux' }[process.platform];
        const { packagePlatform } = require(`./packaging/${platform}.cjs`);
        const artifacts = await packagePlatform({
            root,
            staging,
            output,
            version: metadata.version,
            arch: process.arch,
            productName: 'Super Mario Kart',
            prepareApp: appRoot => common.prepareApp(root, appRoot),
            createExecutable: (executable, appPath) => common.createExecutable(
                root, staging, executable, appPath, metadata.version
            ),
            smoke: common.smoke,
            run: common.run,
        });
        for (const artifact of artifacts) {
            const stat = await fs.stat(artifact);
            console.log(`Artifact: ${artifact} (${(stat.size / 1024 / 1024).toFixed(1)} MiB)`);
        }
    } finally {
        await fs.rm(staging, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
