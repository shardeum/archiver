import * as sqlite3 from 'sqlite3';
import * as Logger from '../../Logger';

type PreparedStatementInitializer = (db: sqlite3.Database) => void;
type PreparedStatementFinalizer = () => Promise<void>;

const initializers: PreparedStatementInitializer[] = [];
const finalizers: PreparedStatementFinalizer[] = [];

/**
 * Register an initializer and finalizer for a set of prepared statements.
 */
export const registerPreparedStatements = (
  initializer: PreparedStatementInitializer,
  finalizer: PreparedStatementFinalizer
): void => {
  initializers.push(initializer);
  finalizers.push(finalizer);
};

/**
 * Initialize all registered prepared statements.
 */
export const initializePreparedStatements = (db: sqlite3.Database): void => {
  initializers.forEach((initialize) => initialize(db));
  Logger.mainLogger.info('All prepared statements initialized.');
};

/**
 * Finalize all registered prepared statements.
 */
export const finalizePreparedStatements = async (): Promise<void> => {
  await Promise.all(finalizers.map((finalize) => finalize()));
  Logger.mainLogger.info('All prepared statements finalized.');
};
