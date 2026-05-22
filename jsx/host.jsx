// =====================================================
// LaMa Cleaner - ExtendScript Host
// =====================================================
#target photoshop


function exportSelectionAndMask(imgPath, maskPath, expandPx) {
    var origUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;
    var alphaCh = null;
    var doc;
    var alphaName = 'lama_sel_' + new Date().getTime();

    try {
        if (app.documents.length === 0) return 'no_document';
        doc = app.activeDocument;

        // 检查是否有选区
        try {
            var b = doc.selection.bounds;
            if (!b) return 'no_selection';
        } catch (e) {
            return 'no_selection';
        }

        // 扩展选区（让 AI 多吃一点边缘）
        if (expandPx && expandPx > 0) {
            try { doc.selection.expand(expandPx); } catch (e) {}
        }

        // 把选区保存到 alpha 通道（保留到 duplicate 后能找到）
        alphaCh = doc.channels.add();
        alphaCh.name = alphaName;
        doc.selection.store(alphaCh);
        doc.selection.deselect();

        var pngOpts = new PNGSaveOptions();
        pngOpts.interlaced = false;
        pngOpts.compression = 6;

        // === 1. 导出原图（合并所有可见图层） ===
        var srcDup = doc.duplicate('__lama_src__', true);
        srcDup.flatten();
        srcDup.saveAs(new File(imgPath), pngOpts, true);
        srcDup.close(SaveOptions.DONOTSAVECHANGES);

        // === 2. 生成蒙版图 ===
        app.activeDocument = doc;
        var maskDup = doc.duplicate('__lama_mask__', true);
        maskDup.flatten();

        // 在 flatten 后的文档里找回 alpha 通道
        var alphaInDup = null;
        for (var j = 0; j < maskDup.channels.length; j++) {
            if (maskDup.channels[j].name === alphaName) {
                alphaInDup = maskDup.channels[j];
                break;
            }
        }

        if (!alphaInDup) {
            maskDup.close(SaveOptions.DONOTSAVECHANGES);
            return 'alpha_lost';
        }

        // 全选填黑
        maskDup.selection.selectAll();
        var black = new SolidColor();
        black.rgb.red = 0; black.rgb.green = 0; black.rgb.blue = 0;
        maskDup.selection.fill(black);
        maskDup.selection.deselect();

        // 加载 alpha 通道（选区内）填白
        maskDup.selection.load(alphaInDup);
        var white = new SolidColor();
        white.rgb.red = 255; white.rgb.green = 255; white.rgb.blue = 255;
        maskDup.selection.fill(white);
        maskDup.selection.deselect();

        maskDup.saveAs(new File(maskPath), pngOpts, true);
        maskDup.close(SaveOptions.DONOTSAVECHANGES);

        return 'ok';
    } catch (err) {
        return 'exception: ' + err.message;
    } finally {
        // 清理原文档上的 alpha 通道
        try {
            if (alphaCh && doc) {
                app.activeDocument = doc;
                // 用名字找回再删，避免引用失效
                for (var k = 0; k < doc.channels.length; k++) {
                    if (doc.channels[k].name === alphaName) {
                        doc.channels[k].remove();
                        break;
                    }
                }
            }
        } catch (e) {}
        app.preferences.rulerUnits = origUnits;
    }
}

// ── 涂抹蒙版模式 ─────────────────────────────────────────────────────

function createMaskLayer() {
    if (app.documents.length === 0) return 'no_document';
    var doc = app.activeDocument;

    // 已存在则直接激活
    for (var i = 0; i < doc.layers.length; i++) {
        if (doc.layers[i].name === 'LaMa_Mask') {
            doc.activeLayer = doc.layers[i];
            doc.layers[i].visible = true;
            return 'exists';
        }
    }

    var layer = doc.artLayers.add();
    layer.name = 'LaMa_Mask';
    layer.opacity = 60;
    doc.activeLayer = layer;

    // 设置前景色为红色，方便用户直接涂抹
    var red = new SolidColor();
    red.rgb.red = 255; red.rgb.green = 0; red.rgb.blue = 0;
    app.foregroundColor = red;

    return 'ok';
}

function exportPaintedMaskAndImage(imgPath, maskPath, expandPx) {
    if (app.documents.length === 0) return 'no_document';
    var doc = app.activeDocument;
    var origUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;

    var maskLayerName = 'LaMa_Mask';
    var maskLayer = null;
    for (var i = 0; i < doc.layers.length; i++) {
        if (doc.layers[i].name === maskLayerName) {
            maskLayer = doc.layers[i];
            break;
        }
    }
    if (!maskLayer) return 'no_mask_layer';

    // 检查图层是否有内容（空图层 bounds 全为 0）
    try {
        var lb = maskLayer.bounds;
        if (lb[2].as('px') === 0 && lb[3].as('px') === 0) return 'empty_mask';
    } catch (e) { return 'empty_mask'; }

    var pngOpts = new PNGSaveOptions();
    pngOpts.interlaced = false;
    pngOpts.compression = 6;
    var maskDoc = null;

    try {
        // === 1. 导出原图（排除 LaMa_Mask 图层）===
        var srcDup = doc.duplicate('__lama_src__', true);
        for (var j = 0; j < srcDup.layers.length; j++) {
            if (srcDup.layers[j].name === maskLayerName) {
                try { srcDup.layers[j].remove(); } catch (e) {}
                break;
            }
        }
        srcDup.flatten();
        srcDup.saveAs(new File(imgPath), pngOpts, true);
        srcDup.close(SaveOptions.DONOTSAVECHANGES);
        app.activeDocument = doc;

        // === 2. 生成黑白蒙版 ===
        // 新建纯黑背景文档（与原图同尺寸）
        maskDoc = app.documents.add(
            doc.width, doc.height, doc.resolution,
            '__lama_mask__', NewDocumentMode.RGB, DocumentFill.WHITE
        );
        app.activeDocument = maskDoc;

        // 把白色背景图层转为普通图层并填充纯黑
        var bgLyr = maskDoc.layers[0];
        bgLyr.isBackgroundLayer = false;
        maskDoc.activeLayer = bgLyr;
        maskDoc.selection.selectAll();
        var black = new SolidColor();
        black.rgb.red = 0; black.rgb.green = 0; black.rgb.blue = 0;
        maskDoc.selection.fill(black);
        maskDoc.selection.deselect();

        // 把 LaMa_Mask 图层复制到黑色文档的最上层
        app.activeDocument = doc;
        maskLayer.duplicate(maskDoc, ElementPlacement.PLACEATBEGINNING);

        // 拼合：透明区 → 黑色，涂抹区 → 涂抹颜色
        app.activeDocument = maskDoc;
        maskDoc.flatten();

        // 去色 → 自动对比度（拉满到 0-255）→ 色调分离为 2 级（纯黑/纯白）
        maskDoc.activeLayer.desaturate();
        maskDoc.activeLayer.autoContrast();
        maskDoc.activeLayer.posterize(2);

        // 扩展蒙版边缘
        if (expandPx && expandPx > 0) {
            maskDoc.activeLayer.applyGaussianBlur(expandPx);
            maskDoc.activeLayer.autoContrast();
            maskDoc.activeLayer.posterize(2);
        }

        maskDoc.saveAs(new File(maskPath), pngOpts, true);
        maskDoc.close(SaveOptions.DONOTSAVECHANGES);
        maskDoc = null;

        return 'ok';
    } catch (err) {
        if (maskDoc) { try { maskDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (e) {} }
        return 'exception: ' + err.message;
    } finally {
        app.preferences.rulerUnits = origUnits;
        try { app.activeDocument = doc; } catch (e) {}
    }
}

function hideMaskLayer() {
    if (app.documents.length === 0) return 'ok';
    var doc = app.activeDocument;
    for (var i = 0; i < doc.layers.length; i++) {
        if (doc.layers[i].name === 'LaMa_Mask') {
            doc.layers[i].visible = false;
            return 'ok';
        }
    }
    return 'ok';
}

function placeResult(outPath) {
    try {
        if (app.documents.length === 0) return 'no_document';
        var doc = app.activeDocument;

        var f = new File(outPath);
        if (!f.exists) return 'no_file';

        // 打开结果图，把图层复制到原文档最上层
        var resultDoc = app.open(f);
        resultDoc.activeLayer.duplicate(doc, ElementPlacement.PLACEATBEGINNING);
        resultDoc.close(SaveOptions.DONOTSAVECHANGES);

        app.activeDocument = doc;

        // 给图层起个带时间戳的名字
        var d = new Date();
        var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
        var stamp = pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
        doc.activeLayer.name = 'LaMa_Clean_' + stamp;

        return 'ok';
    } catch (err) {
        return 'exception: ' + err.message;
    }
}
