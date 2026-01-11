/**
 * Session Manager Pattern
 *
 * Demonstrates BaseSessionManager for managing shared resources across gadgets.
 * This pattern is useful for:
 * - Browser sessions (like dhalsim)
 * - Database connections
 * - API clients with state
 * - Any resource that needs to be shared across multiple gadget calls
 *
 * Run: npx tsx examples/23-session-manager.ts
 */

import {
  BaseSessionManager,
  Gadget,
  gadgetError,
  gadgetSuccess,
  LLMist,
  SimpleSessionManager,
  z,
} from "llmist";

// =============================================================================
// EXAMPLE 1: Database Session Manager
// =============================================================================

// Define the session type
interface DatabaseConnection {
  id: string;
  connected: boolean;
  query: (sql: string) => Promise<unknown[]>;
  close: () => Promise<void>;
}

// Extend BaseSessionManager with your session type
class DatabaseSessionManager extends BaseSessionManager<DatabaseConnection> {
  private host: string;

  constructor(host: string) {
    super();
    this.host = host;
  }

  async createSession(): Promise<string> {
    const id = this.generateId("db"); // Generates: db1, db2, db3...

    // Simulate database connection
    const connection: DatabaseConnection = {
      id,
      connected: true,
      query: async (sql) => {
        console.log(`  [${id}] Executing: ${sql}`);
        // Simulate query results
        if (sql.toLowerCase().includes("select")) {
          return [
            { id: 1, name: "Alice" },
            { id: 2, name: "Bob" },
          ];
        }
        return [];
      },
      close: async () => {
        console.log(`  [${id}] Connection closed`);
        connection.connected = false;
      },
    };

    this.sessions.set(id, connection);
    console.log(`  [${id}] Connected to ${this.host}`);
    return id;
  }

  async closeSession(id: string): Promise<void> {
    const conn = this.sessions.get(id);
    if (conn) {
      await conn.close();
      this.sessions.delete(id);
    }
  }
}

// =============================================================================
// GADGETS USING DATABASE SESSION MANAGER
// =============================================================================

class CreateConnection extends Gadget({
  description: "Create a new database connection",
  schema: z.object({}),
}) {
  constructor(private manager: DatabaseSessionManager) {
    super();
  }

  async execute(): Promise<string> {
    const connectionId = await this.manager.createSession();
    return gadgetSuccess({ connectionId, message: "Connection established" });
  }
}

class QueryDatabase extends Gadget({
  description: "Execute a SQL query on an existing connection",
  schema: z.object({
    connectionId: z.string().describe("Database connection ID"),
    sql: z.string().describe("SQL query to execute"),
  }),
}) {
  constructor(private manager: DatabaseSessionManager) {
    super();
  }

  async execute(params: this["params"]): Promise<string> {
    try {
      const conn = this.manager.requireSession(params.connectionId);
      const rows = await conn.query(params.sql);
      return gadgetSuccess({ rowCount: rows.length, data: rows });
    } catch (error) {
      return gadgetError((error as Error).message);
    }
  }
}

class CloseConnection extends Gadget({
  description: "Close a database connection",
  schema: z.object({
    connectionId: z.string().describe("Database connection ID"),
  }),
}) {
  constructor(private manager: DatabaseSessionManager) {
    super();
  }

  async execute(params: this["params"]): Promise<string> {
    if (!this.manager.hasSession(params.connectionId)) {
      return gadgetError(`Connection not found: ${params.connectionId}`);
    }
    await this.manager.closeSession(params.connectionId);
    return gadgetSuccess({ message: "Connection closed" });
  }
}

// =============================================================================
// EXAMPLE 2: SimpleSessionManager for basic cases
// =============================================================================

// SimpleSessionManager is useful when you just need to store/retrieve sessions
// without complex creation logic

interface ApiClient {
  baseUrl: string;
  apiKey: string;
  fetch: (path: string) => Promise<unknown>;
}

class ApiClientManager extends SimpleSessionManager<ApiClient> {
  // SimpleSessionManager provides createSession that stores whatever you pass
  // You can override closeSession for cleanup if needed

  async closeSession(id: string): Promise<void> {
    const client = this.getSession(id);
    if (client) {
      console.log(`  [${id}] API client disconnected from ${client.baseUrl}`);
      this.sessions.delete(id);
    }
  }
}

// =============================================================================
// DEMO: Database Session Manager
// =============================================================================

async function demoDatabaseSessionManager() {
  console.log("=== Database Session Manager Demo ===\n");

  const manager = new DatabaseSessionManager("localhost:5432");

  // Create gadget instances with manager dependency
  const createConn = new CreateConnection(manager);
  const queryDb = new QueryDatabase(manager);
  const closeConn = new CloseConnection(manager);

  // Simulate gadget usage
  console.log("1. Creating connection:");
  const result1 = await createConn.execute({});
  console.log(`   Result: ${result1}\n`);

  // Extract connection ID
  const connId = JSON.parse(result1).connectionId;

  console.log("2. Listing active sessions:");
  console.log(`   Sessions: ${manager.listSessions().join(", ")}\n`);

  console.log("3. Executing query:");
  const result2 = await queryDb.execute({
    connectionId: connId,
    sql: "SELECT * FROM users",
  });
  console.log(`   Result: ${result2}\n`);

  console.log("4. Using requireSession() on missing ID:");
  const result3 = await queryDb.execute({
    connectionId: "invalid-id",
    sql: "SELECT 1",
  });
  console.log(`   Result: ${result3}\n`);

  console.log("5. Closing connection:");
  const result4 = await closeConn.execute({ connectionId: connId });
  console.log(`   Result: ${result4}\n`);

  console.log("6. Sessions after close:");
  console.log(
    `   Sessions: ${manager.listSessions().length === 0 ? "(none)" : manager.listSessions().join(", ")}\n`,
  );
}

// =============================================================================
// DEMO: SimpleSessionManager
// =============================================================================

async function demoSimpleSessionManager() {
  console.log("=== Simple Session Manager Demo ===\n");

  const manager = new ApiClientManager();

  // Create sessions by passing the session object directly
  console.log("1. Creating API client sessions:");
  const id1 = await manager.createSession({
    baseUrl: "https://api.example.com",
    apiKey: "key-123",
    fetch: async (path) => ({ data: `Response from ${path}` }),
  });
  console.log(`   Created: ${id1}`);

  const id2 = await manager.createSession({
    baseUrl: "https://api.other.com",
    apiKey: "key-456",
    fetch: async (path) => ({ data: `Response from ${path}` }),
  });
  console.log(`   Created: ${id2}\n`);

  console.log("2. Listing sessions:");
  console.log(`   Sessions: ${manager.listSessions().join(", ")}\n`);

  console.log("3. Using getSession():");
  const client = manager.getSession(id1);
  console.log(`   Client ${id1} baseUrl: ${client?.baseUrl}\n`);

  console.log("4. Closing all sessions:");
  await manager.closeAll();
  console.log(
    `   Sessions after closeAll(): ${manager.listSessions().length === 0 ? "(none)" : manager.listSessions().join(", ")}\n`,
  );
}

// =============================================================================
// SHOW PATTERN FOR REAL-WORLD USE
// =============================================================================

function showRealWorldPattern() {
  console.log("=== Real-World Pattern: Browser Session Manager ===\n");

  console.log(`
// This is how dhalsim's BrowserSessionManager extends BaseSessionManager:

import { BaseSessionManager, type ISessionManager } from 'llmist';
import type { Browser, Page } from 'playwright';

interface BrowserSession {
  browser: Browser;
  page: Page;
  createdAt: Date;
}

export class BrowserSessionManager extends BaseSessionManager<BrowserSession> {
  async createSession(config?: { headless?: boolean }): Promise<string> {
    const id = this.generateId('browser');

    const browser = await chromium.launch({
      headless: config?.headless ?? true,
    });
    const page = await browser.newPage();

    this.sessions.set(id, {
      browser,
      page,
      createdAt: new Date(),
    });

    return id;
  }

  async closeSession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (session) {
      await session.browser.close();
      this.sessions.delete(id);
    }
  }

  // Custom method for this specific manager
  getPage(id: string): Page {
    return this.requireSession(id).page;
  }
}

// Then gadgets inject the manager:

class Navigate extends Gadget({
  description: 'Navigate to a URL',
  schema: z.object({
    sessionId: z.string(),
    url: z.string().url(),
  }),
}) {
  constructor(private manager: BrowserSessionManager) {
    super();
  }

  async execute(params: this['params']): Promise<string> {
    const page = this.manager.getPage(params.sessionId);
    await page.goto(params.url);
    return gadgetSuccess({ url: params.url, title: await page.title() });
  }
}
`);
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  await demoDatabaseSessionManager();
  await demoSimpleSessionManager();
  showRealWorldPattern();

  console.log("=== Done ===\n");
}

main().catch(console.error);
