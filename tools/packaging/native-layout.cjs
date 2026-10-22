'use strict';

const path = require('node:path');

/** Share the installed native paths between the packager and embedded loader. */
function nativeLayout(appRoot, platform = process.platform) {
    if (platform === 'win32') {
        return { addon: path.join(appRoot, 'sfmljs.dll'), libraries: appRoot };
    }
    if (platform === 'darwin') {
        const libraries = path.resolve(appRoot, '../Frameworks');
        return { addon: path.join(libraries, 'sfmljs.node'), libraries };
    }
    return {
        addon: path.join(appRoot, 'native/build/Release/sfml.node'),
        libraries: path.join(appRoot, 'native/third_party/sfml/lib'),
    };
}

module.exports = { nativeLayout };
