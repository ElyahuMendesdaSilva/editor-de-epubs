const { app } = require('electron');
const path = require('path');
const { readJSONSafe, writeJSON } = require('../utils/files');

function getRegistryPath() {
    return path.join(app.getPath('userData'), 'projects.json');
}

async function addToRegistry(projectPath) {
    const registryPath = getRegistryPath();
    const registry = readJSONSafe(registryPath, []);

    if (!registry.includes(projectPath)) {
        registry.push(projectPath);
        await writeJSON(registryPath, registry);
    }
}

module.exports = { addToRegistry, getRegistryPath };

