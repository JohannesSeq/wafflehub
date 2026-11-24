import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const states = sqliteTable('companion_states', {
  userId: text('user_id').primaryKey(),
  data: text('data').notNull(),
  updatedAt: text('updated_at').notNull(),
});
