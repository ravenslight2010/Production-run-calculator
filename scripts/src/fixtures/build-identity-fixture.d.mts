import type { TestContext } from "node:test";
export function sourceFixture(context: TestContext): string;
export function put(root: string, file: string, content?: string): void;
export function outputs(root: string): void;