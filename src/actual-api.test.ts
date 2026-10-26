import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
}));

vi.mock('@actual-app/api', () => ({
  default: {
    init: vi.fn(),
    shutdown: vi.fn(),
    getBudgets: vi.fn(),
    downloadBudget: vi.fn(),
    sync: vi.fn(),
    getAccounts: vi.fn(),
    getCategories: vi.fn(),
    getCategoryGroups: vi.fn(),
    getPayees: vi.fn(),
    getTransactions: vi.fn(),
    getRules: vi.fn(),
    getAccountBalance: vi.fn(),
    createPayee: vi.fn(),
    updatePayee: vi.fn(),
    deletePayee: vi.fn(),
    createRule: vi.fn(),
    updateRule: vi.fn(),
    deleteRule: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
    createCategoryGroup: vi.fn(),
    updateCategoryGroup: vi.fn(),
    deleteCategoryGroup: vi.fn(),
    addTransactions: vi.fn(),
    importTransactions: vi.fn(),
    updateTransaction: vi.fn(),
    deleteTransaction: vi.fn(),
    runBankSync: vi.fn(),
  },
}));

import api from '@actual-app/api';
import {
  initActualApi,
  shutdownActualApi,
  syncBudget,
  getTransactions,
  createTransaction,
  getAccounts,
} from './actual-api.js';

describe('actual-api synchronization', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.ACTUAL_SERVER_URL = 'http://actual.example.com';
    process.env.ACTUAL_PASSWORD = 'secret-password';
    process.env.ACTUAL_BUDGET_SYNC_ID = 'test-budget-id';
    process.env.ACTUAL_SYNC_COOLDOWN_MS = '30000';

    vi.mocked(api.getBudgets).mockResolvedValue([
      { id: 'test-budget-id', name: 'My Budget', cloudFileId: 'test-budget-id' },
    ] as unknown as Awaited<ReturnType<typeof api.getBudgets>>);
    vi.mocked(api.init).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof api.init>>);
    vi.mocked(api.downloadBudget).mockResolvedValue(undefined);
    vi.mocked(api.sync).mockResolvedValue(undefined);
    vi.mocked(api.shutdown).mockResolvedValue(undefined);

    await shutdownActualApi();
  });

  afterEach(async () => {
    await shutdownActualApi();
    process.env = originalEnv;
  });

  describe('syncBudget', () => {
    it('should call api.sync when server URL is configured (happy path)', async () => {
      await initActualApi();
      expect(api.downloadBudget).toHaveBeenCalledWith('test-budget-id', undefined);

      // Force sync
      await syncBudget(true);
      expect(api.sync).toHaveBeenCalledTimes(1);
    });

    it('should respect cooldown and avoid redundant sync calls (edge case)', async () => {
      await initActualApi();
      // First sync
      await syncBudget(true);
      expect(api.sync).toHaveBeenCalledTimes(1);

      // Second sync within cooldown (30s) without force
      await syncBudget(false);
      expect(api.sync).toHaveBeenCalledTimes(1);

      // Force sync should bypass cooldown
      await syncBudget(true);
      expect(api.sync).toHaveBeenCalledTimes(2);
    });

    it('should skip sync when ACTUAL_SERVER_URL is not set (offline mode)', async () => {
      delete process.env.ACTUAL_SERVER_URL;
      await initActualApi();

      await syncBudget(true);
      expect(api.sync).not.toHaveBeenCalled();
    });

    it('should catch and log sync errors without crashing (error handling)', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(api.sync).mockRejectedValue(new Error('Connection refused'));

      await initActualApi();
      await expect(syncBudget(true)).resolves.not.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to sync budget'), expect.any(Error));
      consoleErrorSpy.mockRestore();
    });
  });

  describe('fetch functions trigger sync', () => {
    it('getTransactions triggers syncBudget before querying api.getTransactions', async () => {
      process.env.ACTUAL_SYNC_COOLDOWN_MS = '0';
      vi.mocked(api.getTransactions).mockResolvedValue([]);

      await getTransactions('acc-1', '2026-01-01', '2026-01-31');

      expect(api.sync).toHaveBeenCalled();
      expect(api.getTransactions).toHaveBeenCalledWith('acc-1', '2026-01-01', '2026-01-31');
    });

    it('getAccounts triggers syncBudget before querying api.getAccounts', async () => {
      process.env.ACTUAL_SYNC_COOLDOWN_MS = '0';
      vi.mocked(api.getAccounts).mockResolvedValue([]);

      await getAccounts();

      expect(api.sync).toHaveBeenCalled();
      expect(api.getAccounts).toHaveBeenCalled();
    });
  });

  describe('action functions trigger immediate sync', () => {
    it('createTransaction triggers forced syncBudget after adding transaction', async () => {
      vi.mocked(api.addTransactions).mockResolvedValue('ok');

      await createTransaction('acc-1', {
        date: '2026-10-25',
        amount: -500,
        payee_name: 'Store',
      });

      expect(api.addTransactions).toHaveBeenCalledWith(
        'acc-1',
        [{ date: '2026-10-25', amount: -500, payee_name: 'Store' }],
        { runTransfers: true }
      );
      expect(api.sync).toHaveBeenCalled();
    });
  });
});
