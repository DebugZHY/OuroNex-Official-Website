# OuroNex 腾讯云轻量服务器部署包

## 目标

把当前 OuroNex 静态网站发布到腾讯云轻量应用服务器：

- 公网 IPv4：150.109.55.6
- 系统：OpenCloudOS 9.4（WordPress 应用镜像）
- 当前 HTTP 80 已由 Nginx 提供服务，HTTPS 443 未开放
- 直接访问地址：http://150.109.55.6/
- 站点入口带有口令空白页：输入 sida123456 后按 Enter 才显示主页面

本地探测确认：服务器当前返回的是旧版 OuroNex 静态站，还没有 gate.js / gate.css，也没有当前的 Transmission Tower 模型。本次是覆盖升级，不是从零安装。

## 交付文件

本目录包含：

- deploy-ouronex.sh：在已有 Nginx 站点上备份并复制静态包；不修改 Nginx 配置。
- nginx-ouronex.conf：仅在没有现成站点、需要新建 Nginx server 时使用。
- 部署包（在服务器外生成）：ouronex-public-20261108.tar.gz 和 .zip，内含 public/、本脚本、Nginx 示例和校验和。

发布包使用 package-manifest 生成，共 139 个文件；package-manifest.json、backend、deploy、_scratch、node_modules 均不进入 public。

## 当前服务器的实际状态

从本机请求 http://150.109.55.6/ 得到：

- HTTP 200，Server: nginx
- index.html 仍是旧版，缺少 gate 文件
- /assets/gate.js、/assets/gate.css、/api/v1/auth/me/、/health/ 均返回 404
- 80 端口已经可以访问，443 连接失败

所以不需要重装系统，也不需要先安装 Nginx；先确认现有站点的 root，再替换静态文件即可。

## 第一步：登录并找到站点根目录

使用腾讯云控制台的“登录”（免密/密码/密钥/VNC）进入服务器。不要向任何人发送密码或私钥。

在服务器执行：

    nginx -T 2>/dev/null | grep -E '^\s*(server_name|root)\s'
    ls -la /www/wwwroot 2>/dev/null || true
    ps -ef | grep -E '[n]ginx|[a]pache|[h]ttpd'

找到当前返回 OuroNex 旧页面的 server 的 root。后面的 WEB_ROOT 就是该目录，例如：

    /www/wwwroot/ouronex
    /www/wwwroot/150.109.55.6
    /var/www/html

不要直接把 WEB_ROOT 设为 /、/www 或 /www/wwwroot。若 root 由宝塔面板管理，也可以在宝塔“网站”里查看站点根目录。

## 第二步：上传并解压发布包

在腾讯云控制台的“文件管理”上传，或用本机 SSH/SFTP 上传到 /root。以下命令在服务器执行：

    cd /root
    tar -xzf ouronex-public-20261108.tar.gz
    ls -la ouronex-public-20261108/public/index.html
    ls -la ouronex-public-20261108/public/assets/gate.js

发布包解压后的 public 才是网站根目录内容，不要把外层目录直接作为 Nginx root。

## 第三步：备份并部署

推荐先在服务器上确认 WEB_ROOT 指向当前旧站，然后执行：

    cd /root/ouronex-public-20261108
    sudo bash deploy-ouronex.sh ./public /www/wwwroot/ouronex http://150.109.55.6/

把 /www/wwwroot/ouronex 换成第一步找到的真实路径。

脚本会：

1. 把旧 WEB_ROOT 打包到 /root/ouronex-backups/<时间戳>/web-root.tar.gz。
2. 把 public/ 内容复制到 WEB_ROOT，不删除 root 里已有的额外文件。
3. 执行 nginx -t，并 reload Nginx。
4. 请求站点并检查是否出现 id="site-gate"，同时检查 gate.js 和模型文件。

如果脚本提示 nginx 未找到，检查宝塔路径：

    /www/server/nginx/sbin/nginx -t
    /www/server/nginx/sbin/nginx -s reload

如果脚本提示 gate 检查失败，先看 Nginx 的真实 root 是否就是 WEB_ROOT，不要盲目重装。

## 替代方案：只用宝塔面板

如果服务器已有宝塔面板并且不想用命令行：

1. 在宝塔“网站”中找到当前 OuroNex 站点，记录根目录并备份。
2. 用“文件”上传压缩包并解压到临时目录。
3. 把解压后的 public/ 内容上传/复制到当前站点根目录，覆盖 index.html 和 assets。
4. 清空站点缓存，必要时重载 Nginx。
5. 打开 http://150.109.55.6/，应看到纯白页面；输入 sida123456 后按 Enter 才显示首页。

如果宝塔里存在 WordPress 站点，不要删除 WordPress 数据库或目录；当前目标是替换对外展示的静态站点，不是卸载现有应用。若 root 与 WordPress 共用，请先完整备份 /www/wwwroot 和 WordPress 数据库。

## 全新 Nginx 配置（仅在没有现成站点时）

不要把示例配置直接覆盖到已经有站点的服务器上。只有在确认没有其他 server 监听 80 时：

    sudo mkdir -p /var/www/ouronex/public
    sudo cp -a /root/ouronex-public-20261108/public/. /var/www/ouronex/public/
    sudo cp /root/ouronex-public-20261108/nginx-ouronex.conf /etc/nginx/conf.d/ouronex.conf
    sudo nginx -t
    sudo systemctl reload nginx

如果现有 Nginx 配置已经有一个 default_server，先备份并停用它，避免 listen 80 default_server 冲突。

## 腾讯云防火墙

当前 80 端口已可访问，通常不需要改。若从外网打不开：

腾讯云轻量应用服务器控制台 → 实例 → 防火墙 → 添加规则：

- 应用类型：HTTP
- 协议：TCP
- 端口：80
- 来源：0.0.0.0/0

443 只在之后配置 HTTPS 时再开放；没有域名和证书前不要强行用 https://IP。

## 验收

在任意能上网的电脑执行：

    curl -fsS http://150.109.55.6/ | grep -o 'id="site-gate"'
    curl -fsS -o /dev/null -w '%{http_code}\n' http://150.109.55.6/assets/gate.js
    curl -fsS -o /dev/null -w '%{http_code}\n' http://150.109.55.6/workflow-stages/models/transmission-tower.glb.gz

预期：site-gate 命中，两个 HTTP 都是 200。

浏览器打开 http://150.109.55.6/：

1. 应看到纯白空白页，没有导航、Logo、文字或首页内容。
2. 输入错误口令按 Enter：仍然空白。
3. 输入 sida123456 后按 Enter：显示首页。
4. 等待超过 10 秒再尝试用旧输入补齐口令：旧输入已被清空，必须重新完整输入。

## 回滚

    sudo tar -xzf /root/ouronex-backups/<时间戳>/web-root.tar.gz -C <WEB_ROOT>
    sudo nginx -s reload

回滚只恢复网站文件；如果服务器还涉及 WordPress 数据库，另行按宝塔备份恢复，两者不要混为一谈。

## 重要限制

- 交付包是纯静态网站。首页的 Log in 已隐藏；/login/、/dashboard/、/api/v1/... 等后端路由不会由静态包提供。如果要把账号/早鸟表单接到服务器端，需要另外部署 Django/Waitress + 反向代理，不能只替换静态文件。
- early-access 表单目前是浏览器端本地确认，不会提交到服务器。
- 空白口令页是前端遮挡，不是真正的访问控制；口令写在 gate.js 中，查看源码或开发者工具可以绕过。若要真正防止未授权访问，需要 Nginx auth、Cloudflare Access 或其他服务端认证。
- 当前 443 未开放，先使用 http://150.109.55.6/。正式对外建议绑定域名并配置 HTTPS，之后再处理 canonical、CSP 和证书。
