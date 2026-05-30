import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// SEC-FIX-5: Binary integrity verification via SHA-256 checksums.
// Runs once at activation to detect tampered or substituted binaries.

/**
 * Parses a checksums.txt file where each data line is:
 *   <64-hex-char SHA-256>  <filename>
 * Lines starting with # are comments and are ignored.
 *
 * Returns the expected lowercase hex hash for `filename`, or `undefined`.
 * Rejects hash strings that are not exactly 64 hex characters (defence against
 * truncated or placeholder values slipping through).
 */
export function parseChecksums(content: string, filename: string): string | undefined {
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) { continue; }

        const firstSpace = trimmed.search(/\s/);
        if (firstSpace === -1) { continue; }

        const hash = trimmed.slice(0, firstSpace);
        const name = trimmed.slice(firstSpace).trim();

        // SEC-FIX-5: only accept full-length SHA-256 hex strings.
        if (name === filename && /^[0-9a-f]{64}$/i.test(hash)) {
            return hash.toLowerCase();
        }
    }
    return undefined;
}

/**
 * Computes the SHA-256 of the binary at `binaryPath` and compares it against
 * the expected hash in `checksumsPath`.
 *
 * Behaviour:
 *  - `checksumsPath` absent → silently returns (development / CI builds).
 *  - Binary not listed     → rejects (configuration error).
 *  - Hash mismatch         → rejects with a clear tamper-warning message.
 *  - Hash matches          → resolves.
 */
export async function verifyBinaryIntegrity(
    binaryPath: string,
    checksumsPath: string
): Promise<void> {
    let checksumsContent: string;
    try {
        checksumsContent = fs.readFileSync(checksumsPath, 'utf8');
    } catch {
        // SEC-FIX-5: no checksums.txt in tree → dev/CI mode, skip verification.
        return;
    }

    const binaryName = path.basename(binaryPath);
    const expectedHash = parseChecksums(checksumsContent, binaryName);

    if (expectedHash === undefined) {
        throw new Error(
            `PHP Formatter: no checksum entry found for "${binaryName}". ` +
            `Regenerate checksums.txt with the release build script.`
        );
    }

    const fileBuffer = fs.readFileSync(binaryPath);
    const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    if (actualHash !== expectedHash) {
        throw new Error(
            `PHP Formatter: binary integrity check FAILED.\n` +
            `  File:     ${binaryPath}\n` +
            `  Expected: ${expectedHash}\n` +
            `  Actual:   ${actualHash}\n` +
            `The binary may have been tampered with. Formatting is disabled.`
        );
    }
}
