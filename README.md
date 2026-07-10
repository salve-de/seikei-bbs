# Political Economy Bulletin Board

政治・経済の論点を `匿名 / 半匿名` で立てて、議論、通報、簡易モデレーションまで回せるローカル掲示板。

## できること

- 少数の部屋 + タグによる論点整理
- リンク付きスレ立て
- メガスレ、固定、ロック、slow mode
- 検索、並び替え、詳細表示
- コメント投稿
- 通報キューと簡易モデレーション操作
- JSON ファイルへの永続化

## 起動

```bash
npm start
```

ブラウザで `http://localhost:4173` を開く。

## 開発チェック

```bash
npm run check
```

## ディレクトリ

- `server.js`: API、板データ、通報、永続化
- `public/index.html`: UI
- `public/styles.css`: スタイル
- `public/app.js`: フロントロジック
- `data/threads.json`: スレッド永続化
- `data/comments.json`: コメント永続化
- `data/reports.json`: 通報キュー永続化

## 主要 API

- `GET /api/board`: 板全体、部屋、スレ一覧、モデレーション要約
- `GET /api/threads/:threadId`: スレ詳細とコメント
- `POST /api/threads`: 新規スレ作成
- `POST /api/threads/:threadId/comments`: コメント投稿
- `POST /api/reports`: スレ / コメント通報
- `GET /api/moderation/queue`: 保留通報
- `POST /api/moderation/threads/:threadId`: 固定 / ロック / slow mode
- `POST /api/moderation/reports/:reportId`: 通報解決 / 却下

## データ初期化

- 起動時に `data/*.json` を読み込む
- 旧 RSS 形式のデータを検出した場合は、掲示板向けのシードデータへ自動で置き換える
- 以後はスレ、コメント、通報がローカル JSON に保存される

## 限界

- まだユーザー認証はない
- 権限管理はローカル運営前提の簡易版
- 重複トピックの高度なクラスタリングは未実装
- レート制限はインメモリなので再起動でリセットされる
- 本番運用には認証、監査ログ、削除依頼導線、運営権限分離が必要
