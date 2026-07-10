# Political Economy Bulletin Board

政治・経済のニュースを一次情報に紐づけ、`匿名 / 半匿名` で感情と論点を残せるローカル掲示板。

## できること

- 少数の部屋 + タグによる論点整理
- 今日の争点と感情リアクション
- 出典 URL と対象（政策 / 議員 / 政党 / 地域 / 経済指標）を必須にしたスレ立て
- 公式情報を出典にした議員一覧、議員詳細、関連スレ
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
- `public/index.html`: 今日の争点 UI
- `public/politicians.html`: 議員一覧
- `public/politician.html`: 議員詳細と関連スレ
- `public/styles.css`: スタイル
- `public/*.js`: 画面別のフロントロジック
- `data/politicians.json`: 公式出典と確認日を持つ初期議員データ
- `data/threads.json`: スレッド永続化
- `data/comments.json`: コメント永続化
- `data/reports.json`: 通報キュー永続化

## 主要 API

- `GET /api/board`: 板全体、部屋、スレ一覧、モデレーション要約
- `GET /api/threads/:threadId`: スレ詳細とコメント
- `GET /api/politicians`: 議員一覧と活動数
- `GET /api/politicians/:politicianId`: 議員詳細と関連スレ
- `POST /api/threads`: 新規スレ作成
- `POST /api/threads/:threadId/reactions`: 感情リアクション
- `POST /api/threads/:threadId/comments`: コメント投稿
- `POST /api/reports`: スレ / コメント通報
- `GET /api/moderation/queue`: 保留通報
- `POST /api/moderation/threads/:threadId`: 固定 / ロック / slow mode
- `POST /api/moderation/reports/:reportId`: 通報解決 / 却下

## データ初期化

- 起動時に `data/*.json` を読み込む
- 旧形式のスレには対象、出典、リアクションを一度だけ補完する
- 以後はスレ、コメント、通報がローカル JSON に保存される

## 議員データ

- 初期データは衆議院・参議院の公式議員情報を出典にしている
- 各レコードに `verifiedAt` と `sourceUrl` を保持する
- 現時点では少数の対象だけを収録し、全国会議員の自動同期は未実装

## 限界

- まだユーザー認証はない
- 権限管理はローカル運営前提の簡易版
- リアクションの重複防止はインメモリで、再起動するとリセットされる
- 重複トピックの高度なクラスタリングは未実装
- レート制限はインメモリなので再起動でリセットされる
- 本番運用には認証、監査ログ、削除依頼導線、運営権限分離が必要
