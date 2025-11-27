// test/logger.test.js

import { Logger } from "../js/utils.js";

/**
 * Logger 유틸리티 테스트
 */
describe("Logger", () => {
  // Mock console methods
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;

  beforeEach(() => {
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  });

  test("debug should call console.log when debug mode is enabled", () => {
    // Mock isDebugMode to return true
    Logger.isDebugMode = jest.fn().mockReturnValue(true);

    Logger.debug("Test message");

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("[DEBUG]"),
      "Test message"
    );
  });

  test("warn should call console.warn when debug mode is enabled", () => {
    Logger.isDebugMode = jest.fn().mockReturnValue(true);

    Logger.warn("Warning message");

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("[WARN]"),
      "Warning message"
    );
  });

  test("error should call console.error regardless of debug mode", () => {
    Logger.isDebugMode = jest.fn().mockReturnValue(false);

    Logger.error("Error message");

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("[ERROR]"),
      "Error message"
    );
  });

  test("debug should not call console.log when debug mode is disabled", () => {
    Logger.isDebugMode = jest.fn().mockReturnValue(false);

    Logger.debug("Test message");

    expect(console.log).not.toHaveBeenCalled();
  });
});
