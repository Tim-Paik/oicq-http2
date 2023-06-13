import * as oicq from "oicq";
import { availableActions } from "./actions";
import { segment } from "icqq";

export class NotFoundError extends Error {}

const fn_signs: { [x: string]: string[] } = {};
const bool_fields = [
  "no_cache",
  "auto_escape",
  "as_long",
  "enable",
  "reject_add_request",
  "is_dismiss",
  "approve",
  "block",
];
let bot: oicq.Client;
let queue: { action: string; param_arr: string[] }[] = [];
let queue_running = false;
let rate_limit_interval = 500;

function getMethod(obj: Object, method: string): Function | undefined {
  let ret: Function | undefined;
  try {
    ret = Reflect.get(obj, method);
  } catch {
    bot.logger.error(`Undefined action: ${method}`);
    ret = undefined;
  }
  return ret;
}

async function runQueue() {
  if (queue_running) return;
  while (queue.length > 0) {
    queue_running = true;
    const task = queue.shift();
    getMethod(bot, task?.action as string)?.apply(bot, task?.param_arr);
    await new Promise((resolve) => {
      setTimeout(resolve, rate_limit_interval);
    });
    queue_running = false;
  }
}

export function setBot(client: oicq.Client, rate_limit: number) {
  bot = client;
  if (!isNaN(rate_limit) && rate_limit > 0) {
    rate_limit_interval = rate_limit;
  }
  for (let fn of availableActions) {
    let sign = getMethod(bot, fn)
      ?.toString()
      .match(/\(.*?\)/)
      ?.shift()
      ?.replace("(", "")
      .replace(")", "")
      .split(",");
    fn_signs[fn] = sign ? sign : [];
    fn_signs[fn]?.forEach((v: string, i: number, arr: string[]) => {
      arr[i] = v.replace(/=.+/, "").trim();
      // SS：去掉参数名里的一切数字 ……
      arr[i] = v.replace(/[0-9]+/g, "");
    });
  }
}

export async function apply({
  action,
  params,
  echo,
}: {
  action: string;
  params?: any;
  echo?: string;
}): Promise<string> {
  let is_async = action.includes("_async");
  if (is_async) action = action.replace("_async", "");
  let is_queue = action.includes("_rate_limited");
  if (is_queue) action = action.replace("_rate_limited", "");

  if (action === "send_msg") {
    if (["private", "group", "discuss"].includes(params.get("message_type"))) {
      action = "send_" + params.get("message_type") + "_msg";
    } else if (params.get("user_id")) {
      action = "send_private_msg";
    } else if (params.get("group_id")) {
      action = "send_group_msg";
    } else if (params.get("discuss_id")) {
      action = "send_discuss_msg";
    }
  }
  action = action.replace(/_[\w]/g, (s) => {
    if (s[1] === undefined) return "";
    return s[1].toUpperCase();
  });

  if (
    getMethod(bot, action) !== undefined &&
    availableActions.includes(action)
  ) {
    const param_arr = [];

    // FIX: URLSearchParams 对象在处理为 params 时转换错误
    if(params instanceof URLSearchParams) {
      params = Object.fromEntries(params);
    }

    let sign = fn_signs[action];
    if (sign !== undefined) {
      for (let k of sign) {
        if (Reflect.has(params, k)) {
          if (bool_fields.includes(k)) {
            let v = true;
            if (params[k] === "0" || params[k] === "false") v = false;
            params[k] = v ? "true" : "false";
          }
          param_arr.push(params[k]);
        }
      }
    }
    if (params?.auto_escape && action.startsWith("send") && action.endsWith("Msg")) {
        param_arr[1] = segment.fromCqcode(param_arr[1])
    }
    let ret;
    if (is_queue) {
      queue.push({ action, param_arr });
      runQueue();
      ret = {
        retcode: 1,
        status: "async",
        data: null,
      };
    } else {
      ret = getMethod(bot, action)?.apply(bot, param_arr);
      if (ret instanceof Promise) {
        if (is_async)
          ret = {
            retcode: 1,
            status: "async",
            data: null,
          };
        else ret = await ret;
      }
    }

    if (ret instanceof Map) {
      ret = {
        data: [...ret.values()],
      };
    }

    if (ret instanceof Array) {
      ret = {
        data: ret,
      };
    }

    if (echo) ret.echo = echo;
    return JSON.stringify(ret);
  } else {
    throw new NotFoundError();
  }
}
