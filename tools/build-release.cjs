'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { build } = require('esbuild');

const root = path.resolve(__dirname, '..');

/** Bundle the game and its diagnostic entry into one readable, tree-shaken file. */
async function buildRelease({
    entryPoint = path.join(__dirname, 'packaging/release-entry.mjs'),
    outputDirectory = path.join(root, 'dist'),
} = {}) {
    const result = await build({
        absWorkingDir: root,
        entryPoints: [entryPoint],
        outfile: path.join(outputDirectory, 'main.js'),
        bundle: true,
        platform: 'node',
        target: 'node22',
        format: 'cjs',
        packages: 'external',
        treeShaking: true,
        splitting: false,
        sourcemap: false,
        minify: false,
        legalComments: 'inline',
        write: false,
        metafile: true,
    });
    if (result.outputFiles.length !== 1) {
        throw new Error('Release must contain exactly one JavaScript file');
    }
    // Keep the previous build intact on compilation failure, then remove stale tsc output.
    await fs.rm(outputDirectory, { recursive: true, force: true });
    await fs.mkdir(outputDirectory, { recursive: true });
    const output = result.outputFiles[0];
    await fs.writeFile(output.path, output.contents);
    console.log(`Release bundle: ${output.path} (${(output.contents.length / 1024).toFixed(1)} KiB)`);
    return result.metafile;
}

if (require.main === module) {
    buildRelease().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = { buildRelease };
