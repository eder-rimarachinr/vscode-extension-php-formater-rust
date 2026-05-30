import { buildWebviewHtml, parseWebviewMessage } from '../webview';

const mockWebview = { cspSource: 'vscode-resource:' } as any;

// ─── buildWebviewHtml ─────────────────────────────────────────────────────────

describe('buildWebviewHtml — CSP meta tag', () => {
    it('includes a Content-Security-Policy meta tag', () => {
        const html = buildWebviewHtml(mockWebview, { body: '<p>hi</p>' });
        expect(html).toContain('Content-Security-Policy');
    });

    it('sets default-src to none', () => {
        const html = buildWebviewHtml(mockWebview, { body: '' });
        expect(html).toContain(`default-src 'none'`);
    });

    it('sets connect-src to none', () => {
        const html = buildWebviewHtml(mockWebview, { body: '' });
        expect(html).toContain(`connect-src 'none'`);
    });

    it('script-src contains a nonce', () => {
        const html = buildWebviewHtml(mockWebview, { body: '' });
        expect(html).toMatch(/script-src 'nonce-[A-Za-z0-9_\-+/]+'/) ;
    });

    it('each call generates a unique nonce', () => {
        const html1 = buildWebviewHtml(mockWebview, { body: '' });
        const html2 = buildWebviewHtml(mockWebview, { body: '' });
        const nonce1 = html1.match(/nonce-([A-Za-z0-9_\-+/]+)/)![1];
        const nonce2 = html2.match(/nonce-([A-Za-z0-9_\-+/]+)/)![1];
        expect(nonce1).not.toBe(nonce2);
    });
});

describe('buildWebviewHtml — script blocks', () => {
    it('wraps scripts with the nonce attribute', () => {
        const html = buildWebviewHtml(mockWebview, {
            body: '',
            scripts: ['console.log("ok")'],
        });
        expect(html).toMatch(/<script nonce="[^"]+">console\.log\("ok"\)<\/script>/);
    });

    it('does not include a <script> tag when no scripts are provided', () => {
        const html = buildWebviewHtml(mockWebview, { body: '<p>no scripts</p>' });
        expect(html).not.toContain('<script');
    });
});

describe('buildWebviewHtml — structure', () => {
    it('includes the provided body content', () => {
        const html = buildWebviewHtml(mockWebview, { body: '<h1>hello</h1>' });
        expect(html).toContain('<h1>hello</h1>');
    });

    it('includes cspSource in img-src', () => {
        const html = buildWebviewHtml(mockWebview, { body: '' });
        expect(html).toContain('vscode-resource:');
    });
});

// ─── parseWebviewMessage ──────────────────────────────────────────────────────

interface PingCommand { type: 'ping'; id: number }
function isPingCommand(v: unknown): v is PingCommand {
    return (
        typeof v === 'object' && v !== null &&
        (v as any).type === 'ping' &&
        typeof (v as any).id === 'number'
    );
}

describe('parseWebviewMessage', () => {
    it('returns typed value when guard passes', () => {
        const msg = { type: 'ping', id: 1 };
        expect(parseWebviewMessage(msg, isPingCommand)).toEqual(msg);
    });

    it('returns null when guard fails', () => {
        expect(parseWebviewMessage({ type: 'unknown' }, isPingCommand)).toBeNull();
    });

    it('returns null for null input', () => {
        expect(parseWebviewMessage(null, isPingCommand)).toBeNull();
    });

    it('returns null for a string input', () => {
        expect(parseWebviewMessage('ping', isPingCommand)).toBeNull();
    });
});
