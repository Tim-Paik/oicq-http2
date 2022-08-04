import fs from "fs";
import path from "path";
import http from "http";
import axios, { AxiosRequestConfig } from "axios";
import WebSocket from "ws";
import { WebSocketServer } from "ws";
import crypto from "crypto";
import * as oicq from "oicq";
import * as api from "./api";
import { Config, configDir } from "./configs";
import { AddressInfo } from "net";

let bot: oicq.Client;
let wss: WebSocketServer;

function startup(account: number, configs: { [k: string]: Config }) {
  const passDir = path.join(configDir, account.toString());
  const passFile = path.join(passDir, "password");

  const config: Config = Object.assign(
    configs["general"],
    configs[account.toString()]
  );

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
  createServer(account, config);
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
      return bot.login();
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
  if (wss != undefined) {
    wss.clients.forEach((ws) => {
      bot.logger.debug(`正向WS上报事件: ` + json);
      ws.send(json);
    });
  }
}

function createServer(account: number, config: Config) {
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
    onHttpReq(req, res, config);
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
      onWSOpen(account, ws);
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

function onWSOpen(account: number, ws: WebSocket.WebSocket) {
  ws.on("message", async (rawData) => {
    bot.logger.debug(`收到WS消息: ` + rawData);
    let data = JSON.parse(rawData.toString());
    try {
      let ret;
      if (
        data.action === ".handle_quick_operation" ||
        data.action === ".handle_quick_operation_async" ||
        data.action === ".handle_quick_operation_rate_limited"
      ) {
        api.handleQuickOperation(data);
        ret = JSON.stringify({
          retcode: 1,
          status: "async",
          data: null,
          echo: data.echo,
        });
      } else if (data.action === "http_proxy") {
        let config: AxiosRequestConfig;
        let url = new URL(data.params.url);
        config = {
          headers: { Cookie: bot.cookies[url.hostname as oicq.Domain] },
          withCredentials: true,
        };
        try {
          config = Object.assign(config, data.params);
          let res = await axios(config);
          ret = JSON.stringify({
            data: {
              status: res.status,
              statusText: res.statusText,
              headers: res.headers,
              data: res.data,
            },
            echo: data.echo,
          });
        } catch (e) {
          ret = JSON.stringify({
            retcode: 1400,
            status: "failed",
            data: e,
            echo: data.echo,
          });
        }
      } else {
        ret = await api.apply(data);
      }
      ws.send(ret);
    } catch (e) {
      if (e instanceof api.NotFoundError) var retcode = 1404;
      else var retcode = 1400;
      ws.send(
        JSON.stringify({
          retcode: retcode,
          status: "failed",
          data: null,
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
  const url = new URL(req.url);
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
        res.end(ret);
      } catch (e) {
        if (e instanceof api.NotFoundError) res.writeHead(404).end();
        else res.writeHead(400).end();
      }
    });
  } else {
    res.writeHead(405).end();
  }
}

function botLogin(passFile: string) {
  try {
    const password = fs.readFileSync(passFile);
    bot.login(password.length ? password : null);
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
    bot.login(password);
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
      const cmd = input.split(" ")[0];
      const param = input.replace(cmd, "").trim();
      switch (cmd) {
        case "bye":
          bot.logout().then(() => {
            process.exit(0);
          });
          break;
        case "send":
          const abc = param.split(" ");
          const target = parseInt(abc[0]);
          if (bot.gl.has(target)) bot.sendGroupMsg(target, abc[1]);
          else bot.sendPrivateMsg(target, abc[1]);
          break;
        default:
          console.log(help);
          break;
      }
    })
    .on("error", () => {});
}

export default startup;
