import fs from "fs";
import path from "path";
import http from "http";
import multiparty from "multiparty";
import WebSocket from "ws";
import { WebSocketServer } from "ws";
import crypto from "crypto";
import * as oicq from "icqq";
import * as api from "./api";
import { Config, httpReverse, configDir, sampleConfig } from "./configs";
import { AddressInfo } from "net";
import * as extra from "./extra";
import axios from "axios";
import qs from "querystring";

let bot: oicq.Client;
let wss: WebSocketServer;
let http_reverse: httpReverse;

function startup(account: number, configs: { [k: string]: Config }) {
  const passDir = path.join(configDir, account.toString());
  if(!fs.existsSync(passDir)) fs.mkdirSync(passDir);
  const passFile = path.join(passDir, "password");
  const generalConfig = configs["general"];
  const accountConfig = configs[account.toString()];
  let config: Config;

  if (generalConfig !== undefined) {
    config = Object.assign(generalConfig, accountConfig);
  } else if (accountConfig !== undefined) {
    config = accountConfig;
  } else {
    config = sampleConfig.general;
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
  http_reverse = config.http_reverse || [];
  createBot(account, config, passFile);
  createServer(config);
  setTimeout(botLogin, 500, account, passFile);
}

function createBot(account: number, config: Config, passFile: string) {
  bot = oicq.createClient({
    log_level: config.log_level,
    platform: config.platform,
    ignore_self: config.ignore_self,
    data_dir: configDir,
  });
  if((config as any).qsign != undefined) {
    (bot as any).sig.sign_api_addr = (config as any).qsign
  }
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
      botLoginWithPassword(account, passFile);
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

function escapeCQInside(s: string) {
  if (s === "&") return "&amp;"
  if (s === ",") return "&#44;"
  if (s === "[") return "&#91;"
  if (s === "]") return "&#93;"
  return ""
}

function genCqcode(content: MessageElem[]) {
  let cqcode = ""
  for (let elem of content) {
      if (elem.type === "text") {
          cqcode += elem.text
          continue
      }
      const tmp = { ...elem } as Partial<MessageElem>
      delete tmp.type
      const str = qs.stringify(tmp as NodeJS.Dict<any>, ",", "=", { encodeURIComponent: (s) => s.replace(/&|,|\[|\]/g, escapeCQInside) })
      cqcode += "[CQ:" + elem.type + (str ? "," : "") + str + "]"
  }
  return cqcode
}

function dipatch(event: any) {
  if (event.message !== undefined) {
    event.cq_message = genCqcode(event.message)
  }
  const json = JSON.stringify(event);
  wss?.clients.forEach((ws) => {
    bot.logger.debug(`正向WS上报事件: ` + json);
    ws.send(json);
  });
  http_reverse?.filter(x => x.enable).forEach((config) => {
    const sign = crypto
      .createHmac("sha1", config.secret || "")
      .update(json)
      .digest("hex");
    axios
      .post(config.url, json, {
        headers: {
          "Content-Type": "application/json",
          "X-Signature": `sha1=${sign}`,
        },
      })
      .catch((err) => {
        bot.logger.error(`反向HTTP上报事件失败: ${err}`);
      });
  })
}

function createServer(config: Config) {
  if (!config.use_http && !config.use_ws) {
    return;
  }
  let server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (config.enable_cors) res.setHeader('Access-Control-Allow-Origin', '*');
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
  // FIX: 当请求的url为 / 时，req.url 为 undefined
  const url = new URL(req.url as string, `http://${req.headers.host}`);
  const action = url.pathname.replace(/\//g, "");
  if (req.method === "GET") {
    bot.logger.debug(`收到GET请求: ` + req.url);
    const params = url.searchParams;
    try {
      let ret;
      if (extra.extraActions.hasOwnProperty(action)) {
        ret = await extra.apply(bot, { action, params });
      } else {
        ret = await api.apply({ action, params });
      }
      res.end(ret);
    } catch (e) {
      bot.logger.error(e);
      res.writeHead(404).end("404 Not Found");
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
      let rawData: Array<any> = [];
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

function botLogin(account: number, passFile: string) {
  try {
    const password = fs.readFileSync(passFile);
    bot.login(account, password.length ? password : undefined);
  } catch {
    botLoginWithPassword(account, passFile);
  }
}

function botLoginWithPassword(account: number, passFile: string) {
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
    return bot.login(account, password);
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
