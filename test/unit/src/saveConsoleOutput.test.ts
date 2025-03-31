// Mock dependencies upfront with Jest's hoisting
jest.mock('stream');
jest.mock('path');
jest.mock('streamroller');
jest.mock('console');

// Import required modules and dependencies
import { expect, describe, it, beforeEach, afterEach, jest } from '@jest/globals'

// Store original process objects to restore after tests
const originalProcessStdout = process.stdout
const originalProcessStderr = process.stderr
const originalConsole = global.console

describe('saveConsoleOutput Module', () => {
  // Clear Jest modules before each test to ensure clean imports
  let startSaving: (baseDir: string) => void;
  let mockPassThrough: jest.Mock;
  let mockRollingFileStream: jest.Mock;
  let mockJoin: jest.Mock;
  let mockConsole: jest.Mock;
  let mockPipe: jest.Mock;
  
  beforeEach(() => {
    // Clear the module cache to ensure a fresh import
    jest.resetModules();
    
    // Setup our mocks before importing the module
    mockPipe = jest.fn().mockReturnThis();
    mockPassThrough = jest.fn().mockImplementation(() => ({
      pipe: mockPipe
    }));
    
    mockJoin = jest.fn().mockImplementation((...args) => args.join('/'));
    
    mockRollingFileStream = jest.fn().mockImplementation(() => ({
      // Mock properties if needed
    }));
    
    // Create a mock Console constructor that returns a console-like object
    mockConsole = jest.fn().mockImplementation(() => ({
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    }));
    
    // Mock the required modules with proper exports
    jest.mock('stream', () => ({
      PassThrough: mockPassThrough
    }));
    
    jest.mock('path', () => ({
      join: mockJoin
    }));
    
    jest.mock('streamroller', () => ({
      RollingFileStream: mockRollingFileStream
    }));
    
    // Mock console with a constructor that behaves like Console
    jest.mock('console', () => ({
      Console: mockConsole
    }));
    
    // Reset global console
    global.console = { ...originalConsole };
    
    // Now import the module to test with mocks already in place
    startSaving = require('../../../src/saveConsoleOutput').startSaving;
  });

  // Restore original objects after each test
  afterEach(() => {
    Object.defineProperty(process, 'stdout', {
      value: originalProcessStdout,
      writable: true
    });
    
    Object.defineProperty(process, 'stderr', {
      value: originalProcessStderr,
      writable: true
    });
    
    global.console = originalConsole;
    
    // Clear all mocks
    jest.resetAllMocks();
  });

  it('should create PassThrough streams', () => {
    // Act
    startSaving('/test/path');
    
    // Assert
    expect(mockPassThrough).toHaveBeenCalledTimes(2);
  });

  it('should pipe the PassThrough streams to stdout and stderr', () => {
    // Act
    startSaving('/test/path');
    
    // Assert
    expect(mockPipe).toHaveBeenCalledWith(process.stdout);
    expect(mockPipe).toHaveBeenCalledWith(process.stderr);
  });

  it('should create a RollingFileStream with correct parameters', () => {
    // Act
    startSaving('/test/path');
    
    // Assert
    expect(mockJoin).toHaveBeenCalledWith('/test/path', 'out.log');
    expect(mockRollingFileStream).toHaveBeenCalledWith(
      '/test/path/out.log',
      10000000, // Max file size
      10 // Max files
    );
  });
  
  it('should pipe the PassThrough streams to the RollingFileStream', () => {
    // Setup
    const mockStreamInstance = {};
    mockRollingFileStream.mockReturnValueOnce(mockStreamInstance);
    
    // Act
    startSaving('/test/path');
    
    // Assert
    expect(mockPipe).toHaveBeenCalledWith(mockStreamInstance);
  });
  
  it('should create a new Console instance with the PassThrough streams', () => {
    // Act
    startSaving('/test/path');
    
    // Assert
    expect(mockConsole).toHaveBeenCalledTimes(1);
    expect(mockConsole).toHaveBeenCalledWith({
      stdout: expect.anything(),
      stderr: expect.anything()
    });
  });

  it('should replace the global console object', () => {
    // Setup - mock the return value from Console constructor
    const mockConsoleInstance = { log: jest.fn(), error: jest.fn() };
    mockConsole.mockReturnValueOnce(mockConsoleInstance);
    
    // Arrange
    const originalGlobalConsole = global.console;
    
    // Act
    startSaving('/test/path');
    
    // Assert
    expect(global.console).not.toBe(originalGlobalConsole);
    expect(global.console).toBe(mockConsoleInstance);
  });

  it('should handle empty baseDir parameter', () => {
    // Act
    startSaving('');
    
    // Assert
    expect(mockJoin).toHaveBeenCalledWith('', 'out.log');
  });
}); 