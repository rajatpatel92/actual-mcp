import api from '@actual-app/api';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { BudgetFile, TransactionData, UpdateTransactionData } from './types.js';
import { APIAccountEntity, APICategoryEntity, APICategoryGroupEntity, APIPayeeEntity } from '@actual-app/api/models';
import type { RuleEntity, TransactionEntity, ImportTransactionEntity } from '@actual-app/core/types/models';

const DEFAULT_DATA_DIR: string = path.resolve(os.homedir() || '.', '.actual');

// API initialization state
let initialized = false;
let initializing = false;
let initializationError: Error | null = null;

// Synchronization state
let lastSyncTimestamp = 0;
let syncPromise: Promise<void> | null = null;
const DEFAULT_SYNC_COOLDOWN_MS = 30000;

/**
 * Initialize the Actual Budget API
 */
export async function initActualApi(): Promise<void> {
  if (initialized) return;
  if (initializing) {
    // Wait for initialization to complete if already in progress
    while (initializing) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (initializationError) throw initializationError;
    return;
  }

  initializing = true;
  try {
    console.error('Initializing Actual Budget API...');
    const dataDir = process.env.ACTUAL_DATA_DIR || DEFAULT_DATA_DIR;
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const serverURL = process.env.ACTUAL_SERVER_URL;
    const password = process.env.ACTUAL_PASSWORD;
    // Reason: InitConfig is a discriminated union in 26.x — NoServerConfig forbids serverURL/password
    const initConfig = serverURL ? { dataDir, serverURL, password: password ?? '' } : { dataDir };
    await api.init(initConfig);

    const budgets: BudgetFile[] = await api.getBudgets();
    if (!budgets || budgets.length === 0) {
      throw new Error('No budgets found. Please create a budget in Actual first.');
    }

    // Use specified budget or the first one
    const budgetId: string = process.env.ACTUAL_BUDGET_SYNC_ID || budgets[0].cloudFileId || budgets[0].id || '';
    console.error(`Loading budget: ${budgetId}`);
    await api.downloadBudget(
      budgetId,
      process.env.ACTUAL_BUDGET_ENCRYPTION_PASSWORD
        ? {
            password: process.env.ACTUAL_BUDGET_ENCRYPTION_PASSWORD,
          }
        : undefined
    );

    initialized = true;
    lastSyncTimestamp = Date.now();
    console.error('Actual Budget API initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Actual Budget API:', error);
    initializationError = error instanceof Error ? error : new Error(String(error));
    throw initializationError;
  } finally {
    initializing = false;
  }
}

/**
 * Shutdown the Actual Budget API
 */
export async function shutdownActualApi(): Promise<void> {
  if (!initialized) return;
  try {
    await api.shutdown();
  } catch (err) {
    console.error('Error shutting down Actual Budget API:', err);
  } finally {
    initialized = false;
    lastSyncTimestamp = 0;
    syncPromise = null;
  }
}

/**
 * Synchronize local budget data with the remote Actual server.
 *
 * @param force - If true, bypasses the sync cooldown window.
 */
export async function syncBudget(force = false): Promise<void> {
  await initActualApi();

  // # Reason: Offline / local-only setups without a remote server URL cannot sync with a server.
  if (!process.env.ACTUAL_SERVER_URL) {
    return;
  }

  const cooldownMs = process.env.ACTUAL_SYNC_COOLDOWN_MS
    ? parseInt(process.env.ACTUAL_SYNC_COOLDOWN_MS, 10)
    : DEFAULT_SYNC_COOLDOWN_MS;

  const now = Date.now();
  if (!force && lastSyncTimestamp > 0 && now - lastSyncTimestamp < cooldownMs) {
    return;
  }

  // # Reason: Coalesce concurrent sync requests into a single promise to avoid race conditions.
  if (syncPromise) {
    return syncPromise;
  }

  syncPromise = (async (): Promise<void> => {
    try {
      console.error('Syncing budget with Actual Budget server...');
      await api.sync();
      lastSyncTimestamp = Date.now();
      console.error('Budget synced successfully');
    } catch (error) {
      // # Reason: If remote sync fails (e.g. temporary network blip), log a warning but allow
      // operations to proceed using local data rather than failing the entire request.
      console.error('Warning: Failed to sync budget with Actual Budget server:', error);
    } finally {
      syncPromise = null;
    }
  })();

  return syncPromise;
}

// ----------------------------
// FETCH
// ----------------------------

/**
 * Get all accounts (ensures API is initialized and fresh)
 */
export async function getAccounts(): Promise<APIAccountEntity[]> {
  await initActualApi();
  await syncBudget();
  return api.getAccounts();
}

/**
 * Get account balance (ensures API is initialized and fresh)
 */
export async function getAccountBalance(accountId: string): Promise<number> {
  await initActualApi();
  await syncBudget();
  return api.getAccountBalance(accountId);
}

/**
 * Get all categories (ensures API is initialized and fresh)
 */
export async function getCategories(): Promise<(APICategoryEntity | APICategoryGroupEntity)[]> {
  await initActualApi();
  await syncBudget();
  return api.getCategories();
}

/**
 * Get all category groups (ensures API is initialized and fresh)
 */
export async function getCategoryGroups(): Promise<APICategoryGroupEntity[]> {
  await initActualApi();
  await syncBudget();
  return api.getCategoryGroups();
}

/**
 * Get all payees (ensures API is initialized and fresh)
 */
export async function getPayees(): Promise<APIPayeeEntity[]> {
  await initActualApi();
  await syncBudget();
  return api.getPayees();
}

/**
 * Get transactions for a specific account and date range (ensures API is initialized and fresh)
 */
export async function getTransactions(accountId: string, start: string, end: string): Promise<TransactionEntity[]> {
  await initActualApi();
  await syncBudget();
  return api.getTransactions(accountId, start, end);
}

/**
 * Get all rules (ensures API is initialized and fresh)
 */
export async function getRules(): Promise<RuleEntity[]> {
  await initActualApi();
  await syncBudget();
  return api.getRules();
}

// ----------------------------
// ACTION
// ----------------------------

/**
 * Create a new payee (ensures API is initialized and syncs to server)
 */
export async function createPayee(args: Record<string, unknown>): Promise<string> {
  await initActualApi();
  const result = await api.createPayee(args as unknown as Omit<APIPayeeEntity, 'id'>);
  await syncBudget(true);
  return result;
}

/**
 * Update a payee (ensures API is initialized and syncs to server)
 */
export async function updatePayee(id: string, args: Record<string, unknown>): Promise<unknown> {
  await initActualApi();
  const result = await api.updatePayee(id, args);
  await syncBudget(true);
  return result;
}

/**
 * Delete a payee (ensures API is initialized and syncs to server)
 */
export async function deletePayee(id: string): Promise<unknown> {
  await initActualApi();
  const result = await api.deletePayee(id);
  await syncBudget(true);
  return result;
}

/**
 * Create a new rule (ensures API is initialized and syncs to server)
 */
export async function createRule(args: Record<string, unknown>): Promise<RuleEntity> {
  await initActualApi();
  const result = await api.createRule(args as unknown as Omit<RuleEntity, 'id'>);
  await syncBudget(true);
  return result;
}

/**
 * Update a rule (ensures API is initialized and syncs to server)
 */
export async function updateRule(args: Record<string, unknown>): Promise<RuleEntity> {
  await initActualApi();
  const result = await api.updateRule(args as unknown as RuleEntity);
  await syncBudget(true);
  return result;
}

/**
 * Delete a rule (ensures API is initialized and syncs to server)
 */
export async function deleteRule(id: string): Promise<boolean> {
  await initActualApi();
  const result = await api.deleteRule(id);
  await syncBudget(true);
  return result;
}

/**
 * Create a new category (ensures API is initialized and syncs to server)
 */
export async function createCategory(args: Record<string, unknown>): Promise<string> {
  await initActualApi();
  const result = await api.createCategory(args as unknown as Omit<APICategoryEntity, 'id'>);
  await syncBudget(true);
  return result;
}

/**
 * Update a category (ensures API is initialized and syncs to server)
 */
export async function updateCategory(id: string, args: Record<string, unknown>): Promise<unknown> {
  await initActualApi();
  const result = await api.updateCategory(id, args);
  await syncBudget(true);
  return result;
}

/**
 * Delete a category (ensures API is initialized and syncs to server)
 */
export async function deleteCategory(id: string): Promise<void> {
  await initActualApi();
  await api.deleteCategory(id);
  await syncBudget(true);
}

/**
 * Create a new category group (ensures API is initialized and syncs to server)
 */
export async function createCategoryGroup(args: Record<string, unknown>): Promise<string> {
  await initActualApi();
  const result = await api.createCategoryGroup(args as unknown as Omit<APICategoryGroupEntity, 'id'>);
  await syncBudget(true);
  return result;
}

/**
 * Update a category group (ensures API is initialized and syncs to server)
 */
export async function updateCategoryGroup(id: string, args: Record<string, unknown>): Promise<unknown> {
  await initActualApi();
  const result = await api.updateCategoryGroup(id, args);
  await syncBudget(true);
  return result;
}

/**
 * Delete a category group (ensures API is initialized and syncs to server)
 */
export async function deleteCategoryGroup(id: string): Promise<unknown> {
  await initActualApi();
  const result = await api.deleteCategoryGroup(id);
  await syncBudget(true);
  return result;
}

/**
 * Create a transaction (ensures API is initialized and syncs to server).
 * Passes runTransfers so that transfer payees automatically create the counterpart transaction.
 */
export async function createTransaction(accountId: string, data: TransactionData): Promise<string> {
  await initActualApi();
  const result = await api.addTransactions(accountId, [data], { runTransfers: true });
  await syncBudget(true);
  return result;
}

/**
 * Import a list of transactions using Actual's reconciliation logic.
 * Deduplicates via imported_id and optionally supports dry-run validation.
 */
export async function importTransactions(
  accountId: string,
  transactions: ImportTransactionEntity[],
  opts?: { defaultCleared?: boolean; dryRun?: boolean }
): Promise<{ added: string[]; updated: string[]; errors: Array<{ message: string }> }> {
  await initActualApi();
  const result = await api.importTransactions(accountId, transactions, opts);
  if (!opts?.dryRun) {
    await syncBudget(true);
  }
  return result;
}

/**
 * Update a transaction (ensures API is initialized and syncs to server)
 */
export async function updateTransaction(id: string, data: UpdateTransactionData): Promise<unknown> {
  await initActualApi();
  const result = await api.updateTransaction(id, data as unknown as Partial<TransactionEntity>);
  await syncBudget(true);
  return result;
}

/**
 * Delete a transaction (ensures API is initialized and syncs to server)
 */
export async function deleteTransaction(id: string): Promise<unknown> {
  await initActualApi();
  const result = await api.deleteTransaction(id);
  await syncBudget(true);
  return result;
}

/**
 * Run bank sync for accounts (ensures API is initialized)
 *
 * @param accountId - Optional. Specific account ID, or special value:
 *   - "onbudget": sync all on-budget linked accounts
 *   - "offbudget": sync all off-budget linked accounts
 *   - undefined: sync ALL linked accounts
 */
export async function runBankSync(accountId?: string): Promise<void> {
  await initActualApi();
  // API expects { accountId } object or undefined for all accounts
  await api.runBankSync(accountId ? { accountId } : undefined);
  await syncBudget(true);
}
