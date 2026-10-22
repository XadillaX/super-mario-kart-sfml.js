'use strict';

const { compileFunction } = require('node:vm');

/** CommonJS wrapper arguments shared by cache generation and SEA consumption. */
const GAME_PARAMETERS = ['exports', 'require', 'module', '__filename', '__dirname'];

/** Stable compilation origin; relocated runtime paths are passed as arguments. */
const GAME_FILENAME = 'smk-embedded-game.js';

/** Compile without running the bundle, leaving SFML initialization to game startup. */
function createGameCodeCache(source) {
    const compiled = compileFunction(source, GAME_PARAMETERS, {
        filename: GAME_FILENAME,
        produceCachedData: true,
    });
    if (!compiled.cachedDataProduced || !compiled.cachedData?.length) {
        throw new Error('V8 did not produce a game code cache');
    }
    return compiled.cachedData;
}

module.exports = { createGameCodeCache, GAME_PARAMETERS, GAME_FILENAME };
