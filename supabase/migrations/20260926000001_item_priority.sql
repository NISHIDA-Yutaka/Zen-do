-- タスクの重要度（1〜4）を追加（docs/design.md 21章）。
-- アイゼンハワーマトリクスの4象限に対応させる: 1=緊急かつ重要 / 2=重要だが緊急でない / 3=緊急だが重要でない / 4=どちらでもない。
-- null は「まだ決めていない」。4（いちばん低い）と区別し、LINE通知の振り分けで未判定を扱えるようにする。

alter table items add column priority smallint
  check (priority is null or priority between 1 and 4);

comment on column items.priority is
  '重要度（1〜4・1が最も重要）。アイゼンハワーマトリクスの象限。nullは未設定（docs/design.md 21章）';
