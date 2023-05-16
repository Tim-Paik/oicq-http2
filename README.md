# oicq-http2
将 oicq2 （或其衍生的二次开发版本）部署为兼容 [OneBot 11](https://github.com/botuniverse/onebot-11) 协议的独立服务，
通过 http 及 ws 与外界通信。

本项目移植自 [这儿](https://github.com/takayama-lily/oicq/tree/master/http-api)，
仅用于将 oicq2 扩展部署为服务，同时增加了部分功能以便扩展使用。

## :card_file_box: 环境需求
- nodejs >= 12.16
- yarn

## :truck: 部署运行
### > 准备项目
使用 git 获取本仓库或者在本页面下载 ZIP 归档，使用 `yarn install` 初始化项目依赖。
![yarn](https://github.com/Stapxs/Stapxs-QQ-Lite-2.0/blob/main/README/yarn.png)

### > 启动服务
运行指令 `yarn start [QQ]` 启动服务：
![run](https://github.com/Stapxs/Stapxs-QQ-Lite-2.0/blob/main/README/run.png)

## :pencil2: 追加接口
本项目同时追加了一些扩展接口丰富功能，下面是增加的方法列表：
| 名称 | 功能 | 参数 | 备注 |
| ----- | ----- | ----- | ----- |
| http_proxy | 代理请求 API 接口 | `url` | 用于让 bot 代理请求一些 QQ 的 API 接口，绕过前端跨域的问题。 |
| get_login_info | 获取登陆账号的基本信息和 uin | | |
| get_class_info | 获取好友分组列表 | | |
| get_file_url | 获取文件下载链接 | `id, message_id, fid` | |
| get_video_url | 获取视频下载链接 | `id, message_id, fid, md5` | |
| set_message_read | 将消息标记为已读 | `message_id` | |
| upload_file | 上传并发送文件 | `type, id, file` | 这是个 POST 接口，请使用表单提交。其中 type 为 group 或 friend。 |
