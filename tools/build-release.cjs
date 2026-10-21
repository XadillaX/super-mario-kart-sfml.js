'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { isBuiltin } = require('node:module');
const { build } = require('esbuild');
const { releasePlugins } = require('./packaging/bundle-plugins.cjs');

const root = path.resolve(__dirname, '..');

/** Bundle and minify the game and its diagnostic entry into one tree-shaken file. */
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
        treeShaking: true,
        splitting: false,
        sourcemap: false,
        minify: true,
        legalComments: 'inline',
        write: false,
        metafile: true,
        plugins: releasePlugins(),
    });
    if (result.outputFiles.length !== 1) {
        throw new Error('Release must contain exactly one JavaScript file');
    }
    for (const output of Object.values(result.metafile.outputs)) {
        for (const dependency of output.imports) {
            if (dependency.external && !isBuiltin(dependency.path)) {
                throw new Error(`Unbundled JavaScript dependency: ${dependency.path}`);
            }
        }
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
