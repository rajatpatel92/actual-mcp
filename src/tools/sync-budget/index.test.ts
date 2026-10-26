import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler, schema } from './index.js';

vi.mock('../../actual-api.js', () => ({
  syncBudget: vi.fn(),
}));

import { syncBudget } from '../../actual-api.js';

describe('sync-budget tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('schema', () => {
    it('should have correct name and description', () => {
      expect(schema.name).toBe('sync-budget');
      expect(schema.description).toContain('Synchronize local budget data');
    });

    it('should have inputSchema defined', () => {
      expect(schema.inputSchema).toBeDefined();
      expect(schema.inputSchema.type).toBe('object');
    });
  });

  describe('handler - happy path', () => {
    it('should sync with force=true by default when no args provided', async () => {
      vi.mocked(syncBudget).mockResolvedValue(undefined);

      const result = await handler({});

      expect(syncBudget).toHaveBeenCalledWith(true);
      expect(result.content[0]).toHaveProperty('text');
      expect((result.content[0] as { text: string }).text).toContain('Budget synchronization completed');
    });

    it('should pass force=false when explicitly specified', async () => {
      vi.mocked(syncBudget).mockResolvedValue(undefined);

      const result = await handler({ force: false });

      expect(syncBudget).toHaveBeenCalledWith(false);
      expect(result.content[0]).toHaveProperty('text');
      expect((result.content[0] as { text: string }).text).toContain('Budget synchronization completed');
    });

    it('should pass force=true when explicitly specified', async () => {
      vi.mocked(syncBudget).mockResolvedValue(undefined);

      const result = await handler({ force: true });

      expect(syncBudget).toHaveBeenCalledWith(true);
      expect(result.isError).toBeFalsy();
    });
  });

  describe('handler - edge cases', () => {
    it('should handle undefined args gracefully', async () => {
      vi.mocked(syncBudget).mockResolvedValue(undefined);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await handler(undefined as any);

      expect(syncBudget).toHaveBeenCalledWith(true);
      expect(result.isError).toBeFalsy();
    });

    it('should reject invalid argument types', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await handler({ force: 'yes' } as any);

      expect(result.isError).toBe(true);
      expect(syncBudget).not.toHaveBeenCalled();
    });
  });

  describe('handler - error handling', () => {
    it('should handle sync errors gracefully', async () => {
      vi.mocked(syncBudget).mockRejectedValue(new Error('Sync failed: network timeout'));

      const result = await handler({});

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain('Sync failed: network timeout');
    });
  });
});
