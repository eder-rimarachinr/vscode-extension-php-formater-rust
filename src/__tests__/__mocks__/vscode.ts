// Minimal VS Code API stub for unit tests running outside the extension host.
export const window = {
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    showInformationMessage: jest.fn(),
};
export const workspace = {
    workspaceFolders: undefined as undefined | Array<{ uri: { fsPath: string } }>,
    getConfiguration: jest.fn(() => ({ get: jest.fn(), inspect: jest.fn() })),
    getWorkspaceFolder: jest.fn(),
};
export const languages = {};
export const commands  = {};
export const Uri       = { parse: jest.fn(), from: jest.fn() };
