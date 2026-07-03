# 腾讯云部署说明

建议部署方式：放在腾讯云同一台服务器上，但作为一个独立 Docker 容器运行，不并入已有项目。

原因很简单：这个项目有自己的 SQLite 数据库、上传文件、统计规则和后续数据模块。独立容器更稳，后面加新模块也不影响现有网站。

## 推荐域名

建议给它一个独立子域名，例如：

- `hazard.gxajb.site`
- `yh.gxajb.site`
- `yinhuan.gxajb.site`

如果服务器上已经有 Nginx 管理 `gxajb.site`，只需要给这个子域名加一段反向代理配置，转到本机 `127.0.0.1:8010`。

## 服务器部署步骤

在腾讯云服务器上找一个目录，例如：

```bash
mkdir -p /opt/hazard-center
cd /opt/hazard-center
```

把本项目文件上传到这个目录后，执行：

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
```

默认容器只监听服务器本机：

```text
127.0.0.1:8010 -> 容器 8010
```

这意味着外网不能直接访问 8010，必须通过 Nginx 访问，安全一些。

## Nginx 配置

项目里有模板：

```text
deploy/nginx-hazard.gxajb.site.conf
```

把它复制到服务器 Nginx 配置目录，并把 `server_name` 改成实际域名：

```bash
sudo cp deploy/nginx-hazard.gxajb.site.conf /etc/nginx/conf.d/hazard.gxajb.site.conf
sudo nginx -t
sudo systemctl reload nginx
```

如果服务器使用的是宝塔、1Panel、Nginx Proxy Manager 或已有自定义 Nginx 配置，就不一定是 `/etc/nginx/conf.d/`，但核心反代目标一样：

```text
http://127.0.0.1:8010
```

## HTTPS

如果服务器已经有自动申请证书的工具，给新子域名申请证书即可。

如果是命令行 Nginx + Certbot，通常是：

```bash
sudo certbot --nginx -d hazard.gxajb.site
```

执行前需要先把 DNS 解析到腾讯云服务器公网 IP。

## 数据保存和备份

数据都在服务器项目目录的：

```text
data/
```

里面包括：

- `hazards.db`：SQLite 数据库
- `uploads/`：上传过的 Excel 文件

部署或更新代码时不要删除 `data/`。建议服务器定期备份这个目录。

## 常用维护命令

更新代码后重建：

```bash
docker compose up -d --build
```

看日志：

```bash
docker compose logs -f --tail=100
```

重启：

```bash
docker compose restart
```

停止：

```bash
docker compose down
```

## 如果 8010 被占用

修改 `.env`：

```text
HAZARD_HOST_PORT=8011
```

同时把 Nginx 里的反代地址改成：

```text
http://127.0.0.1:8011
```
