import path from "path";
import fs from "fs";
import os from "os";
import { Platform, LogLevel } from "oicq";

export type Config = {
  platform: Platform;
  log_level: LogLevel;
  ignore_self: boolean;
  host: string;
  port: number;
  use_http: boolean;
  use_ws: boolean;
  access_token: string;
  enable_cors: boolean;
  enable_heartbeat: boolean;
  heartbeat_interval: number;
  rate_limit_interval: number;
};

export const configDir = path.join(os.homedir(), ".oicq");
const configPath = path.join(configDir, "config.json");

const config: { [k: string]: Config } = JSON.parse(
  fs.readFileSync(configPath).toString()
);

export default config;
