'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

// Versions match SFML 3.1.0's FetchContent declarations. Header notices are
// extracted from that SFML tag so embedded codec versions cannot drift.
const NOTICES = {
    'FreeType.txt': 'freetype/freetype/VER-2-14-3/docs/FTL.TXT',
    'HarfBuzz.txt': 'harfbuzz/harfbuzz/14.1.0/COPYING',
    'SheenBidi.txt': 'Tehreer/SheenBidi/v3.0.0/LICENSE',
    'Ogg.txt': 'xiph/ogg/v1.3.6/COPYING',
    'Vorbis.txt': 'xiph/vorbis/v1.3.7/COPYING',
    'FLAC.txt': 'xiph/flac/1.5.0/COPYING.Xiph',
    'glad.txt': 'Dav1dde/glad/v2.0.8/LICENSE',
    'cpp-unicodelib.txt': 'yhirose/cpp-unicodelib/469224e560fb3000615fde3186e654d617667c5a/LICENSE',
};

const HEADERS = [
    'miniaudio/miniaudio.h',
    'dr_mp3/dr_mp3.h',
    'stb_image/stb_image.h',
    'stb_image/stb_image_write.h',
    'qoi/qoi.h',
    'glad/include/glad/gl.h',
];

/** Download an exact upstream source text, failing the build on missing notices. */
async function sourceText(source) {
    const response = await fetch(`https://raw.githubusercontent.com/${source}`, {
        signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
        throw new Error(`Cannot retrieve license ${source}: HTTP ${response.status}`);
    }
    return response.text();
}

/** Retain complete license comments without shipping megabytes of codec headers. */
function headerNotices(text) {
    const comments = text.match(/\/\*[\s\S]*?\*\//g) || [];
    const notices = comments.filter(comment =>
        /permission is hereby granted|redistribution and use|public domain|copyright|SPDX-License-Identifier/i.test(comment)
    );
    if (!notices.length) {
        throw new Error('No license notice found in bundled SFML header');
    }
    return notices.join('\n\n') + '\n';
}

/** Include licenses for the libraries statically linked into SFML's binaries. */
async function retainSfmlNotices(appRoot) {
    const destination = path.join(appRoot, 'licenses/SFML-dependencies');
    await fs.mkdir(destination, { recursive: true });
    for (const [name, source] of Object.entries(NOTICES)) {
        await fs.writeFile(path.join(destination, name), await sourceText(source));
    }
    for (const header of HEADERS) {
        const source = `SFML/SFML/3.1.0/extlibs/headers/${header}`;
        const text = headerNotices(await sourceText(source));
        await fs.writeFile(path.join(destination, `${path.basename(header)}.txt`), text);
    }
}

module.exports = { headerNotices, retainSfmlNotices };
