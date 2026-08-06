import path from "node:path";

import { createProductionServices } from "../src/server/production";

const dataDir = process.env.KANBAN_DATA_DIR?.trim() || path.join(process.cwd(), "data");
const services = createProductionServices(dataDir);
const result = await services.formalDailySettlementRunner.run();

process.stdout.write(`${JSON.stringify({ outcome: result.outcome })}\n`);
