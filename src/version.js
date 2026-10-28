// Kept equal to package.json's version and engines by test/version.test.js
export const VERSION = '0.3.0'

// Oldest Node.js accepted: 26 LTS with the October 2026 security fixes
export const MIN_NODE_VERSION = '26.12.1'

/**
 * @param {string} version - Node.js version, e.g. process.versions.node.
 * @returns {boolean} Whether it is MIN_NODE_VERSION or later.
 */
export function isSupportedNodeVersion (version) {
  const parts = version.split('.').map(Number)
  const minimum = MIN_NODE_VERSION.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== minimum[i]) {
      return parts[i] > minimum[i]
    }
  }
  return true
}
