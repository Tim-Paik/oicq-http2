import * as oicq from "oicq";
import { availableActions } from "./actions";

export class NotFoundError extends Error {}

const fn_signs: { [x: string]: any } = {};
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
let bot: any;
let queue: { action: string; param_arr: string[] }[] = [];
let queue_running = false;
let rate_limit_interval = 500;

async function runQueue() {
  if (queue_running) return;
  while (queue.length > 0) {
    queue_running = true;
    const task = queue.shift();
    const { action, param_arr } = task;
    bot[action].apply(bot, param_arr);
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
    if (bot[fn]) {
      fn_signs[fn] = bot[fn]
        .toString()
        .match(/\(.*?\)/)[0]
        .replace("(", "")
        .replace(")", "")
        .split(",");
      fn_signs[fn].forEach((v: string, i: number, arr: string[]) => {
        arr[i] = v.replace(/=.+/, "").trim();
      });
    }
  }
}

function quickOperate(event: any, res: any) {
  if (event.post_type === "message" && res.reply) {
    const action =
      event.message_type === "private" ? "sendPrivateMsg" : "sendGroupMsg";
    const id =
      event.message_type === "private" ? event.user_id : event.group_id;
    bot[action](id, res.reply, res.auto_escape);
    if (event.group_id) {
      if (res.delete) bot.deleteMsg(event.message_id);
      if (res.kick && !event.anonymous)
        bot.setGroupKick(event.group_id, event.user_id, res.reject_add_request);
      if (res.ban)
        bot.setGroupBan(
          event.group_id,
          event.user_id,
          res.ban_duration ? res.ban_duration : 1800
        );
    }
  }
  if (event.post_type === "request" && res.hasOwnProperty("approve")) {
    const action =
      event.request_type === "friend"
        ? "setFriendAddRequest"
        : "setGroupAddRequest";
    bot[action](
      event.flag,
      res.approve,
      res.reason ? res.reason : "",
      res.block ? true : false
    );
  }
}

export function handleQuickOperation(data: any) {
  const event = data.params.context,
    res = data.params.operation;
  quickOperate(event, res);
}

export async function apply({
  action,
  params,
  echo,
}: {
  action: string;
  params?: URLSearchParams;
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
    return s[1].toUpperCase();
  });

  if (bot[action] && availableActions.includes(action)) {
    const param_arr = [];

    for (let k of fn_signs[action]) {
      if (Reflect.has(params, k)) {
        if (bool_fields.includes(k)) {
          let v = true;
          if (params.get(k) === "0" || params.get(k) === "false") v = false;
          params.set(k, v ? "true" : "false");
        }
        param_arr.push(params.get(k));
      }
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
      ret = bot[action].apply(bot, param_arr);
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

    if (echo) ret.echo = echo;
    return JSON.stringify(ret);
  } else {
    throw new NotFoundError();
  }
}
