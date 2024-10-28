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
      "^.+\\.(ts|tsx)$": "ts-jest"
    },
  };