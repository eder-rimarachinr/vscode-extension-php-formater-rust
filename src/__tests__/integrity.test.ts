import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseChecksums, verifyBinaryIntegrity } from '../integrity';

// ─── parseChecksums ───────────────────────────────────────────────────────────

const GOOD_HASH = 'a'.repeat(64); // valid 64-char hex string

describe('parseChecksums', () => {
    it('returns hash for a matching filename', () => {
        const content = `${GOOD_HASH}  php_formatter.exe\n`;
        expect(parseChecksums(content, 'php_formatter.exe')).toBe(GOOD_HASH);
    });

    it('skips comment lines', () => {
        const content = `# comment\n${GOOD_HASH}  binary\n`;
        expect(parseChecksums(content, 'binary')).toBe(GOOD_HASH);
    });

    it('skips blank lines', () => {
        const content = `\n\n${GOOD_HASH}  binary\n`;
        expect(parseChecksums(content, 'binary')).toBe(GOOD_HASH);
    });

    it('returns undefined for unknown filename', () => {
        const content = `${GOOD_HASH}  php_formatter.exe\n`;
        expect(parseChecksums(content, 'other.exe')).toBeUndefined();
    });

    it('rejects a hash with wrong length (too short)', () => {
        expect(parseChecksums('abc123  binary\n', 'binary')).toBeUndefined();
    });

    it('rejects a hash with non-hex characters', () => {
        const badHash = 'g'.repeat(64); // 'g' is not a hex digit
        expect(parseChecksums(`${badHash}  binary\n`, 'binary')).toBeUndefined();
    });

    it('normalises hash to lowercase', () => {
        const upper = GOOD_HASH.toUpperCase();
        const result = parseChecksums(`${upper}  binary\n`, 'binary');
        expect(result).toBe(GOOD_HASH.toLowerCase());
    });

    it('returns undefined for empty content', () => {
        expect(parseChecksums('', 'binary')).toBeUndefined();
    });
});

// ─── verifyBinaryIntegrity ────────────────────────────────────────────────────

function tmpFile(name: string): string {
    return path.join(os.tmpdir(), `phpfmt_test_${name}`);
}

describe('verifyBinaryIntegrity', () => {
    it('resolves without error when checksums file is absent', async () => {
        await expect(
            verifyBinaryIntegrity(tmpFile('binary'), tmpFile('nonexistent_checksums.txt'))
        ).resolves.toBeUndefined();
    });

    it('resolves when the hash matches', async () => {
        const binPath  = tmpFile('ok.bin');
        const cksPath  = tmpFile('ok_checksums.txt');
        const content  = 'hello world';

        fs.writeFileSync(binPath, content);
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        // Use path.basename so the entry matches the actual filename on disk.
        fs.writeFileSync(cksPath, `${hash}  ${path.basename(binPath)}\n`);

        await expect(verifyBinaryIntegrity(binPath, cksPath)).resolves.toBeUndefined();

        fs.unlinkSync(binPath);
        fs.unlinkSync(cksPath);
    });

    it('rejects when the hash does not match', async () => {
        const binPath = tmpFile('tampered.bin');
        const cksPath = tmpFile('tampered_checksums.txt');

        fs.writeFileSync(binPath, 'tampered content');
        fs.writeFileSync(cksPath, `${'a'.repeat(64)}  ${path.basename(binPath)}\n`);

        await expect(verifyBinaryIntegrity(binPath, cksPath))
            .rejects.toThrow(/integrity check FAILED/);

        fs.unlinkSync(binPath);
        fs.unlinkSync(cksPath);
    });

    it('rejects when the binary name is not listed in checksums', async () => {
        const binPath = tmpFile('unlisted.bin');
        const cksPath = tmpFile('unlisted_checksums.txt');

        fs.writeFileSync(binPath, 'data');
        fs.writeFileSync(cksPath, `${'a'.repeat(64)}  other_binary.bin\n`);

        await expect(verifyBinaryIntegrity(binPath, cksPath))
            .rejects.toThrow(/no checksum entry found/);

        fs.unlinkSync(binPath);
        fs.unlinkSync(cksPath);
    });
});
