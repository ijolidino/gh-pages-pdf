# -*- coding: utf-8 -*-
"""导出 MySQL pdf_docs 表 → data.js（window.PDF_DATA），供本目录静态快照站使用。

PDF 文件本体已随站点放在本目录 pdfs/ 下（结构与扫描根目录一致），因此导出的 dir
一律转成「相对站点根」的路径（如 pdfs/00/），data.js 里不再出现任何本机绝对路径；
前端点标题即用相对 URL 新页签打开 PDF，部署到 GitHub Pages 后同样有效。

用法（在项目根或本目录执行均可）：
  1. 先设密码环境变量（密码只从环境变量读，绝不写进代码——这个目录要推到 GitHub）：
     Git Bash:  MYSQL_PWD=你的密码 python gh-pages-pdf/build_data.py
     PowerShell: $env:MYSQL_PWD='你的密码'; python gh-pages-pdf/build_data.py
  2. 可选环境变量：MYSQL_BIN（mysql.exe 路径）、DB_HOST/DB_PORT/DB_USER/DB_NAME（默认 127.0.0.1/3306/root/topic_community）、
     PDF_ROOT（扫描根目录，用于把绝对路径剥成相对路径，默认 D:/AI/shitjournal-backup/pdfs）

导出后 git 提交 data.js + index.html + app.js + style.css + pdfs/ 即可，Pages 上不需要任何后端。
"""
import datetime
import json
import os
import shutil
import subprocess
import sys

pwd = os.environ.get("MYSQL_PWD")
if not pwd:
    sys.exit("错误：请先设置环境变量 MYSQL_PWD（密码不写进文件，避免推到 GitHub 泄露）")

# 扫描根目录：DB 里 file_path 以此为前缀，剥掉后换成站点内的 pdfs/ 相对路径
PDF_ROOT = os.environ.get("PDF_ROOT", "D:/AI/shitjournal-backup/pdfs").replace("\\", "/").rstrip("/")

mysql = (
    os.environ.get("MYSQL_BIN")
    or shutil.which("mysql")
    or r"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
)
if not os.path.exists(mysql):
    sys.exit(f"错误：找不到 mysql.exe：{mysql}，请设置 MYSQL_BIN 指向实际路径")

# dir 输出为「去掉文件名的目录」并把反斜杠换成正斜杠：
# 既避开 batch 模式对 JSON 里反斜杠的二次转义问题，也方便下面按前缀剥成 pdfs/ 相对路径
sql = (
    "SELECT JSON_ARRAYAGG(JSON_OBJECT("
    "'title', title,"
    " 'keywords', COALESCE(keywords, JSON_ARRAY()),"
    " 'fileName', file_name,"
    " 'dir', REPLACE(LEFT(file_path, CHAR_LENGTH(file_path) - CHAR_LENGTH(file_name)), '\\\\', '/'),"
    " 'size', size_bytes"
    ")) FROM (SELECT * FROM pdf_docs ORDER BY file_path, file_name) x;"
)

cmd = [
    mysql,
    "--host=" + os.environ.get("DB_HOST", "127.0.0.1"),
    "--port=" + os.environ.get("DB_PORT", "3306"),
    "--user=" + os.environ.get("DB_USER", "root"),
    "--default-character-set=utf8mb4",  # 不加会按 GBK 连接，生僻字在 JSON_TABLE/输出阶段变 NULL
    "-N", "-B", "--raw",                # raw 关闭 batch 的反斜杠二次转义
    os.environ.get("DB_NAME", "topic_community"),
    "-e", sql,
]
env = {**os.environ, "MYSQL_PWD": pwd}
r = subprocess.run(cmd, capture_output=True, env=env)
if r.returncode != 0:
    sys.exit("mysql 执行失败：" + r.stderr.decode("utf-8", "replace"))

raw = r.stdout.decode("utf-8").strip()
docs = [] if raw in ("", "NULL") else json.loads(raw)

# 核心步骤：把 DB 里的绝对目录剥成站点相对路径。
# PDF 本体已随站点放在 pdfs/ 下（结构与扫描根一致），所以
#   "D:/AI/shitjournal-backup/pdfs/00/" → "pdfs/00/"
# 剥完之后 data.js 里不再有任何本机绝对路径，GitHub Pages 上点标题即可直开 PDF。
leftover = 0
for d in docs:
    norm = str(d.get("dir") or "").replace("\\", "/")
    if norm.lower().startswith(PDF_ROOT.lower() + "/"):
        d["dir"] = "pdfs/" + norm[len(PDF_ROOT) + 1:]
    elif norm.lower() == PDF_ROOT.lower():
        d["dir"] = "pdfs/"
    else:
        leftover += 1
        print(f"警告：目录不在扫描根 {PDF_ROOT} 下，未剥前缀：{norm}", file=sys.stderr)

data = {
    "generatedAt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
    "docs": docs,
}
out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.js")
with open(out_path, "w", encoding="utf-8") as f:
    f.write("window.PDF_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")

print(f"已写出 {out_path}：{len(docs)} 个 PDF（dir 已转为 pdfs/ 相对路径"
      + (f"，另有 {leftover} 条不在扫描根下，仍是绝对路径，请检查！）" if leftover else "）"))
