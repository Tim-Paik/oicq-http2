import axios, { AxiosRequestConfig } from "axios";
import * as oicq from "icqq";
import fs from "fs";

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
      uin: bot.uin,
      status: onlinestatus,
      nickname: bot.nickname,
      sex: bot.sex,
      age: bot.age,
      bkn: bot.bkn,
    };
  },

  get_version_info: async (bot: oicq.Client, data: any): Promise<Object> => {
    return {
      app_name: "oicq2",
      version: "2.3.1",
      http_api: "1.1.0",
      stat: bot.stat,
    };
  },

  // PS：它有时候 pick 到的对象是空的但是操作也能成功，很迷惑所以我不进行空判断了
  set_message_read: async (bot: oicq.Client, data: any): Promise<Object> => {
    bot.reportReaded(data.params.message_id);
    return { error: 0 };
  },

  get_file_url: async (bot: oicq.Client, data: any): Promise<Object> => {
    if (data.params.message_id.length > 24) {
			return { url: await bot.pickGroup(data.params.id).getFileUrl(data.params.fid) }
		} else {
			return { url: await bot.pickUser(data.params.id).getFileUrl(data.params.fid) }
		}
  },

  get_video_url: async (bot: oicq.Client, data: any): Promise<Object> => {
    if (data.params.message_id.length > 24) {
			return { url: await bot.pickGroup(data.params.id).getVideoUrl(data.params.fid, data.params.md5) }
		} else {
			return { url: await bot.pickUser(data.params.id).getVideoUrl(data.params.fid, data.params.md5) }
		}
  },

  upload_file: async (bot: oicq.Client, data: any): Promise<Object> => {
    // 使用 HTTP 请求来上传要发送的文件并发送
    let status = {} as { [key: string]: any };
    try {
      if(data.params.file) {
        const file = data.params.file;
        if (data.params.type == 'group') {
          const group = bot.pickGroup(data.params.id);
          status = await group.fs.upload(file.path, '/', file.originalFilename);
        } else {
          const friend = bot.pickFriend(data.params.id);
          status['info'] = await friend.sendFile(file.path, file.originalFilename);
        }
      }
    } finally {
      if(data.params.file) fs.unlinkSync(data.params.file.path);
    }
    return status;
  }
};

export async function apply(bot: oicq.Client, data: any): Promise<string> {
  if(data.echo) {
    return JSON.stringify({
      data: await Reflect.get(extraActions, data.action)(bot, data),
      echo: data.echo,
    });
  } else {
    // SS: 没有 echo 的情况是给 HTTP 请求用的
    return JSON.stringify(await Reflect.get(extraActions, data.action)(bot, data));
  }
}
