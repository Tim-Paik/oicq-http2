import fs from "fs";
import path from "path";
import http from "http";
import multiparty from "multiparty";
import WebSocket from "ws";
import { WebSocketServer } from "ws";
import crypto from "crypto";
import * as oicq from "oicq";
import * as api from "./api";
import { Config, configDir } from "./configs";
import { AddressInfo } from "net";
import * as extra from "./extra";

let bot: oicq.Client;
let wss: WebSocketServer;

function startup(account: number, configs: { [k: string]: Config }) {
  const passDir = path.join(configDir, account.toString());
  const passFile = path.join(passDir, "password");
  const generalConfig = configs["general"];
  const accountConfig = configs[account.toString()];
  let config: Config;

  if (generalConfig !== undefined) {
    config = Object.assign(generalConfig, accountConfig);
  } else if (accountConfig !== undefined) {
    config = accountConfig;
  } else {
    config = {
      platform: 5,
      ignore_self: false,
      log_level: "info",
      host: "0.0.0.0",
      port: 5700,
      use_http: true,
      use_ws: true,
      access_token: "",
      enable_cors: true,
      enable_heartbeat: true,
      heartbeat_interval: 15000,
      rate_limit_interval: 500,
    };
  }

  if (config.enable_heartbeat && config.use_ws) {
    setInterval(() => {
      const json = JSON.stringify({
        time: ~~(Date.now() / 1000), // ~~number 取整数
        post_type: "meta_event",
        meta_event_type: "heartbeat",
        interval: config.heartbeat_interval,
      });
      if (wss) {
        wss.clients.forEach((ws) => {
          ws.send(json);
        });
      }
    }, config.heartbeat_interval);
  }
  createBot(account, config, passFile);
  createServer(config);
  setTimeout(botLogin, 500, passFile);
}

function createBot(account: number, config: Config, passFile: string) {
  bot = oicq.createClient(account, {
    log_level: config.log_level,
    platform: config.platform,
    ignore_self: config.ignore_self,
    data_dir: configDir,
  });
  api.setBot(bot, config.rate_limit_interval);

  bot.on("system.login.slider", () => {
    process.stdin.once("data", (input) => {
      let ticket = input
        .toString()
        .trim()
        .replace("ticket:", "")
        .trim()
        .replace(/"/g, "");
      bot.submitSlider(ticket);
    });
  });
  bot.on("system.login.qrcode", () => {
    bot.logger.mark("扫码完成后回车登录。");
    process.stdin.once("data", () => {
      bot.login();
    });
  });
  bot.on("system.login.device", () => {
    bot.logger.mark("验证完成后回车登录。");
    process.stdin.once("data", () => {
      bot.login();
    });
  });
  bot.on("system.login.error", (data) => {
    if (data.code === -2) {
      bot.login();
    }
    if (data.message.includes("密码错误")) {
      botLoginWithPassword(passFile);
    } else {
      bot.terminate();
    }
  });
  bot.on("system.online", () => {
    loop();
    dipatch({
      self_id: account,
      time: ~~(Date.now() / 1000),
      post_type: "meta_event",
      meta_event_type: "lifecycle",
      sub_type: "enable",
    });
  });
  bot.on("system.offline", () => {
    dipatch({
      self_id: account,
      time: ~~(Date.now() / 1000),
      post_type: "meta_event",
      meta_event_type: "lifecycle",
      sub_type: "disable",
    });
  });
  bot.on("request", dipatch);
  bot.on("notice", dipatch);
  bot.on("message", dipatch);
}

function dipatch(event: any) {
  const json = JSON.stringify(event);
  wss?.clients.forEach((ws) => {
    bot.logger.debug(`正向WS上报事件: ` + json);
    ws.send(json);
  });
}

function createServer(config: Config) {
  if (!config.use_http && !config.use_ws) {
    return;
  }
  let server = http.createServer((req, res) => {
    if (!config.use_http) return res.writeHead(404).end();
    if (req.method === "OPTIONS" && config.enable_cors) {
      return res
        .writeHead(200, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, authorization",
        })
        .end();
    }
    if (config.access_token) {
      if (!req.headers["authorization"]) {
        let params = new URLSearchParams(req.url);
        let access_token = params.get("access_token");
        if (access_token) {
          req.headers["authorization"] = access_token;
        } else {
          return res.writeHead(401).end();
        }
      }
      if (!req.headers["authorization"].includes(config.access_token))
        return res.writeHead(403).end();
    }
    return onHttpReq(req, res, config);
  });
  if (config.use_ws) {
    wss = new WebSocketServer({ server });
    wss.on("error", () => {});
    wss.on("connection", (ws, req) => {
      ws.on("error", () => {});
      if (config.access_token) {
        if (req.url) {
          const url = new URL("http://www.example.com/" + req.url);
          const accessToken = url.searchParams.get("access_token");
          if (accessToken) {
            req.headers["authorization"] = accessToken;
          }
        }
        if (
          !req.headers["authorization"] ||
          !req.headers["authorization"].includes(config.access_token)
        )
          return ws.close(1002);
      }
      onWSOpen(ws);
    });
  }
  server
    .listen(config.port, config.host, () => {
      let addr = server.address() as AddressInfo;
      bot.logger.info(
        `开启http服务器成功 正在监听${addr.address}:${addr.port}`
      );
    })
    .on("error", (e) => {
      bot.logger.error(e.message);
      bot.logger.error("开启http服务器失败 进程退出");
      process.exit(1);
    });
}

function onWSOpen(ws: WebSocket.WebSocket) {
  ws.on("message", async (rawData) => {
    bot.logger.debug(`收到WS消息: ` + rawData);
    let data = JSON.parse(rawData.toString());
    try {
      let ret;
      if (Object.keys(extra.extraActions).includes(data.action)) {
        ret = await extra.apply(bot, data);
      } else {
        ret = await api.apply(data);
      }
      ws.send(ret);
    } catch (e) {
      console.log(e);
      let error: number;
      if (e instanceof api.NotFoundError) error = 1404;
      else error = 1400;
      ws.send(
        JSON.stringify({
          self_id: bot.uin,
          error: error,
          echo: data.echo,
        })
      );
    }
  });
  ws.send(
    JSON.stringify({
      post_type: "meta_event",
      meta_event_type: "lifecycle",
      sub_type: "connect",
    })
  );
  ws.send(
    JSON.stringify({
      post_type: "meta_event",
      meta_event_type: "lifecycle",
      sub_type: "enable",
    })
  );
}

async function onHttpReq(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: Config
) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (config.enable_cors) res.setHeader("Access-Control-Allow-Origin", "*");
  // FIX: 当请求的url为 / 时，req.url 为 undefined
  const url = new URL(req.url as string, `http://${req.headers.host}`);
  const action = url.pathname.replace(/\//g, "");
  if (req.method === "GET") {
    bot.logger.debug(`收到GET请求: ` + req.url);
    const params = url.searchParams;
    try {
      const ret = await api.apply({ action, params });
      res.end(ret);
    } catch (e) {
      res.writeHead(404).end();
    }
  } else if (req.method === "POST") {
    if(req.headers["content-type"]?.includes("form-data")) {
      // SS：特殊处理表单提交
      const form = new multiparty.Form();
      form.parse(req, async function(err, fields, files) {
        if(err == null) {
          try {
            let params = fields;
            Object.keys(fields).forEach((item: string) => {
              params[item] = fields[item][0];
            })
            if(Object.keys(files).length > 0) {
              // 有文件的话只取第一个
              params.file = files.file[0];
            }
            let ret;
            if (Object.keys(extra.extraActions).includes(action)) {
              ret = await extra.apply(bot, { action, params });
            } else {
              ret = await api.apply({ action, params });
            }
            return res.end(ret);
          } catch(e) {
            console.log(e)
            if (e instanceof api.NotFoundError) return res.writeHead(404).end();
            else return res.writeHead(400).end();
          }
        } else {
          return res.writeHead(406).end();
        }
      });
    } else {
      let rawData: Array<any>;
      req.on("data", (chunk) => rawData.push(chunk));
      req.on("end", async () => {
        try {
          let data = Buffer.concat(rawData).toString();
          bot.logger.debug(`收到POST请求: ` + data);
          let params,
            ct = req.headers["content-type"];
          if (!ct || ct.includes("json")) params = data ? JSON.parse(data) : {};
          else if (ct && ct.includes("x-www-form-urlencoded"))
            params = new URLSearchParams(data);
          else return res.writeHead(406).end();
          const ret = await api.apply({ action, params });
          return res.end(ret);
        } catch (e) {
          if (e instanceof api.NotFoundError) return res.writeHead(404).end();
          else return res.writeHead(400).end();
        }
      });
    }
  } else {
    res.writeHead(405).end();
  }
}

function botLogin(passFile: string) {
  try {
    const password = fs.readFileSync(passFile);
    bot.login(password.length ? password : undefined);
  } catch {
    botLoginWithPassword(passFile);
  }
}

function botLoginWithPassword(passFile: string) {
  console.log("请输入密码 (直接按回车扫码登录): ");
  process.stdin.once("data", (input) => {
    let inputStr = input.toString().trim();
    if (!inputStr.length) {
      fs.writeFileSync(passFile, "", { mode: 0o600 });
      return bot.login();
    }
    const password = crypto.createHash("md5").update(inputStr).digest();
    fs.writeFileSync(passFile, password, {
      mode: 0o600,
    });
    return bot.login(password);
  });
}

function loop() {
  const help = `※你已成功登录，此控制台有简单的指令可用于调试。
※发言: send <target> <message>
※下线结束程序: bye`;
  console.log(help);
  process.stdin
    .on("data", async (rawInput) => {
      let input = rawInput.toString().trim();
      if (!input) return;
      const cmd = input.split(" ")[0] as string;
      const param = input.replace(cmd, "").trim();
      switch (cmd) {
        case "bye":
          bot.logout().then(() => {
            process.exit(0);
          });
          break;
        case "send":
          const arr = param.split(" ");
          if (arr.length !== 2) {
            console.log(`send <target> <message>`);
            return;
          }
          const target = parseInt(arr[0] as string);
          if (bot.gl.has(target)) bot.sendGroupMsg(target, arr[1] as string);
          else bot.sendPrivateMsg(target, arr[1] as string);
          break;
        default:
          console.log(help);
          break;
      }
    })
    .on("error", () => {});
}

export default startup;
