import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, Trash2, Loader2, Key, Scissors, Image as ImageIcon, X, Sliders, Check } from 'lucide-react';

interface Category {
  id: string;
  label: string;
}

interface ImageItem {
  id: string;
  sourceUrl: string;
  tolerance: number;
  erosion: number;
  categoryId: string;
  itemName: string;
  originalUrl: string;
  thumbUrl: string;
  name: string;
}

interface ProcessResult {
  originalUrl: string;
  thumbUrl: string;
}

interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CATEGORIES: Category[] = [
  { id: "1_4_インナー", label: "インナー" },
  { id: "2_7_くつ", label: "くつ" },
  { id: "3_6_ボトムス", label: "ボトムス" },
  { id: "4_2_ドレス", label: "ドレス" },
  { id: "5_5_トップス", label: "トップス" },
  { id: "10_1_かお", label: "かお" },
  { id: "11_9_ぼうし", label: "ぼうし" },
  { id: "12_10_アクセサリー", label: "アクセサリー" },
  { id: "13_11_エフェクト", label: "エフェクト" }
];

const App: React.FC = () => {
  const [apiKey, setApiKey] = useState<string>("");
  const [showApiInput, setShowApiInput] = useState<boolean>(false);
  const [images, setImages] = useState<ImageItem[]>([]); 
  const [processing, setProcessing] = useState<boolean>(false);
  const [isDeletingAll, setIsDeletingAll] = useState<boolean>(false); 
  const [adjustingItem, setAdjustingItem] = useState<ImageItem | null>(null); 
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    const isAcc = String(catId).includes("アクセサリー");
    const safeItemName = String(itemName || "装備").replace(/[\\/:*?"<>|]/g, "").trim();
    return `${String(catId)}${isAcc ? "_overlap" : ""}_${safeItemName}`;
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
            if (currentMask[idx - 1] === 0 || currentMask[idx + 1] === 0 ||
                currentMask[idx - width] === 0 || currentMask[idx + width] === 0) {
              nextMask[idx] = 0;
            }
          }
        }
      }
      currentMask = nextMask;
    }
    return currentMask;
  };

  const processImage = async (imgDataObj: { sourceUrl: string; tolerance?: number; erosion?: number }): Promise<ProcessResult> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const workCanvas = document.createElement('canvas');
        workCanvas.width = img.width; workCanvas.height = img.height;
        const workCtx = workCanvas.getContext('2d')!;
        workCtx.drawImage(img, 0, 0);
        const imageData = workCtx.getImageData(0, 0, img.width, img.height);
        const data = imageData.data;
        const width = img.width, height = img.height;

        const cornerIdx = [0, (width - 1) * 4, (height - 1) * width * 4, (width * height - 1) * 4];
        const samples = cornerIdx.map(idx => ({ r: data[idx], g: data[idx+1], b: data[idx+2] }));
        const avgBG = {
          r: Math.round(samples.reduce((a, b) => a + b.r, 0) / 4),
          g: Math.round(samples.reduce((a, b) => a + b.g, 0) / 4),
          b: Math.round(samples.reduce((a, b) => a + b.b, 0) / 4)
        };

        const tol = imgDataObj.tolerance || 70;
        const erosionSize = imgDataObj.erosion || 1;
        const mask = new Uint8Array(width * height);

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i+1], b = data[i+2];
          const px = (i / 4) % width, py = (i / 4 / width) | 0;
          if (px > width * 0.92 && py > height * 0.92) continue;
          const dist = Math.sqrt(Math.pow(r - avgBG.r, 2) + Math.pow(g - avgBG.g, 2) + Math.pow(b - avgBG.b, 2));
          const isSaturatedGreen = g > r * 1.35 && g > b * 1.35 && g > 70;
          const isSaturatedMagenta = r > g * 1.35 && b > g * 1.35 && r > 70;
          if (dist > tol && !isSaturatedGreen && !isSaturatedMagenta) mask[i / 4] = 1;
        }

        const erodedMask = applyErosion(mask, width, height, erosionSize);

        for (let i = 0; i < data.length; i += 4) {
          if (erodedMask[i / 4] === 0) {
            data[i + 3] = 0;
          } else {
            const r = data[i], g = data[i+1], b = data[i+2];
            const dist = Math.sqrt(Math.pow(r - avgBG.r, 2) + Math.pow(g - avgBG.g, 2) + Math.pow(b - avgBG.b, 2));
            if (dist < tol * 1.4) data[i + 3] = Math.max(0, (dist - tol) * (255 / (tol * 0.4)));
          }
        }
        workCtx.putImageData(imageData, 0, 0);

        const visited = new Uint8Array(width * height);
        const finalMask = new Uint8Array(width * height);
        const stack = new Uint32Array(width * height);
        let foundAny = false;
        let minX = width, minY = height, maxX = 0, maxY = 0;

        for (let i = 0; i < width * height; i++) {
          if (!visited[i] && data[i * 4 + 3] > 20) {
            let ptr = 0;
            stack[ptr++] = i; visited[i] = 1;
            const island: number[] = [];
            while (ptr > 0) {
              const idx = stack[--ptr]; island.push(idx);
              const x = idx % width;
              [idx-width, idx+width, idx-1, idx+1].forEach(ni => {
                if (ni >= 0 && ni < width * height && !visited[ni] && data[ni * 4 + 3] > 20) {
                  const nx = ni % width; if (Math.abs(nx - x) <= 1) { visited[ni] = 1; stack[ptr++] = ni; }
                }
              });
            }
            if (island.length > 50) {
              island.forEach(p => {
                finalMask[p] = 1;
                const px = p % width, py = (p / width) | 0;
                if(px < minX) minX = px; if(px > maxX) maxX = px;
                if(py < minY) minY = py; if(py > maxY) maxY = py;
              });
              foundAny = true;
            }
          }
        }
        for(let i=0; i<width*height; i++) if(finalMask[i] === 0) data[i*4+3] = 0;
        workCtx.putImageData(imageData, 0, 0);

        const tightBox: BoundingBox | null = foundAny ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null;

        const generateOutput = (targetSize: number, isTight: boolean): string => {
          const finalCanvas = document.createElement('canvas');
          finalCanvas.width = targetSize; finalCanvas.height = targetSize;
          const fCtx = finalCanvas.getContext('2d')!;
          fCtx.imageSmoothingQuality = 'high';
          if (!tightBox) return finalCanvas.toDataURL('image/png');
          const scale = isTight ? Math.min(targetSize / tightBox.w, targetSize / tightBox.h) : Math.min((targetSize * 0.96) / width, (targetSize * 0.96) / height);
          const dw = (isTight ? tightBox.w : width) * scale, dh = (isTight ? tightBox.h : height) * scale;
          const dx = (targetSize - dw) / 2, dy = (targetSize - dh) / 2;
          const sx = isTight ? tightBox.x : 0, sy = isTight ? tightBox.y : 0, sw = isTight ? tightBox.w : width, sh = isTight ? tightBox.h : height;
          fCtx.drawImage(workCanvas, sx, sy, sw, sh, dx, dy, dw, dh);
          return finalCanvas.toDataURL('image/png');
        };
        resolve({ originalUrl: generateOutput(2048, false), thumbUrl: generateOutput(1024, true) });
      };
      img.src = imgDataObj.sourceUrl;
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setProcessing(true);
    for (const file of files) {
      const sourceUrl = URL.createObjectURL(file);
      const initialObj = { 
        id: crypto.randomUUID(), sourceUrl, tolerance: 70, erosion: 1, 
        categoryId: "4_2_ドレス", itemName: "装備アイテム" 
      };
      const result = await processImage(initialObj);
      setImages(prev => [{ ...initialObj, ...result, name: generateFullFilename(initialObj.categoryId, initialObj.itemName) }, ...prev]);
    }
    setProcessing(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const updateItem = async (id: string, patch: Partial<ImageItem>): Promise<void> => {
    const target = images.find(i => i.id === id);
    if (!target) return;
    const nextItem = { ...target, ...patch };
    const result = await processImage(nextItem);
    const updatedItem = { ...nextItem, ...result, name: generateFullFilename(nextItem.categoryId, nextItem.itemName) };
    
    setImages(prev => prev.map(img => img.id === id ? updatedItem : img));
    if (adjustingItem?.id === id) setAdjustingItem(updatedItem);
  };

  const downloadFile = (url: string, filename: string): void => {
    fetch(url)
      .then(res => res.blob())
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(blobUrl);
      });
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
      
      {/* --- 調整モーダル (Adjustment Modal) --- */}
      {adjustingItem && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-stone-900/90 backdrop-blur-xl animate-in fade-in duration-200"
          onClick={() => setAdjustingItem(null)}
        >
          <div 
            className="bg-white w-full max-w-2xl rounded-[3rem] shadow-2xl overflow-hidden border border-white/20"
            onClick={(e) => e.stopPropagation()}
          >
            {/* モーダルヘッダー */}
            <div className="flex justify-between items-center px-8 py-6 border-b border-stone-100">
              <div className="flex items-center gap-3">
                <div className="bg-blue-600 p-2 rounded-xl text-white shadow-lg shadow-blue-200">
                  <Sliders size={20} />
                </div>
                <h3 className="font-black uppercase italic tracking-tighter text-lg">Fine Tuning Asset</h3>
              </div>
              <button 
                onClick={() => setAdjustingItem(null)} 
                className="p-2 bg-stone-50 rounded-full hover:bg-rose-500 hover:text-white transition-all shadow-sm active:scale-90"
              >
                <X size={20} />
              </button>
            </div>

            {/* モーダルコンテンツ */}
            <div className="p-8">
              <div className="w-full aspect-square bg-[url('https://www.transparenttextures.com/patterns/checkerboard.png')] bg-stone-50 rounded-[2.5rem] overflow-hidden flex items-center justify-center border-4 border-stone-100 shadow-inner mb-8">
                <img src={adjustingItem.originalUrl} className="max-w-full max-h-full object-contain" alt="Tuning Preview" />
              </div>

              {/* スライダーエリア */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 px-4">
                <div className="space-y-3">
                  <div className="flex justify-between items-end">
                    <label className="text-[10px] font-black uppercase text-stone-400 tracking-widest">Sensitivity (感度)</label>
                    <span className="bg-blue-50 text-blue-600 px-3 py-0.5 rounded-full text-xs font-black">{adjustingItem.tolerance}</span>
                  </div>
                  <input 
                    type="range" min="30" max="150" 
                    value={adjustingItem.tolerance} 
                    onChange={(e) => updateItem(adjustingItem.id, { tolerance: parseInt(e.target.value) })}
                    className="w-full h-2 bg-stone-100 rounded-lg appearance-none cursor-pointer accent-blue-600" 
                  />
                  <p className="text-[9px] text-stone-400 italic">背景の消え残りを調整します</p>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-end">
                    <label className="text-[10px] font-black uppercase text-stone-400 tracking-widest">Edge Erosion (縁削り)</label>
                    <span className="bg-rose-50 text-rose-600 px-3 py-0.5 rounded-full text-xs font-black">{adjustingItem.erosion}px</span>
                  </div>
                  <input 
                    type="range" min="0" max="4" 
                    value={adjustingItem.erosion} 
                    onChange={(e) => updateItem(adjustingItem.id, { erosion: parseInt(e.target.value) })}
                    className="w-full h-2 bg-stone-100 rounded-lg appearance-none cursor-pointer accent-rose-500" 
                  />
                  <p className="text-[9px] text-stone-400 italic">輪郭の汚れを物理的に削ります</p>
                </div>
              </div>
            </div>

            {/* モーダルフッター: 「完了」ボタン */}
            <div className="bg-stone-50 p-6 flex justify-center border-t border-stone-100">
              <button 
                onClick={() => setAdjustingItem(null)} 
                className="bg-blue-600 text-white px-12 py-3.5 rounded-2xl font-black uppercase tracking-[0.2em] shadow-xl shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-2"
              >
                <Check size={20} /> 調整完了 (Done)
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto pb-20">
        <header className="mb-6 flex flex-col items-center relative text-center">
          <div className="absolute right-0 top-0">
            <button onClick={() => setShowApiInput(!showApiInput)} className={`p-3 rounded-full transition-all bg-white shadow-sm border ${apiKey ? 'text-green-600' : 'text-rose-500 animate-pulse'}`}><Key size={18} /></button>
          </div>
          <div className="bg-white p-4 rounded-full shadow-lg mb-2 border border-stone-200"><Scissors className="text-blue-600 w-6 h-6" /></div>
          <h1 className="text-xl font-black uppercase italic tracking-tighter">Gear Clipper <span className="text-blue-600">v39</span></h1>
          <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mt-1 italic">Thumbnail List & Tuning Modal</p>
        </header>

        {showApiInput && (
          <div className="mb-8 bg-white p-6 rounded-3xl border-2 border-blue-500 shadow-xl animate-in fade-in zoom-in duration-300">
            <input type="password" placeholder="Gemini API Key..." className="w-full bg-stone-50 border rounded-xl px-4 py-3 text-sm outline-none mb-3" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            <button onClick={() => saveApiKey(apiKey)} className="w-full bg-blue-600 text-white py-2 rounded-xl font-bold">保存</button>
          </div>
        )}

        <div onClick={() => !processing && fileInputRef.current?.click()} className={`bg-white p-4 rounded-[2rem] border-4 border-dashed mb-10 flex flex-col justify-center items-center cursor-pointer transition-all hover:border-blue-500 min-h-[100px] group ${processing ? 'opacity-50 pointer-events-none' : 'border-stone-200'}`}>
            <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple accept="image/*" className="hidden" />
            <div className="flex flex-col items-center gap-1">
              {processing ? <Loader2 className="w-6 h-6 text-blue-500 animate-spin" /> : <Upload className="text-blue-400 group-hover:scale-110 transition-transform" size={24} />}
              <h3 className="text-sm font-black text-stone-800 uppercase italic">Add Gear Assets</h3>
            </div>
        </div>

        {images.length > 0 && (
          <div className="space-y-3">
            <div className="flex justify-between items-center bg-stone-900 text-white p-3 px-6 rounded-full shadow-xl mb-4">
              <div className="flex items-center gap-4">
                <span className="bg-blue-600 px-3 py-0.5 rounded-full text-[9px] font-black uppercase">{images.length} Assets</span>
                <h2 className="font-black text-xs uppercase tracking-widest italic">Inventory</h2>
              </div>
              <div className="flex gap-2">
                <button onClick={downloadAll} className="bg-white text-stone-900 px-4 py-1.5 rounded-full text-[10px] font-black hover:bg-blue-500 hover:text-white transition-all active:scale-95">
                  <Download size={12} /> 一括保存
                </button>
                <button onClick={() => isDeletingAll ? (setImages([]), setIsDeletingAll(false)) : setIsDeletingAll(true)} className={`px-4 py-1.5 rounded-full text-[10px] font-black transition-all active:scale-95 ${isDeletingAll ? 'bg-rose-500' : 'bg-stone-700 text-stone-400'}`}>
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
                    <div className="w-14 h-14 bg-[url('https://www.transparenttextures.com/patterns/checkerboard.png')] bg-stone-50 rounded-lg overflow-hidden border border-stone-100 flex items-center justify-center">
                      <img src={img.thumbUrl} className="max-w-full max-h-full object-contain" alt="Gear Thumb" />
                    </div>
                  </div>

                  <div className="flex-1 min-w-0 grid grid-cols-12 gap-3 items-center">
                    <div className="col-span-3">
                      <select 
                        value={img.categoryId} 
                        onChange={(e) => updateItem(img.id, { categoryId: e.target.value })} 
                        className="w-full bg-stone-50 border border-stone-100 rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none cursor-pointer"
                      >
                        {CATEGORIES.map(cat => (<option key={cat.id} value={cat.id}>{cat.label}</option>))}
                      </select>
                    </div>
                    <div className="col-span-4">
                      <input 
                        type="text" 
                        value={img.itemName} 
                        onChange={(e) => updateItem(img.id, { itemName: e.target.value })} 
                        className="w-full bg-stone-50 border border-stone-100 rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none" 
                        placeholder="名称入力..." 
                      />
                    </div>
                    
                    <div className="col-span-3">
                      <div className="bg-stone-50 px-2 py-1.5 rounded border border-stone-100 truncate flex items-center gap-1">
                        <p className="text-[9px] font-mono text-stone-400 truncate uppercase tracking-tighter">{img.name}.png</p>
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
                        onClick={() => { downloadFile(img.originalUrl, `${img.name}.png`); setTimeout(() => downloadFile(img.thumbUrl, `${img.name}_サムネ.png`), 400); }} 
                        className="p-2 rounded-lg bg-blue-600 text-white hover:bg-stone-900 transition-all shadow-sm active:scale-90"
                        title="保存"
                      >
                        <Download size={14} />
                      </button>
                      <button 
                        onClick={() => setImages(images.filter(i => i.id !== img.id))} 
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
             <p className="font-black uppercase tracking-[0.3em] text-[9px] italic">No Gear Assets</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
