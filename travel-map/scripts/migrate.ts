import { loadConfig } from "../src/config";
import { openDatabase } from "../src/db";

const config = loadConfig();
const database = openDatabase(config.DATABASE_PATH);
database.close();
console.log(`Migrations applied to ${config.DATABASE_PATH}`);
