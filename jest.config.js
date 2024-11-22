module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: [
      "<rootDir>/test/unit"
    ],
    testMatch: [
      "**/__tests__/**/*.+(ts|tsx|js)",
      "**/?(*.)+(spec|test).+(ts|tsx|js)"
    ],
    transform: {
      "^.+\\.(ts|tsx)$": ["ts-jest", {
        tsconfig: "test/tsconfig.json"
      }]
    },
    moduleDirectories: ["node_modules", "src"],
    globals: {
      'ts-jest': {
        isolatedModules: true
      }
    },
    timers: 'fake'
}