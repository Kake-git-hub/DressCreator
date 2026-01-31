import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Download,
  Image as ImageIcon,
  Key,
  Loader2,
  Save,
  Scissors,
  Sliders,
  Trash2,
  Upload,
} from 'lucide-react';

type Category = {
  id: string;
  label: string;
};

type ProcessResult = {
  originalUrl: string;
  thumbUrl: string;
};

type BoundingBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type ImageItem = {
  id: string;
  sourceUrl: string;
  tolerance: number;
  erosion: number;
  categoryId: string;
  itemName: string;
  name: string;
  isNaming: boolean;
  originalUrl: string;
  thumbUrl: string;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

const CATEGORIES: Category[] = [
  { id: '1_4_インナー', label: 'インナー' },
  { id: '2_7_くつ', label: 'くつ' },
  { id: '3_6_ボトムス', label: 'ボトムス' },
  { id: '4_2_ドレス', label: 'ドレス' },
  { id: '5_5_トップス', label: 'トップス' },
  { id: '10_1_かお', label: 'かお' },
  { id: '11_9_ぼうし', label: 'ぼうし' },
  { id: '12_10_アクセサリー', label: 'アクセサリー' },
  { id: '13_11_エフェクト', label: 'エフェクト' },
];

const CHECKERBOARD_URL = 'https://www.transparenttextures.com/patterns/checkerboard.png';

const App: React.FC = () => {
  const [apiKey, setApiKey] = useState<string>('');
  const [showApiInput, setShowApiInput] = useState<boolean>(false);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [processing, setProcessing] = useState<boolean>(false);
  const [isDeletingAll, setIsDeletingAll] = useState<boolean>(false);
  const [adjustingItem, setAdjustingItem] = useState<ImageItem | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const savedKey = localStorage.getItem('user_gemini_api_key');
    if (savedKey) setApiKey(savedKey);
  }, []);

  const saveApiKey = (key: string): void => {
    const trimmedKey = String(key).trim();
    setApiKey(trimmedKey);
    localStorage.setItem('user_gemini_api_key', trimmedKey);
    setShowApiInput(false);
  };

  const generateFullFilename = (catId: string, itemName: string): string => {
    const isAcc = String(catId).includes('アクセサリー');
    const safeItemName = String(itemName || '装備').replace(/[\\/:*?"<>|]/g, '').trim();
    return `${String(catId)}${isAcc ? '_overlap' : ''}_${safeItemName}`;
  };

  const applyErosion = (mask: Uint8Array, width: number, height: number, size: number): Uint8Array => {
    if (size <= 0) return mask;
    let currentMask = new Uint8Array(mask);

    for (let s = 0; s < size; s++) {
      const nextMask = new Uint8Array(currentMask);
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = y * width + x;
          if (currentMask[idx] === 1) {
            if (
              currentMask[idx - 1] === 0 ||
              currentMask[idx + 1] === 0 ||
              currentMask[idx - width] === 0 ||
              currentMask[idx + width] === 0
            ) {
              nextMask[idx] = 0;
            }
          }
        }
      }
      currentMask = nextMask;
    }

    return currentMask;
  };

  const processImage = async (
    imgDataObj: Pick<ImageItem, 'sourceUrl' | 'tolerance' | 'erosion'>,
  ): Promise<ProcessResult> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        const workCanvas = document.createElement('canvas');
        workCanvas.width = img.width;
        workCanvas.height = img.height;
        const workCtx = workCanvas.getContext('2d');
        if (!workCtx) {
          resolve({ originalUrl: '', thumbUrl: '' });
          return;
        }

        workCtx.drawImage(img, 0, 0);
        const imageData = workCtx.getImageData(0, 0, img.width, img.height);
        const data = imageData.data;
        const width = img.width;
        const height = img.height;
        const totalPixels = width * height;

        const cornerIdx = [0, (width - 1) * 4, (height - 1) * width * 4, (totalPixels - 1) * 4];
        const samples = cornerIdx.map((idx) => ({ r: data[idx], g: data[idx + 1], b: data[idx + 2] }));
        const avgBG = {
          r: Math.round(samples.reduce((a, b) => a + b.r, 0) / 4),
          g: Math.round(samples.reduce((a, b) => a + b.g, 0) / 4),
          b: Math.round(samples.reduce((a, b) => a + b.b, 0) / 4),
        };

        const tol = imgDataObj.tolerance ?? 50;
        const erosionSize = imgDataObj.erosion ?? 0;

        const isBackground = new Uint8Array(totalPixels);
        const visited = new Uint8Array(totalPixels);
        const stack = new Uint32Array(totalPixels);
        let ptr = 0;

        [0, width - 1, (height - 1) * width, totalPixels - 1].forEach((seed) => {
          stack[ptr++] = seed;
          visited[seed] = 1;
        });

        while (ptr > 0) {
          const idx = stack[--ptr];
          const r = data[idx * 4];
          const g = data[idx * 4 + 1];
          const b = data[idx * 4 + 2];
          const dist = Math.sqrt((r - avgBG.r) ** 2 + (g - avgBG.g) ** 2 + (b - avgBG.b) ** 2);

          if (dist < tol * 1.5) {
            isBackground[idx] = 1;
            const x = idx % width;
            const ns = [idx - width, idx + width, idx - 1, idx + 1];
            for (const ni of ns) {
              if (ni >= 0 && ni < totalPixels && visited[ni] === 0) {
                const nx = ni % width;
                if (Math.abs(nx - x) <= 1) {
                  visited[ni] = 1;
                  stack[ptr++] = ni;
                }
              }
            }
          }
        }

        const mask = new Uint8Array(totalPixels);
        for (let i = 0; i < totalPixels; i++) if (isBackground[i] === 0) mask[i] = 1;
        const erodedMask = applyErosion(mask, width, height, erosionSize);

        for (let i = 0; i < totalPixels; i++) {
          const px = i % width;
          const py = (i / width) | 0;

          if (px > width * 0.92 && py > height * 0.92) {
            data[i * 4 + 3] = 0;
            continue;
          }

          if (erodedMask[i] === 0) {
            data[i * 4 + 3] = 0;
          } else {
            const r = data[i * 4];
            const g = data[i * 4 + 1];
            const b = data[i * 4 + 2];
            const dist = Math.sqrt((r - avgBG.r) ** 2 + (g - avgBG.g) ** 2 + (b - avgBG.b) ** 2);
            if (dist < tol * 1.3) data[i * 4 + 3] = Math.max(0, (dist - tol) * (255 / (tol * 0.3)));
          }
        }

        workCtx.putImageData(imageData, 0, 0);

        const islandVisited = new Uint8Array(totalPixels);
        const finalMask = new Uint8Array(totalPixels);
        const islandStack = new Uint32Array(totalPixels);
        let minX = width;
        let minY = height;
        let maxX = 0;
        let maxY = 0;
        let foundAny = false;

        for (let i = 0; i < totalPixels; i++) {
          if (islandVisited[i] === 0 && data[i * 4 + 3] > 20) {
            let iPtr = 0;
            islandStack[iPtr++] = i;
            islandVisited[i] = 1;
            const island: number[] = [];

            while (iPtr > 0) {
              const idx = islandStack[--iPtr];
              island.push(idx);
              const x = idx % width;
              const neighbors = [idx - width, idx + width, idx - 1, idx + 1];

              for (const ni of neighbors) {
                if (ni >= 0 && ni < totalPixels && islandVisited[ni] === 0 && data[ni * 4 + 3] > 20) {
                  const nx = ni % width;
                  if (Math.abs(nx - x) <= 1) {
                    islandVisited[ni] = 1;
                    islandStack[iPtr++] = ni;
                  }
                }
              }
            }

            if (island.length > 50) {
              island.forEach((p) => {
                finalMask[p] = 1;
                const px = p % width;
                const py = (p / width) | 0;
                if (px < minX) minX = px;
                if (px > maxX) maxX = px;
                if (py < minY) minY = py;
                if (py > maxY) maxY = py;
              });
              foundAny = true;
            }
          }
        }

        for (let i = 0; i < totalPixels; i++) if (finalMask[i] === 0) data[i * 4 + 3] = 0;
        workCtx.putImageData(imageData, 0, 0);

        const tightBox: BoundingBox | null = foundAny
          ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
          : null;

        const generateOutput = (targetSize: number, isTight: boolean): string => {
          const finalCanvas = document.createElement('canvas');
          finalCanvas.width = targetSize;
          finalCanvas.height = targetSize;
          const fCtx = finalCanvas.getContext('2d');
          if (!fCtx) return finalCanvas.toDataURL('image/png');
          fCtx.imageSmoothingQuality = 'high';
          if (!tightBox) return finalCanvas.toDataURL('image/png');

          const scale = isTight
            ? Math.min(targetSize / tightBox.w, targetSize / tightBox.h)
            : Math.min((targetSize * 0.96) / width, (targetSize * 0.96) / height);

          const dw = (isTight ? tightBox.w : width) * scale;
          const dh = (isTight ? tightBox.h : height) * scale;
          const dx = (targetSize - dw) / 2;
          const dy = (targetSize - dh) / 2;
          const sx = isTight ? tightBox.x : 0;
          const sy = isTight ? tightBox.y : 0;
          const sw = isTight ? tightBox.w : width;
          const sh = isTight ? tightBox.h : height;

          fCtx.drawImage(workCanvas, sx, sy, sw, sh, dx, dy, dw, dh);
          return finalCanvas.toDataURL('image/png');
        };

        resolve({ originalUrl: generateOutput(2048, false), thumbUrl: generateOutput(1024, true) });
      };

      img.src = imgDataObj.sourceUrl;
    });
  };

  const suggestFilename = async (dataUrl: string, imgId: string): Promise<void> => {
    if (!apiKey) return;

    const model = 'gemini-2.5-flash-preview-09-2025';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const tryFetch = async (retries = 3): Promise<void> => {
      try {
        const base64 = dataUrl.split(',')[1];
        if (!base64) throw new Error('Invalid data URL');

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `分析：[${CATEGORIES.map((c) => c.label).join(', ')}]から1つ選択。具体的でユニークな日本語名を考案。JSON形式 {"category": "カテゴリ名", "name": "日本語名"} で出力。余計な文字は一切含めない。`,
                  },
                  { inlineData: { mimeType: 'image/png', data: base64 } },
                ],
              },
            ],
          }),
        });

        if (!response.ok) throw new Error('API Error');

        const result = (await response.json()) as GeminiResponse;
        const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) throw new Error('No Text');

        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('JSON not found');

        const parsed = JSON.parse(jsonMatch[0]) as { category?: string; name?: string };
        const foundCategory =
          CATEGORIES.find((c) => c.label === parsed.category) ?? { id: '4_2_ドレス', label: 'ドレス' };
        const itemName = String(parsed.name || '新装備').substring(0, 25);

        setImages((prev) =>
          prev.map((img) =>
            img.id === imgId
              ? {
                  ...img,
                  categoryId: foundCategory.id,
                  itemName,
                  name: generateFullFilename(foundCategory.id, itemName),
                  isNaming: false,
                }
              : img,
          ),
        );
      } catch {
        if (retries > 0) {
          await new Promise<void>((r) => setTimeout(r, 1500));
          return tryFetch(retries - 1);
        }

        setImages((prev) =>
          prev.map((img) =>
            img.id === imgId
              ? { ...img, isNaming: false, itemName: '解析失敗', name: generateFullFilename(img.categoryId, '解析失敗') }
              : img,
          ),
        );
      }
    };

    return tryFetch();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setProcessing(true);

    for (const file of files) {
      const sourceUrl = URL.createObjectURL(file);
      const id = crypto.randomUUID();

      const initialObj: Omit<ImageItem, 'originalUrl' | 'thumbUrl' | 'name'> = {
        id,
        sourceUrl,
        tolerance: 50,
        erosion: 0,
        categoryId: '4_2_ドレス',
        itemName: '解析中...',
        isNaming: Boolean(apiKey),
      };

      const result = await processImage(initialObj);
      const finalItem: ImageItem = {
        ...initialObj,
        ...result,
        name: generateFullFilename(initialObj.categoryId, initialObj.itemName),
      };

      setImages((prev) => [finalItem, ...prev]);
      if (apiKey) void suggestFilename(result.originalUrl, id);
    }

    setProcessing(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const updateItem = async (id: string, patch: Partial<ImageItem>): Promise<void> => {
    const target = images.find((i) => i.id === id);
    if (!target) return;

    const nextItem: ImageItem = { ...target, ...patch };
    const result = await processImage(nextItem);
    const updatedItem: ImageItem = {
      ...nextItem,
      ...result,
      name: generateFullFilename(nextItem.categoryId, nextItem.itemName),
    };

    setImages((prev) => prev.map((img) => (img.id === id ? updatedItem : img)));
    if (adjustingItem?.id === id) setAdjustingItem(updatedItem);
  };

  const downloadFile = (url: string, filename: string): void => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  };

  const downloadAll = (): void => {
    images.forEach((img, i) => {
      setTimeout(() => {
        downloadFile(img.originalUrl, `${img.name}.png`);
        downloadFile(img.thumbUrl, `${img.name}_サムネ.png`);
      }, i * 800);
    });
  };

  return (
    <div className="min-h-screen bg-stone-100 p-4 md:p-8 font-sans text-stone-900 select-none">
      {/* 調整モーダル */}
      {adjustingItem && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-stone-900/95 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setAdjustingItem(null)}
        >
          <div
            className="relative flex flex-col md:flex-row items-center gap-6 max-w-7xl w-full h-full justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex-1 bg-stone-50 rounded-[3rem] overflow-hidden flex items-center justify-center border-4 border-white/10 shadow-2xl h-full max-h-[85vh]"
              style={{ backgroundImage: `url('${CHECKERBOARD_URL}')` }}
            >
              <img
                src={adjustingItem.originalUrl}
                className="max-w-full max-h-full object-contain"
                alt="Adjustment View"
              />
            </div>
            <div className="flex flex-col gap-6 bg-black/40 backdrop-blur-xl p-3 py-6 rounded-full border border-white/5 shadow-2xl items-center">
              <div className="flex flex-col items-center relative">
                <span className="text-white font-black text-[9px] bg-blue-500/80 px-2 rounded-full mb-1">
                  {adjustingItem.tolerance}
                </span>
                <div className="h-20 w-8 flex items-center justify-center">
                  <input
                    type="range"
                    min="15"
                    max="110"
                    value={adjustingItem.tolerance}
                    onChange={(e) =>
                      updateItem(adjustingItem.id, { tolerance: parseInt(e.target.value, 10) })
                    }
                    className="w-20 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-blue-400 origin-center -rotate-90"
                  />
                </div>
                <label className="text-[7px] font-black uppercase text-stone-300 mt-1">Sense</label>
              </div>
              <div className="w-6 h-px bg-white/10" />
              <div className="flex flex-col items-center relative">
                <span className="text-white font-black text-[9px] bg-rose-500/80 px-2 rounded-full mb-1">
                  {adjustingItem.erosion}px
                </span>
                <div className="h-20 w-8 flex items-center justify-center">
                  <input
                    type="range"
                    min="0"
                    max="4"
                    value={adjustingItem.erosion}
                    onChange={(e) => updateItem(adjustingItem.id, { erosion: parseInt(e.target.value, 10) })}
                    className="w-20 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-rose-400 origin-center -rotate-90"
                  />
                </div>
                <label className="text-[7px] font-black uppercase text-stone-300 mt-1">Edge</label>
              </div>
              <button
                onClick={() => setAdjustingItem(null)}
                className="w-10 h-10 rounded-full bg-white/90 text-stone-900 flex items-center justify-center shadow-xl hover:bg-green-500 hover:text-white transition-all active:scale-90"
              >
                <Check size={20} />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto pb-20">
        <header className="mb-6 flex flex-col items-center relative text-center">
          <div className="absolute right-0 top-0">
            <button
              onClick={() => setShowApiInput(!showApiInput)}
              className={`p-3 rounded-full transition-all bg-white shadow-sm border ${
                apiKey ? 'text-green-600' : 'text-rose-500 animate-pulse'
              }`}
            >
              <Key size={18} />
            </button>
          </div>
          <div className="bg-white p-4 rounded-full shadow-lg mb-2 border border-stone-200">
            <Scissors className="text-blue-600 w-6 h-6" />
          </div>
          <h1 className="text-xl font-black uppercase italic tracking-tighter">
            Gear Clipper <span className="text-blue-600">v50</span>
          </h1>
          <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mt-1 italic">
            Robust Legacy API &amp; Smart Naming
          </p>
        </header>

        {showApiInput && (
          <div className="mb-8 bg-white p-6 rounded-3xl border-2 border-blue-500 shadow-xl animate-in fade-in zoom-in duration-300">
            <h3 className="font-black text-xs uppercase tracking-widest mb-4 flex items-center gap-2 text-blue-600 italic underline decoration-blue-600/30">
              Gemini API Key Setting
            </h3>
            <div className="flex gap-2">
              <input
                type="password"
                placeholder="AIzaSy..."
                className="flex-1 bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-blue-500 font-mono"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button
                onClick={() => saveApiKey(apiKey)}
                className="bg-blue-600 text-white px-8 py-2 rounded-2xl font-black text-sm hover:bg-black transition-all shadow-lg active:scale-95 flex items-center gap-2"
              >
                <Save size={18} /> 保存
              </button>
            </div>
          </div>
        )}

        <div
          onClick={() => !processing && fileInputRef.current?.click()}
          className={`bg-white p-4 rounded-[2rem] border-4 border-dashed mb-10 flex flex-col justify-center items-center cursor-pointer transition-all hover:border-blue-500 min-h-[100px] group ${
            processing ? 'opacity-50 pointer-events-none' : 'border-stone-200'
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            multiple
            accept="image/*"
            className="hidden"
          />
          <div className="flex flex-col items-center gap-1">
            {processing ? (
              <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
            ) : (
              <Upload className="text-blue-400 group-hover:scale-110 transition-transform" size={24} />
            )}
            <h3 className="text-sm font-black text-stone-800 uppercase italic">Import Gear Assets</h3>
          </div>
        </div>

        {images.length > 0 && (
          <div className="space-y-3">
            <div className="flex justify-between items-center bg-stone-900 text-white p-3 px-6 rounded-full shadow-xl mb-4">
              <div className="flex items-center gap-4">
                <span className="bg-blue-600 px-3 py-0.5 rounded-full text-[9px] font-black uppercase">
                  {images.length} Assets
                </span>
                <h2 className="font-black text-xs uppercase tracking-widest italic">Inventory</h2>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={downloadAll}
                  className="bg-white text-stone-900 px-4 py-1.5 rounded-full text-[10px] font-black hover:bg-blue-500 hover:text-white transition-all"
                >
                  一括保存
                </button>
                <button
                  onClick={() =>
                    isDeletingAll ? (setImages([]), setIsDeletingAll(false)) : setIsDeletingAll(true)
                  }
                  className={`px-4 py-1.5 rounded-full text-[10px] font-black transition-all ${
                    isDeletingAll ? 'bg-rose-500' : 'bg-stone-700 text-stone-400'
                  }`}
                >
                  {isDeletingAll ? '本当に消す？' : '全削除'}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              {images.map((img) => (
                <div
                  key={img.id}
                  className="bg-white rounded-xl p-2 px-4 shadow-sm border border-stone-200 flex items-center gap-4 hover:shadow-md transition-all group relative overflow-hidden"
                >
                  <div className="absolute left-0 top-0 h-full w-1 bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />

                  <div className="flex-shrink-0">
                    <div
                      className="w-14 h-14 bg-stone-50 rounded-lg overflow-hidden border border-stone-100 flex items-center justify-center"
                      style={{ backgroundImage: `url('${CHECKERBOARD_URL}')` }}
                    >
                      <img src={img.thumbUrl} className="max-w-full max-h-full object-contain" alt="Thumb" />
                    </div>
                  </div>

                  <div className="flex-1 min-w-0 grid grid-cols-12 gap-3 items-center text-[10px]">
                    <div className="col-span-3">
                      <select
                        value={img.categoryId}
                        onChange={(e) => updateItem(img.id, { categoryId: e.target.value })}
                        className="w-full bg-stone-50 border border-stone-100 rounded-lg px-2 py-1.5 font-bold outline-none cursor-pointer"
                      >
                        {CATEGORIES.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-4 relative">
                      <input
                        type="text"
                        value={img.itemName}
                        onChange={(e) => updateItem(img.id, { itemName: e.target.value })}
                        className="w-full bg-stone-50 border border-stone-100 rounded-lg px-2 py-1.5 font-bold outline-none"
                        placeholder="名称..."
                      />
                      {img.isNaming && (
                        <Loader2
                          size={10}
                          className="absolute right-2 top-2 text-blue-500 animate-spin"
                        />
                      )}
                    </div>
                    <div className="col-span-3">
                      <div className="bg-stone-50 px-2 py-1.5 rounded border border-stone-100 truncate">
                        <p className="font-mono text-stone-400 truncate uppercase tracking-tighter italic">
                          {img.name}.png
                        </p>
                      </div>
                    </div>
                    <div className="col-span-2 flex justify-end gap-1.5">
                      <button
                        onClick={() => setAdjustingItem(img)}
                        className="p-2 rounded-lg bg-stone-100 text-stone-500 hover:bg-stone-800 hover:text-white transition-all shadow-sm active:scale-90"
                        title="精密調整"
                      >
                        <Sliders size={14} />
                      </button>
                      <button
                        onClick={() => {
                          downloadFile(img.originalUrl, `${img.name}.png`);
                          setTimeout(() => downloadFile(img.thumbUrl, `${img.name}_サムネ.png`), 400);
                        }}
                        className="p-2 rounded-lg bg-blue-600 text-white hover:bg-stone-900 transition-all shadow-sm active:scale-90"
                        title="保存"
                      >
                        <Download size={14} />
                      </button>
                      <button
                        onClick={() => setImages(images.filter((i) => i.id !== img.id))}
                        className="p-2 rounded-lg bg-stone-50 text-stone-300 hover:text-rose-500 transition-all border border-stone-200 active:scale-90"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {images.length === 0 && !processing && (
          <div className="flex flex-col items-center justify-center py-20 text-stone-300 border-2 border-dashed border-stone-200 rounded-[3rem]">
            <ImageIcon size={32} className="mb-2 opacity-20" />
            <p className="font-black uppercase tracking-[0.3em] text-[9px] italic">Ready to Import</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
