import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { validatePath } from './security';
import { verifyBinaryIntegrity } from './integrity';

// ─── Protocol types ───────────────────────────────────────────────────────────

interface BinaryRequest {
    command: 'format' | 'check';
    source: string;
    file_path?: string;
    workspace_root?: string;
}

interface BinaryDiagnostic {
    line: number;
    col: number;
    end_line: number;
    end_col: number;
    message: string;
    severity: string;
    code: string;
    fix?: { replacement: string };
}

interface BinaryResponse {
    ok: boolean;
    command: string;
    formatted?: string;
    changed: boolean;
    timing_ms: number;
    diagnostics: BinaryDiagnostic[];
    error?: string;
}

// ─── Binary invocation ────────────────────────────────────────────────────────

// SEC-001: read only from global/machine settings — workspace settings cannot
// override this, preventing a malicious .vscode/settings.json from redirecting
// the binary to an arbitrary executable.
function getBinaryPath(): string {
    const inspected = vscode.workspace.getConfiguration('phpFormatter').inspect<string>('binaryPath');
    const custom = inspected?.globalValue ?? inspected?.defaultValue;
    if (typeof custom === 'string' && custom.trim()) { return custom.trim(); }
    const ext = os.platform() === 'win32' ? '.exe' : '';
    return path.join(__dirname, '..', 'bin', `php_formatter${ext}`);
}

// SEC-006: resolve workspace root so the binary can stop config discovery there.
function getWorkspaceRoot(uri: vscode.Uri): string | undefined {
    return vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
}

// FIX-1: VS Code wrapper — collects workspace roots and delegates to the pure
// validatePath() so the core logic is unit-testable without a running host.
function validateWorkspacePath(filePath: string): string {
    const roots = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [];
    return validatePath(filePath, roots);
}

// SEC-005: strip non-printable chars and cap length before showing to the user.
function sanitizeError(raw: string): string {
    return raw.replace(/[^\x20-\x7E\n]/g, '?').slice(0, 500);
}

// SEC-008: runtime validation — the "as BinaryResponse" cast is erased at
// runtime, so we verify the fields we actually use before trusting them.
function parseBinaryResponse(raw: string): BinaryResponse {
    const resp = JSON.parse(raw);
    if (typeof resp !== 'object' || resp === null) { throw new Error('Response is not an object'); }
    if (typeof resp.ok !== 'boolean') { throw new Error('Missing field: ok'); }
    if (resp.formatted !== undefined && typeof resp.formatted !== 'string') {
        throw new Error('Invalid field: formatted');
    }
    if (!Array.isArray(resp.diagnostics)) { resp.diagnostics = []; }
    return resp as BinaryResponse;
}

const MAX_STDOUT_BYTES = 50 * 1024 * 1024; // 50 MB — SEC-004
const MAX_STDERR_BYTES =  1 * 1024 * 1024; //  1 MB — SEC-004
const BINARY_TIMEOUT_MS = 30_000;           // 30 s  — SEC-003

function callBinary(request: BinaryRequest): Promise<BinaryResponse> {
    // FIX-1: reject immediately if file_path escapes the workspace boundary.
    if (request.file_path) {
        try {
            request = { ...request, file_path: validateWorkspacePath(request.file_path) };
        } catch (err) {
            return Promise.reject(err);
        }
    }

    return new Promise((resolve, reject) => {
        const binary = getBinaryPath();
        // FIX-2: spawn uses an explicit args array — never {shell:true} or string
        // concatenation, so spaces in `binary` and args cannot become shell injection.
        const proc = cp.spawn(binary, ['--json']);
        let stdout = '';
        let stderr = '';
        let settled = false;

        function finish(fn: () => void): void {
            if (settled) { return; }
            settled = true;
            clearTimeout(timer);
            fn();
        }

        // SEC-003: kill the process if it doesn't respond in time.
        const timer = setTimeout(() => {
            finish(() => {
                proc.kill();
                reject(new Error('PHP Formatter: timed out after 30 s'));
            });
        }, BINARY_TIMEOUT_MS);

        proc.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
            // SEC-004: hard limit to prevent OOM in the extension host.
            if (stdout.length > MAX_STDOUT_BYTES) {
                finish(() => {
                    proc.kill();
                    reject(new Error('PHP Formatter: response exceeded size limit'));
                });
            }
        });

        proc.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
            // SEC-004: ring-buffer stderr so it never grows unbounded.
            if (stderr.length > MAX_STDERR_BYTES) {
                stderr = stderr.slice(-MAX_STDERR_BYTES);
            }
        });

        proc.on('error', (err: Error) => finish(() =>
            reject(new Error(`PHP Formatter binary not found: ${binary}\n${err.message}`))
        ));

        proc.on('close', () => finish(() => {
            try {
                const resp = parseBinaryResponse(stdout); // SEC-008
                // SEC-005: sanitize binary-controlled error before showing it.
                resp.ok
                    ? resolve(resp)
                    : reject(new Error(`PHP Formatter: ${sanitizeError(resp.error ?? 'unknown error')}`));
            } catch {
                reject(new Error('PHP Formatter: invalid binary response (check binary path)'));
            }
        }));

        proc.stdin.write(JSON.stringify(request), 'utf8');
        proc.stdin.end();
    });
}

// ─── Status bar ───────────────────────────────────────────────────────────────

let statusBar: vscode.StatusBarItem;
let statusTimer: ReturnType<typeof setTimeout> | undefined;

function showTiming(ms: number): void {
    statusBar.text = `$(watch) PHP fmt: ${ms}ms`;
    statusBar.show();
    if (statusTimer) { clearTimeout(statusTimer); }
    statusTimer = setTimeout(() => statusBar.hide(), 5000);
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

let diagCollection: vscode.DiagnosticCollection;
const fixMap = new Map<string, string>(); // "uri:line:col" → replacement

async function runCheck(doc: vscode.TextDocument): Promise<void> {
    if (doc.languageId !== 'php') { return; }
    if (!vscode.workspace.getConfiguration('phpFormatter').get<boolean>('diagnostics')) {
        diagCollection.delete(doc.uri);
        return;
    }
    try {
        const resp = await callBinary({
            command: 'check',
            source: doc.getText(),
            file_path: doc.uri.fsPath,
            workspace_root: getWorkspaceRoot(doc.uri),
        });
        const diags = resp.diagnostics.map(d => {
            const range = new vscode.Range(d.line, d.col, d.end_line, d.end_col);
            const diag = new vscode.Diagnostic(range, d.message, vscode.DiagnosticSeverity.Warning);
            diag.code = d.code;
            diag.source = 'php-formatter';
            if (d.fix) { fixMap.set(`${doc.uri}:${d.line}:${d.col}`, d.fix.replacement); }
            return diag;
        });
        diagCollection.set(doc.uri, diags);
    } catch { diagCollection.delete(doc.uri); }
}

// ─── Preview scheme ───────────────────────────────────────────────────────────

const PREVIEW_SCHEME = 'php-formatter-preview';
const previewMap = new Map<string, string>();

// ─── Bulk format helper ───────────────────────────────────────────────────────

async function formatFiles(
    files: vscode.Uri[],
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken
): Promise<void> {
    let changed = 0;
    for (const [i, uri] of files.entries()) {
        if (token.isCancellationRequested) { break; }
        progress.report({
            message: `${i + 1}/${files.length}: ${path.basename(uri.fsPath)}`,
            increment: 100 / files.length,
        });
        try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            const source = Buffer.from(bytes).toString('utf8');
            const resp = await callBinary({
                command: 'format',
                source,
                file_path: uri.fsPath,
                workspace_root: getWorkspaceRoot(uri),
            });
            if (resp.changed && resp.formatted) {
                await vscode.workspace.fs.writeFile(uri, Buffer.from(resp.formatted, 'utf8'));
                changed++;
            }
        } catch { /* skip unreadable files */ }
    }
    vscode.window.showInformationMessage(
        `PHP Formatter: ${changed} of ${files.length} file(s) changed.`
    );
}

// ─── Activation ───────────────────────────────────────────────────────────────

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // FIX-5: verify the bundled binary hasn't been tampered with before accepting
    // any formatting requests. Silently skips when checksums.txt is absent (dev mode).
    const binaryPath = getBinaryPath();
    const checksumsPath = path.join(__dirname, '..', 'bin', 'checksums.txt');
    try {
        await verifyBinaryIntegrity(binaryPath, checksumsPath);
    } catch (err: unknown) {
        vscode.window.showErrorMessage(
            `PHP Formatter security error: ${(err as Error).message}`
        );
        return; // abort activation — no commands or providers are registered
    }

    const sub = context.subscriptions;

    // Status bar item
    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    sub.push(statusBar);

    // Diagnostic collection
    diagCollection = vscode.languages.createDiagnosticCollection('php-formatter');
    sub.push(diagCollection);

    // ── Document formatter (Shift+Alt+F) ──────────────────────────────────────
    sub.push(vscode.languages.registerDocumentFormattingEditProvider('php', {
        async provideDocumentFormattingEdits(doc): Promise<vscode.TextEdit[]> {
            try {
                const resp = await callBinary({
                    command: 'format',
                    source: doc.getText(),
                    file_path: doc.uri.fsPath,
                    workspace_root: getWorkspaceRoot(doc.uri),
                });
                if (!resp.formatted || !resp.changed) { return []; }
                showTiming(resp.timing_ms);
                const full = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
                return [vscode.TextEdit.replace(full, resp.formatted)];
            } catch (err: unknown) {
                vscode.window.showErrorMessage(`PHP Formatter: ${(err as Error).message}`);
                return [];
            }
        },
    }));

    // ── Format on save ────────────────────────────────────────────────────────
    sub.push(vscode.workspace.onWillSaveTextDocument(event => {
        if (event.document.languageId !== 'php') { return; }
        if (!vscode.workspace.getConfiguration('phpFormatter').get<boolean>('formatOnSave')) { return; }
        event.waitUntil(
            callBinary({
                command: 'format',
                source: event.document.getText(),
                file_path: event.document.uri.fsPath,
                workspace_root: getWorkspaceRoot(event.document.uri),
            })
                .then(resp => {
                    if (!resp.formatted || !resp.changed) { return []; }
                    showTiming(resp.timing_ms);
                    const full = new vscode.Range(
                        event.document.positionAt(0),
                        event.document.positionAt(event.document.getText().length)
                    );
                    return [vscode.TextEdit.replace(full, resp.formatted)];
                })
                .catch(() => [] as vscode.TextEdit[])
        );
    }));

    // ── Diagnostics on open / save ────────────────────────────────────────────
    sub.push(vscode.workspace.onDidOpenTextDocument(runCheck));
    sub.push(vscode.workspace.onDidSaveTextDocument(runCheck));
    if (vscode.window.activeTextEditor) { runCheck(vscode.window.activeTextEditor.document); }

    // ── Preview content provider ──────────────────────────────────────────────
    sub.push(vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, {
        provideTextDocumentContent: (uri) => previewMap.get(uri.path) ?? '',
    }));

    // ── Command: Preview Format ───────────────────────────────────────────────
    sub.push(vscode.commands.registerCommand('phpFormatter.previewFormat', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'php') {
            vscode.window.showWarningMessage('PHP Formatter: open a PHP file to preview formatting.');
            return;
        }
        const doc = editor.document;
        try {
            const resp = await callBinary({
                command: 'format',
                source: doc.getText(),
                file_path: doc.uri.fsPath,
                workspace_root: getWorkspaceRoot(doc.uri),
            });
            previewMap.set(doc.uri.path, resp.formatted ?? doc.getText());
            // SEC-002: use Uri.from() to avoid authority injection with UNC paths.
            const previewUri = vscode.Uri.from({ scheme: PREVIEW_SCHEME, path: doc.uri.path });
            await vscode.commands.executeCommand(
                'vscode.diff', doc.uri, previewUri,
                `${path.basename(doc.uri.fsPath)}  ↔  PHP Formatter Preview`
            );
        } catch (err: unknown) {
            vscode.window.showErrorMessage(`PHP Formatter: ${(err as Error).message}`);
        }
    }));

    // ── Command: Format Selection ─────────────────────────────────────────────
    sub.push(vscode.commands.registerCommand('phpFormatter.formatSelection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'php') { return; }
        if (editor.selection.isEmpty) {
            vscode.window.showInformationMessage('PHP Formatter: select code to format.');
            return;
        }
        try {
            const source = editor.document.getText(editor.selection);
            const resp = await callBinary({
                command: 'format',
                source,
                file_path: editor.document.uri.fsPath,
                workspace_root: getWorkspaceRoot(editor.document.uri),
            });
            if (!resp.formatted || !resp.changed) { return; }
            await editor.edit(b => b.replace(editor.selection, resp.formatted!));
            showTiming(resp.timing_ms);
        } catch (err: unknown) {
            vscode.window.showErrorMessage(`PHP Formatter: ${(err as Error).message}`);
        }
    }));

    // ── Quick Fix provider ────────────────────────────────────────────────────
    sub.push(vscode.languages.registerCodeActionsProvider(
        'php',
        {
            provideCodeActions(doc, _range, ctx) {
                return ctx.diagnostics
                    .filter(d => d.source === 'php-formatter')
                    .flatMap(diag => {
                        const key = `${doc.uri}:${diag.range.start.line}:${diag.range.start.character}`;
                        const replacement = fixMap.get(key);
                        if (replacement === undefined) { return []; }
                        const action = new vscode.CodeAction('Fix formatting', vscode.CodeActionKind.QuickFix);
                        action.edit = new vscode.WorkspaceEdit();
                        action.edit.replace(doc.uri, diag.range, replacement);
                        action.diagnostics = [diag];
                        action.isPreferred = true;
                        return [action];
                    });
            },
        },
        { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    ));

    // ── Command: Format Workspace ─────────────────────────────────────────────
    sub.push(vscode.commands.registerCommand('phpFormatter.formatWorkspace', async () => {
        const files = await vscode.workspace.findFiles('**/*.php', '{**/vendor/**,**/node_modules/**}');
        if (!files.length) {
            vscode.window.showInformationMessage('PHP Formatter: no PHP files found in workspace.');
            return;
        }
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'PHP Formatter: workspace', cancellable: true },
            (progress, token) => formatFiles(files, progress, token)
        );
    }));

    // ── Command: Format Folder (explorer context menu) ────────────────────────
    sub.push(vscode.commands.registerCommand('phpFormatter.formatFolder', async (folderUri: vscode.Uri) => {
        const files = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folderUri, '**/*.php'),
            '{**/vendor/**,**/node_modules/**}'
        );
        if (!files.length) {
            vscode.window.showInformationMessage('PHP Formatter: no PHP files found in this folder.');
            return;
        }
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `PHP Formatter: ${path.basename(folderUri.fsPath)}`,
                cancellable: true,
            },
            (progress, token) => formatFiles(files, progress, token)
        );
    }));
}

export function deactivate(): void {
    if (statusTimer) { clearTimeout(statusTimer); }
}
