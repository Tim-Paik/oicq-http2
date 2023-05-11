# Dockerfile for oicq2-http

FROM node:lts-bullseye-slim

# 运行文件夹
WORKDIR /usr/src/app
# 拷贝文件
# PS：因为 oicq2 预先构建需要依赖 src 文件夹
# 所以干脆把整个文件夹拷贝进去，反正构建也不慢
COPY . .
# 安装依赖
RUN yarn install

# 参数
ENV ID=1234567890
ENV PORT=5700

# 暴露端口
EXPOSE $PORT

# 运行
CMD yarn start $ID