'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { createGameCodeCache, GAME_PARAMETERS, GAME_FILENAME } =
    require('../tools/packaging/code-cache.cjs');

test('game cache compiles without executing code and is accepted in a fresh process', () => {
    const source = 'exports.answer = 42; if (!module) throw new Error("must not execute while caching");';
    const cachedData = createGameCodeCache(source);
    assert.ok(cachedData.length > 0);
    const child = `
        const { compileFunction } = require('node:vm');
        const { source, cache, parameters, filename } =
            JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
        const compiled = compileFunction(source, parameters, {
            filename, cachedData: Buffer.from(cache, 'base64'),
        });
        const module = { exports: {} };
        compiled(module.exports, require, module, '/moved/app/dist/main.js', '/moved/app/dist');
        console.log(JSON.stringify({ rejected: compiled.cachedDataRejected, answer: module.exports.answer }));
    `;
    const result = execFileSync(process.execPath, ['-e', child], {
        input: JSON.stringify({
            source, cache: cachedData.toString('base64'),
            parameters: GAME_PARAMETERS, filename: GAME_FILENAME,
        }),
        encoding: 'utf8',
        timeout: 30_000,
    });
    assert.deepEqual(JSON.parse(result), { rejected: false, answer: 42 });
});
