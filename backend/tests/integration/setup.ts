
import dotenv from "dotenv";

dotenv.config({ path: ".env.test", override: true });
import { Pool } from "pg";

const EXPECTED_DATABASE = "ecommerce_dashboard_migration_test";

async function verifyTestDatabase(): Promise<void> {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
        throw new Error(
            "Integration tests stopped: DATABASE_URL is not defined."
        );
    }

    let databaseFromUrl: string;

    try {
        const parsedUrl = new URL(connectionString);

        if (
            parsedUrl.protocol !== "postgres:" &&
            parsedUrl.protocol !== "postgresql:"
        ) {
            throw new Error("Unsupported database protocol.");
        }

        databaseFromUrl = decodeURIComponent(
            parsedUrl.pathname.replace(/^\//, "")
        );
    } catch {
        throw new Error(
            "Integration tests stopped: DATABASE_URL is invalid."
        );
    }

    if (databaseFromUrl !== EXPECTED_DATABASE) {
        throw new Error(
            `Integration tests stopped: expected database "${EXPECTED_DATABASE}", received "${databaseFromUrl}".`
        );
    }

    const pool = new Pool({
        connectionString,
        max: 1,
    });

    try {
        const result = await pool.query(
            "SELECT current_database() AS database_name"
        );

        const actualDatabase = result.rows[0]?.database_name;

        if (actualDatabase !== EXPECTED_DATABASE) {
            throw new Error(
                `Integration tests stopped: PostgreSQL connected to an unexpected database.`
            );
        }
    } catch {
        throw new Error(
            "Integration tests stopped: unable to verify the PostgreSQL test database."
        );
    } finally {
        await pool.end();
    }

    const jwtSecret = process.env.JWT_ACCESS_SECRET;
    const csrfSecret = process.env.CSRF_SECRET;

    if (!jwtSecret || Buffer.byteLength(jwtSecret, "utf8") < 32) {
        throw new Error(
            "Integration tests stopped: JWT_ACCESS_SECRET must contain at least 32 bytes."
        );
    }

    if (!csrfSecret || Buffer.byteLength(csrfSecret, "utf8") < 32) {
        throw new Error(
            "Integration tests stopped: CSRF_SECRET must contain at least 32 bytes."
        );
    }
}

await verifyTestDatabase();
