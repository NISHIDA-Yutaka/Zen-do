# 開発環境セットアップ手順（別マシンで再開する時）

職場↔自宅など、別のPCで開発を再開するときの手順。

## 前提: 必要なもの

- **Node.js 22 以上**（`node -v` で確認。無ければ [nodejs.org](https://nodejs.org) からLTS版をインストール）
- **git**
- Supabaseプロジェクトの接続情報2つ（`SUPABASE_URL` と `SUPABASE_SECRET_KEY`）

## 手順

### 1. リポジトリを取得

```bash
git clone https://github.com/NISHIDA-Yutaka/Zen-do.git zendo
cd zendo
```

（既にcloneしてある2回目以降は `git pull` で最新を取得）

> **初回の認証**: push/pull時にブラウザが開いてGitHubのサインインを求められたら、パスキーでサインイン。
> ユーザー名/パスワードを聞く古いダイアログが出た場合はGitが古すぎるサイン（GitHubはパスワード認証を廃止済み）。
> `winget upgrade --id Git.Git` でGit本体を最新にすること（職場PCは2.23→2.55への更新で解決した実績あり）。

### 2. 依存パッケージをインストール

```bash
npm install
```

`node_modules/` はgitに含めていないので、マシンごとに毎回必要。

### 3. `.env.local` を作る（重要）

`.env.local` は秘密情報なのでgitには入っていない（＝cloneしても付いてこない）。
**マシンごとに手作業で作る**必要がある。

1. リポジトリ直下に `.env.local` という名前のファイルを新規作成
2. `.env.local.example` の中身をコピーして貼る
3. 値を埋める。最低限、アプリを動かすのに今必要なのは以下の2つ:
   - `SUPABASE_URL` … Supabaseダッシュボード → Project Settings → API の Project URL
   - `SUPABASE_SECRET_KEY` … 同 API画面の Secret key（`sb_secret_...`）
   - 他（`ANTHROPIC_API_KEY` / `CRON_SECRET` / VAPID鍵 / `APP_TIMEZONE`）は該当機能を実装する時までは空でOK

> 値は毎回Supabaseダッシュボードからコピーし直せる。秘密情報をメールやチャットで送らないこと。

### 4. 開発サーバー起動

```bash
npm run dev
```

ブラウザで `http://localhost:3000` を開く（自動で `/today` にリダイレクトされる）。

## よくある確認事項

- **DBは再構築しなくてよい**: Supabaseはクラウド上にあり、全マシンで同じDBを共有する。マイグレーション（テーブル作成）は最初の1回だけ適用済みなので、別マシンで改めて実行する必要はない。
- **`.env.local` を忘れると**: DBアクセスを伴う機能でエラーになる。今はまだ画面が静的な骨組みだけなので `npm run dev` 自体は動くが、実装が進んだら必須。
- **改行コードの警告（LF/CRLF）**: Windowsでgit操作時に出るが無害。
