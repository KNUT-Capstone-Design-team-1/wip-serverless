const ENCODINGS = ["br", "gzip", "deflate", "identity"];

function validateManifest(manifest) {
  // O(number of file descriptors), not O(resource rows). Called once per loaded snapshot.
  if (manifest?.format !== 1 || !manifest.tables || typeof manifest.tables !== "object" ||
      Array.isArray(manifest.tables)) throw new Error("Invalid resource manifest");
  for (const [table, entry] of Object.entries(manifest.tables)) {
    if (!/^[a-z][a-z0-9_]*$/.test(table) || !Number.isSafeInteger(entry.total) || entry.total < 0 ||
        !entry.pages || typeof entry.pages !== "object" || Array.isArray(entry.pages) ||
        Object.keys(entry.pages).length === 0) {
      throw new Error("Invalid resource manifest table");
    }
    for (const [limit, pages] of Object.entries(entry.pages)) {
      if (!/^[1-9][0-9]*$/.test(limit) || !Number.isSafeInteger(Number(limit)) ||
          !Array.isArray(pages) || pages.length !== Math.ceil(entry.total / Number(limit))) {
        throw new Error("Invalid resource manifest pagination");
      }
      for (const page of pages) {
        if (!Number.isSafeInteger(page.bodyLength) || page.bodyLength < 0 ||
            !/^W\/"[A-Za-z0-9+/]{43}="$/.test(page.etag) ||
            !page.files || Object.keys(page.files).length !== ENCODINGS.length) {
          throw new Error("Invalid resource manifest page");
        }
        for (const encoding of ENCODINGS) {
          const file = page.files[encoding];
          if (!file || typeof file.path !== "string" ||
              !/^resource-pages\/[a-zA-Z0-9_./-]+$/.test(file.path) || file.path.split("/").includes("..") ||
              !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) {
            throw new Error("Invalid resource manifest file");
          }
        }
        if (page.files.identity.bytes !== page.bodyLength) throw new Error("Invalid resource body length");
      }
    }
  }
  return manifest;
}

module.exports = { validateManifest, ENCODINGS };
