# seikei-bbs

政治・経済を扱う匿名掲示板のプロトタイプです。

## 起動

```bash
npm install
npm start
```

通常は `http://localhost:4173` で起動します。ポートが使用中の場合は、次の空きポートへ切り替わります。

## 検証

```bash
npm run check
npm test
npm run build
```

## 保存

- ローカル起動: `data/*.json`
- 公開環境: D1
- ブラウザ: ウォッチ、投票済み状態、匿名セッション、未読

## 主な構成

- `server.js`: ローカルAPIとJSON保存
- `worker/index.js`: 公開APIとD1保存
- `public/`: HTML、CSS、JavaScript
- `data/`: 初期データ
- `drizzle/`: D1スキーマ
- `test/`: APIテスト

## 公開前の確認事項

- レート制限
- 通報機能
- 運営APIの認証
- 削除依頼窓口
- 監査ログ
- 権利侵害、脅迫、個人情報への対応手順
