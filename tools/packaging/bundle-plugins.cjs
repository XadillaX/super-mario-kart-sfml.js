'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { build } = require('esbuild');

/** Preserve native loading after all JavaScript moves into dist/main.js. */
function nativePlugin() {
    return {
        name: 'sfml-native-location',
        setup(builder) {
            builder.onLoad({ filter: /sfml\.js[/\\]dist[/\\]internal[/\\]native\.js$/ }, async args => {
                const source = await fs.readFile(args.path, 'utf8');
                const original = "const requireNative = (0, node_module_1.createRequire)(__filename);\n" +
                    "exports.native = requireNative('../../build/Release/sfml.node');";
                const normalized = source.replace(/\r\n/g, '\n');
                if (!normalized.includes(original)) {
                    throw new Error('The sfml.js native loader changed; review the release adapter');
                }
                const replacement = `
const bundleFilename = require('node:worker_threads').workerData?.smkBundleFilename || __filename;
exports.native = require(${JSON.stringify(path.join(__dirname, 'native-loader.cjs'))})
    .loadNative(bundleFilename);`;
                return {
                    contents: normalized.replace(original, replacement),
                    loader: 'js',
                    resolveDir: path.dirname(args.path),
                };
            });
        },
    };
}

/** Inline the optional SFML audio worker so no secondary JavaScript file is needed. */
function audioWorkerPlugin() {
    return {
        name: 'sfml-inline-audio-worker',
        setup(builder) {
            builder.onLoad({
                filter: /sfml\.js[/\\]dist[/\\]internal[/\\]audio-worker-session\.js$/,
            }, async args => {
                const worker = await build({
                    entryPoints: [path.join(path.dirname(args.path), 'audio-worker.js')],
                    bundle: true,
                    platform: 'node',
                    target: 'node22',
                    format: 'cjs',
                    minify: true,
                    write: false,
                    plugins: [nativePlugin()],
                });
                const source = (await fs.readFile(args.path, 'utf8')).replace(/\r\n/g, '\n');
                const original = "new node_worker_threads_1.Worker((0, node_path_1.join)(__dirname, 'audio-worker.js'), {\n" +
                    '            workerData: { token, kind, module, exportName: options.exportName,';
                if (!source.includes(original)) {
                    throw new Error('The sfml.js audio worker changed; review the release adapter');
                }
                return {
                    contents: source.replace(original,
                        `new node_worker_threads_1.Worker(${JSON.stringify(worker.outputFiles[0].text)}, {\n` +
                        '            eval: true,\n' +
                        '            workerData: { smkBundleFilename: __filename, token, kind, module, exportName: options.exportName,'),
                    loader: 'js',
                    resolveDir: path.dirname(args.path),
                };
            });
        },
    };
}

/** Bundle only game-facing SFML modules while preserving their native and worker behavior. */
function releasePlugins() {
    return [
        {
            name: 'sfml-game-entry',
            setup(builder) {
                builder.onResolve({ filter: /^sfml\.js$/ }, () => ({
                    path: path.join(__dirname, 'sfml-entry.mjs'),
                }));
            },
        },
        nativePlugin(),
        audioWorkerPlugin(),
    ];
}

module.exports = { releasePlugins };
