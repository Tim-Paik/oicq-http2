import axios, { AxiosRequestConfig } from "axios";
import * as oicq from "oicq";

export const extraActions = {
  http_proxy: async (bot: oicq.Client, data: any): Promise<Object> => {
    let config: AxiosRequestConfig;
    let url = new URL(data.params.url);
    config = {
      headers: { Cookie: bot.cookies[url.hostname as oicq.Domain] },
      withCredentials: true,
    };
    config = Object.assign(config, data.params);
    let res = await axios(config);
    return {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
      data: res.data,
    };
  },

  get_login_info: async (bot: oicq.Client, data: any): Promise<Object> => {
    let onlinestatus: string;
    switch (bot.status) {
      case oicq.OnlineStatus.Absent:
        onlinestatus = "absent";
        break;
      case oicq.OnlineStatus.Busy:
        onlinestatus = "busy";
        break;
      case oicq.OnlineStatus.DontDisturb:
        onlinestatus = "dontdisturb";
        break;
      case oicq.OnlineStatus.Invisible:
        onlinestatus = "invisible";
        break;
      case oicq.OnlineStatus.Online:
        onlinestatus = "online";
        break;
      case oicq.OnlineStatus.Qme:
        onlinestatus = "qme";
        break;
    }
    return {
      account: {
        uin: bot.uin,
        status: onlinestatus,
        nickname: bot.nickname,
        sex: bot.sex,
        age: bot.age,
      },
      oicq: {
        version: "2.3.1",
        http_api: "1.0.2",
        stat: bot.stat,
        bkn: bot.bkn,
      },
    };
  },
};

export async function apply(bot: oicq.Client, data: any): Promise<string> {
  return JSON.stringify({
    data: await Reflect.get(extraActions, data.action)(bot, data),
    echo: data.echo,
  });
}
