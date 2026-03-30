# 使用 Node.js 24 官方镜像
FROM node:24-slim

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装依赖
RUN npm install --production

# 复制源代码
COPY . .

# 编译 TypeScript
RUN npm run build

# 设置环境变量默认值
ENV NODE_ENV=production
ENV HEARTBEAT_INTERVAL_SECONDS=30

# 启动命令
CMD ["npm", "start"]
