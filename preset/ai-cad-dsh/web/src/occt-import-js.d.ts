// src/occt-import-js.d.ts — occt-import-js 无自带类型声明。
// 本包仅用 `occtimportjs({ wasmBinary })` 返回 Promise<Occt>（见 occt.ts），
// loose any 声明即可满足，运行时形态由 occt.ts 的 Occt 接口自行约束。
declare module 'occt-import-js';
