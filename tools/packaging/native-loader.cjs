'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Module, createRequire } = require('node:module');
const { isSea } = require('node:sea');
const { nativeLayout } = require('./native-layout.cjs');

/** Load one native instance from the installed layout or the development dependency. */
function loadNative(bundleFilename) {
    const requireNative = createRequire(bundleFilename);
    const { addon } = nativeLayout(path.resolve(path.dirname(bundleFilename), '..'));
    if (!isSea() && !fs.existsSync(addon)) {
        return requireNative('../node_modules/sfml.js/build/Release/sfml.node');
    }
    if (process.platform !== 'win32') {
        return requireNative(addon);
    }
    // CommonJS treats .dll as JavaScript. dlopen loads the renamed addon directly.
    const cached = requireNative.cache[addon];
    if (cached) {
        return cached.exports;
    }
    const nativeModule = new Module(addon);
    nativeModule.filename = addon;
    process.dlopen(nativeModule, addon);
    nativeModule.loaded = true;
    requireNative.cache[addon] = nativeModule;
    return nativeModule.exports;
}

module.exports = { loadNative };
