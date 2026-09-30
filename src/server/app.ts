import type { Catalog } from '../core/catalog.js';

export async function startServer(_opts: { port: number; open: boolean; catalog?: Catalog }): Promise<{ url: string; close(): Promise<void> }> {
  throw new Error('server non ancora implementato');
}
