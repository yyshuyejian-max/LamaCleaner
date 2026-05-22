# LaMa Cleaner · PS 一键去水印插件

> 用 AI（LaMa 模型）智能清除图片中的 logo、水印、杂物，结果作为新图层贴回，原图完整保留。

**适用：Windows 10/11 + Photoshop 2022 ~ 2026**

---

## 安装（两步完成）

### 第 1 步：下载解压

点击右上角绿色 **Code** 按钮 → **Download ZIP** → 解压到任意文件夹（桌面即可）

### 第 2 步：双击运行安装脚本

找到解压出的 `setup.bat`，**直接双击运行**（无需管理员权限）

脚本自动完成以下所有步骤：

| 步骤 | 内容 |
|------|------|
| ① | 检测 Python，未安装则自动通过 winget 安装 |
| ② | 将插件复制到 Photoshop 扩展目录 |
| ③ | 写入注册表，允许加载第三方扩展 |
| ④ | 创建独立 Python 环境并安装 AI 依赖（约 10~20 分钟，下载 ~2GB） |

> 安装期间请保持网络畅通，勿关闭黑色命令行窗口。

---

## 使用方法

### 启动

1. **重启 Photoshop**
2. 菜单 `窗口 → 扩展功能 → LaMa Cleaner`
3. 面板中点击 **「启动后端服务」**（首次自动下载模型 ~200MB）
4. 状态栏变绿"服务已就绪"后即可使用

### 选区模式（精确去除）

```
① 用套索 / 快速选择 / 魔棒圈住要去除的区域
② 点击「清除选区内容」
③ 结果自动贴在新图层，Ctrl+Z 可撤销
```

### 涂抹蒙版模式（自由涂抹）

```
① 切换到「涂抹蒙版」选项卡
② 点击「创建蒙版图层」（自动新建 LaMa_Mask 图层）
③ 用画笔随意涂抹要去除的区域（颜色不限）
④ 点击「清除涂抹区域」
```

---

## 常见问题

**Q：菜单里没有「LaMa Cleaner」**  
A：确认 setup.bat 运行成功，然后**完全重启** Photoshop（关闭后重新打开）。

**Q：启动服务后一直转圈**  
A：首次需下载 LaMa 模型（~200MB），请查看弹出的「LaMa Server」黑窗口中的进度。

**Q：处理速度慢**  
A：CPU 模式处理 4K 图约 10~30 秒。有 NVIDIA 显卡可换 GPU 版 PyTorch 加速：

```bat
:: 在安装目录的 server 文件夹下运行：
call venv\Scripts\activate.bat
pip uninstall torch torchvision -y
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
```

**Q：处理后边缘有残影**  
A：将面板中「边缘扩展」数值从 3 调大到 5~10 像素。

**Q：如何卸载**  
A：删除 `%APPDATA%\Adobe\CEP\extensions\LamaCleaner` 文件夹即可。

---

## 目录结构

```
LamaCleaner/
├── setup.bat          ← 双击安装
├── CSXS/              扩展清单
├── client/            面板 UI（HTML / JS / CSS）
├── jsx/host.jsx       ExtendScript（操作 PS 图层）
└── server/
    ├── lama_server.py  Python 后端（FastAPI + LaMa）
    ├── requirements.txt
    └── run.bat
```

---

## 致谢

- [LaMa 论文](https://arxiv.org/abs/2109.07161) — 旷视研究院
- [simple-lama-inpainting](https://github.com/enesmsahin/simple-lama-inpainting)
- [patugosavi/LamaCleaner](https://github.com/patugosavi/LamaCleaner)
