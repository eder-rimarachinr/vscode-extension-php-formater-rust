import * as crypto from 'crypto';
import * as vscode from 'vscode';

// SEC-FIX-4: Centralised webview HTML builder with a strict Content Security Policy.
//
// Currently this extension has no webview panel.  This module provides the
// correct pattern so that any future settings UI uses CSP from day one.
//
// Key decisions:
//  - default-src 'none'  → blocks everything not explicitly listed.
//  - script-src nonce    → inline scripts require the per-request nonce; no eval.
//  - connect-src 'none'  → the webview cannot make network requests.
//  - style-src unsafe-inline → allows <style> tags (acceptable for local UI).
//  - img-src cspSource   → permits VS Code's own resource scheme for images.
//  - font-src 'none'     → no external font loading.

export interface WebviewContent {
    /** Raw HTML for <body>. Must NOT contain <script> tags — use `scripts` instead. */
    body: string;
    /** JS source strings. Each block is wrapped in <script nonce="...">. */
    scripts?: string[];
    /** CSS source strings. Each block is wrapped in <style>. */
    styles?: string[];
}

/**
 * Builds a complete HTML document with a strict CSP for a VS Code webview.
 * The nonce is freshly generated per call (128 bits, base64url encoded).
 */
export function buildWebviewHtml(
    webview: vscode.Webview,
    content: WebviewContent
): string {
    // SEC-FIX-4: cryptographically random nonce — not Math.random().
    const nonce = crypto.randomBytes(16).toString('base64url');

    const csp = [
        `default-src 'none'`,
        `script-src 'nonce-${nonce}'`,
        `style-src 'unsafe-inline'`,
        `img-src ${webview.cspSource} data:`,
        `connect-src 'none'`,
        `font-src 'none'`,
    ].join('; ');

    const scriptBlocks = (content.scripts ?? [])
        .map(js => `<script nonce="${nonce}">${js}</script>`)
        .join('\n    ');

    const styleBlocks = (content.styles ?? [])
        .map(css => `<style>${css}</style>`)
        .join('\n    ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PHP Formatter</title>
    ${styleBlocks}
</head>
<body>
    ${content.body}
    ${scriptBlocks}
</body>
</html>`;
}

/**
 * SEC-FIX-4: Type-safe postMessage handler.
 * All data arriving from the webview via `onDidReceiveMessage` must be
 * validated before use — never cast `unknown` data without a type guard.
 *
 * Usage:
 *   panel.webview.onDidReceiveMessage(raw => {
 *       const msg = parseWebviewMessage(raw, isMyCommand);
 *       if (!msg) { return; }
 *       // msg is now typed as MyCommand
 *   });
 */
export function parseWebviewMessage<T>(
    data: unknown,
    guard: (v: unknown) => v is T
): T | null {
    return guard(data) ? data : null;
}
