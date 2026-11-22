'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function getRawFs() {
  if (typeof process !== 'undefined' && process.versions && process.versions.electron) {
    try {
      return require('original-fs');
    } catch {}
  }
  return fs;
}

function readHeader(archivePath) {
  const rawFs = getRawFs();
  const fd = rawFs.openSync(archivePath, 'r');
  try {
    const pre = Buffer.alloc(16);
    const bytesRead = rawFs.readSync(fd, pre, 0, 16, 0);
    if (bytesRead < 16) {
      throw new Error(`Invalid ASAR archive (truncated header): ${archivePath}`);
    }
    const jsonSize = pre.readUInt32LE(12);
    if (jsonSize <= 0 || jsonSize > 128 * 1024 * 1024) {
      throw new Error(`Invalid ASAR header size (${jsonSize}): ${archivePath}`);
    }
    const padding = (4 - (jsonSize % 4)) % 4;
    const jsonBuf = Buffer.alloc(jsonSize);
    rawFs.readSync(fd, jsonBuf, 0, jsonSize, 16);
    const header = JSON.parse(jsonBuf.toString('utf8'));
    return { header, baseOffset: 16 + jsonSize + padding };
  } finally {
    rawFs.closeSync(fd);
  }
}

function getNode(header, relPath) {
  const parts = String(relPath).replace(/^[\\/]+/, '').split(/[\\/]+/).filter(Boolean);
  let cur = header;
  for (const part of parts) {
    if (!cur || !cur.files || !Object.prototype.hasOwnProperty.call(cur.files, part)) {
      throw new Error(`File not found in ASAR: ${relPath}`);
    }
    cur = cur.files[part];
  }
  return cur;
}

function extractFile(archivePath, relPath) {
  const rawFs = getRawFs();
  const { header, baseOffset } = readHeader(archivePath);
  const node = getNode(header, relPath);
  if (node.unpacked) {
    const unpackedSrc = path.join(archivePath + '.unpacked', relPath);
    if (rawFs.existsSync(unpackedSrc)) {
      return rawFs.readFileSync(unpackedSrc);
    }
    return Buffer.alloc(node.size || 0);
  }
  const buf = Buffer.alloc(node.size);
  const fd = rawFs.openSync(archivePath, 'r');
  try {
    rawFs.readSync(fd, buf, 0, node.size, baseOffset + Number(node.offset));
    return buf;
  } finally {
    rawFs.closeSync(fd);
  }
}

function statFile(archivePath, relPath) {
  const { header } = readHeader(archivePath);
  return getNode(header, relPath);
}

function listPackage(archivePath) {
  const { header } = readHeader(archivePath);
  const list = [];
  function walk(tree, prefix) {
    for (const [name, info] of Object.entries(tree.files || {})) {
      const cur = prefix + '/' + name;
      list.push(cur);
      if (info.files) walk(info, cur);
    }
  }
  walk(header, '');
  return list;
}

function collectUnpackedPaths(archivePath) {
  const { header } = readHeader(archivePath);
  const unpacked = new Set();
  function walk(tree, prefix) {
    for (const [name, info] of Object.entries(tree.files || {})) {
      const relPosix = prefix ? `${prefix}/${name}` : name;
      if (info.unpacked) unpacked.add(relPosix);
      if (info.files) walk(info, relPosix);
    }
  }
  walk(header, '');
  return unpacked;
}

function extractAll(archivePath, destDir) {
  const rawFs = getRawFs();
  const { header, baseOffset } = readHeader(archivePath);
  const fd = rawFs.openSync(archivePath, 'r');
  try {
    function walk(tree, currentDir, relDir) {
      fs.mkdirSync(currentDir, { recursive: true });
      for (const [name, info] of Object.entries(tree.files || {})) {
        const targetPath = path.join(currentDir, name);
        const relPath = relDir ? path.join(relDir, name) : name;
        if (info.files) {
          walk(info, targetPath, relPath);
        } else if (info.unpacked) {
          const unpackedSrc = path.join(archivePath + '.unpacked', relPath);
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          if (rawFs.existsSync(unpackedSrc)) {
            rawFs.copyFileSync(unpackedSrc, targetPath);
          } else {
            fs.writeFileSync(targetPath, Buffer.alloc(0));
          }
        } else {
          const buf = Buffer.alloc(info.size);
          rawFs.readSync(fd, buf, 0, info.size, baseOffset + Number(info.offset));
          fs.writeFileSync(targetPath, buf);
        }
      }
    }
    walk(header, destDir, '');
  } finally {
    rawFs.closeSync(fd);
  }
}

async function createPackageWithOptions(srcDir, destAsar, options = {}) {
  const rawFs = getRawFs();
  let offset = 0;
  const chunks = [];
  const unpackedSet = options.unpackedPaths instanceof Set ? options.unpackedPaths : null;
  const unpackMatcher = unpackedSet
    ? (relPosix => unpackedSet.has(relPosix))
    : (typeof options.unpackMatcher === 'function' ? options.unpackMatcher : () => false);

  function build(currentDir, relPosix) {
    const files = {};
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const childPosix = relPosix ? `${relPosix}/${entry.name}` : entry.name;
      const isUnpacked = unpackMatcher(childPosix);
      if (entry.isDirectory()) {
        const node = { files: build(fullPath, childPosix) };
        if (isUnpacked) node.unpacked = true;
        files[entry.name] = node;
      } else if (entry.isFile()) {
        const buf = fs.readFileSync(fullPath);
        const hash = crypto.createHash('sha256').update(buf).digest('hex');
        const blockHashes = [];
        const blockSize = 4 * 1024 * 1024;
        for (let i = 0; i < buf.length; i += blockSize) {
          blockHashes.push(crypto.createHash('sha256').update(buf.subarray(i, i + blockSize)).digest('hex'));
        }
        if (blockHashes.length === 0) {
          blockHashes.push(crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex'));
        }
        const integrity = { algorithm: 'SHA256', hash, blockSize, blocks: blockHashes };
        if (isUnpacked) {
          if (options.writeUnpacked !== false) {
            const unpackedTarget = path.join(destAsar + '.unpacked', childPosix);
            fs.mkdirSync(path.dirname(unpackedTarget), { recursive: true });
            fs.copyFileSync(fullPath, unpackedTarget);
          }
          files[entry.name] = { size: buf.length, unpacked: true, integrity };
        } else {
          files[entry.name] = { size: buf.length, offset: String(offset), integrity };
          offset += buf.length;
          chunks.push(buf);
        }
      }
    }
    return files;
  }

  const headerObj = { files: build(srcDir, '') };
  const jsonBuf = Buffer.from(JSON.stringify(headerObj), 'utf8');
  const jsonSize = jsonBuf.length;
  const padding = (4 - (jsonSize % 4)) % 4;
  const alignedSize = jsonSize + padding;
  const headerBuf = Buffer.alloc(16 + alignedSize);
  headerBuf.writeUInt32LE(4, 0);
  headerBuf.writeUInt32LE(8 + alignedSize, 4);
  headerBuf.writeUInt32LE(4 + alignedSize, 8);
  headerBuf.writeUInt32LE(jsonSize, 12);
  jsonBuf.copy(headerBuf, 16);

  const fd = rawFs.openSync(destAsar, 'w');
  try {
    rawFs.writeSync(fd, headerBuf);
    for (const chunk of chunks) {
      rawFs.writeSync(fd, chunk);
    }
  } finally {
    rawFs.closeSync(fd);
  }
}

async function createPackage(srcDir, destAsar) {
  return createPackageWithOptions(srcDir, destAsar, {});
}

module.exports = {
  readHeader,
  extractFile,
  statFile,
  listPackage,
  collectUnpackedPaths,
  extractAll,
  createPackage,
  createPackageWithOptions
};
