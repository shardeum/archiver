import * as sqlite3 from 'sqlite3';
import * as Logger from '../../Logger';

// Centralized Map for all prepared statements
export const preparedStatementRegistry: Map<string, sqlite3.Statement> = new Map();

/**
 * Add a prepared statement to the registry.
 */
export const addPreparedStatement = (name: string, statement: sqlite3.Statement): void => {
  if (preparedStatementRegistry.has(name)) {
    Logger.mainLogger.error(`Prepared statement with name "${name}" is already registered.`);
    throw new Error(`Prepared statement with name "${name}" is already registered.`);
  }
  preparedStatementRegistry.set(name, statement);
};

/**
 * Get a prepared statement from the registry.
 */
export const getPreparedStmt = (name: string): sqlite3.Statement => {
  const stmt = preparedStatementRegistry.get(name);
  if (!stmt) {
    Logger.mainLogger.error(`Prepared statement not found: ${name}`);
    throw new Error(`Prepared statement not found: ${name}`);
  }
  return stmt;
};

/**
 * Finalize all prepared statements in the registry.
 */
export const finalizePreparedStatements = async (): Promise<void> => {
  const finalizePromises = Array.from(preparedStatementRegistry.values()).map(
    (stmt) =>
      new Promise<void>((resolve, reject) => {
        stmt.finalize((err) => {
          if (err) {
            Logger.mainLogger.error(`Error finalizing statement:`, err);
            reject(err);
          } else {
            resolve();
          }
        });
      })
  );
  await Promise.all(finalizePromises);
  preparedStatementRegistry.clear();
};
