const { readdirSync } = require('fs');
const { join } = require('path');
const { spawnSync } = require('child_process');

const root = join(__dirname, '..');
const targets = [join(root, 'index.js'), join(root, 'preload.js')];

function collectJavaScriptFiles(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const fullPath = join(directory, entry.name);

        if (entry.isDirectory()) {
            collectJavaScriptFiles(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            targets.push(fullPath);
        }
    }
}

collectJavaScriptFiles(join(root, 'src'));

for (const filePath of targets) {
    const result = spawnSync(process.execPath, ['--check', filePath], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`Syntax check passed for ${targets.length} JavaScript files.`);
