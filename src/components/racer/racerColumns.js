// 選手一覧の列定義（デスクトップの表の見出しと、URL の sort に受け付けるキー）。
// コンポーネントのファイルから定数を export すると Fast Refresh が効かなくなるので分けている
export const COLUMNS = [
  { key: "name", label: "選手名", sortable: false },
  { key: "branch", label: "支部", sortable: true },
  { key: "height_cm", label: "身長", sortable: true },
  { key: "weight_kg", label: "体重", sortable: true },
  { key: "grade", label: "級別", sortable: true },
  { key: "registration_period", label: "登録期", sortable: true },
  { key: "hometown", label: "出身地", sortable: true },
  { key: "winRate", label: "勝率", sortable: true },
  { key: "age", label: "年齢", sortable: true },
];

// URL の sort に受け付けるキー（列のキーそのもの）。モバイルの折りたたみ行も同じキーで並べる
export const SORTABLE_KEYS = COLUMNS.filter((c) => c.sortable).map(
  (c) => c.key,
);
