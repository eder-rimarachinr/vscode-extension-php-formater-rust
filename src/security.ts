import * as path from 'path';

// SEC-FIX-1: Dedicated module for workspace boundary enforcement.
// Pure functions only — no VS Code imports — fully testable without a running extension host.

export class FormatterSecurityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FormatterSecurityError';
    }
}

/**
 * Verifies that `filePath` resolves to a location inside one of the provided
 * workspace roots. Returns the canonicalized absolute path on success.
 *
 * Rules:
 *  - Empty `workspaceRoots` (single-file mode, no folder open) → always passes.
 *  - Path must equal a root OR start with `<root><sep>` to prevent prefix spoofing
 *    (e.g. `/workspace-extra/` must not match root `/workspace`).
 *  - On Windows the comparison is case-insensitive.
 */
export function validatePath(filePath: string, workspaceRoots: readonly string[]): string {
    const resolved = path.resolve(filePath);

    if (workspaceRoots.length === 0) {
        return resolved;
    }

    // SEC-FIX-1: Windows paths are case-insensitive; normalise before comparison.
    const norm = (p: string): string =>
        process.platform === 'win32' ? p.toLowerCase() : p;

    const normResolved = norm(resolved);

    const inWorkspace = workspaceRoots.some(root => {
        const normRoot = norm(path.resolve(root));
        return (
            normResolved === normRoot ||
            normResolved.startsWith(normRoot + path.sep)
        );
    });

    if (!inWorkspace) {
        throw new FormatterSecurityError(
            `PHP Formatter: "${resolved}" is outside all workspace folders. Formatting aborted.`
        );
    }

    return resolved;
}
