import { describe, it, expect, beforeEach } from "vitest";
import { UndoStack } from "../../src/content-script/undo";

describe("UndoStack", () => {
  let stack: UndoStack<string>;

  beforeEach(() => {
    stack = new UndoStack<string>(10);
  });

  it("starts empty", () => {
    expect(stack.canUndo()).toBe(false);
    expect(stack.undo()).toBeNull();
  });

  it("pushes and undoes one action", () => {
    stack.push("action-1");
    expect(stack.canUndo()).toBe(true);
    expect(stack.undo()).toBe("action-1");
    expect(stack.canUndo()).toBe(false);
  });

  it("undoes in LIFO order", () => {
    stack.push("a");
    stack.push("b");
    stack.push("c");
    expect(stack.undo()).toBe("c");
    expect(stack.undo()).toBe("b");
    expect(stack.undo()).toBe("a");
    expect(stack.undo()).toBeNull();
  });

  it("respects max size", () => {
    const small = new UndoStack<number>(3);
    small.push(1);
    small.push(2);
    small.push(3);
    small.push(4); // evicts 1
    expect(small.undo()).toBe(4);
    expect(small.undo()).toBe(3);
    expect(small.undo()).toBe(2);
    expect(small.undo()).toBeNull(); // 1 was evicted
  });

  it("clears the stack", () => {
    stack.push("a");
    stack.push("b");
    stack.clear();
    expect(stack.canUndo()).toBe(false);
  });
});
