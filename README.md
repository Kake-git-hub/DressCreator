# Dress Creator - Gear Outliner

着せ替えアプリ用の衣装画像処理ツールです。

## 機能

- 衣装画像の背景除去（グリーンバック / ホワイト / ドールシルエット参照）
- AI による自動カテゴリ分類（Gemini API）
- 2048px オリジナル + 1024px サムネイル出力
- 黒縁補正で輪郭を保護

## 使い方

1. **Base Reference**: ドールのシルエット画像をアップロード（オプション）
2. **Categorized Upload**: 衣装画像をアップロード
3. AIが自動でカテゴリ分類・名前提案
4. 必要に応じてカテゴリ・名前を編集
5. Download Set または Export All でダウンロード

## 環境変数

AI分類機能を使用する場合は、環境変数 `VITE_GEMINI_API_KEY` を設定してください。

## 開発

```bash
npm install
npm run dev
```

## ビルド

```bash
npm run build
```

## ライセンス

MIT
