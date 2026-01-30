import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, Trash2, Loader2, Key, Save, Scissors, Image as ImageIcon, Trash } from 'lucide-react';

const CATEGORIES = [
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

interface ProcessedImage {
  id: string;
  originalUrl: string;
  thumbUrl: string;
  categoryId: string;
  itemName: string;
  name: string;
  isNaming: boolean;
}

const App: React.FC = () => {
  const [apiKey, setApiKey] = useState("");
  const [showApiInput, setShowApiInput] = useState(false);
  const [images, setImages] = useState<ProcessedImage[]>([]); 
  const [processing, setProcessing] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedKey = localStorage.getItem('user_gemini_api_key');
    if (savedKey) setApiKey(savedKey);
  }, []);

  const saveApiKey = (key: string) => {
    const trimmedKey = String(key).trim();
    setApiKey(trimmedKey);
    localStorage.setItem('user_gemini_api_key', trimmedKey);
    setShowApiInput(false);
  };

  const generateFullFilename = (catId: string, itemName: string) => {
    const isAcc = String(catId).includes("アクセサリー");
    const safeItemName = String(itemName || "装備").replace(/[\\/:*?"<>|]/g, "").trim();
    return `${String(catId)}${isAcc ? "_overlap" : ""}_${safeItemName}`;
  };

  const cleanupIslands = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const size = width * height;
    const visited = new Uint8Array(size);
    const mask = new Uint8Array(size);
    const stack = new Uint32Array(size);
    let foundAny = false;

    for (let i = 0; i < size; i++) {
      if (!visited[i] && data[i * 4 + 3] > 20) {
        let stackPtr = 0;
        const islandPixels: number[] = [];
        stack[stackPtr++] = i;
        visited[i] = 1;
        
        while (stackPtr > 0) {
          const idx = stack[--stackPtr];
          islandPixels.push(idx);
          const x = idx % width;
          const y = (idx / width) | 0;

          if (y > 0) { const ni = idx - width; if (!visited[ni] && data[ni * 4 + 3] > 20) { visited[ni] = 1; stack[stackPtr++] = ni; } }
          if (y < height - 1) { const ni = idx + width; if (!visited[ni] && data[ni * 4 + 3] > 20) { visited[ni] = 1; stack[stackPtr++] = ni; } }
          if (x > 0) { const ni = idx - 1; if (!visited[ni] && data[ni * 4 + 3] > 20) { visited[ni] = 1; stack[stackPtr++] = ni; } }
          if (x < width - 1) { const ni = idx + 1; if (!visited[ni] && data[ni * 4 + 3] > 20) { visited[ni] = 1; stack[stackPtr++] = ni; } }
        }
        if (islandPixels.length > 40) {
          for (const p of islandPixels) mask[p] = 1;
          foundAny = true;
        }
      }
    }

    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (let i = 0; i < size; i++) {
      if (mask[i] === 0) {
        data[i * 4 + 3] = 0;
      } else {
        const px = i % width; const py = (i / width) | 0;
        if(px < minX) minX = px; if(px > maxX) maxX = px;
        if(py < minY) minY = py; if(py > maxY) maxY = py;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return foundAny ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null;
  };

  const processImage = async (file: File): Promise<{ originalUrl: string; thumbUrl: string }> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
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

          const tolerance = 50;

          for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i+1], b = data[i+2];
            const px = (i / 4) % width;
            const py = (i / 4 / width) | 0;

            if (px > width * 0.90 && py > height * 0.90) {
              data[i + 3] = 0; continue;
            }

            const dist = Math.sqrt(Math.pow(r - avgBG.r, 2) + Math.pow(g - avgBG.g, 2) + Math.pow(b - avgBG.b, 2));
            if (dist < tolerance) {
              data[i + 3] = 0;
            } else if (dist < tolerance * 1.4) {
              data[i + 3] = Math.max(0, (dist - tolerance) * (255 / (tolerance * 0.4)));
            }
          }

          workCtx.putImageData(imageData, 0, 0);
          const tightBox = cleanupIslands(workCtx, width, height);

          const generateOutput = (targetSize: number, isTight: boolean) => {
            const finalCanvas = document.createElement('canvas');
            finalCanvas.width = targetSize; finalCanvas.height = targetSize;
            const fCtx = finalCanvas.getContext('2d')!;
            fCtx.imageSmoothingQuality = 'high';
            if (!tightBox) return finalCanvas.toDataURL('image/png');

            const scale = isTight ? Math.min(targetSize / tightBox.w, targetSize / tightBox.h) : Math.min((targetSize * 0.96) / width, (targetSize * 0.96) / height);
            const dw = (isTight ? tightBox.w : width) * scale, dh = (isTight ? tightBox.h : height) * scale;
            const dx = (targetSize - dw) / 2, dy = (targetSize - dh) / 2;
            const sx = isTight ? tightBox.x : 0, sy = isTight ? tightBox.y : 0, sw = isTight ? tightBox.w : width, sh = isTight ? tightBox.h : height;

            const thickness = Math.max(1, Math.round(targetSize / 600));
            fCtx.globalCompositeOperation = 'source-over';
            for(let ox = -thickness; ox <= thickness; ox += thickness) {
              for(let oy = -thickness; oy <= thickness; oy += thickness) {
                if (ox === 0 && oy === 0) continue;
                fCtx.drawImage(workCanvas, sx, sy, sw, sh, dx + ox, dy + oy, dw, dh);
              }
            }
            fCtx.globalCompositeOperation = 'source-in'; fCtx.fillStyle = 'black';
            fCtx.fillRect(0, 0, targetSize, targetSize); fCtx.globalCompositeOperation = 'source-over';
            
            fCtx.drawImage(workCanvas, sx, sy, sw, sh, dx, dy, dw, dh);
            return finalCanvas.toDataURL('image/png');
          };
          resolve({ originalUrl: generateOutput(2048, false), thumbUrl: generateOutput(1024, true) });
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const suggestFilename = async (base64: string, imgId: string) => {
    if (!apiKey) return;
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          contents: [{ parts: [{ text: `衣服の画像分析。カテゴリ：[${CATEGORIES.map(c => c.label).join(", ")}]から1つ選び、具体的でユニークな日本語名を提案。JSON: {"category": "...", "name": "..."}` }, { inlineData: { mimeType: "image/png", data: base64.split(',')[1] } }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      const result = await response.json();
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return;
      const parsed = JSON.parse(text);
      const foundCategory = CATEGORIES.find(c => c.label === parsed.category) || { id: "4_2_ドレス", label: "ドレス" };
      const itemName = String(parsed.name || "新装備").substring(0, 25);
      
      setImages(prev => prev.map(img => {
        if (img.id === imgId) {
          return { 
            ...img, 
            categoryId: foundCategory.id, 
            itemName: itemName, 
            name: generateFullFilename(foundCategory.id, itemName),
            isNaming: false 
          };
        }
        return img;
      }));
    } catch (e) { 
      console.error(e);
      setImages(prev => prev.map(img => img.id === imgId ? { ...img, isNaming: false, itemName: "解析失敗" } : img));
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setProcessing(true);
    const newItems: ProcessedImage[] = [];
    for (const file of files) {
      const { originalUrl, thumbUrl } = await processImage(file);
      const id = crypto.randomUUID();
      const defaultCat = "4_2_ドレス";
      const defaultItem = "装備アイテム";
      const initialItem: ProcessedImage = { 
        id, originalUrl, thumbUrl, 
        categoryId: defaultCat, 
        itemName: defaultItem, 
        name: generateFullFilename(defaultCat, defaultItem),
        isNaming: !!apiKey
      };
      newItems.push(initialItem);
    }
    setImages(prev => [...newItems, ...prev]);
    
    newItems.forEach(item => {
      if (apiKey) suggestFilename(item.originalUrl, item.id);
    });

    setProcessing(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const updateItemProperty = (id: string, property: keyof ProcessedImage, value: string) => {
    setImages(prev => prev.map(img => {
      if (img.id === id) {
        const updated = { ...img, [property]: value };
        updated.name = generateFullFilename(updated.categoryId, updated.itemName);
        return updated;
      }
      return img;
    }));
  };

  const downloadFile = (url: string, filename: string) => {
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

  const downloadAll = () => {
    images.forEach((img, i) => {
      const delay = i * 800; 
      setTimeout(() => {
        downloadFile(img.originalUrl, `${img.name}.png`);
        downloadFile(img.thumbUrl, `${img.name}_サムネ.png`);
      }, delay);
    });
  };

  const confirmClearAll = () => {
    if (isDeletingAll) {
      setImages([]);
      setIsDeletingAll(false);
    } else {
      setIsDeletingAll(true);
      setTimeout(() => setIsDeletingAll(false), 3000);
    }
  };

  return (
    <div className="min-h-screen bg-stone-100 p-4 md:p-8 font-sans text-stone-900">
      <div className="max-w-6xl mx-auto pb-20">
        <header className="mb-6 flex flex-col items-center relative text-center">
          <div className="absolute right-0 top-0">
            <button onClick={() => setShowApiInput(!showApiInput)} className={`p-3 rounded-full transition-all ${apiKey ? 'text-green-600 bg-white shadow-sm border border-green-50' : 'text-rose-500 bg-rose-50 border border-rose-100 animate-pulse'}`}><Key size={20} /></button>
          </div>
          <div className="bg-white p-4 rounded-full shadow-lg mb-2 border border-stone-200"><Scissors className={`text-blue-600 w-7 h-7 ${processing ? 'animate-bounce' : ''}`} /></div>
          <h1 className="text-2xl font-black tracking-tighter text-stone-900 uppercase italic">Gear Clipper <span className="text-blue-600">v32.1</span></h1>
        </header>

        {showApiInput && (
          <div className="mb-8 bg-white p-6 rounded-[2rem] border-2 border-blue-500 shadow-xl animate-in fade-in zoom-in duration-300">
            <h3 className="font-black text-xs uppercase tracking-widest mb-4 flex items-center gap-2 text-blue-600 italic underline decoration-blue-600/30">Gemini API Key Setting</h3>
            <div className="flex gap-2">
              <input type="password" placeholder="AIzaSy..." className="flex-1 bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-blue-500 font-mono" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              <button onClick={() => saveApiKey(apiKey)} className="bg-blue-600 text-white px-8 py-2 rounded-2xl font-black text-sm hover:bg-black transition-all shadow-lg active:scale-95 flex items-center gap-2"><Save size={18} /> 保存</button>
            </div>
          </div>
        )}

        <div onClick={() => !processing && fileInputRef.current?.click()} className={`bg-white p-4 rounded-[2rem] shadow-sm border-4 border-dashed mb-10 flex flex-col justify-center items-center cursor-pointer transition-all hover:border-blue-500 hover:bg-blue-50/10 min-h-[100px] relative overflow-hidden group ${processing ? 'opacity-50 pointer-events-none' : 'border-stone-200'}`}>
            <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple accept="image/*" className="hidden" />
            <div className="flex flex-col items-center gap-1">
              {processing ? <Loader2 className="w-8 h-8 text-blue-500 animate-spin" /> : <Upload className="text-blue-400 group-hover:scale-110 transition-transform" size={24} />}
              <h3 className="text-md font-black text-stone-800 uppercase italic tracking-tighter">Import Gear Images</h3>
            </div>
        </div>

        {images.length > 0 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-center bg-stone-900 text-white p-4 px-6 rounded-[2rem] shadow-xl">
              <div className="flex items-center gap-3">
                <div className="bg-blue-600 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">{images.length} Items</div>
                <h2 className="font-black text-lg uppercase tracking-tighter italic">Inventory List</h2>
              </div>
              <div className="flex gap-2">
                <button onClick={downloadAll} className="flex items-center gap-2 bg-white text-stone-900 px-5 py-2 rounded-full text-[11px] font-black hover:bg-blue-500 hover:text-white transition-all active:scale-95">
                  <Download size={14} /> 一括保存
                </button>
                <button 
                  onClick={confirmClearAll} 
                  className={`flex items-center gap-2 px-5 py-2 rounded-full text-[11px] font-black transition-all active:scale-95 ${isDeletingAll ? 'bg-rose-500 text-white animate-pulse' : 'bg-rose-800/30 text-rose-300 hover:bg-rose-600 hover:text-white'}`}
                >
                  <Trash size={14} /> {isDeletingAll ? '本当に削除？' : '全削除'}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {images.map((img) => (
                <div key={img.id} className="bg-white rounded-2xl p-3 shadow-sm border border-stone-200 flex items-center gap-4 hover:shadow-md transition-all group overflow-hidden relative">
                  <div className="absolute left-0 top-0 h-full w-1 bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />

                  <div className="flex-shrink-0 flex gap-2">
                    <div className="w-14 h-14 bg-[url('https://www.transparenttextures.com/patterns/checkerboard.png')] bg-stone-50 rounded-lg overflow-hidden border border-stone-200 flex items-center justify-center relative">
                      <img src={img.originalUrl} className="max-w-full max-h-full object-contain" alt="Gear" />
                    </div>
                    <div className="w-14 h-14 bg-[url('https://www.transparenttextures.com/patterns/checkerboard.png')] bg-blue-50/20 rounded-lg overflow-hidden border border-blue-100/50 flex items-center justify-center relative">
                      <img src={img.thumbUrl} className="max-w-full max-h-full object-contain" alt="Thumb" />
                    </div>
                  </div>

                  <div className="flex-1 min-w-0 grid grid-cols-12 gap-3 items-center">
                    <div className="col-span-3">
                      <select 
                        value={String(img.categoryId)} 
                        onChange={(e) => updateItemProperty(img.id, 'categoryId', e.target.value)} 
                        className="w-full bg-stone-50 border border-stone-100 rounded-lg px-2 py-1.5 text-xs font-bold outline-none focus:border-blue-400 cursor-pointer"
                      >
                        {CATEGORIES.map(cat => (<option key={cat.id} value={cat.id}>{cat.label}</option>))}
                      </select>
                    </div>
                    <div className="col-span-5 relative">
                      <input 
                        type="text" 
                        value={String(img.itemName || "")} 
                        onChange={(e) => updateItemProperty(img.id, 'itemName', e.target.value)} 
                        className="w-full bg-stone-50 border border-stone-100 rounded-lg px-3 py-1.5 text-xs font-bold outline-none focus:border-blue-400"
                        placeholder="名称入力..."
                      />
                      {img.isNaming && <Loader2 size={12} className="absolute right-2 top-2.5 text-blue-500 animate-spin" />}
                    </div>
                    <div className="col-span-3">
                      <div className="bg-stone-100 px-3 py-1.5 rounded-lg border border-stone-200">
                        <p className="text-[10px] font-mono text-stone-500 truncate font-bold uppercase">{String(img.name || '---')}.png</p>
                      </div>
                    </div>
                    <div className="col-span-1 flex justify-end gap-1.5">
                      <button 
                        onClick={() => { downloadFile(img.originalUrl, `${img.name}.png`); setTimeout(() => downloadFile(img.thumbUrl, `${img.name}_サムネ.png`), 400); }} 
                        className="p-2 rounded-lg bg-blue-600 text-white hover:bg-stone-900 transition-all shadow-sm active:scale-90"
                        title="保存"
                      >
                        <Download size={14} />
                      </button>
                      <button 
                        onClick={() => setImages(images.filter(i => i.id !== img.id))} 
                        className="p-2 rounded-lg bg-white border border-stone-200 text-stone-300 hover:text-rose-500 hover:border-rose-200 transition-all shadow-sm active:scale-90"
                        title="削除"
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
          <div className="flex flex-col items-center justify-center py-16 text-stone-300 border-2 border-dashed border-stone-200 rounded-[3rem]">
             <ImageIcon size={32} className="mb-2 opacity-20" />
             <p className="font-black uppercase tracking-[0.3em] text-[9px] italic">Inventory is Empty</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
