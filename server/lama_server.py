# -*- coding: utf-8 -*-
"""
LaMa Cleaner 后端服务 (优化版)
核心优化：裁剪到选区边界框，只对小区域做推理
参考 patugosavi/LamaCleaner 的预处理逻辑
"""
import io
import sys
import time

try:
    from fastapi import FastAPI, File, UploadFile
    from fastapi.responses import Response, JSONResponse
    import uvicorn
    from PIL import Image
    import numpy as np
    from simple_lama_inpainting import SimpleLama
except ImportError as e:
    print(f"[错误] 缺少依赖: {e}")
    print("请先运行 setup.bat 或 server/install.bat 安装依赖")
    input("按回车退出...")
    sys.exit(1)

# 尝试检测 GPU
try:
    import torch
    _device = "CUDA (GPU)" if torch.cuda.is_available() else "CPU"
except ImportError:
    _device = "CPU"

print("=" * 50)
print("  LaMa Cleaner Server  (优化版 v1.1)")
print("=" * 50)
print(f"计算设备: {_device}")
print("正在加载 LaMa 模型...")
print("（首次启动会下载模型 ~200MB，请耐心等待）")
print("")

lama = SimpleLama()

print("[OK] 模型加载完成，服务就绪")
print("")

# 裁剪区最大边长（超过则等比缩小再推理，推理后再放大）
MAX_CROP_DIM = 1200
# 裁剪区周围额外扩展的像素（让 AI 看到更多上下文）
BBOX_PAD = 40


def get_mask_bbox(mask_np: np.ndarray, pad: int):
    """获取蒙版白色区域的紧凑边界框，并向外扩展 pad 像素。"""
    h, w = mask_np.shape
    rows = np.any(mask_np > 128, axis=1)
    cols = np.any(mask_np > 128, axis=0)
    if not (np.any(rows) and np.any(cols)):
        # 找不到选区内容，退回全图
        return 0, 0, h, w
    rmin = int(np.where(rows)[0][0])
    rmax = int(np.where(rows)[0][-1]) + 1
    cmin = int(np.where(cols)[0][0])
    cmax = int(np.where(cols)[0][-1]) + 1
    return (
        max(0, rmin - pad),
        max(0, cmin - pad),
        min(h, rmax + pad),
        min(w, cmax + pad),
    )


def resize_if_too_large(img: Image.Image, mask: Image.Image, max_dim: int):
    """若图像最长边超过 max_dim，等比缩放；返回 (img, mask, scale)。"""
    w, h = img.size
    longest = max(w, h)
    if longest <= max_dim:
        return img, mask, 1.0
    scale = max_dim / longest
    new_w, new_h = max(1, int(w * scale)), max(1, int(h * scale))
    img_r = img.resize((new_w, new_h), Image.LANCZOS)
    mask_r = mask.resize((new_w, new_h), Image.NEAREST)
    return img_r, mask_r, scale


app = FastAPI()


@app.get("/health")
def health():
    return {"status": "ok", "device": _device}


@app.post("/inpaint")
async def inpaint(image: UploadFile = File(...), mask: UploadFile = File(...)):
    t0 = time.time()

    img_full = Image.open(io.BytesIO(await image.read())).convert("RGB")
    msk_full = Image.open(io.BytesIO(await mask.read())).convert("L")

    if img_full.size != msk_full.size:
        msk_full = msk_full.resize(img_full.size, Image.NEAREST)

    W, H = img_full.size
    print(f"  原图尺寸: {W}x{H}  ({W*H//1000}K 像素)")

    # ── 安全检查：蒙版为空则直接返回原图 ──────────────────────────────
    msk_np = np.array(msk_full)
    if not np.any(msk_np > 128):
        print("  [WARN] 蒙版为空，返回原图")
        out = io.BytesIO()
        img_full.save(out, format="PNG")
        return Response(content=out.getvalue(), media_type="image/png")

    # ── 关键优化 1：裁剪到选区边界框 ──────────────────────────────────
    # 只对选区周围的小矩形做推理，避免把整张 4K 大图喂给 AI
    rmin, cmin, rmax, cmax = get_mask_bbox(msk_np, pad=BBOX_PAD)
    crop_h, crop_w = rmax - rmin, cmax - cmin
    ratio = crop_w * crop_h * 100 // (W * H)
    print(f"  裁剪区域: {crop_w}x{crop_h}  (原图的 {ratio}%)")

    img_crop = img_full.crop((cmin, rmin, cmax, rmax))
    msk_crop = msk_full.crop((cmin, rmin, cmax, rmax))

    # ── 关键优化 2：超大裁剪区自动缩放 ────────────────────────────────
    img_crop, msk_crop, scale = resize_if_too_large(img_crop, msk_crop, MAX_CROP_DIM)
    if scale < 1.0:
        print(f"  缩放推理: {img_crop.size[0]}x{img_crop.size[1]}  (x{scale:.2f})")

    # ── AI 推理 ───────────────────────────────────────────────────────
    t1 = time.time()
    result_crop = lama(img_crop, msk_crop)
    print(f"  推理耗时: {time.time() - t1:.1f}s")

    # 推理结果放大回裁剪区原始尺寸
    if scale < 1.0:
        result_crop = result_crop.resize((crop_w, crop_h), Image.LANCZOS)

    # ── 将结果贴回原图 ─────────────────────────────────────────────────
    result_full = img_full.copy()
    result_full.paste(result_crop, (cmin, rmin))

    out = io.BytesIO()
    result_full.save(out, format="PNG")
    print(f"  [OK] 总耗时: {time.time() - t0:.1f}s")
    return Response(content=out.getvalue(), media_type="image/png")


if __name__ == "__main__":
    print("服务地址: http://127.0.0.1:8765")
    print("关闭此窗口即停止服务")
    print("=" * 50)
    print("")
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="warning")
