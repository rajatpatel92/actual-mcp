// ----------------------------
// SYNC BUDGET TOOL
// ----------------------------

import { z, toJSONSchema } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { success, errorFromCatch } from '../../utils/response.js';
import { syncBudget } from '../../actual-api.js';
import type { ToolInput } from '../../types.js';

const SyncBudgetArgsSchema = z.object({
  force: z
    .boolean()
    .optional()
    .describe('Whether to force synchronization even if recently synced within cooldown (default: true).'),
});

type SyncBudgetArgs = z.infer<typeof SyncBudgetArgsSchema>;

export const schema = {
  name: 'sync-budget',
  description:
    'Synchronize local budget data with the remote Actual Budget server to ensure all latest transactions, accounts, and categories are up-to-date.',
  inputSchema: toJSONSchema(SyncBudgetArgsSchema) as ToolInput,
};

export async function handler(args: SyncBudgetArgs): Promise<CallToolResult> {
  try {
    const validatedArgs = SyncBudgetArgsSchema.parse(args ?? {});
    const force = validatedArgs.force ?? true;

    await syncBudget(force);

    return success('Budget synchronization completed successfully.');
  } catch (err) {
    return errorFromCatch(err);
  }
}
