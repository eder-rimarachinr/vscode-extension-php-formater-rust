/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/src/__tests__/**/*.test.ts'],
    // Map the `vscode` module to a hand-rolled stub so tests run outside the
    // extension host without requiring @vscode/test-electron.
    moduleNameMapper: {
        '^vscode$': '<rootDir>/src/__tests__/__mocks__/vscode.ts',
    },
    transform: {
        '^.+\\.ts$': ['ts-jest', {
            tsconfig: './tsconfig.test.json',
        }],
    },
};
