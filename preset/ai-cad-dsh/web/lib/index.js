// @ai-cad/cad3d-preview 宿主半区（Node）。纯 UI 插件：空 apply 使插件出现在宿主
// Loader（cordis 插件树 import 裸包名能解析到本文件）；浏览器半区经 package.json
// 的 dsh.client 声明 + exports["./client"] 被发现并服务到 /plugins/<id>/client.js。
/** Host plugin body — no host-side behavior for the 3D preview plugin. */
function apply() {}
export { apply };
