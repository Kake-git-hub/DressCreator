import React, { useState, useRef } from 'react';
import { Upload, Download, Trash2, Loader2, Image as ImageIcon, Sparkles, RefreshCw, ChevronDown } from 'lucide-react';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";

// カテゴリー定義
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

interface BaseSilhouette {
  url: string;
  data: ImageData;
  width: number;
  height: number;
}

interface ProcessedImage {
  id: string;
  name: string;
  originalUrl: string;
  thumbUrl: string;
  categoryId: string;
  itemName: string;
  timestamp: string;
}

const App: React.FC = () => {
  const [baseSilhouette, setBaseSilhouette] = useState<BaseSilhouette | null>(null);
  const [images, setImages] = useState<ProcessedImage[]>([]);
  const [processing, setProcessing] = useState(false);
  const [useOutline, setUseOutline] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const baseInputRef = useRef<HTMLInputElement>(null);

  // ベースシルエットの読み込み
  const handleBaseUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        setBaseSilhouette({
          url: event.target?.result as string,
          data: ctx.getImageData(0, 0, img.width, img.height),
          width: img.width,
          height: img.height
        });
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // 連続性を解析して「最大ピクセル集合（衣装本体）」以外を消去する
  const filterLargestIsland = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const visited = new Uint8Array(width * height);
    const islands: { pixels: number[]; minX: number; minY: number; maxX: number; maxY: number }[] = [];

    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const idx = y * width + x;
        if (!visited[idx] && data[idx * 4 + 3] > 50) {
          const island = { pixels: [] as number[], minX: x, minY: y, maxX: x, maxY: y };
          const stack: [number, number][] = [[x, y]];
          visited[idx] = 1;

          while (stack.length > 0) {
            const [cx, cy] = stack.pop()!;
            island.pixels.push(cy * width + cx);
            if (cx < island.minX) island.minX = cx;
            if (cx > island.maxX) island.maxX = cx;
            if (cy < island.minY) island.minY = cy;
            if (cy > island.maxY) island.maxY = cy;

            [[0, 2], [0, -2], [2, 0], [-2, 0]].forEach(([dx, dy]) => {
              const nx = cx + dx, ny = cy + dy;
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const nIdx = ny * width + nx;
                if (!visited[nIdx] && data[nIdx * 4 + 3] > 50) {
                  visited[nIdx] = 1;
                  stack.push([nx, ny]);
                }
              }
            });
          }
          if (island.pixels.length > 10) islands.push(island);
        }
      }
    }

    if (islands.length === 0) return null;
    const largest = islands.sort((a, b) => b.pixels.length - a.pixels.length)[0];

    for (let i = 0; i < data.length; i += 4) {
      const x = (i / 4) % width;
      const y = Math.floor((i / 4) / width);
      if (x < largest.minX - 4 || x > largest.maxX + 4 || y < largest.minY - 4 || y > largest.maxY + 4) {
        data[i + 3] = 0;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return { x: largest.minX, y: largest.minY, w: largest.maxX - largest.minX + 1, h: largest.maxY - largest.minY + 1 };
  };

  const processImage = (file: File): Promise<{ originalUrl: string; thumbUrl: string }> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const workCanvas = document.createElement('canvas');
          const workCtx = workCanvas.getContext('2d')!;
          workCanvas.width = img.width;
          workCanvas.height = img.height;
          workCtx.drawImage(img, 0, 0);

          const imageData = workCtx.getImageData(0, 0, img.width, img.height);
          const data = imageData.data;
          const refData = baseSilhouette ? baseSilhouette.data.data : null;

          for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i+1], b = data[i+2];
            let shouldTransparent = false;
            if (refData) {
              const rr = refData[i], rg = refData[i+1], rb = refData[i+2];
              const diff = Math.sqrt(Math.pow(r - rr, 2) + Math.pow(g - rg, 2) + Math.pow(b - rb, 2));
              if (diff < 68) shouldTransparent = true;
            }
            const isGreen = g > r * 1.05 && g > b * 1.05 && g > 60;
            const isWhite = r > 242 && g > 242 && b > 242;
            if (shouldTransparent || isGreen || isWhite) {
              data[i + 3] = 0;
            } else {
              const avg = (r + b) / 2;
              if (g > avg) data[i+1] = avg;
            }
          }
          workCtx.putImageData(imageData, 0, 0);

          const tightBox = filterLargestIsland(workCtx, img.width, img.height);

          const generateOutput = (targetSize: number, isTightThumbnail: boolean) => {
            const finalCanvas = document.createElement('canvas');
            finalCanvas.width = targetSize;
            finalCanvas.height = targetSize;
            const fCtx = finalCanvas.getContext('2d')!;
            fCtx.imageSmoothingEnabled = true;
            fCtx.imageSmoothingQuality = 'high';

            if (!tightBox) return finalCanvas.toDataURL('image/png');

            let dw: number, dh: number, dx: number, dy: number, sx: number, sy: number, sw: number, sh: number;
            if (isTightThumbnail) {
              const scale = Math.min(targetSize / tightBox.w, targetSize / tightBox.h);
              dw = tightBox.w * scale; dh = tightBox.h * scale;
              dx = (targetSize - dw) / 2; dy = (targetSize - dh) / 2;
              sx = tightBox.x; sy = tightBox.y; sw = tightBox.w; sh = tightBox.h;
            } else {
              const scale = Math.min((targetSize * 0.96) / img.width, (targetSize * 0.96) / img.height);
              dw = img.width * scale; dh = img.height * scale;
              dx = (targetSize - dw) / 2; dy = (targetSize - dh) / 2;
              sx = 0; sy = 0; sw = img.width; sh = img.height;
            }

            if (useOutline) {
              const thickness = Math.max(1, Math.round(targetSize / 400));
              fCtx.globalCompositeOperation = 'source-over';
              for(let x = -thickness; x <= thickness; x += thickness) {
                for(let y = -thickness; y <= thickness; y += thickness) {
                  if (x === 0 && y === 0) continue;
                  fCtx.drawImage(workCanvas, sx, sy, sw, sh, dx + x, dy + y, dw, dh);
                }
              }
              fCtx.globalCompositeOperation = 'source-in';
              fCtx.fillStyle = 'black';
              fCtx.fillRect(0, 0, targetSize, targetSize);
              fCtx.globalCompositeOperation = 'source-over';
            }

            fCtx.drawImage(workCanvas, sx, sy, sw, sh, dx, dy, dw, dh);
            return finalCanvas.toDataURL('image/png');
          };

          const originalUrl = generateOutput(2048, false);
          const thumbUrl = generateOutput(1024, true);

          resolve({ originalUrl, thumbUrl });
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const suggestFilenameInfo = async (base64: string) => {
    const categoryLabels = CATEGORIES.map(c => c.label).join(", ");
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          contents: [{ 
            parts: [{ 
              text: `画像に写っている衣服パーツを分析し、以下のいずれかのカテゴリに分類してください。また、アイテムの具体的でユニークな名称（色や特徴を含む）を日本語で1つ提案してください。
              カテゴリ：[${categoryLabels}]` 
            }, { 
              inlineData: { mimeType: "image/png", data: base64.split(',')[1] } 
            }] 
          }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                category: { type: "STRING" },
                name: { type: "STRING" }
              },
              required: ["category", "name"]
            }
          }
        })
      });
      const result = await response.json();
      const parsed = JSON.parse(result.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
      
      const foundCategory = CATEGORIES.find(c => c.label === parsed.category) || { id: "0_不明", label: "不明" };
      const itemName = (parsed.name || "装備").replace(/[\\/:*?"<>|]/g, "").substring(0, 25);
      
      const now = new Date();
      const timestamp = `${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
      
      return { categoryId: foundCategory.id, itemName, timestamp };
    } catch { 
      return { categoryId: "0_不明", itemName: `装備_${Date.now()}`, timestamp: "" }; 
    }
  };

  const buildFilename = (categoryId: string, itemName: string, timestamp: string) => {
    const isAccessory = categoryId.includes("アクセサリー");
    const overlapPrefix = isAccessory ? "_overlap" : "";
    return `${categoryId}${overlapPrefix}_${itemName}_${timestamp}`;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    setImages([]); // 新規アップロード時にリストをクリア
    setProcessing(true);

    const processedList: ProcessedImage[] = [];
    for (const file of files) {
      const { originalUrl, thumbUrl } = await processImage(file);
      const info = await suggestFilenameInfo(originalUrl);
      const name = buildFilename(info.categoryId, info.itemName, info.timestamp);
      
      processedList.push({ 
        id: crypto.randomUUID(), 
        name, 
        originalUrl, 
        thumbUrl,
        categoryId: info.categoryId,
        itemName: info.itemName,
        timestamp: info.timestamp
      });
    }
    
    setImages(processedList);
    setProcessing(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCategoryChange = (id: string, newCategoryId: string) => {
    setImages(prev => prev.map(img => {
      if (img.id === id) {
        const newName = buildFilename(newCategoryId, img.itemName, img.timestamp);
        return { ...img, categoryId: newCategoryId, name: newName };
      }
      return img;
    }));
  };

  const handleNameInputBlur = (id: string, newItemName: string) => {
    setImages(prev => prev.map(img => {
      if (img.id === id) {
        const newName = buildFilename(img.categoryId, newItemName, img.timestamp);
        return { ...img, itemName: newItemName, name: newName };
      }
      return img;
    }));
  };

  const downloadFile = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const downloadSet = (img: ProcessedImage) => {
    downloadFile(img.originalUrl, `${img.name}.png`);
    setTimeout(() => downloadFile(img.thumbUrl, `${img.name}_サムネ.png`), 350);
  };

  const downloadAll = () => {
    images.forEach((img, i) => {
      const baseDelay = i * 1600;
      setTimeout(() => downloadFile(img.originalUrl, `${img.name}.png`), baseDelay);
      setTimeout(() => downloadFile(img.thumbUrl, `${img.name}_サムネ.png`), baseDelay + 600);
    });
  };

  return (
    <div className="min-h-screen bg-neutral-100 p-4 md:p-8 font-sans text-neutral-900">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8 flex flex-col items-center">
          <div className="bg-white p-4 rounded-3xl shadow-sm mb-4 border border-neutral-200">
            <RefreshCw className={`text-blue-600 w-10 h-10 ${processing ? 'animate-spin' : ''}`} />
          </div>
          <h1 className="text-3xl font-black tracking-tighter text-neutral-900 underline decoration-blue-500/20">GEAR OUTLINER <span className="text-blue-600 text-lg align-top ml-1 italic">v12</span></h1>
          <p className="text-neutral-500 font-bold uppercase tracking-widest text-[10px] mt-2 italic tracking-[0.2em]">Interactive Categorizing | 2K Resolution</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-neutral-200">
            <h3 className="font-black text-[10px] uppercase tracking-widest mb-4 text-neutral-400 flex items-center gap-2">
              <span className="w-5 h-5 bg-neutral-900 text-white flex items-center justify-center rounded-full">1</span>
              Base Reference
            </h3>
            <div 
              onClick={() => baseInputRef.current?.click()}
              className={`aspect-square rounded-3xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all ${baseSilhouette ? 'border-blue-500 bg-blue-50/50 shadow-inner' : 'border-neutral-200 hover:border-blue-300'}`}
            >
              <input type="file" ref={baseInputRef} onChange={handleBaseUpload} accept="image/*" className="hidden" />
              {baseSilhouette ? (
                <img src={baseSilhouette.url} className="w-full h-full object-contain p-2 mix-blend-multiply" alt="Ref" />
              ) : (
                <div className="text-center p-4">
                  <ImageIcon className="mx-auto text-neutral-300 mb-2" size={32} />
                  <p className="text-[10px] font-black text-neutral-400 uppercase tracking-tighter">ドールシルエット</p>
                </div>
              )}
            </div>
          </div>

          <div className="md:col-span-2 bg-white p-6 rounded-[2.5rem] shadow-sm border border-neutral-200">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-black text-[10px] uppercase tracking-widest text-neutral-400 flex items-center gap-2">
                <span className="w-5 h-5 bg-neutral-900 text-white flex items-center justify-center rounded-full">2</span>
                Categorized Upload
              </h3>
              <label className="flex items-center gap-2 cursor-pointer bg-neutral-50 px-4 py-2 rounded-full border border-neutral-200 hover:bg-neutral-100 transition-all shadow-sm">
                <input type="checkbox" checked={useOutline} onChange={(e) => setUseOutline(e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500" />
                <span className="text-[10px] font-black uppercase tracking-wider">黒縁補正で輪郭を保護</span>
              </label>
            </div>
            <div 
              onClick={() => !processing && fileInputRef.current?.click()}
              className={`h-[180px] rounded-3xl border-4 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all ${processing ? 'opacity-50 grayscale pointer-events-none' : 'border-blue-100 bg-blue-50/20 hover:border-blue-500 hover:bg-white shadow-inner'}`}
            >
              <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple accept="image/*" className="hidden" />
              {processing ? (
                <div className="flex flex-col items-center gap-4">
                  <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
                  <p className="font-black text-blue-600 tracking-tighter text-lg animate-pulse uppercase text-center px-4">AI Categorizing & Processing...</p>
                </div>
              ) : (
                <div className="text-center">
                  <Upload className="mx-auto text-blue-400 mb-3" size={40} />
                  <p className="text-xl font-black tracking-tight text-neutral-800">衣装をアップロードして分類</p>
                  <p className="text-neutral-400 text-[10px] font-black uppercase tracking-widest mt-1">※アップロードすると以前のリストはクリアされます</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {images.length > 0 && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-center px-4">
              <h2 className="font-black text-2xl uppercase tracking-tighter text-blue-600 flex items-center gap-2">
                <Sparkles size={24} /> Inventories
              </h2>
              <button onClick={downloadAll} className="bg-blue-600 hover:bg-blue-700 text-white px-10 py-4 rounded-3xl font-black shadow-xl shadow-blue-200 transition-all active:scale-95 flex items-center gap-2 uppercase tracking-tighter">
                <Download size={24} /> Export All (2K)
              </button>
            </div>

            <div className="grid gap-8 pb-20">
              {images.map((img) => (
                <div key={img.id} className="bg-white rounded-[3rem] p-8 shadow-sm border border-neutral-200 flex flex-col lg:flex-row items-center gap-10 hover:shadow-lg transition-all relative">
                  <div className="flex gap-6">
                    <div className="relative group">
                      <div className="w-56 h-56 bg-[url('https://www.transparenttextures.com/patterns/checkerboard.png')] bg-neutral-100 rounded-3xl overflow-hidden flex items-center justify-center border-4 border-neutral-50 shadow-inner p-2">
                        <img src={img.originalUrl} className="max-w-full max-h-full object-contain" alt="Original" />
                      </div>
                      <span className="absolute -top-3 -left-3 bg-neutral-900 text-white text-[9px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest">2048px</span>
                    </div>
                    <div className="relative group">
                      <div className="w-48 h-48 bg-[url('https://www.transparenttextures.com/patterns/checkerboard.png')] bg-blue-50 rounded-3xl overflow-hidden flex items-center justify-center border-4 border-blue-500/20 shadow-inner p-1">
                        <img src={img.thumbUrl} className="max-w-full max-h-full object-contain" alt="Thumb" />
                      </div>
                      <span className="absolute -top-3 -right-3 bg-blue-600 text-white text-[9px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest">1024px Tight</span>
                    </div>
                  </div>
                  
                  <div className="flex-1 min-w-0 w-full space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* カテゴリーセレクター */}
                      <div className="bg-neutral-50 p-4 rounded-2xl border border-neutral-100 focus-within:border-blue-400 transition-all shadow-inner">
                        <label className="text-[10px] font-black text-neutral-400 uppercase mb-2 block tracking-widest italic flex items-center gap-1">
                          Category <ChevronDown size={10} />
                        </label>
                        <select 
                          value={img.categoryId}
                          onChange={(e) => handleCategoryChange(img.id, e.target.value)}
                          className="w-full bg-transparent border-none font-bold text-lg outline-none text-neutral-900 appearance-none cursor-pointer"
                        >
                          {CATEGORIES.map(cat => (
                            <option key={cat.id} value={cat.id}>{cat.label}</option>
                          ))}
                        </select>
                      </div>

                      {/* 詳細名入力 */}
                      <div className="bg-neutral-50 p-4 rounded-2xl border border-neutral-100 focus-within:border-blue-400 transition-all shadow-inner">
                        <label className="text-[10px] font-black text-neutral-400 uppercase mb-2 block tracking-widest italic">Item Detail Name</label>
                        <input 
                          type="text" 
                          defaultValue={img.itemName}
                          onBlur={(e) => handleNameInputBlur(img.id, e.target.value)}
                          className="w-full bg-transparent border-none font-bold text-lg outline-none text-neutral-900 tracking-tight"
                        />
                      </div>
                    </div>

                    {/* プレビューファイル名 */}
                    <div className="bg-neutral-100/50 p-3 rounded-xl border border-neutral-200">
                      <p className="text-[9px] font-black text-neutral-400 uppercase mb-1 tracking-widest">Preview Full Filename</p>
                      <p className="text-xs font-mono text-neutral-500 truncate">{img.name}.png</p>
                    </div>

                    <div className="flex gap-4">
                      <button 
                        onClick={() => downloadSet(img)} 
                        className="flex-1 bg-neutral-900 text-white py-5 rounded-[1.5rem] text-[12px] font-black hover:bg-black transition-all uppercase tracking-[0.3em] shadow-lg active:scale-95 flex items-center justify-center gap-2"
                      >
                        <Download size={20} /> Download Set
                      </button>
                      <button onClick={() => setImages(images.filter(i => i.id !== img.id))} className="bg-neutral-100 text-neutral-400 hover:text-red-500 hover:bg-red-50 p-5 rounded-[1.5rem] transition-all">
                        <Trash2 size={28} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
