import type { Annotation } from "./types";

export interface UndoAction {
  type: "delete";
  annotation: Annotation;
}

export class UndoStack<T = UndoAction> {
  private stack: T[] = [];
  private maxSize: number;

  constructor(maxSize = 10) {
    this.maxSize = maxSize;
  }

  push(action: T): void {
    this.stack.push(action);
    if (this.stack.length > this.maxSize) {
      this.stack.shift();
    }
  }

  undo(): T | null {
    return this.stack.pop() ?? null;
  }

  canUndo(): boolean {
    return this.stack.length > 0;
  }

  clear(): void {
    this.stack.length = 0;
  }
}

export const undoStack = new UndoStack<UndoAction>();
