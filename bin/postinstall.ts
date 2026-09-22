#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installSkills } from "../src/install-skills.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
await installSkills(packageRoot);
