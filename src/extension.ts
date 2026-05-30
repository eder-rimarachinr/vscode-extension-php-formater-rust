import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as os from 'os';

// ─── Protocol types ───────────────────────────────────────────────────────────

interface BinaryRequest {
    command: 'format' | 'check';
    source: string;
    file_path?: string;
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

function getBinaryPath(): string {
    const custom = vscode.workspace.getConfiguration('phpFormatter').get<string>('binaryPath');
    if (custom?.trim()) { return custom.trim(); }
    const ext = os.platform() === 'win32' ? '.exe' : '';
    return path.join(__dirname, '..', 'bin', `php_formatter${ext}`);
}

function callBinary(request: BinaryRequest): Promise<BinaryResponse> {
    return new Promise((resolve, reject) => {
        const binary = getBinaryPath();
        const proc = cp.spawn(binary, ['--json']);
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
        proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
        proc.on('error', (err: Error) => reject(new Error(`PHP Formatter binary not found: ${binary}\n${err.message}`)));
        proc.on('close', (_code: number | null) => {
            try {
                const resp = JSON.parse(stdout) as BinaryResponse;
                resp.ok ? resolve(resp) : reject(new Error(resp.error ?? 'Unknown error'));
            } catch {
                reject(new Error(`Invalid binary response: ${stdout || stderr}`));
            }
        });

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
        const resp = await callBinary({ command: 'check', source: doc.getText(), file_path: doc.uri.fsPath });
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
            const resp = await callBinary({ command: 'format', source, file_path: uri.fsPath });
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

export function activate(context: vscode.ExtensionContext): void {
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
                const resp = await callBinary({ command: 'format', source: doc.getText(), file_path: doc.uri.fsPath });
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
            callBinary({ command: 'format', source: event.document.getText(), file_path: event.document.uri.fsPath })
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
            const resp = await callBinary({ command: 'format', source: doc.getText(), file_path: doc.uri.fsPath });
            previewMap.set(doc.uri.path, resp.formatted ?? doc.getText());
            const previewUri = vscode.Uri.parse(`${PREVIEW_SCHEME}:${doc.uri.path}`);
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
            const resp = await callBinary({ command: 'format', source, file_path: editor.document.uri.fsPath });
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
