import path from "path";
import fs from "fs";
import os from "os";
import { Platform, LogLevel } from "icqq";

export type httpReverse = Array<{ enable: boolean, url: string, secret?: string}>;

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
  http_reverse?: httpReverse
};

export const configDir = path.join(os.homedir(), ".oicq");
const configPath = path.join(configDir, "config.json");
export const sampleConfig = {
    general: {
        platform: Platform.iPad,
        ignore_self: false,
        log_level: "info" as LogLevel,
        host: "0.0.0.0",
        port: 5700,
        use_http: true,
        use_ws: true,
        access_token: "",
        enable_cors: true,
        enable_heartbeat: true,
        heartbeat_interval: 15000,
        rate_limit_interval: 500,
        http_reverse: [
          {
            enable: false,
            url: "http://127.0.0.1:5000",
            secret: "",
          }
        ]
    }
};

if (!fs.existsSync(configDir)) fs.mkdirSync(configDir);

if (!fs.existsSync(configPath)) {
  fs.writeFileSync(configPath, JSON.stringify(sampleConfig, null, 2));
  console.log(`配置文件不存在，已帮你自动生成，请修改后再次启动程序。
  配置文件在：${configPath}
  `);
  process.exit(0);
}

const config: { [k: string]: Config } = JSON.parse(
  fs.readFileSync(configPath).toString()
);

export default config;
