const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function ensureDir(directory, fileSystem = fs) {
    fileSystem.mkdirSync(directory, { recursive: true });
}

function readJson(file, fallback, fileSystem = fs) {
    if (!fileSystem.existsSync(file)) return fallback;
    try {
        return JSON.parse(fileSystem.readFileSync(file, 'utf8'));
    } catch (error) {
        const wrapped = new Error(`Corrupt JSON file: ${file}: ${error.message}`);
        wrapped.code = 'HEYNA_CORRUPT_JSON';
        wrapped.cause = error;
        throw wrapped;
    }
}

function atomicWriteJson(file, value, fileSystem = fs) {
    ensureDir(path.dirname(file), fileSystem);
    const temporary = path.join(
        path.dirname(file),
        `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
    );
    const payload = `${JSON.stringify(value, null, 2)}\n`;

    try {
        fileSystem.writeFileSync(temporary, payload, { encoding: 'utf8', flag: 'wx' });
        JSON.parse(fileSystem.readFileSync(temporary, 'utf8'));
        fileSystem.renameSync(temporary, file);
    } catch (error) {
        fileSystem.rmSync(temporary, { force: true });
        throw error;
    }
}

module.exports = { ensureDir, readJson, atomicWriteJson };
