"use strict";

const HISTORY_KEY = "filmRgbRecordsV1";
const SETTINGS_KEY = "filmRgbSettingsV1";
const MAX_IMAGE_SIDE = 2000;

const elements = {
  cameraInput: document.getElementById("cameraInput"),
  galleryInput: document.getElementById("galleryInput"),
  installButton: document.getElementById("installButton"),
  imageStatus: document.getElementById("imageStatus"),
  canvas: document.getElementById("photoCanvas"),
  emptyState: document.getElementById("emptyState"),
  resetRoiButton: document.getElementById("resetRoiButton"),
  clearRoiButton: document.getElementById("clearRoiButton"),
  roiModeButtons: [...document.querySelectorAll("[data-roi-mode]")],
  sampleShapeButtons: [...document.querySelectorAll("[data-sample-shape]")],
  sampleRoiValue: document.getElementById("sampleRoiValue"),
  whiteRoiValue: document.getElementById("whiteRoiValue"),
  darkRoiValue: document.getElementById("darkRoiValue"),
  samplePixelCount: document.getElementById("samplePixelCount"),
  rawR: document.getElementById("rawR"),
  rawG: document.getElementById("rawG"),
  rawB: document.getElementById("rawB"),
  rawRgbText: document.getElementById("rawRgbText"),
  rawSwatch: document.getElementById("rawSwatch"),
  correctedR: document.getElementById("correctedR"),
  correctedG: document.getElementById("correctedG"),
  correctedB: document.getElementById("correctedB"),
  correctedRgbText: document.getElementById("correctedRgbText"),
  correctedSwatch: document.getElementById("correctedSwatch"),
  correctionStatus: document.getElementById("correctionStatus"),
  labL: document.getElementById("labL"),
  labA: document.getElementById("labA"),
  labB: document.getElementById("labB"),
  labStatus: document.getElementById("labStatus"),
  metadataList: document.getElementById("metadataList"),
  experimentForm: document.getElementById("experimentForm"),
  lightSource: document.getElementById("lightSource"),
  lightCct: document.getElementById("lightCct"),
  lightBrightness: document.getElementById("lightBrightness"),
  sampleState: document.getElementById("sampleState"),
  notes: document.getElementById("notes"),
  saveRecordButton: document.getElementById("saveRecordButton"),
  historyBody: document.getElementById("historyBody"),
  historyCount: document.getElementById("historyCount"),
  exportButton: document.getElementById("exportButton"),
  clearHistoryButton: document.getElementById("clearHistoryButton"),
  toast: document.getElementById("toast")
};

const drawingContext = elements.canvas.getContext("2d", {
  willReadFrequently: true
});
const sourceCanvas = document.createElement("canvas");
const sourceContext = sourceCanvas.getContext("2d", {
  willReadFrequently: true
});

const state = {
  imageLoaded: false,
  file: null,
  metadata: {},
  activeMode: "sample",
  sampleShape: "rect",
  rois: {
    sample: null,
    white: null,
    dark: null
  },
  dragging: false,
  dragStart: null,
  installPrompt: null,
  records: loadJson(HISTORY_KEY, [])
};

let toastTimer = null;

function loadJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 2600);
}

function cssColor(variableName) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(variableName)
    .trim();
}

function normalizedRect(rect) {
  if (!rect || !elements.canvas.width || !elements.canvas.height) {
    return null;
  }

  const x1 = clamp(
    Math.min(rect.x1, rect.x2),
    0,
    elements.canvas.width - 1
  );
  const y1 = clamp(
    Math.min(rect.y1, rect.y2),
    0,
    elements.canvas.height - 1
  );
  const x2 = clamp(
    Math.max(rect.x1, rect.x2),
    x1 + 1,
    elements.canvas.width
  );
  const y2 = clamp(
    Math.max(rect.y1, rect.y2),
    y1 + 1,
    elements.canvas.height
  );

  return { x1, y1, x2, y2 };
}

function inscribedSquare(rect) {
  const normalized = normalizedRect(rect);
  if (!normalized) {
    return null;
  }

  const centerX = (normalized.x1 + normalized.x2) / 2;
  const centerY = (normalized.y1 + normalized.y2) / 2;
  const side = Math.min(
    normalized.x2 - normalized.x1,
    normalized.y2 - normalized.y1
  );

  return normalizedRect({
    x1: centerX - side / 2,
    y1: centerY - side / 2,
    x2: centerX + side / 2,
    y2: centerY + side / 2
  });
}

function circleRectFromCenter(center, edge, minimumRadius = 1) {
  const width = elements.canvas.width;
  const height = elements.canvas.height;
  const centerX = clamp(center.x, 1, width - 1);
  const centerY = clamp(center.y, 1, height - 1);
  const maxRadius = Math.max(
    1,
    Math.min(centerX, width - centerX, centerY, height - centerY)
  );
  const radius = clamp(
    Math.max(minimumRadius, Math.hypot(edge.x - centerX, edge.y - centerY)),
    1,
    maxRadius
  );

  return normalizedRect({
    x1: centerX - radius,
    y1: centerY - radius,
    x2: centerX + radius,
    y2: centerY + radius
  });
}

function eventCanvasPoint(event) {
  const bounds = elements.canvas.getBoundingClientRect();
  return {
    x: clamp(
      (event.clientX - bounds.left) * elements.canvas.width / bounds.width,
      0,
      elements.canvas.width
    ),
    y: clamp(
      (event.clientY - bounds.top) * elements.canvas.height / bounds.height,
      0,
      elements.canvas.height
    )
  };
}

function defaultRoi(mode) {
  const width = elements.canvas.width;
  const height = elements.canvas.height;
  const side = Math.max(24, Math.min(width, height) * 0.23);
  const margin = Math.min(width, height) * 0.06;
  let centerX = width / 2;
  let centerY = height / 2;

  if (mode === "white") {
    centerX = margin + side / 2;
    centerY = margin + side / 2;
  } else if (mode === "dark") {
    centerX = width - margin - side / 2;
    centerY = margin + side / 2;
  }

  return normalizedRect({
    x1: centerX - side / 2,
    y1: centerY - side / 2,
    x2: centerX + side / 2,
    y2: centerY + side / 2
  });
}

function drawRoi(mode, roi) {
  const rect = normalizedRect(roi);
  if (!rect) {
    return;
  }

  const colors = {
    sample: cssColor("--selection-sample"),
    white: cssColor("--selection-white"),
    dark: cssColor("--selection-dark")
  };
  const labels = {
    sample: "样品",
    white: "白板",
    dark: "暗场"
  };
  const scale = Math.max(1, elements.canvas.width / 900);
  const active = mode === state.activeMode;
  const lineWidth = (active ? 4 : 2) * scale;
  const x = rect.x1;
  const y = rect.y1;
  const width = rect.x2 - rect.x1;
  const height = rect.y2 - rect.y1;

  drawingContext.save();

  if (mode === "white") {
    drawingContext.strokeStyle = cssColor("--selection-dark");
    drawingContext.lineWidth = lineWidth + 3 * scale;
    drawingContext.strokeRect(x, y, width, height);
  }

  drawingContext.strokeStyle = colors[mode];
  drawingContext.lineWidth = lineWidth;
  if (mode === "sample" && state.sampleShape === "circle") {
    drawingContext.beginPath();
    drawingContext.ellipse(
      x + width / 2,
      y + height / 2,
      width / 2,
      height / 2,
      0,
      0,
      Math.PI * 2
    );
    drawingContext.stroke();
  } else {
    drawingContext.strokeRect(x, y, width, height);
  }

  const fontSize = Math.max(16, Math.round(16 * scale));
  drawingContext.font = `600 ${fontSize}px sans-serif`;
  const labelWidth = drawingContext.measureText(labels[mode]).width + 16 * scale;
  const labelHeight = fontSize + 10 * scale;
  const labelY = Math.max(0, y - labelHeight);
  drawingContext.fillStyle = colors[mode];
  drawingContext.fillRect(x, labelY, labelWidth, labelHeight);
  drawingContext.fillStyle = mode === "dark"
    ? cssColor("--selection-white")
    : cssColor("--selection-dark");
  drawingContext.fillText(
    labels[mode],
    x + 8 * scale,
    labelY + fontSize + 3 * scale
  );
  drawingContext.restore();
}

function drawCanvas() {
  if (!state.imageLoaded) {
    return;
  }

  drawingContext.clearRect(
    0,
    0,
    elements.canvas.width,
    elements.canvas.height
  );
  drawingContext.drawImage(sourceCanvas, 0, 0);

  for (const mode of ["sample", "white", "dark"]) {
    if (state.rois[mode]) {
      drawRoi(mode, state.rois[mode]);
    }
  }
}

function meanRgb(rect, shape = "rect") {
  const roi = normalizedRect(rect);
  if (!roi) {
    return null;
  }

  const x = Math.floor(roi.x1);
  const y = Math.floor(roi.y1);
  const width = Math.max(1, Math.floor(roi.x2) - x);
  const height = Math.max(1, Math.floor(roi.y2) - y);
  const pixels = sourceContext.getImageData(x, y, width, height).data;
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;

  const centerX = width / 2;
  const centerY = height / 2;
  const radiusX = width / 2;
  const radiusY = height / 2;

  for (let index = 0; index < pixels.length; index += 4) {
    if (shape === "circle") {
      const pixelIndex = index / 4;
      const pixelX = pixelIndex % width + 0.5;
      const pixelY = Math.floor(pixelIndex / width) + 0.5;
      const normalizedX = (pixelX - centerX) / radiusX;
      const normalizedY = (pixelY - centerY) / radiusY;
      if (normalizedX ** 2 + normalizedY ** 2 > 1) {
        continue;
      }
    }

    if (pixels[index + 3] === 0) {
      continue;
    }

    red += pixels[index];
    green += pixels[index + 1];
    blue += pixels[index + 2];
    count += 1;
  }

  if (!count) {
    return null;
  }

  return {
    r: Math.round(red / count),
    g: Math.round(green / count),
    b: Math.round(blue / count),
    count,
    width,
    height
  };
}

function rgbText(rgb) {
  return rgb ? `RGB(${rgb.r}, ${rgb.g}, ${rgb.b})` : "--";
}

function setRgbDisplay(rgb, valueElements, textElement, swatchElement) {
  if (!rgb) {
    valueElements.forEach((element) => {
      element.textContent = "--";
    });
    textElement.textContent = "RGB(--, --, --)";
    swatchElement.style.background = "";
    return;
  }

  valueElements[0].textContent = String(rgb.r);
  valueElements[1].textContent = String(rgb.g);
  valueElements[2].textContent = String(rgb.b);
  textElement.textContent = rgbText(rgb);
  swatchElement.style.background = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

function correctedRgb(sample, white, dark) {
  if (!sample || !white) {
    return null;
  }

  const black = dark || { r: 0, g: 0, b: 0 };
  const output = {};

  for (const channel of ["r", "g", "b"]) {
    const span = white[channel] - black[channel];
    if (span <= 2) {
      return null;
    }

    output[channel] = Math.round(clamp(
      255 * (sample[channel] - black[channel]) / span,
      0,
      255
    ));
  }

  return output;
}

function rgbToLab(rgb) {
  if (!rgb) {
    return null;
  }

  const linearize = (channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  };
  const red = linearize(rgb.r);
  const green = linearize(rgb.g);
  const blue = linearize(rgb.b);
  const x = 0.4124564 * red + 0.3575761 * green + 0.1804375 * blue;
  const y = 0.2126729 * red + 0.7151522 * green + 0.0721750 * blue;
  const z = 0.0193339 * red + 0.1191920 * green + 0.9503041 * blue;
  const delta = 6 / 29;
  const transform = (value) => value > delta ** 3
    ? Math.cbrt(value)
    : value / (3 * delta ** 2) + 4 / 29;
  const fx = transform(x / 0.95047);
  const fy = transform(y);
  const fz = transform(z / 1.08883);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz)
  };
}

function labNumber(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return Math.abs(value) < 0.05 ? "0.0" : value.toFixed(1);
}

function labText(lab) {
  return lab
    ? "L* " + labNumber(lab.l) + ", a* " + labNumber(lab.a) +
      ", b* " + labNumber(lab.b)
    : "--";
}

function setLabDisplay(lab, source) {
  elements.labL.textContent = labNumber(lab?.l);
  elements.labA.textContent = labNumber(lab?.a);
  elements.labB.textContent = labNumber(lab?.b);

  if (!lab) {
    elements.labStatus.textContent = "等待样品区域";
  } else if (source === "corrected") {
    elements.labStatus.textContent = "基于校正RGB";
  } else {
    elements.labStatus.textContent = "基于原始RGB";
  }
}

function recalculateResults() {
  const sample = state.rois.sample
    ? meanRgb(state.rois.sample, state.sampleShape)
    : null;
  const white = state.rois.white ? meanRgb(state.rois.white) : null;
  const dark = state.rois.dark ? meanRgb(state.rois.dark) : null;
  const corrected = correctedRgb(sample, white, dark);
  const labSource = corrected ? "corrected" : sample ? "raw" : null;
  const lab = rgbToLab(corrected || sample);

  state.results = { sample, white, dark, corrected, lab, labSource };

  elements.sampleRoiValue.textContent = sample ? rgbText(sample) : "未选择";
  elements.whiteRoiValue.textContent = white ? rgbText(white) : "未选择";
  elements.darkRoiValue.textContent = dark ? rgbText(dark) : "未选择";
  elements.samplePixelCount.textContent = sample
    ? state.sampleShape === "circle"
      ? "圆形 · " + sample.count.toLocaleString() + " px"
      : sample.width + " × " + sample.height + " px"
    : "--";

  setRgbDisplay(
    sample,
    [elements.rawR, elements.rawG, elements.rawB],
    elements.rawRgbText,
    elements.rawSwatch
  );
  setRgbDisplay(
    corrected,
    [elements.correctedR, elements.correctedG, elements.correctedB],
    elements.correctedRgbText,
    elements.correctedSwatch
  );
  setLabDisplay(lab, labSource);

  if (!white) {
    elements.correctionStatus.textContent = "需要白板区域";
  } else if (!corrected) {
    elements.correctionStatus.textContent = "白板与暗场差值无效";
  } else if (dark) {
    elements.correctionStatus.textContent = "已使用白板和暗场";
  } else {
    elements.correctionStatus.textContent = "已使用白板，暗场按0";
  }

  elements.saveRecordButton.disabled = !sample;
  elements.resetRoiButton.disabled = !state.imageLoaded;
  elements.clearRoiButton.disabled = !state.rois[state.activeMode];
}

function selectRoiMode(mode) {
  state.activeMode = mode;
  elements.roiModeButtons.forEach((button) => {
    const selected = button.dataset.roiMode === mode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  elements.clearRoiButton.disabled = !state.rois[mode];
  drawCanvas();
}

function selectSampleShape(shape) {
  if (shape !== "rect" && shape !== "circle") {
    return;
  }

  state.sampleShape = shape;
  if (shape === "circle" && state.rois.sample) {
    state.rois.sample = inscribedSquare(state.rois.sample);
  }
  elements.sampleShapeButtons.forEach((button) => {
    const selected = button.dataset.sampleShape === shape;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  drawCanvas();
  recalculateResults();
}

function startRoiDrag(event) {
  if (!state.imageLoaded) {
    return;
  }

  event.preventDefault();
  elements.canvas.setPointerCapture(event.pointerId);
  const point = eventCanvasPoint(event);
  state.dragStart = point;
  state.dragging = true;
  state.rois[state.activeMode] =
    state.activeMode === "sample" && state.sampleShape === "circle"
      ? circleRectFromCenter(point, point)
      : {
          x1: point.x,
          y1: point.y,
          x2: point.x,
          y2: point.y
        };
  drawCanvas();
}

function moveRoiDrag(event) {
  if (!state.dragging || !state.dragStart) {
    return;
  }

  const point = eventCanvasPoint(event);
  if (state.activeMode === "sample" && state.sampleShape === "circle") {
    state.rois.sample = circleRectFromCenter(state.dragStart, point);
  } else {
    const roi = state.rois[state.activeMode];
    roi.x2 = point.x;
    roi.y2 = point.y;
  }
  drawCanvas();
}

function finishRoiDrag(event) {
  if (!state.dragging || !state.dragStart) {
    return;
  }

  const point = eventCanvasPoint(event);
  const minimumSide = Math.max(
    12,
    Math.min(elements.canvas.width, elements.canvas.height) * 0.025
  );
  const moved = Math.hypot(
    point.x - state.dragStart.x,
    point.y - state.dragStart.y
  );

  if (state.activeMode === "sample" && state.sampleShape === "circle") {
    state.rois.sample = circleRectFromCenter(
      state.dragStart,
      point,
      moved < minimumSide ? minimumSide : 1
    );
  } else if (moved < minimumSide) {
    state.rois[state.activeMode] = normalizedRect({
      x1: point.x - minimumSide,
      y1: point.y - minimumSide,
      x2: point.x + minimumSide,
      y2: point.y + minimumSide
    });
  } else {
    state.rois[state.activeMode].x2 = point.x;
    state.rois[state.activeMode].y2 = point.y;
    state.rois[state.activeMode] = normalizedRect(
      state.rois[state.activeMode]
    );
  }

  state.dragging = false;
  state.dragStart = null;
  drawCanvas();
  recalculateResults();
}

function cancelRoiDrag() {
  state.dragging = false;
  state.dragStart = null;
  drawCanvas();
  recalculateResults();
}

function resetCurrentRoi() {
  if (!state.imageLoaded) {
    return;
  }

  state.rois[state.activeMode] = defaultRoi(state.activeMode);
  drawCanvas();
  recalculateResults();
}

function clearCurrentRoi() {
  state.rois[state.activeMode] = null;
  drawCanvas();
  recalculateResults();
}

function formatFileSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatExposure(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  if (seconds < 1) {
    return `1/${Math.round(1 / seconds)} s`;
  }
  return `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`;
}

function formatExifDate(value) {
  if (!value) {
    return null;
  }
  return value.replace(
    /^(\d{4}):(\d{2}):(\d{2})/,
    "$1-$2-$3"
  );
}

function renderMetadata() {
  const metadata = state.metadata;
  const rows = [
    ["文件", state.file ? state.file.name : null],
    ["大小", state.file ? formatFileSize(state.file.size) : null],
    ["分辨率", metadata.width && metadata.height
      ? `${metadata.width} × ${metadata.height} px`
      : null],
    ["设备", [metadata.make, metadata.model].filter(Boolean).join(" ") || null],
    ["拍摄时间", formatExifDate(metadata.dateTimeOriginal || metadata.dateTime)],
    ["ISO", metadata.iso ? String(metadata.iso) : null],
    ["曝光时间", formatExposure(metadata.exposureTime)],
    ["光圈", metadata.fNumber
      ? `f/${Number(metadata.fNumber).toFixed(1)}`
      : null],
    ["焦距", metadata.focalLength
      ? `${Number(metadata.focalLength).toFixed(1)} mm`
      : null],
    ["曝光补偿", Number.isFinite(metadata.exposureBias)
      ? `${Number(metadata.exposureBias).toFixed(2)} EV`
      : null],
    ["白平衡", metadata.whiteBalance === 0
      ? "自动"
      : metadata.whiteBalance === 1
        ? "手动"
        : null],
    ["闪光灯", Number.isFinite(metadata.flash)
      ? (metadata.flash & 1 ? "已闪光" : "未闪光")
      : null],
    ["色彩空间", metadata.colorSpace === 1
      ? "sRGB"
      : metadata.colorSpace === 65535
        ? "未标定"
        : null]
  ].filter((row) => row[1] !== null && row[1] !== "");

  elements.metadataList.replaceChildren();
  for (const [term, description] of rows) {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = description;
    row.append(dt, dd);
    elements.metadataList.append(row);
  }

  if (rows.length <= 3) {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = "EXIF";
    dd.textContent = "照片未包含更多拍摄参数";
    row.append(dt, dd);
    elements.metadataList.append(row);
  }
}

function readExifValue(view, tiffStart, entryOffset, littleEndian) {
  const typeSizes = {
    1: 1,
    2: 1,
    3: 2,
    4: 4,
    5: 8,
    7: 1,
    9: 4,
    10: 8
  };

  const type = view.getUint16(entryOffset + 2, littleEndian);
  const count = view.getUint32(entryOffset + 4, littleEndian);
  const typeSize = typeSizes[type];
  if (!typeSize || count < 1 || count > 10000) {
    return null;
  }

  const totalBytes = typeSize * count;
  const dataOffset = totalBytes <= 4
    ? entryOffset + 8
    : tiffStart + view.getUint32(entryOffset + 8, littleEndian);

  if (dataOffset < 0 || dataOffset + totalBytes > view.byteLength) {
    return null;
  }

  if (type === 2) {
    let output = "";
    for (let index = 0; index < count; index += 1) {
      const code = view.getUint8(dataOffset + index);
      if (code === 0) {
        break;
      }
      output += String.fromCharCode(code);
    }
    return output.trim();
  }

  const values = [];
  for (let index = 0; index < count; index += 1) {
    const offset = dataOffset + index * typeSize;
    let value = null;

    if (type === 1 || type === 7) {
      value = view.getUint8(offset);
    } else if (type === 3) {
      value = view.getUint16(offset, littleEndian);
    } else if (type === 4) {
      value = view.getUint32(offset, littleEndian);
    } else if (type === 9) {
      value = view.getInt32(offset, littleEndian);
    } else if (type === 5 || type === 10) {
      const numerator = type === 10
        ? view.getInt32(offset, littleEndian)
        : view.getUint32(offset, littleEndian);
      const denominator = type === 10
        ? view.getInt32(offset + 4, littleEndian)
        : view.getUint32(offset + 4, littleEndian);
      value = denominator ? numerator / denominator : null;
    }

    values.push(value);
  }

  return count === 1 ? values[0] : values;
}

function parseExifIfd(view, tiffStart, ifdOffset, littleEndian, tags) {
  const absoluteOffset = tiffStart + ifdOffset;
  if (absoluteOffset < 0 || absoluteOffset + 2 > view.byteLength) {
    return;
  }

  const entryCount = view.getUint16(absoluteOffset, littleEndian);
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = absoluteOffset + 2 + index * 12;
    if (entryOffset + 12 > view.byteLength) {
      break;
    }
    const tag = view.getUint16(entryOffset, littleEndian);
    tags[tag] = readExifValue(
      view,
      tiffStart,
      entryOffset,
      littleEndian
    );
  }
}

function parseExif(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 12 || view.getUint16(0, false) !== 0xffd8) {
    return {};
  }

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = view.getUint8(offset + 1);
    if (marker === 0xda || marker === 0xd9) {
      break;
    }

    const segmentLength = view.getUint16(offset + 2, false);
    if (segmentLength < 2 || offset + 2 + segmentLength > view.byteLength) {
      break;
    }

    if (marker === 0xe1 && segmentLength >= 8) {
      const signature = String.fromCharCode(
        view.getUint8(offset + 4),
        view.getUint8(offset + 5),
        view.getUint8(offset + 6),
        view.getUint8(offset + 7)
      );

      if (signature === "Exif") {
        const tiffStart = offset + 10;
        if (tiffStart + 8 > view.byteLength) {
          return {};
        }

        const byteOrder = view.getUint16(tiffStart, false);
        const littleEndian = byteOrder === 0x4949;
        if (!littleEndian && byteOrder !== 0x4d4d) {
          return {};
        }

        const tags = {};
        const firstIfdOffset = view.getUint32(tiffStart + 4, littleEndian);
        parseExifIfd(
          view,
          tiffStart,
          firstIfdOffset,
          littleEndian,
          tags
        );

        if (Number.isFinite(tags[0x8769])) {
          parseExifIfd(
            view,
            tiffStart,
            tags[0x8769],
            littleEndian,
            tags
          );
        }

        return {
          make: tags[0x010f] || null,
          model: tags[0x0110] || null,
          orientation: tags[0x0112] || null,
          dateTime: tags[0x0132] || null,
          exposureTime: tags[0x829a] ?? null,
          fNumber: tags[0x829d] ?? null,
          iso: Array.isArray(tags[0x8827])
            ? tags[0x8827][0]
            : tags[0x8827] ?? null,
          dateTimeOriginal: tags[0x9003] || null,
          exposureBias: tags[0x9204] ?? null,
          flash: tags[0x9209] ?? null,
          focalLength: tags[0x920a] ?? null,
          colorSpace: tags[0xa001] ?? null,
          exifWidth: tags[0xa002] ?? null,
          exifHeight: tags[0xa003] ?? null,
          whiteBalance: tags[0xa403] ?? null,
          lensModel: tags[0xa434] || null
        };
      }
    }

    offset += 2 + segmentLength;
  }

  return {};
}

async function extractExif(file) {
  try {
    const slice = file.slice(0, Math.min(file.size, 2 * 1024 * 1024));
    return parseExif(await slice.arrayBuffer());
  } catch (error) {
    return {};
  }
}

function decodeImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      const scale = Math.min(
        1,
        MAX_IMAGE_SIDE / Math.max(image.naturalWidth, image.naturalHeight)
      );
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));

      sourceCanvas.width = width;
      sourceCanvas.height = height;
      elements.canvas.width = width;
      elements.canvas.height = height;
      sourceContext.clearRect(0, 0, width, height);
      sourceContext.drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(objectUrl);
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
        workingWidth: width,
        workingHeight: height
      });
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("无法读取该图片格式"));
    };

    image.src = objectUrl;
  });
}

async function handleImageFile(file) {
  if (!file) {
    return;
  }

  if (!file.type.startsWith("image/")) {
    showToast("请选择照片文件");
    return;
  }

  elements.imageStatus.textContent = "正在读取照片和拍摄参数…";
  elements.saveRecordButton.disabled = true;

  try {
    const [imageInfo, exif] = await Promise.all([
      decodeImage(file),
      extractExif(file)
    ]);

    state.file = file;
    state.metadata = {
      ...exif,
      width: imageInfo.width,
      height: imageInfo.height
    };
    state.imageLoaded = true;
    state.rois = {
      sample: defaultRoi("sample"),
      white: null,
      dark: null
    };

    elements.emptyState.hidden = true;
    elements.imageStatus.textContent = `${file.name} · 拖动选择${state.activeMode === "sample" ? "样品" : state.activeMode === "white" ? "白板" : "暗场"}区域`;
    renderMetadata();
    drawCanvas();
    recalculateResults();
  } catch (error) {
    elements.imageStatus.textContent = "照片读取失败";
    showToast(error.message || "无法读取照片");
  } finally {
    elements.cameraInput.value = "";
    elements.galleryInput.value = "";
  }
}

function currentDeviceName() {
  return [state.metadata.make, state.metadata.model]
    .filter(Boolean)
    .join(" ") || "未知";
}

function nullableNumber(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function loadSettings() {
  const settings = loadJson(SETTINGS_KEY, {});
  if (settings.lightSource) {
    elements.lightSource.value = settings.lightSource;
  }
  if (settings.lightCct !== null && settings.lightCct !== undefined) {
    elements.lightCct.value = settings.lightCct;
  }
  if (
    settings.lightBrightness !== null &&
    settings.lightBrightness !== undefined
  ) {
    elements.lightBrightness.value = settings.lightBrightness;
  }
  if (settings.sampleState) {
    elements.sampleState.value = settings.sampleState;
  }
}

function createRecord() {
  const results = state.results;
  const now = new Date();

  return {
    id: `${now.getTime()}-${Math.random().toString(16).slice(2)}`,
    time: now.toISOString(),
    localTime: now.toLocaleString("zh-CN", { hour12: false }),
    fileName: state.file ? state.file.name : "",
    width: state.metadata.width || null,
    height: state.metadata.height || null,
    make: state.metadata.make || "",
    model: state.metadata.model || "",
    iso: state.metadata.iso ?? null,
    exposureTime: state.metadata.exposureTime ?? null,
    fNumber: state.metadata.fNumber ?? null,
    focalLength: state.metadata.focalLength ?? null,
    whiteBalance: state.metadata.whiteBalance ?? null,
    raw: results.sample
      ? { r: results.sample.r, g: results.sample.g, b: results.sample.b }
      : null,
    white: results.white
      ? { r: results.white.r, g: results.white.g, b: results.white.b }
      : null,
    dark: results.dark
      ? { r: results.dark.r, g: results.dark.g, b: results.dark.b }
      : null,
    corrected: results.corrected,
    lab: results.lab
      ? { l: results.lab.l, a: results.lab.a, b: results.lab.b }
      : null,
    sampleShape: state.sampleShape,
    samplePixels: results.sample ? results.sample.count : null,
    lightSource: elements.lightSource.value,
    lightCct: nullableNumber(elements.lightCct.value),
    lightBrightness: nullableNumber(elements.lightBrightness.value),
    sampleState: elements.sampleState.value,
    notes: elements.notes.value.trim()
  };
}

function saveRecord(event) {
  event.preventDefault();
  if (!state.results || !state.results.sample) {
    showToast("请先选择样品区域");
    return;
  }

  const record = createRecord();
  state.records.unshift(record);
  saveJson(HISTORY_KEY, state.records);
  saveJson(SETTINGS_KEY, {
    lightSource: record.lightSource,
    lightCct: record.lightCct,
    lightBrightness: record.lightBrightness,
    sampleState: record.sampleState
  });
  renderHistory();
  showToast("本次数据已保存到手机本地");
}

function addCell(row, text) {
  const cell = document.createElement("td");
  cell.textContent = text;
  row.append(cell);
  return cell;
}

function renderHistory() {
  elements.historyBody.replaceChildren();
  const hasRecords = state.records.length > 0;
  elements.historyCount.textContent = `${state.records.length}条数据`;
  elements.exportButton.disabled = !hasRecords;
  elements.clearHistoryButton.disabled = !hasRecords;

  if (!hasRecords) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    const cell = document.createElement("td");
    cell.colSpan = 9;
    cell.textContent = "暂无记录";
    row.append(cell);
    elements.historyBody.append(row);
    return;
  }

  for (const record of state.records) {
    const row = document.createElement("tr");
    addCell(row, record.localTime);
    addCell(row, rgbText(record.raw));
    addCell(row, record.corrected ? rgbText(record.corrected) : "--");
    addCell(
      row,
      labText(record.lab || rgbToLab(record.corrected || record.raw))
    );
    addCell(row, record.lightSource || "--");
    addCell(row, record.lightCct ? `${record.lightCct} K` : "--");
    addCell(
      row,
      record.lightBrightness ? `${record.lightBrightness}%` : "--"
    );
    addCell(row, [record.make, record.model].filter(Boolean).join(" ") || "未知");

    const actionCell = document.createElement("td");
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-record";
    deleteButton.textContent = "删除";
    deleteButton.setAttribute("aria-label", `删除${record.localTime}的记录`);
    deleteButton.addEventListener("click", () => deleteRecord(record.id));
    actionCell.append(deleteButton);
    row.append(actionCell);
    elements.historyBody.append(row);
  }
}

function deleteRecord(id) {
  state.records = state.records.filter((record) => record.id !== id);
  saveJson(HISTORY_KEY, state.records);
  renderHistory();
  showToast("记录已删除");
}

function clearHistory() {
  if (!state.records.length) {
    return;
  }
  if (!window.confirm("确定清空全部本地记录吗？此操作无法撤销。")) {
    return;
  }
  state.records = [];
  saveJson(HISTORY_KEY, state.records);
  renderHistory();
  showToast("本地记录已清空");
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function exportCsv() {
  if (!state.records.length) {
    return;
  }

  const headers = [
    "检测时间",
    "文件名",
    "图片宽度",
    "图片高度",
    "手机品牌",
    "手机型号",
    "ISO",
    "曝光时间（秒）",
    "光圈",
    "焦距（mm）",
    "白平衡模式",
    "原始R",
    "原始G",
    "原始B",
    "白板R",
    "白板G",
    "白板B",
    "暗场R",
    "暗场G",
    "暗场B",
    "校正R",
    "校正G",
    "校正B",
    "L*",
    "a*",
    "b*",
    "样品区域形状",
    "样品像素数",
    "光源",
    "标称色温（K）",
    "LED PWM亮度（%）",
    "样品状态",
    "备注"
  ];

  const rows = state.records.map((record) => [
    record.localTime,
    record.fileName,
    record.width,
    record.height,
    record.make,
    record.model,
    record.iso,
    record.exposureTime,
    record.fNumber,
    record.focalLength,
    record.whiteBalance === 0
      ? "自动"
      : record.whiteBalance === 1
        ? "手动"
        : "",
    record.raw?.r,
    record.raw?.g,
    record.raw?.b,
    record.white?.r,
    record.white?.g,
    record.white?.b,
    record.dark?.r,
    record.dark?.g,
    record.dark?.b,
    record.corrected?.r,
    record.corrected?.g,
    record.corrected?.b,
    (record.lab || rgbToLab(record.corrected || record.raw))?.l,
    (record.lab || rgbToLab(record.corrected || record.raw))?.a,
    (record.lab || rgbToLab(record.corrected || record.raw))?.b,
    record.sampleShape === "circle" ? "圆形" : "矩形",
    record.samplePixels,
    record.lightSource,
    record.lightCct,
    record.lightBrightness,
    record.sampleState,
    record.notes
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  const blob = new Blob(["\ufeff", csv], {
    type: "text/csv;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const timestamp = new Date()
    .toISOString()
    .slice(0, 16)
    .replaceAll(/[-:T]/g, "");
  link.href = url;
  link.download = `膜色RGB数据_${timestamp}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("CSV已导出，可用Excel打开");
}

function handleInstallPrompt(event) {
  event.preventDefault();
  state.installPrompt = event;
  elements.installButton.hidden = false;
}

async function installApp() {
  if (!state.installPrompt) {
    return;
  }
  state.installPrompt.prompt();
  await state.installPrompt.userChoice;
  state.installPrompt = null;
  elements.installButton.hidden = true;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  if (!window.isSecureContext && location.hostname !== "localhost") {
    return;
  }
  navigator.serviceWorker.register("./service-worker.js").catch(() => {
    // Online analysis remains available when offline installation is unsupported.
  });
}

elements.cameraInput.addEventListener("change", (event) => {
  handleImageFile(event.target.files?.[0]);
});
elements.galleryInput.addEventListener("change", (event) => {
  handleImageFile(event.target.files?.[0]);
});
elements.roiModeButtons.forEach((button) => {
  button.addEventListener("click", () => selectRoiMode(button.dataset.roiMode));
});
elements.sampleShapeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectSampleShape(button.dataset.sampleShape);
  });
});
elements.resetRoiButton.addEventListener("click", resetCurrentRoi);
elements.clearRoiButton.addEventListener("click", clearCurrentRoi);
elements.canvas.addEventListener("pointerdown", startRoiDrag);
elements.canvas.addEventListener("pointermove", moveRoiDrag);
elements.canvas.addEventListener("pointerup", finishRoiDrag);
elements.canvas.addEventListener("pointercancel", cancelRoiDrag);
elements.experimentForm.addEventListener("submit", saveRecord);
elements.exportButton.addEventListener("click", exportCsv);
elements.clearHistoryButton.addEventListener("click", clearHistory);
elements.installButton.addEventListener("click", installApp);
window.addEventListener("beforeinstallprompt", handleInstallPrompt);
window.addEventListener("resize", drawCanvas);

loadSettings();
renderHistory();
registerServiceWorker();
