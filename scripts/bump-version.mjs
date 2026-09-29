import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = path.join(root, 'package.json');
const packageLockPath = path.join(root, 'package-lock.json');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseVersion(version, source) {
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error(`${source} version must use semantic version format x.y.z`);
    }
    return version.split('.').map(Number);
}

function nextPatchVersion(version) {
    const [major, minor, patch] = parseVersion(version, 'package');
    if (patch >= Number.MAX_SAFE_INTEGER) {
        throw new Error(`Cannot increment patch version ${version}`);
    }
    return `${major}.${minor}.${patch + 1}`;
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const packageJson = readJson(packageJsonPath);
const packageLock = readJson(packageLockPath);
const currentVersion = packageJson.version;
parseVersion(currentVersion, 'package.json');

if (packageLock.version !== currentVersion || packageLock.packages?.['']?.version !== currentVersion) {
    throw new Error(
        `Version mismatch before packaging: package.json=${currentVersion}, `
        + `package-lock.json=${packageLock.version}, package-lock root=${packageLock.packages?.['']?.version}`
    );
}

const nextVersion = nextPatchVersion(currentVersion);
packageJson.version = nextVersion;
packageLock.version = nextVersion;
packageLock.packages[''].version = nextVersion;

writeJson(packageJsonPath, packageJson);
writeJson(packageLockPath, packageLock);
console.log(`[version:fpk] ${currentVersion} -> ${nextVersion}`);
