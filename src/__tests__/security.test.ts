import * as path from 'path';
import { validatePath, FormatterSecurityError } from '../security';

// Use an absolute path that definitely exists on every platform as the fake root.
const ROOT = path.resolve('/workspace');

describe('validatePath — no workspace folders', () => {
    it('returns the resolved path when roots array is empty', () => {
        const result = validatePath('/workspace/file.php', []);
        expect(result).toBe(path.resolve('/workspace/file.php'));
    });
});

describe('validatePath — path inside workspace', () => {
    it('accepts a file directly in the workspace root', () => {
        const file = path.join(ROOT, 'index.php');
        expect(validatePath(file, [ROOT])).toBe(file);
    });

    it('accepts a file in a subdirectory', () => {
        const file = path.join(ROOT, 'src', 'app', 'Controller.php');
        expect(validatePath(file, [ROOT])).toBe(file);
    });

    it('accepts a path equal to the workspace root itself', () => {
        expect(validatePath(ROOT, [ROOT])).toBe(ROOT);
    });

    it('accepts a file when multiple workspace roots are provided', () => {
        const root2 = path.resolve('/other-workspace');
        const file  = path.join(root2, 'script.php');
        expect(validatePath(file, [ROOT, root2])).toBe(file);
    });
});

describe('validatePath — path outside workspace', () => {
    it('throws FormatterSecurityError for an absolute path outside all roots', () => {
        const outside = path.resolve('/etc/passwd');
        expect(() => validatePath(outside, [ROOT])).toThrow(FormatterSecurityError);
    });

    it('throws for a sibling directory that shares a prefix with the root', () => {
        // /workspace-evil should NOT match root /workspace
        const evil = path.resolve('/workspace-evil/file.php');
        expect(() => validatePath(evil, [ROOT])).toThrow(FormatterSecurityError);
    });

    it('error message includes the offending path', () => {
        const outside = path.resolve('/tmp/evil.php');
        expect(() => validatePath(outside, [ROOT])).toThrow(/outside all workspace/);
    });

    it('throws when path traversal resolves outside the root', () => {
        // path.resolve collapses ../ so this becomes /file.php
        const traversal = path.join(ROOT, '..', 'file.php');
        expect(() => validatePath(traversal, [ROOT])).toThrow(FormatterSecurityError);
    });
});

describe('FormatterSecurityError', () => {
    it('has the correct name property', () => {
        const err = new FormatterSecurityError('test');
        expect(err.name).toBe('FormatterSecurityError');
        expect(err).toBeInstanceOf(Error);
    });
});
