# Dockerfile for oicq2-http

FROM alpine:latest
# 如果无法流畅的连接 alpine 官方包管理仓库的话，可以替换镜像
# RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.ustc.edu.cn/g' /etc/apk/repositories
RUN apk add --no-cache --update nodejs npm
RUN npm install yarn -g

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
