// test/logger.test.js

import { Logger } from "../js/utils.js";

/**
 * Logger 유틸리티 테스트
 * CSS 스타일링을 포함한 실제 출력 형식을 테스트
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

  describe("Debug mode enabled", () => {
    beforeEach(() => {
      // Mock isDebugMode to return true
      Logger.isDebugMode = jest.fn().mockReturnValue(true);
    });

    test("debug should call console.log with CSS styling when debug mode is enabled", () => {
      Logger.debug("Test message");

      expect(console.log).toHaveBeenCalledWith(
        "%c[DEBUG]",
        "color: #4A90E2; font-weight: normal; font-style: italic;",
        "Test message"
      );
      expect(console.log).toHaveBeenCalledTimes(1);
    });

    test("warn should call console.warn with CSS styling when debug mode is enabled", () => {
      Logger.warn("Warning message");

      expect(console.warn).toHaveBeenCalledWith(
        "%c[WARN]",
        "color: #FFA500; font-weight: 600;",
        "Warning message"
      );
      expect(console.warn).toHaveBeenCalledTimes(1);
    });

    test("info should call console.log with CSS styling when debug mode is enabled", () => {
      Logger.info("Info message");

      expect(console.log).toHaveBeenCalledWith(
        "%c[INFO]",
        "color: #888; font-weight: normal;",
        "Info message"
      );
      expect(console.log).toHaveBeenCalledTimes(1);
    });

    test("biz should call console.log with CSS styling when debug mode is enabled", () => {
      Logger.biz("Business message");

      expect(console.log).toHaveBeenCalledWith(
        "%c💰 [BIZ]",
        "color: #FFD700; font-weight: 700; text-shadow: 0 0 3px rgba(255, 215, 0, 0.5);",
        "Business message"
      );
      expect(console.log).toHaveBeenCalledTimes(1);
    });
  });

  describe("Debug mode disabled", () => {
    beforeEach(() => {
      // Mock isDebugMode to return false
      Logger.isDebugMode = jest.fn().mockReturnValue(false);
    });

    test("debug should not call console.log when debug mode is disabled", () => {
      Logger.debug("Test message");

      expect(console.log).not.toHaveBeenCalled();
    });

    test("warn should not call console.warn when debug mode is disabled", () => {
      Logger.warn("Warning message");

      expect(console.warn).not.toHaveBeenCalled();
    });

    test("info should not call console.log when debug mode is disabled", () => {
      Logger.info("Info message");

      expect(console.log).not.toHaveBeenCalled();
    });

    test("biz should not call console.log when debug mode is disabled", () => {
      Logger.biz("Business message");

      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe("Error logging (always enabled)", () => {
    test("error should call console.error with CSS styling regardless of debug mode", () => {
      // Debug mode disabled
      Logger.isDebugMode = jest.fn().mockReturnValue(false);

      Logger.error("Error message");

      expect(console.error).toHaveBeenCalledWith(
        "%c[ERROR]",
        "background: #FF4444; color: #FFFFFF; padding: 2px 6px; border-radius: 3px; font-weight: bold;",
        "Error message"
      );
      expect(console.error).toHaveBeenCalledTimes(1);
    });

    test("error should call console.error with CSS styling when debug mode is enabled", () => {
      // Debug mode enabled
      Logger.isDebugMode = jest.fn().mockReturnValue(true);

      Logger.error("Error message");

      expect(console.error).toHaveBeenCalledWith(
        "%c[ERROR]",
        "background: #FF4444; color: #FFFFFF; padding: 2px 6px; border-radius: 3px; font-weight: bold;",
        "Error message"
      );
      expect(console.error).toHaveBeenCalledTimes(1);
    });
  });

  describe("Performance logging", () => {
    test("time and timeEnd should call console.time when debug mode is enabled", () => {
      Logger.isDebugMode = jest.fn().mockReturnValue(true);

      const originalTime = console.time;
      const originalTimeEnd = console.timeEnd;
      console.time = jest.fn();
      console.timeEnd = jest.fn();

      Logger.time("test label");
      Logger.timeEnd("test label");

      expect(console.time).toHaveBeenCalledWith("[PERF] test label");
      expect(console.timeEnd).toHaveBeenCalledWith("[PERF] test label");

      console.time = originalTime;
      console.timeEnd = originalTimeEnd;
    });

    test("time and timeEnd should not call console.time when debug mode is disabled", () => {
      Logger.isDebugMode = jest.fn().mockReturnValue(false);

      const originalTime = console.time;
      const originalTimeEnd = console.timeEnd;
      console.time = jest.fn();
      console.timeEnd = jest.fn();

      Logger.time("test label");
      Logger.timeEnd("test label");

      expect(console.time).not.toHaveBeenCalled();
      expect(console.timeEnd).not.toHaveBeenCalled();

      console.time = originalTime;
      console.timeEnd = originalTimeEnd;
    });
  });

  describe("Group logging", () => {
    test("group and groupEnd should call console.group when debug mode is enabled", () => {
      Logger.isDebugMode = jest.fn().mockReturnValue(true);

      const originalGroup = console.group;
      const originalGroupEnd = console.groupEnd;
      console.group = jest.fn();
      console.groupEnd = jest.fn();

      Logger.group("test group");
      Logger.groupEnd();

      expect(console.group).toHaveBeenCalledWith(
        "%c[GROUP] test group",
        "color: #888; font-weight: bold;"
      );
      expect(console.groupEnd).toHaveBeenCalledTimes(1);

      console.group = originalGroup;
      console.groupEnd = originalGroupEnd;
    });

    test("group and groupEnd should not call console.group when debug mode is disabled", () => {
      Logger.isDebugMode = jest.fn().mockReturnValue(false);

      const originalGroup = console.group;
      const originalGroupEnd = console.groupEnd;
      console.group = jest.fn();
      console.groupEnd = jest.fn();

      Logger.group("test group");
      Logger.groupEnd();

      expect(console.group).not.toHaveBeenCalled();
      expect(console.groupEnd).not.toHaveBeenCalled();

      console.group = originalGroup;
      console.groupEnd = originalGroupEnd;
    });
  });
});
